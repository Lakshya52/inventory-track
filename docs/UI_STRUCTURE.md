# UI Structure — Mobile Designs

> Source: all **23** images in `mobileUiImages/`. Every image was opened and inspected.
> Original images were not modified, renamed, moved or deleted.
> Role attribution is based on the visible bottom navigation, screen titles and the task brief.
> These are design references only — this phase creates placeholders, not final UI.

---

## 1. Common Authentication

| Image | Screen | Notes |
|---|---|---|
| `login common page.png` | **Common Login** (all roles) | Centred "Login" title, "Email id" field, "Password" field, dark-blue "Login" button. No role selector in the design — role is resolved after authentication. |

There are **no** separate Admin, QC or Dispatch login designs. Implemented as one `/login` route with development-only role shortcut buttons below the real-looking form.

---

## 2. Admin UI

**No Admin design images are present** in `mobileUiImages/`.

Only the Admin dashboard foundation was created (`/admin`). Detailed Admin navigation will be supplied in a later phase; no tabs, workflows or screens were invented.

---

## 3. QC UI

**No QC design images are present** in `mobileUiImages/`.

Only the QC dashboard foundation was created (`/qc`). Detailed QC navigation will be supplied in a later phase; no tabs, workflows or screens were invented.

---

## 4. Dispatch UI

The images below all show the same five-item bottom navigation bar:
**Home · Batches · QR Print · Dispatch · Loading** — therefore they all belong to the Dispatch role.

### 4.1 Main tab screens

| Image | Screen / tab | Description |
|---|---|---|
| `Home page for dispatch.png` | **Home** (`/home`) | Header: KJ logo + "Home" + three-dot menu. "Good Morning, User Name". *Quick KPIs / Overview*: Orders ready to load, Waiting for approval, Labels waiting to print, Dispatched today. *Get Started*: 4 cards — Create batch (Step 1), Print QR labels (Step 2), Create dispatch order (Step 3), Load & scan (Step 4). |
| `batches/batches page main page 2.png` | **Batches** (`/batches`) | "Manage Product Batches", KPIs (Total batches 24, Total grades 18, Total units 12.4k), green "+ Create new batch", batch search, recent batch list with "View batch →". |
| `qr codes labels/labels main page 3.png` | **QR Print** (`/qr-print`) | "QR Codes / Labels", batch search ("Search Created Batches"), list of batches with "View QRs →". |
| `dispatch order/all dispatch orders - main page 4.png` | **Dispatch** (`/dispatch`) | "All Dispatch Orders", KPIs, green "+ Create new batch" (label appears copied from Batches — see §7), order search, "Recent Orders" list with status badges and arrow buttons. |
| `loading and scanning/loading and scanning main page 5.png` | **Loading** (`/loading`) | "Loading & Scan", dispatch order search, order cards with party/transporter/vehicle/container and item list; buttons "Packing List" and "Start Loading". |

### 4.2 Create-batch workflow (Batches tab)

| Image | Route | Step |
|---|---|---|
| `batches/batches - create new batch step 1 select product grades.png` | `/batches/create/select` | Step 1 "Select" — title "Create a Stock Batch", stepper, product search, product rows with `+`, Previous / Next. |
| `batches/batches - create new batch step 2 select quantity.png` | `/batches/create/quantity` | Step 2 "Quantity" — package size, average quantity, number of packages, total material quantity. |
| `batches/batches - create new batch step 3 enter details.png` | `/batches/create/details` | Step 3 "Details" — manufacturing date, expiry date, location stored at per product. |
| `batches/batches - create new batch step 4 preview.png` | `/batches/create/preview` | Step 4 "Preview" — generated batch number, product list, Submit. |
| `batches/batches - submitted for qc check.png` | `/batches/submitted` | Confirmation "Batch created!", batch number, "View Batch" and "Create Another Batch". |

All five screens keep the bottom tab bar visible; step screens use a close (X) control instead of the logo header.

### 4.3 QR label detail (QR Print tab)

Four images are **states of one screen** — title "Batch QR Details", subtitle about printing generated batches, a status banner, QR-code search and a list of QR serials:

| Image | State |
|---|---|
| `qr codes labels/viewing a single batch qr code details - qc not marked.png` | QC not marked — amber banner, printing blocked. |
| `qr codes labels/viewing a single batch qr code details - qc pass.png` | QC passed — green banner, "Send To Print" button. |
| `qr codes labels/viewing a single batch qr code details - qc pass - qr code already printed.png` | QC passed and all codes printed — per-code print buttons, re-print request below. |
| `qr codes labels/viewing a single batch qr code details - qc failed.png` | QC failed — red banner, printing blocked. |

Implemented as a single dynamic route `/qr-print/[batchId]` with state handled inside the screen later.

### 4.4 Dispatch order workflow (Dispatch tab)

| Image | Route | Screen |
|---|---|---|
| `dispatch order/create dispatch order page.png` | `/dispatch/create` | "Create Dispatch Order": 1. Select Client/Party/Customer, 2. Select Available Batches, 3. Transporter Details (name, mobile, vehicle, container, scheduled dispatch), green "Create Order". |
| `dispatch order/dispatch order details page - to view one single order details.png` | `/dispatch/[orderId]` | "Orders #DO-2026-000002", details table (client, order number, dispatch date/day, quantity, transporter, vehicle, container), "Download Packing List". |

### 4.5 Loading & scanning workflow (Loading tab)

| Image | Route | Screen / step |
|---|---|---|
| `loading and scanning/loading and scanning - scan tab page.png` | `/loading/scan` | Scan tab: order number, scanned-units progress, camera viewport, "Stop Scanning", Products To Scan, Shipment details, Recent scans. |
| `loading and scanning/loading and scanning - recall tab section.png` | `/loading/recall` | Recall tab: "Recall A Product", two choices — "Type QR CODE" and "Scan QR CODE". |
| `loading and scanning/loading nand scan section - recall tab section - text qr code value entery section , and the screen that is shown after scanning to recall a product.png` | `/loading/recall/type` | Recall form: Product QR Code, Condition, Reason, green "Recall Product". |
| `loading and scanning/loading and scanning - recall tab section - camera qr code scanning.png` | `/loading/recall/camera` | Recall camera viewport with "Stop Scanning". |
| `loading and scanning/loading and scanning - enter seal number page.png` | `/loading/seal` | Modal: "Order: #DO-2026-000002", "Enter Seal Number", "Mark Dispatched" (background screen blurred). |
| `loading and scanning/loading and scanning - after all scans completed page.png` | `/loading/complete` | Scan tab after all scans: progress 0/17 with "Seal & Finalize" instead of "Stop Scanning". Likely a state of the Scan screen; given its own route for now. |

---

## 5. Shared Components (identified across images)

- **Main header**: KJ logo tile + screen title + vertical three-dot menu (Home, Batches, QR Print, Dispatch, Loading).
- **Workflow header**: plain title with a close (X) button (create batch, QR details, create dispatch order, order details, scan/recall).
- **Bottom navigation**: five persistent items with active tint (green) and icon+label; active pill background on Home/Batches/QR Print/Loading.
- **KPI tiles**: rounded light-grey/green tiles with a number and caption.
- **Primary buttons**: dark blue (Login, batch steps) and green (create/print/scan actions); outlined secondary buttons.
- **Search inputs**: pale grey-blue rounded fields with placeholder text.
- **Stepper**: four segments with check marks (Step 1 Select → Step 2 Quantity → Step 3 Details → Step 4 Preview).
- **List rows / cards**: batch rows, dispatch order rows, QR serial rows with timestamp, grade and code.
- **Status badges**: "Ready to load", "Dispatched", "2 products", QC state banner (amber/green/red).
- **Scanner viewport**: rounded frame with corner brackets; red "Stop Scanning" button.
- **Tab switcher**: Scan | Recall with an underline for the active tab.

These are documented for the later UI phase. This foundation implements only `AppHeader`, `MoreMenu`, `ScreenContainer`, `PlaceholderScreen`, `AppButton` and the bottom-navigation component.

---

## 6. Navigation Relationships

```
                         Common Login (/login)
                                 |
              role identified from auth response
                    /admin       /qc        /home
                      |           |           |
                 (later)     (later)     Dispatch bottom tabs
                                             |
        ┌──────────────┬──────────────┬──────┴──────┬──────────────┐
        v              v              v             v              v
      /home        /batches      /qr-print     /dispatch      /loading
        |              |              |             |              |
  Get Started    /batches/create/*  /qr-print/  /dispatch/create  /loading/scan
  shortcuts:     -> /batches/       [batchId]   /dispatch/[id]    /loading/recall/*
  batches,       submitted                                       /loading/seal
  QR print,                                                      /loading/complete
  dispatch,
  load & scan

  Header three-dot menu (available on all Dispatch screens with AppHeader)
        -> /settings  (NOT a sixth tab)
        -> Logout -> /login
```

- Each tab owns a nested stack, so pushed workflow screens keep the bottom bar visible and preserve that tab's state when switching tabs.
- Home "Get Started" cards are shortcuts into the other four areas; they are not separate tab destinations.
- Settings is reached only from the three-dot menu and returns with normal back navigation.
- All workflow screens use back navigation to return to their parent tab screen.

---

## 7. Unidentified or Unclear Designs

1. **No Admin or QC designs** were supplied. Their dashboards are placeholders only; nothing was inferred.
2. **No Settings design** was supplied. Only the route and navigation entry point were created.
3. **QR detail states**: the four QC-state images look like conditional states of one screen, not four distinct routes. Implemented as one dynamic route; if the user intended separate screens, this can be split later.
4. **"After all scans completed"** image looks like a state of the Scan screen rather than a distinct screen. A separate `/loading/complete` route was created to keep workflow steps addressable.
5. **"Waiting for approval" KPI** on the Home screen has no matching backend approval step — the backend raises dispatch orders directly (legacy PENDING/REJECTED statuses exist but no approval flow). The KPI is left as a design label only.
6. **Dispatch main screen button says "+ Create new batch"** although it sits on the dispatch-orders screen. This appears to be a copy/paste inconsistency in the design; it was not interpreted as a new feature.
7. **Close (X) vs back arrow**: workflow designs show X while the foundation uses a back chevron in `AppHeader`. Behaviour is the same (`router.back()`); visuals will be finalised in the UI phase.
8. **Modal presentation**: the seal-number design is a modal over a blurred screen. The foundation uses a normal route; converting it to an Expo Router modal is a UI-phase decision.
