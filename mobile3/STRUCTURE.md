# mobile3 structure

## Directory map

```
src/
  app/                       Expo Router routes only
    _layout.tsx              Lexend Deca fonts, providers, root stack
    index.tsx                redirects to the signed-in role or /login
    login.tsx                reference-matching login screen
    (admin)/_layout.tsx      RoleGuard + admin tabs
      home.tsx, reports.tsx, dispatches.tsx, settings.tsx
    (qc)/_layout.tsx         RoleGuard + QC tabs
      home.tsx, batches.tsx, scan-check.tsx, reports.tsx, settings.tsx
    (dispatch)/_layout.tsx   RoleGuard + dispatch tabs
      home.tsx, orders.tsx, scan-check.tsx, reports.tsx, settings.tsx
  components/
    navigation/              role-guard.tsx, tabs.ts
                             dispatch-tab-bar.tsx (reference design)
                             admin-tab-bar.tsx, qc-tab-bar.tsx (scaffolds)
    ui/                      app-text.tsx, field.tsx, button.tsx
  context/                   role-context.tsx (auth/session + role)
  screens/                   placeholder-screen.tsx (shared scaffold)
  services/                  api.ts, auth.ts, auth-types.ts, storage.ts
  theme/                     colors, font names, layout tokens
  lib/                       cx.ts
  types.ts                   Role and AppUser types
  global.css                 Tailwind theme + Lexend Deca font tokens
```

## Design tokens

Defined in `src/global.css` (`@theme`) and mirrored in `src/theme/index.ts`:

- `brand` `#0B218C` — title, labels, primary button
- `input` `#E7E9F1` — pale field fill
- `canvas` `#FFFFFF` — screen background
- `font-lexend*` — Lexend Deca 400/500/600/700

## Auth flow

```
login.tsx → useRole().signIn(email, password)
  → services/auth.ts login()
    → POST /api/auth/login
    → AsyncStorage session
  → router.replace(roleHomeHref[role])
```

`RoleGuard` in each group redirects guests to `/login` and prevents cross-role access.

## Adding screens

1. Create the route under the correct group in `src/app/`.
2. Register it in that group's `_layout.tsx` with a `<Tabs.Screen name="..." />`.
3. Put reusable UI in `src/components/ui`, data calls in `src/services`.
