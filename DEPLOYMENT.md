# Deployment: Vercel frontend and Render backend

The API deducts a batch's quantity from its product's `quantity` when dispatch
is confirmed. This applies to single and bulk dispatches in both supported
database implementations, and the Products screen reads the updated stock.
Repeated offline submissions are idempotent and do not deduct stock twice.

## 1. Prepare the database

The Render blueprint in `render.yaml` defaults to MongoDB. Create a MongoDB
Atlas database and a database user, then set `MONGO_URI` in Render to the
Atlas connection string. Keep the username/password URL-encoded if they contain
special characters. Allow connections from the Render service in Atlas Network
Access and use a strong, database-scoped password.

MySQL can be used instead if you have a reachable managed MySQL server: set
`DB_CLIENT=mysql` and configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`,
and `DB_NAME` in Render instead of `MONGO_URI`.

## 2. Deploy the backend to Render

Create a Render Blueprint from this repository and deploy the `inventory-track-api`
web service defined in `render.yaml`. The service builds with `npm ci && npm run
build`, starts with `npm run start`, and checks `/api/health`.

Dispatch and QC image uploads are stored in MongoDB GridFS, so the backend
does not need an uploads directory or a Render persistent disk. Excel imports
are processed in memory and are not retained after processing.
Remove any previously configured `UPLOAD_DIR` variable and disk mount from the
Render service; they are no longer used.

After deployment, copy the Render service URL, for example
`https://inventory-track-q551.onrender.com`.

The mobile EAS build profiles use this Render service URL for
`EXPO_PUBLIC_API_URL`. If the Render service has a different URL, update
`mobile/eas.json` before creating an APK or app bundle. Do not use a private
LAN address there: Expo Go can reach a development backend through Metro, but
an installed app needs a backend URL reachable from the device.

## 3. Deploy the frontend to Vercel

Import the repository into Vercel and set **Root Directory** to `frontend`.
Vercel uses `frontend/vercel.json` for the Vite build output and SPA route
fallback. In the Vercel project environment variables, set:

| Variable | Value |
| --- | --- |
| `API_URL` | Your Render service origin, e.g. `https://inventory-track-q551.onrender.com` (no `/api` suffix) |

Redeploy after setting the variable. `API_URL` is embedded during the
frontend build, so changing it requires a new deployment.

## 4. Set backend environment variables

In the Render service's Environment settings, set:

| Variable | Value |
| --- | --- |
| `MONGO_URI` | Your MongoDB Atlas connection string. Required with the blueprint's `DB_CLIENT=mongo`. |
| `CORS_ORIGIN` | The exact Vercel site origin, e.g. `https://your-project.vercel.app`; add custom domains as comma-separated origins. |
| `JWT_SECRET` | Render generates a secret through the blueprint. Keep it private and do not change it after launch unless you intend to invalidate existing sessions. |
| `DB_CLIENT` | Keep `mongo` for Atlas. For MySQL, switch to `mysql` and supply all `DB_*` connection settings. |

Render supplies `PORT` automatically. `MONGO_DB_NAME` is optional when the
database name is included in `MONGO_URI`. Do not put backend secrets in Vercel
or commit them to the repository.

MongoDB is also required for GridFS file storage, including when the primary
application data backend is configured as MySQL.

When using a custom Vercel domain, include its origin in `CORS_ORIGIN` and
redeploy/restart the Render service. If using Vercel preview deployments, add
the appropriate preview origins too.

## 5. Tenant isolation (multi-workspace)

The API enforces tenant isolation server-side. Every business table carries a
`tenant_id` column (MongoDB: hex-string ObjectId of the `tenants` document;
MySQL: BIGINT UNSIGNED referencing `tenants.id`) and every query issued by the
API is filtered by the caller's tenant from their access token; inserts are
stamped with it. There is no tenant id in any request payload — it is always
derived from the token, and the middleware re-checks that the token tenant
matches the user row in the database on every request.

Scope notes:

- Global keys that remain unique install-wide: user email (single identity per
  install), idempotency operation ids, refresh-token hashes, `device_uuid`.
  Everything else that must be reusable across workspaces (product SKU, batch
  barcode, shelf `location_code`, vendor code, grade / UOM / bag-quantity name,
  QR value, dispatch order number `DO-<YYYY>-<n>`, batch-group number) is
  unique per `(tenant_id, ...)` instead.
- Fresh installs: `database/init.sql` creates the tenant schema natively.
- Upgrades: the idempotent startup migration (`ensureAdminSchema()`) adds the
  columns, backfills pre-existing rows to the `__legacy_workspace__` tenant,
  and swaps the legacy global unique indexes for tenant-scoped composites. It
  is safe to re-run.
- Seeding: `npm run seed` rebuilds the demo tenant `Aceone Inventory`
  (`admin@gmail.com` / `qc@gmail.com` / `dispatch@gmail.com`) and links the
  three accounts to it. Self-serve `POST /api/auth/register` creates a new
  tenant plus its first ADMIN account and an internal `SELF` vendor.
- Offline sync (`/api/sync/*`) is tenant-scoped: devices only ever receive
  their tenant's products/batches/orders/QC data.
- Tenant logos are served unauthenticated by design (`GET /api/tenants/:id/logo`,
  used by `<img>` tags); they carry no business data. Attachments under
  `/uploads/:filename` use unguessable random names and are public by design.

## 6. Divisions (manufacturing units within a tenant)

A tenant can run several **divisions** (plants / manufacturing units) that share
the tenant's directory data (clients, vendors, UOMs, bag quantities, users) but
keep their operational data separate. Products, grades, batches, QR labels,
QC records, dispatch orders and records, fix records, packing-list items,
loading sessions, warehouses, storage racks, shelf locations and activity logs
carry a nullable `division_id`; `NULL` means shared tenant-wide (the default,
and what all pre-divisions rows become, so existing data keeps working).

- The single ADMIN sees everything by default. A division switcher in the
  top bar (top-right) scopes the whole session to one division: reads filter to
  it (plus shared rows) and anything the admin creates is stamped with it
  (`X-Division-Id: all`, or no selection, restores tenant-wide).
- QC and DISPATCH members are assigned to one division at creation time (Users
  page) and see only that division plus shared rows; they are unaffected by the
  admin's switcher.
- Divisions are managed from the **Divisions** page (list, create, rename,
  activate/deactivate, delete when unused).
- Fresh installs and upgrades both get the schema automatically (`init.sql` /
  `ensureAdminSchema()`); no manual migration is needed.
