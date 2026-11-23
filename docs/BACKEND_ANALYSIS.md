# Backend Analysis — ProductScanning

> Scope: read-only analysis of `backend/`. No backend file was modified, no migration or server was run.
> `backend/.env` exists but its values were not inspected — only variable names are listed.
> Source of truth is `backend/src/`; `backend/dist/` is compiled output.

---

## 1. Architecture and technology stack

| Item | Finding |
|---|---|
| Runtime | Node.js + Express 4.21 (`backend/package.json`) |
| Language | TypeScript, run in dev with `tsx watch src/server.ts`, built with `tsc` to `dist/` |
| Server entry | `backend/src/server.ts` — port default **3001**, binds `0.0.0.0` |
| Database | MySQL (`mysql2/promise`) by default; MongoDB (`mongodb@6`) when `DB_CLIENT=mongo` — `src/config/database.ts:8` |
| Uploads | `multer`; GridFS in Mongo mode, disk (`backend/uploads/`) in MySQL mode — `src/config/upload.ts` |
| Realtime | `ws` server at `GET /api/ws?token=...&division=...` — `src/realtime/hub.ts`; plus SSE `GET /api/loading-sessions/active/stream` |
| Other deps | `bcryptjs`, `compression`, `cors`, `dotenv`, `exceljs`, `helmet`, `jsonwebtoken` (unused for tokens), `ws`, `xlsx` |

Global middleware order (`src/server.ts:56-122`): `helmet` → `compression` → `cors` (credentials, `CORS_ORIGIN` allowlist) → `express.json({ limit: '2mb' })` → response sanitizer (strips `_id`, `password_hash`, `token_hash`, `refresh_token_hash`, `logo_data`, `email_key`) → `X-Request-Id` → global rate limit (600/min) → login rate limit (20/min).

Public routes: `GET /uploads/:filename`, `GET /api/tenants/:tenantId/logo`, `POST /api/tenant-logo`, `GET /api/health`.

`GET /api/health` → `{ status, database, uptime_seconds, server_time }`.

---

## 2. Authentication mechanism

### Token format (important for the mobile client)
`backend/src/services/tokens.ts` uses **AES-256-GCM authenticated encryption**, not JWT signing, despite `JWT_*` naming. The token is **opaque** and must be treated as a string:

```
v1.<iv-base64url>.<authTag-base64url>.<ciphertext-base64url>
```

Payload fields: `userId`, `role`, `name`, `email`, `table`, `tenantId`, `iat`, `exp`. Access token TTL default `JWT_ACCESS_TOKEN_SECONDS=900` (15 min). `JWT_SECRET` must be at least 32 characters.

### Transport
- REST: `Authorization: Bearer <token>` (`src/middleware/auth.mongo.ts:17`, `auth.mysql.ts:18`). Missing → `401 { error: 'Authentication required' }`.
- Division scoping: optional `X-Division-Id` header (`all` or absent = tenant-wide for ADMIN).
- WebSocket: token passed as query param. Invalid token → `ws.close(1008, 'Unauthorized')`.

### Middleware (`src/middleware/auth.*.ts`)
Decrypts token → validates `table ∈ {admins, qc_users, dispatch_users}` → loads user row (`401` if missing, `403` if `is_active !== 1`) → checks tenant match and active division → sets `req.user` with derived `divisionId`.

### Auth endpoints (`src/routes/auth.ts`)

| Endpoint | Auth | Request | Response |
|---|---|---|---|
| `POST /api/auth/register` | public | `{ name, companyName, email, mobile\|phone, password }` (password ≥ 12 chars) | `201 { token, refreshToken, refreshExpiresAt, user:{id,tenantId,name,email,role:'ADMIN'}, tenant }` |
| `POST /api/auth/login` | public + rate limit | `{ email, password, device_uuid? }` | `{ token, refreshToken, refreshExpiresAt, user:{id,tenantId,name,email,role} }` |
| `POST /api/auth/refresh` | public | `{ refreshToken, device_uuid? }` | Same shape as login; refresh token is rotated |
| `POST /api/auth/logout` | Bearer | `{ refreshToken?, allDevices? }` | `{ message: 'Signed out' }` |
| `GET /api/auth/me` | Bearer | — | User row plus aliases `tenantId`, `divisionId`, `divisionName`, `role` |
| `GET/PUT /api/auth/tenant` | Bearer | `{ name, email, phone, logoUrl }` | Tenant object |
| `GET/PUT /api/auth/tenant/printer-label-size` | Bearer (PUT ADMIN) | `{ widthMm, heightMm }` | `{ widthMm, heightMm }` (defaults 60×64) |

Errors: `400` validation, `401 'Invalid credentials'`, `403` deactivated/no tenant/no division. Login-specific rate limit: 20/min default.

Refresh tokens are 96-char random hex; only their SHA-256 hash is stored in `refresh_tokens`; default lifetime 30 days (`REFRESH_TOKEN_DAYS`).

---

## 3. Supported user roles

Exact, case-sensitive values: **`ADMIN`**, **`QC`**, **`DISPATCH`** — `src/types/index.ts:1`.

- Map of user tables → roles: `admins → ADMIN`, `qc_users → QC`, `dispatch_users → DISPATCH` (`src/controllers/userController.mongo.ts:9-13`).
- Authorization middleware `authorize(...roles)` returns `401` when unauthenticated and `403 { error: 'Insufficient permissions' }` for a wrong role (`src/middleware/auth.mongo.ts:85-97`, `auth.mysql.ts:87-99`).
- Permission pattern (not exhaustive):
  - ADMIN only: `/api/users`, `/api/divisions`, `/api/reports`, master-data writes, import validate/apply, reprint-request review, `/dispatch-orders/all`, printer label size PUT.
  - ADMIN + QC: QC decisions/stats/pending/records, storage writes, vendor list.
  - ADMIN + DISPATCH: batch group create, dispatch order raise/cancel/recall, QR job list/print/reprint, loading session lifecycle.
  - All three: `/api/sync/*`, printer certificate/sign, `GET /loading-sessions/active`.

---

## 4. API endpoints (mounted in `src/server.ts:115-145`)

All paths below are relative to `EXPO_PUBLIC_API_URL` (which must include `/api`).

| Prefix | Key endpoints |
|---|---|
| `/api/auth` | see §2 |
| `/api/users` | `GET /`, `POST /`, `GET /paged`, `GET /import/template`, `POST /import/validate\|apply`, `GET/PUT/PATCH/DELETE /:type/:id` (ADMIN) |
| `/api/profile` | `PUT /` |
| `/api/divisions` | `GET|POST /`, `PUT|DELETE /:id` (ADMIN) |
| `/api/products` | `GET /`, `GET /search`, `GET /:id`, `GET /families`, `POST /` (ADMIN), family management (ADMIN) |
| `/api/products/import` | `GET /template`, `POST /validate\|apply` (ADMIN, multipart `file`) |
| `/api/batches` | `GET /`, `GET /groups`, `GET /search`, `GET /barcode/:barcode`, `GET/PUT /:id`, `POST /group` (ADM/DISPATCH), `POST /:id/finish-goods` (ADM/QC) |
| `/api/qc` | `POST /batch-groups/:id/decision` (ADM/QC), `POST /batch-groups/decisions/bulk` (ADM/QC), `GET /stats\|pending\|records`, `GET /qr-jobs` (ADM/DISPATCH), `GET /qr-jobs/:id`, `POST /qr-jobs/:id/print`, `/reprint`, `/reprint-request`, print-result, reprint-request review/complete |
| `/api/dispatch` | `GET /today`, `/stats`, `/ready`, `/records`, `/approved-orders` |
| `/api/dispatch-orders` | `POST /`, `GET /mine`, `/history`, `GET /available-qr-labels`, `POST /:id/cancel`, `POST /recall-qr`, `GET /:id/packing-list`, `/packing-list.pdf`; `GET /all` (ADMIN) |
| `/api/dashboard` | `GET /`, `GET /admin` (ADMIN) |
| `/api/activity` | `GET /` |
| `/api/shelf-locations` | CRUD (writes ADM/QC) |
| `/api/storage` | `GET /`, `GET /inventory`, `GET /:id`, CRUD (writes ADM/QC) |
| `/api/clients`, `/api/vendors`, `/api/masters/:kind` | CRUD + Excel import; writes mostly ADMIN |
| `/api/reports` | `GET /summary\|qc\|dispatch\|dispatch-requests\|inventory\|batches` (ADMIN) |
| `/api/sync` | `POST /register\|push`, `GET /pull\|status`, `POST /attachments` (all roles, rate limited) |
| `/api/production` | `GET /batches`, legacy fix endpoints (ADMIN) |
| `/api/loading-sessions` | `POST /`, `GET /active`, `GET /active/stream` (SSE), `GET /by-order/:orderId`, `GET /:id`, `POST /:id/scan\|recall-qr\|recall-sealed\|reload\|finalise\|cancel`, `PATCH /:id/seal` |
| `/api/printer` | `GET /certificate`, `POST /sign` (all three roles) |

### Retired endpoints (return HTTP 410 — do not call from the mobile app)
`POST /api/batches/`, `POST /api/qc/`, `POST /api/qc/bulk`, `POST /api/qc/batches/:id/reopen`, `POST /api/qc/qr-jobs`, `POST /api/dispatch/`, `POST /api/dispatch/bulk`.
The 410 message says batch creation is "auto-passed" but `batchGroupController.mongo.ts:228` actually returns `PENDING_QC`. **Contradiction to clarify with the backend team.**

---

## 5. Key request/response structures (verbatim field names)

```ts
// Batch group creation — POST /api/batches/group
{
  items: [{ product_id, quantity, package_quantity, uom, shelf_location_id,
            warehouse_id, avg_standard_quantity?, manufacturing_date, expiry_date }],
  client_operation_id?
}
// 201: { id, batch_group_id, batch_number, product_count, total_quantity,
//        batches, labels, status: 'PENDING_QC', message }

// QC decision — POST /api/qc/batch-groups/:id/decision
{ result: 'PASS' | 'FAIL', remarks? }
// { group_id, batch_number, status, result, unit_count, product_count, remarks, message }

// Dispatch order — POST /api/dispatch-orders/
{ batch_id? | barcode_value? | items?: [{ batch_id, quantity, label_ids }],
  client_id, driver_name, driver_phone, vehicle_number, container_number,
  quantity?, expected_status?, scheduled_dispatch_at?, client_operation_id? }
// 201 order enriched with: outcome, batch_number, barcode_value, quantity,
// items[].qr_values, uom, batch_status, storage_location, vendor_name,
// grade_name, bag_quantity_name, bag_quantity, bag_quantity_unit, qr_count,
// qr_values, product_name, product_sku, raised_by_name, admin_name,
// client_name, approver_name

// Loading session — POST /api/loading-sessions/
{ dispatch_order_id }
// 201: { session, order_id, order_number, batch_number, product_name,
//        grade_name, order_lines, qr_values, total }

// Scan — POST /api/loading-sessions/:id/scan
{ qr_value, client_operation_id? }
// { result: 'OK'|'DUPLICATE'|'WRONG_BATCH'|'QTY_EXCEEDED', scanned, total, event_id, duplicate }

// Finalise — POST /api/loading-sessions/:id/finalise
{ driver_name, driver_phone, vehicle_number, container_number, seal_number,
  outcome: 'DISPATCHED'|'NOT_DISPATCHED', remarks?, client_operation_id? }

// Sync push — POST /api/sync/push
{ operations: [{ operation_id, type, payload, client_timestamp? }], device_uuid? }
```

Batch status values: `PENDING_QC | QC_PASSED | QC_FAILED | DISPATCH_ORDER_RAISED | DISPATCH_APPROVED | LOADING | DISPATCHED | NOT_DISPATCHED`.
Dispatch order status: `PENDING | APPROVED | REJECTED | CANCELLED | CLOSED_DISPATCHED | CLOSED_NOT_DISPATCHED` (legacy PENDING/REJECTED).
Loading scan results: `OK | DUPLICATE | WRONG_BATCH | QTY_EXCEEDED | RECALLED`.
Sync operation types: `QC_SUBMIT`, `QC_SUBMIT_BULK`, `DISPATCH_ORDER_RAISE`, `DISPATCH_CONFIRM`, `DISPATCH_CONFIRM_BULK`, `BATCH_CREATE_AUTO_PASS`, `LOADING_SESSION_START`, `LOADING_SESSION_SCAN`, `LOADING_SESSION_FINALISE`.

List endpoints generally return `{ items, total, page, limit, pages }`. `GET /api/storage/inventory` returns `{ rows, total, page, limit, pages, summary }`. Error bodies are usually `{ error, code? }`; validation codes are ad-hoc (e.g. `MISSING_TRANSPORT_DETAILS`, `QTY_EXCEEDED`, `INVALID_DISPATCH_ORDER_ID`).

---

## 6. Existing business modules

Auth/tenants, users/roles/divisions, products & families, Excel imports, batches & batch groups, QC (decisions + reprint review), QR labels/print jobs, dispatch orders, dispatch records, loading & scanning (with recall/reload/seal/finalise), inventory, storage (godowns/racks), shelf locations, clients/vendors, master data (`grades`, `bag-quantities`, `uoms`), dashboard/activity/reports, offline sync, realtime WebSocket, uploads, health.

---

## 7. Frontend integration requirements

1. Configure `EXPO_PUBLIC_API_URL` with the `/api` suffix. No URL literals in screens.
2. Call `POST /api/auth/login` with `{ email, password }`; store the opaque `token`; send it as `Authorization: Bearer ...` on every protected request.
3. Read the role from `login.user.role` (already uppercase); redirect ADMIN → `/admin`, QC → `/qc`, DISPATCH → `/home`.
4. Handle 15-minute access tokens: implement refresh via `POST /api/auth/refresh` with the stored `refreshToken` before enabling real API mode.
5. Send `X-Division-Id` when division scoping is needed.
6. Expect both `{ error }` and `{ error, code }` error shapes; surface `error` text.
7. For live updates use WS `/api/ws?token=...` or the loading SSE stream; both are push-notifications to refetch, not full data payloads.
8. Do not call the HTTP-410 endpoints listed above.
9. Image uploads: max 2 MB and only PNG/JPEG/WebP/SVG; Excel imports max 10 MB.

---

## 8. Environment configuration (names only)

`DB_CLIENT`; MySQL: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_POOL_SIZE`, `DB_QUEUE_LIMIT`, `DB_CONNECT_TIMEOUT_MS`; Mongo: `MONGO_URI`, `MONGODB_URI`, `MONGO_DB_NAME`, `MONGODB_DB`, `MONGO_MAX_POOL_SIZE`, `MONGO_CONNECT_TIMEOUT_MS`; auth: `JWT_SECRET`, `JWT_ACCESS_TOKEN_SECONDS`, `REFRESH_TOKEN_DAYS`; server: `PORT`, `CORS_ORIGIN`, `UPLOADS_DIR`; rate limits: `API_RATE_LIMIT_PER_MINUTE`, `LOGIN_RATE_LIMIT_PER_MINUTE`, `SYNC_RATE_LIMIT_PER_MINUTE`, `PRINT_RATE_LIMIT_PER_MINUTE`; printing: `QZ_CERTIFICATE`, `QZ_PRIVATE_KEY`; dispatch: `ALLOW_DIRECT_DISPATCH`; scripts: `BASE_URL`.

No backend secret values were read or copied into the frontend.

---

## 9. Unclear, inconsistent or missing information (documented, not fixed)

1. `POST /api/qc/qr-jobs/:id/print` is registered twice (`src/routes/qc.ts:23` and `:31`); the first registration wins, so the print rate limiter is ineffective.
2. Several retired endpoints remain mounted and return 410; the 410 text contradicts actual `PENDING_QC` batch-group creation behaviour.
3. Nearly every controller has duplicated `.mysql.ts` and `.mongo.ts` implementations; they are not fully identical (e.g. `/auth/me` projections).
4. `JwtPayload.divisionId` is declared but never written into the token; the realtime hub may see `undefined` for non-admin sockets.
5. `jsonwebtoken` is a dependency and `JWT_*` names are used, but tokens are AES-GCM blobs, not JWTs — do not attempt to decode them client-side.
6. QC cannot list QR print jobs or raise dispatch orders, yet can decide batches — confirm intended UX.
7. Route ordering is sensitive (static paths before `/:id`); `/api/products/import` is mounted after `/api/products` and is currently fragile.
8. There is no `/api/qr-labels` route; QR label APIs live under `/api/qc/qr-jobs`.
9. Generic errors return only `500 { error: 'Internal server error' }`; no global structured validation error contract.
10. Rate limits are per-process/in-memory, not global across instances.
