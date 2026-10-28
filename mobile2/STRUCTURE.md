# KLJ ProductScanning — mobile app structure

This app is an Expo Router project with three role-based areas:

| Role | Route group | Tab bar definition | Home route |
| --- | --- | --- | --- |
| Admin | `src/app/(admin)` | `ADMIN_TABS` in `src/components/navigation/tabs.ts` | `/(admin)/home` |
| QC | `src/app/(qc)` | `QC_TABS` in `src/components/navigation/tabs.ts` | `/(qc)/home` |
| Dispatch | `src/app/(dispatch)` | `DISPATCH_TABS` in `src/components/navigation/tabs.ts` | `/(dispatch)/home` |

The admin UI is complete. The QC and dispatch groups are wired with their own tab bars, route guards and placeholder screens, ready for their real UI to be built screen by screen.

---

## 1. Where to add the backend URL

The API base URL lives in **one place**:

`src/services/api.ts` → `resolveBaseUrl()`

It reads `EXPO_PUBLIC_API_URL` first. Set it in **`.env.local`** (create it next to `package.json`, use `.env.example` as the template):

```bash
EXPO_PUBLIC_API_URL=http://localhost:3001/api
```

Notes:

- The value **must include `/api`** and **must not end with `/`**.
- Expo only exposes variables prefixed with `EXPO_PUBLIC_`.
- **Restart Metro** after changing env values (`Ctrl+C`, then `npx expo start --clear`); values are inlined at bundle time.
- If the variable is not set, the app falls back to the host Metro is served from on port `3001`, so local development usually works without an env file.

| Where the app runs | Value to use |
| --- | --- |
| Web browser / iOS simulator | `http://localhost:3001/api` |
| Android emulator | `http://10.0.2.2:3001/api` |
| Physical phone (same Wi-Fi) | `http://<computer-LAN-IP>:3001/api` |
| Production | `https://<api-host>/api` |

For the physical-phone case the phone cannot use `localhost`; use the computer's LAN IP and make sure the backend listens on `0.0.0.0` (it does) and the firewall allows port `3001`.

### CORS (web only)

The backend only accepts the origins listed in its `CORS_ORIGIN` variable. For Expo web on port `8081`, the backend environment needs:

```bash
CORS_ORIGIN=http://localhost:8081
```

That is a backend setting; the mobile app itself does not need any CORS change.

---

## 2. Login and session flow

```
Login screen (src/app/login.tsx)
  → useRole().signIn(email, password)
    → src/services/auth.ts  login()
      → src/services/api.ts  POST /api/auth/login
      → AsyncStorage saves { token, refreshToken, user }
      → src/context/role-context.tsx maps ADMIN/QC/DISPATCH → admin/qc/dispatch
  → router.replace(roleHomeHref[role])
```

- `src/services/auth.ts` — login, `me`, restore, logout.
- `src/services/storage.ts` — persists the session with AsyncStorage.
- `src/services/api.ts` — base URL, bearer token, JSON + multipart helpers, `ApiError`.
- `src/context/role-context.tsx` — the signed-in `AppUser`, `isRestoring`, `signIn`, `signOut`, `updateProfile`.
- `src/components/navigation/role-guard.tsx` — redirects guests to `/login` and blocks cross-role access.

Backend contract expected by the app:

```http
POST /api/auth/login
{ "email": "admin@example.com", "password": "secret" }

200 OK
{
  "token": "...",
  "refreshToken": "...",
  "refreshExpiresAt": "...",
  "user": { "id": 1, "name": "Ram", "email": "admin@example.com", "role": "ADMIN" }
}
```

`role` is `ADMIN`, `QC` or `DISPATCH` (uppercase), exactly as returned by `backend/src/controllers/authController.*.ts`.

The registration screen is UI-only for now: the backend does not expose a public self-registration endpoint, so accounts must be created by an admin (or seeded) before they can log in.

---

## 3. Directory map

```
src/
  app/                     Expo Router routes only
    _layout.tsx            fonts, providers, root stack
    index.tsx              redirects to the signed-in role or login
    login.tsx
    register.tsx
    scan.tsx               shared QR scanner modal
    (admin)/               admin tab group (complete)
      _layout.tsx          RoleGuard + Tabs
      home.tsx
      reports.tsx
      dispatches.tsx
      settings.tsx
      manage/              nested stack for management sub-pages
    (qc)/                  QC tab group (ready for UI work)
      _layout.tsx          RoleGuard + QC_TABS
      home.tsx
      batches.tsx
      scan-check.tsx
      reports.tsx
      settings.tsx
    (dispatch)/            dispatch tab group (ready for UI work)
      _layout.tsx          RoleGuard + DISPATCH_TABS
      home.tsx
      orders.tsx
      scan-check.tsx
      reports.tsx
      settings.tsx
  screens/                 reusable screen bodies (safe to import from app routes)
  components/
    navigation/            tabs.ts, RoleTabBar, RoleGuard
    ui/                    buttons, cards, fields, sheets, scanner, Screen, typography
  context/                 RoleProvider
  services/                api.ts, auth.ts, storage.ts, qc.ts, dispatch.ts
  theme/                   colors and design tokens
  data/mock.ts             mock data currently used by admin screens
  types.ts                 shared UI types
  global.css               Tailwind/NativeWind theme
```

Rules:

- `src/app/**` contains **only route files**; put screen bodies and helpers in `src/screens` or `src/components`.
- Add API calls to `src/services`, never inside components.
- Reuse `Screen`, `PageHeading`, `PrimaryButton`, `Field`, `StatCard`, `QuickLink`, `ManagementTile`, `EmptyPanel`, `BottomSheet` so all roles stay visually consistent.

---

## 4. How to add a new QC or dispatch screen

Example: a QC “Batch details” screen.

1. Create `src/app/(qc)/batch-details.tsx`:

   ```tsx
   import { useLocalSearchParams } from 'expo-router';
   import { View } from 'react-native';

   import { AppText } from '@/components/ui/app-text';
   import { Screen } from '@/components/ui/screen';

   export default function QCBatchDetailsScreen() {
     const { id } = useLocalSearchParams<{ id: string }>();

     return (
       <Screen>
         <View className="px-5 pt-6">
           <AppText variant="display">Batch {id}</AppText>
         </View>
       </Screen>
     );
   }
   ```

2. If it should be a tab, add it to `QC_TABS` in `src/components/navigation/tabs.ts` **and** register it in `src/app/(qc)/_layout.tsx`:

   ```tsx
   <Tabs.Screen name="batch-details" />
   ```

   For a sub-page (not a tab), create a nested `Stack` layout instead, like `src/app/(admin)/manage/_layout.tsx`.

3. Fetch data through a service, for example:

   ```tsx
   import { useEffect, useState } from 'react';
   import { qcApi, type QcRecord } from '@/services/qc';

   const [records, setRecords] = useState<QcRecord[]>([]);
   useEffect(() => {
     qcApi.records().then(setRecords).catch(() => setRecords([]));
   }, []);
   ```

4. Add new endpoints to `src/services/qc.ts` or `src/services/dispatch.ts`. `apiRequest` already adds the bearer token and handles errors.

The same steps apply to dispatch: add files under `src/app/(dispatch)`, update `DISPATCH_TABS` and `(dispatch)/_layout.tsx`, and extend `src/services/dispatch.ts`.

### Navigation targets

Typed routes are enabled. Use group-qualified hrefs:

- `/(admin)/home`, `/(admin)/manage/products`
- `/(qc)/home`, `/(qc)/batches`, `/(qc)/scan-check`
- `/(dispatch)/home`, `/(dispatch)/orders`
- `/scan` (shared modal)

If TypeScript reports an unknown route after adding a file, regenerate types by restarting `npx expo start` (or run the type-generation command used by the project).

---

## 5. Run and verify

```bash
cd mobile2
npx expo start            # web + Expo Go
npx expo start --clear    # after env or Tailwind changes
npx tsc --noEmit          # typecheck
npx expo lint             # lint
```

Login checklist:

1. Start the backend (`backend`, port `3001`) and confirm `http://localhost:3001/api/health` returns `status: ok`.
2. Create `.env.local` from `.env.example` if the backend is not on the default host.
3. Restart Metro with `--clear`.
4. Seed the database if needed (`npm run seed` in `backend`), then log in with a seeded account:
   - admin: `admin@gmail.com` / `admin@123` → admin tabs
   - QC: `qc@gmail.com` / `qc@123` → QC tabs
   - dispatch: `dispatch@gmail.com` / `dispatch@123` → dispatch tabs
5. Confirm the session survives an app reload (AsyncStorage) and that opening another role's URL redirects back to your own home.

---

## 6. Suggested next steps

1. Replace mock data in `src/screens/*` with `src/services/qc.ts` / `dispatch.ts` calls, starting with the home stat cards.
2. Build the QC screens in `(qc)`: pending batches, scan & submit pass/fail, QC records/reports.
3. Build the dispatch screens in `(dispatch)`: order list, approve/reject, scan & confirm dispatch, dispatch records.
4. Move shared report/activity widgets into `src/components` as both roles start using them.
5. Add camera scanning (`expo-camera`) behind the existing `/scan` modal when the scan flow is implemented.
6. Add refresh-token handling in `src/services/api.ts` if sessions need to outlive the access token.
