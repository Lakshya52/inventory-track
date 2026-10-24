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
build`, starts with `npm start`, and checks `/api/health`.

The blueprint provisions a 1 GB persistent disk at `/var/data` for uploaded
dispatch/QC images. Keep `UPLOAD_DIR=/var/data/uploads`; persistent disks require
a Render plan that supports disks. Without persistent storage, uploaded files
on an ephemeral filesystem can disappear when the service restarts or deploys.

After deployment, copy the Render service URL, for example
`https://inventory-track-api.onrender.com`.

## 3. Deploy the frontend to Vercel

Import the repository into Vercel and set **Root Directory** to `frontend`.
Vercel uses `frontend/vercel.json` for the Vite build output and SPA route
fallback. In the Vercel project environment variables, set:

| Variable | Value |
| --- | --- |
| `API_URL` | Your Render service origin, e.g. `https://inventory-track-api.onrender.com` (no `/api` suffix) |

Redeploy after setting the variable. `API_URL` is embedded during the
frontend build, so changing it requires a new deployment.

## 4. Set backend environment variables

In the Render service's Environment settings, set:

| Variable | Value |
| --- | --- |
| `MONGO_URI` | Your MongoDB Atlas connection string. Required with the blueprint's `DB_CLIENT=mongo`. |
| `CORS_ORIGIN` | The exact Vercel site origin, e.g. `https://your-project.vercel.app`; add custom domains as comma-separated origins. |
| `JWT_SECRET` | Render generates a secret through the blueprint. Keep it private and do not change it after launch unless you intend to invalidate existing sessions. |
| `UPLOAD_DIR` | Keep `/var/data/uploads` to store uploaded images on the Render disk. |
| `DB_CLIENT` | Keep `mongo` for Atlas. For MySQL, switch to `mysql` and supply all `DB_*` connection settings. |

Render supplies `PORT` automatically. `MONGO_DB_NAME` is optional when the
database name is included in `MONGO_URI`. Do not put backend secrets in Vercel
or commit them to the repository.

When using a custom Vercel domain, include its origin in `CORS_ORIGIN` and
redeploy/restart the Render service. If using Vercel preview deployments, add
the appropriate preview origins too.
