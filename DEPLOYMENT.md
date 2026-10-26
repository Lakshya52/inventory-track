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
