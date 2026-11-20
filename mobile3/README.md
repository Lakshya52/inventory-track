# ProductScanning — mobile3

Expo / React Native app with NativeWind (Tailwind CSS 4) and the **Lexend Deca** font.

## Run

```bash
npm install
npx expo start          # Expo Go + web
npx expo start --web    # web only
npx tsc --noEmit        # typecheck
npx expo lint           # lint
```

The backend URL is read from `EXPO_PUBLIC_API_URL` (see `.env.example`). Restart Metro with
`--clear` after changing it.

## Current state

- Login screen matching the supplied reference image (white canvas, navy title/button,
  pale grey-blue inputs).
- Session restore, login and logout wired to `POST /api/auth/login`, `GET /api/auth/me`.
- Role areas scaffolded with tab bars and route guards: `(admin)`, `(qc)`, `(dispatch)`.

See `STRUCTURE.md` for the directory map.
