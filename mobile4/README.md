# ProductScanning Mobile (Expo Router + TypeScript + NativeWind v5)

Foundation project for the role-based Android/iOS app. It authenticates against the existing backend in `/backend` (which is untouched).

## Commands

```bash
cd mobile4
npm install
npm start          # Expo dev server (start it yourself when ready)
npm run android    # Android build/run
npm run typecheck  # tsc --noEmit
npm run lint
```

## Environment

Copy `.env.example` to `.env` and set the backend URL:

```
EXPO_PUBLIC_API_URL=http://localhost:3001/api
```

Use `http://10.0.2.2:3001/api` for the Android emulator or your PC's LAN IP for a physical device.

## Android APK

The release APK is built with `npx expo prebuild --platform android` followed by
`./gradlew.bat assembleRelease` from the `android/` folder. The generated file is
`android/app/build/outputs/apk/release/app-release.apk`.

The build targets `arm64-v8a` only (standard single-ABI release APK). To build a
universal APK with all four ABIs instead, set
`reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64` in `android/gradle.properties`.

Login with a backend user, for example `dispatch@gmail.com` / `dispatch@123`.

## Fonts

Lexend Deca (400/500/600/700) is bundled as local TTF files in `src/fonts/`. The file names match the fonts' PostScript names (`LexendDeca-Regular`, `-Medium`, `-SemiBold`, `-Bold`), which is required for correct resolution on iOS. They are loaded at runtime with `useFonts` and exposed to NativeWind through the `--font-*` theme variables in `global.css`.

## Authentication

- Login calls `POST /api/auth/login` with `{ email, password }`.
- The opaque bearer token is persisted with `expo-secure-store` (localStorage on web).
- Protected requests use `authenticatedRequest`, which attaches the token and, on `401`, rotates it via `POST /api/auth/refresh` and retries once.
- `GET /api/auth/tenant` supplies the tenant details and dynamic logo URL used in the header.
- Logout calls `POST /api/auth/logout` and clears the local session.

## Routing overview

- `/login` — common login
- `/admin` — Admin dashboard foundation (protected, ADMIN only)
- `/qc` — QC dashboard foundation (protected, QC only)
- `/home`, `/batches`, `/qr-print`, `/dispatch`, `/loading` — Dispatch bottom tabs (DISPATCH only)
- Dispatch workflows: `/batches/create/*`, `/batches/submitted`, `/qr-print/[batchId]`, `/dispatch/create`, `/dispatch/[orderId]`, `/loading/scan`, `/loading/recall/*`, `/loading/seal`, `/loading/complete`
- `/settings` — reached from the header three-dot menu, not a tab
- `/` — redirects to the signed-in user's dashboard

Role protection lives in `app/_layout.tsx` via Expo Router `Stack.Protected` with explicit `redirectTo`, plus `src/components/navigation/RoleGate.tsx` in each role layout.
