# Deploying Aakash Business ERP on Yeti Cloud

Yeti Cloud (DataHub Nepal) is a Jelastic / Virtuozzo PaaS. The ERP runs there
as **one Node.js environment**: the Express API and the React app on one
domain. The database stays on **Supabase**.

```
browser ──https──> Yeti Cloud Node.js  (server/server.js: /api/* + the React build)
                          │
                          └──> Supabase: global project (tenants, users)
                               + company (tenant) project(s)
```

## What the repository does for this

- `package.json` at the root:
  - `npm install` also installs `server/` and `client/` and builds the React app (`client/build`). If the React build fails (usually memory), the install still finishes and the API starts; the web address then says the app is not built yet - raise the cloudlets and run `npm run build:client` (Web SSH, in `/home/jelastic/ROOT`) or Redeploy.
  - `npm start` runs `server/server.js`; the root `server.js` starts it too, so the platform's default `APP_FILE=server.js` works.
- `server/server.js` serves `client/build`. Every path that is not `/api` gets `index.html`.
- A React build without `REACT_APP_API_URL` calls `/api` on its own domain.
- CORS always allows the ERP's own domain.

## 1. Supabase

The app talks to Supabase through `@supabase/supabase-js`, so the database must be Supabase. A plain PostgreSQL server on Yeti will not work.

1. **Global project**: it holds the companies list and the logins.
   - In the SQL Editor run `database/01_global_master_schema.sql`, then `database/124_default_admin_logins_schema.sql`.
   - This creates the super admin `superadmin@businesserp.com.np` / `Super@12345`, which must be changed at the first login.
   - Settings → API: copy the **Project URL** and the key. They become `GLOBAL_MASTER_URL` and `GLOBAL_MASTER_KEY`.
2. **Company (tenant) project**: all company data, in schemas `tenant_master` and `tenant_trans`.
   - Run every other file in `database/` in number order, `02` up to the last one (`155`). Run them all on a new project; on an existing project run only the files not yet run.
   - Settings → API → **Exposed schemas**: add `tenant_master` (and `tenant_trans`), listed **before** `public`. Tables are called without a schema name, so the first exposed schema is the one used.
   - Give the API roles access, in the SQL Editor:
     ```sql
     GRANT USAGE ON SCHEMA tenant_master, tenant_trans TO anon, authenticated, service_role;
     GRANT ALL ON ALL TABLES IN SCHEMA tenant_master, tenant_trans TO anon, authenticated, service_role;
     GRANT ALL ON ALL SEQUENCES IN SCHEMA tenant_master, tenant_trans TO anon, authenticated, service_role;
     GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tenant_master, tenant_trans TO anon, authenticated, service_role;
     ```
   - Copy this project's URL and key. They are entered as the company's database (db host / anon key) when the super admin creates the company.
3. If the ERP already runs against these projects (for example from a PC), nothing changes in Supabase except running the new migrations. The keys never reach the browser; only the server uses them.

## 2. Yeti Cloud environment

1. Log in at the Yeti Cloud dashboard → **New Environment**.
2. **Node.js** tab: Node.js **18 or 20**, one application server node.
3. Cloudlets:
   - reserved **4**, scaling limit **16** or more.
   - The React build needs about 1.5–2 GB while it runs; afterwards the server uses about 200–300 MB.
4. Name, e.g. `aakash-erp` → **Create**.

## 3. Deploy from GitHub

1. On the Node.js node: **Deployment → Git / SVN**.
2. URL `https://github.com/macrotechcomputechpkr-sudo/AakashBusinessErp`, branch `main`.
3. The repository is private, so use your GitHub username and a **Personal Access Token** (repository read access) as the password.
4. Keep the context **ROOT**. Tick *Check and auto-deploy updates* if wanted → **Deploy**.
5. The platform runs `npm install` (it installs `server`, `client` and builds the app) and then `npm start`. The first deploy takes several minutes.

## 4. Variables

Node.js node → **Config** (or **Variables**):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | the port the platform routes to (Jelastic Node.js: `8080`) |
| `GLOBAL_MASTER_URL` | global Supabase **Project URL**, `https://<ref>.supabase.co` (Settings → API) - not the dashboard link `supabase.com/dashboard/project/<ref>` |
| `GLOBAL_MASTER_KEY` | its **service_role** key (Settings → API) |
| `JWT_SECRET` | a long random string (40+ characters); keep it secret |
| `CORS_ORIGINS` | `https://erp.your-domain.com` (optional - the own domain is always allowed) |
| `APP_URL`, `CLIENT_URL` | `https://erp.your-domain.com` (links in e-mails / messages) |
| `DEFAULT_TENANT_ADMIN_EMAIL`, `DEFAULT_TENANT_ADMIN_PASSWORD` | optional: the first admin of every new company |

Do **not** set `REACT_APP_API_URL`: the app then calls its own domain. After changing variables, **Restart** the node.

## 5. Domain and HTTPS

1. Environment → **Settings → Custom Domains** → bind `erp.your-domain.com`.
2. At your DNS provider: a **CNAME** to the environment's address (or an **A** record to its public IP, if one is attached).
3. **Add-ons → Let's Encrypt Free SSL** → install for the domain.

## 6. First run

- Open `https://erp.your-domain.com`. Log in as the super admin and change the password.
- In **Company Creation**, create the company using the tenant project's URL and key.
- Logs: Node.js node → **Log** (`run.log` / `npm` output).
- Updating: push to `main` → **Update from Git** (or auto-deploy). Run any new `database/` files in Supabase **before** the update.

## Checks if something fails

- **Setup check**: open `https://<your-domain>/api/health/setup`. It says whether the server reaches the global database (`global_db: ok`), how many super admins exist, whether the web app is built, and a hint when something is wrong (key, URL, missing tables). It never shows keys or data.
- **"Login failed" / "Server setup: …" on the login page**: the hint names the problem - fix that variable (or run the SQL files) and Restart.

- **"jem service restart … Failed to start"**: open the node's **Log** (`run.log` / `nodejs.log`).
  - Or **Web SSH** on the node: `journalctl -xeu nodejs.service | tail -50` and `pm2 logs --lines 50`.
  - `Cannot find module …/server.js`: `APP_FILE` must be `server.js` (root) - update from Git so the root `server.js` is there.
  - `Cannot find module 'express'` / `server/node_modules is missing`: `npm install` did not finish (often too few cloudlets for the React build) - raise the cloudlet limit and **Redeploy**.
- **"503 SSL Service Unavailable"**: HTTPS is not on for the environment. Environment → **Settings → SSL → Built-In SSL** (for `*.yetiappcloud.com`), or Let's Encrypt for a custom domain. Until then open the `http://` address.

- **Blank page or 404 on refresh**: the build is missing. Check the deploy log for `npm run build`; this usually means too few cloudlets during the build.
- **"Not allowed by CORS"**: the page is opened from a different domain than the API. Add that domain to `CORS_ORIGINS`.
- **"Tenant not found" / "relation does not exist"**:
  - the migration files were not run on that project, or
  - `tenant_master` is not an exposed schema (step 1.2).
