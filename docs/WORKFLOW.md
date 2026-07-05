# HeartlandStormChaser Workflow Guide

This document explains **how to work on this project yourself** — local development, database migrations, Git, GitHub, and Cloudflare deployment.

Phase 1 established the foundation (static pages, Worker API, D1 schema). Later phases added GPS, weather, OBS overlays, Chasers Streams, and the Android app. See the root [README.md](../README.md) for the current feature list.

---

## Prerequisites

Install these once on your machine:

| Tool | Purpose | Verify |
|------|---------|--------|
| **Node.js 18+** | Runs Wrangler and npm scripts | `node --version` |
| **Git** | Version control | `git --version` |
| **Wrangler** | Cloudflare CLI (installed via npm in this project) | `npx wrangler --version` |

### One-time Cloudflare login

```powershell
npx wrangler login
```

Opens a browser to authenticate. Verify:

```powershell
npx wrangler whoami
```

You need **D1 write** permission (included in a normal Workers login).

### One-time GitHub setup

Your repo remote:

```
https://github.com/NonProfitNerdHerd/HeartlandStormChaser.git
```

Use **GitHub Desktop** or the command line. For CLI PRs, install [GitHub CLI](https://cli.github.com/) and run `gh auth login`.

---

## Project structure

```
HeartlandStormChaser/
├── public/                 # Static frontend (HTML, CSS, JS)
│   ├── index.html          # Homepage
│   ├── dashboard.html      # Map placeholder + status cards
│   ├── settings.html       # API / DB connectivity checks
│   ├── css/
│   └── js/
├── worker/                 # Cloudflare Worker (API)
│   ├── index.ts            # Request router
│   └── routes/
│       ├── health.ts       # GET /api/health
│       └── db-test.ts      # GET /api/db-test
├── migrations/             # D1 SQL migrations (version-controlled)
├── wrangler.jsonc          # Cloudflare project config
├── package.json            # npm scripts and dependencies
└── docs/
    └── WORKFLOW.md         # This file
```

**How requests flow:**

1. Browser requests `/api/*` → Worker handles it (D1 access lives here).
2. All other URLs → static files from `public/`.

---

## Local development

### 1. Clone and install

```powershell
git clone https://github.com/NonProfitNerdHerd/HeartlandStormChaser.git
cd HeartlandStormChaser
npm install
```

### 2. Apply D1 migrations locally

Local D1 is a SQLite file under `.wrangler/state/` (gitignored). After cloning, apply migrations:

```powershell
npx wrangler d1 migrations apply heartland-storm-chaser-db --local
```

You only re-run this when **new migration files** are added.

### 3. Start the dev server

```powershell
npm run dev
```

Wrangler prints a URL (usually `http://127.0.0.1:8787` or `:8788`).

### 4. Pages and API to test

| URL | What it does |
|-----|--------------|
| `/` | Homepage with live `/api/health` status |
| `/dashboard.html` | Map placeholder + 6 status cards |
| `/settings.html` | Live `/api/health` and `/api/db-test` panels |
| `/api/health` | JSON — confirms Worker is alive |
| `/api/db-test` | JSON — confirms D1 is reachable, returns table row counts |

**PowerShell quick test:**

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
Invoke-RestMethod http://127.0.0.1:8787/api/db-test
```

Expected `db-test` counts after initial migration:

- `alert_layers`: 4
- `system_settings`: 3
- `devices`: 0
- `latest_location`: 0

### 5. Stop the dev server

Press `Ctrl+C` in the terminal running `npm run dev`.

---

## Cloudflare D1 database

### Database in this project

| Setting | Value |
|---------|-------|
| Database name | `heartland-storm-chaser-db` |
| Worker binding | `DB` (access as `env.DB` in Worker code) |
| Migrations folder | `migrations/` |

The `database_id` is stored in `wrangler.jsonc`. **Do not change it** unless you create a new database.

### Creating a new D1 database (new project / new clone owner)

If you are setting up from scratch on a **different Cloudflare account**:

```powershell
npx wrangler d1 create heartland-storm-chaser-db
```

Copy the `database_id` from the output into `wrangler.jsonc` under `d1_databases`.

### Applying migrations

| Target | Command | When to use |
|--------|---------|-------------|
| **Local** | `npx wrangler d1 migrations apply heartland-storm-chaser-db --local` | Every time you add a new `.sql` file in `migrations/` |
| **Remote** | `npx wrangler d1 migrations apply heartland-storm-chaser-db --remote` | Before or after deploy, so production D1 matches your schema |

Wrangler tracks applied migrations in a `d1_migrations` table — it will not double-apply the same file.

### Adding a new migration (future phases)

1. Create a new file, e.g. `migrations/0002_add_devices_index.sql`
2. Write SQL changes only (no edits to old migration files)
3. Apply locally: `--local`
4. Test with `npm run dev` and `/api/db-test`
5. Apply remotely: `--remote`
6. Commit the new migration file + any Worker changes

### Ad-hoc SQL queries

**Local:**

```powershell
npx wrangler d1 execute heartland-storm-chaser-db --local --command "SELECT * FROM alert_layers;"
```

**Remote (production D1):**

```powershell
npx wrangler d1 execute heartland-storm-chaser-db --remote --command "SELECT * FROM system_settings;"
```

### Database info

```powershell
npx wrangler d1 info heartland-storm-chaser-db
npx wrangler d1 list
```

---

## Git workflow

### Typical edit cycle

1. **Pull** latest changes before starting work
2. **Edit** files locally
3. **Test** with `npm run dev`
4. **Stage** only the files you changed
5. **Commit** with a clear message
6. **Push** to GitHub

### Command line example

```powershell
git pull origin main
# ... make changes, test ...
git status
git add worker/routes/db-test.ts wrangler.jsonc
git commit -m "Add D1 database test API endpoint and wire settings page."
git push origin main
```

### GitHub Desktop example

1. Open the repository in GitHub Desktop
2. Review changed files in the left panel — **uncheck** anything unrelated
3. Write a short summary (1 line) describing *why* you changed things
4. Click **Commit to main**
5. Click **Push origin**

### Commit message tips

Write what changed and why:

- `Add dashboard page with map placeholder and status cards.`
- `Configure Cloudflare D1 with initial schema and migrations.`
- `Fix db-test error when alert_layers table is empty.`

Avoid vague messages like `update` or `fix stuff`.

### Branches

This repo uses a single active branch:

- **`main`** — pre-production development and deployment branch

Work directly on `main` unless you intentionally create a short-lived feature branch.

```powershell
git checkout main
git pull origin main
```

### What not to commit

These are gitignored and should **never** be staged:

- `node_modules/`
- `.wrangler/` (local D1 data and dev cache)
- `.env` / `.dev.vars` (secrets)

---

## Push to GitHub

After committing locally:

```powershell
git push origin main
```

If this is your first push on a new branch:

```powershell
git push -u origin main
```

Verify on GitHub: https://github.com/NonProfitNerdHerd/HeartlandStormChaser

---

## Deploy to Cloudflare

### Before first deploy

1. Logged in: `npx wrangler whoami`
2. Remote migrations applied:

   ```powershell
   npx wrangler d1 migrations apply heartland-storm-chaser-db --remote
   ```

### Deploy

```powershell
npm run deploy
```

This runs `wrangler deploy`, which uploads:

- Your **Worker** (`worker/index.ts` and routes)
- Your **static assets** (`public/`)

Wrangler prints a live URL like:

```
https://heartland-storm-chaser.<your-subdomain>.workers.dev
```

### After deploy — smoke test

Replace the URL with your deployed Workers URL:

```powershell
Invoke-RestMethod https://heartland-storm-chaser.<subdomain>.workers.dev/api/health
Invoke-RestMethod https://heartland-storm-chaser.<subdomain>.workers.dev/api/db-test
```

Open `/`, `/dashboard.html`, and `/settings.html` in a browser.

### View live logs

```powershell
npx wrangler tail
```

### Redeploy after changes

Every time you change Worker code, frontend files, or `wrangler.jsonc`:

```powershell
git commit -am "Describe your change"
git push origin main
npm run deploy
```

If you added a **new migration**, apply remotely **before** deploy:

```powershell
npx wrangler d1 migrations apply heartland-storm-chaser-db --remote
npm run deploy
```

---

## npm scripts reference

| Script | Command | Purpose |
|--------|---------|---------|
| `npm run dev` | `wrangler dev` | Local dev server (Worker + assets + local D1) |
| `npm run deploy` | `wrangler deploy` | Deploy to Cloudflare |
| `npm run check` | `wrangler check` | Validate Wrangler config |

---

## Troubleshooting

### `/api/db-test` fails locally

- Run migrations: `npx wrangler d1 migrations apply heartland-storm-chaser-db --local`
- Restart `npm run dev`
- Confirm `DB` binding appears when dev server starts

### Port already in use

Wrangler picks the next free port (8787 → 8788). Check the terminal output for the actual URL.

### `wrangler login` expired

```powershell
npx wrangler login
```

### Remote DB empty after deploy

Apply remote migrations:

```powershell
npx wrangler d1 migrations apply heartland-storm-chaser-db --remote
```

### Git push rejected

Pull first, resolve conflicts, then push:

```powershell
git pull origin main
git push origin main
```

---

## Phase 1 checklist (complete)

- [x] Project scaffold (`package.json`, `wrangler.jsonc`, TypeScript config)
- [x] Worker health API (`GET /api/health`)
- [x] Static pages (home, dashboard, settings)
- [x] D1 schema + initial migration
- [x] Database test API (`GET /api/db-test`)
- [x] Workflow documentation (this file)

## Not built yet

- Web Overlays settings page
- OBS ticker overlay UI
- Live alert feeds beyond NWS platform weather
- Interactive map
- Authentication

See the root [README.md](../README.md) for the full current vs. planned feature list.

---

## Quick reference card

```powershell
# Daily dev
npm run dev

# After new migration file
npx wrangler d1 migrations apply heartland-storm-chaser-db --local

# Commit and push
git add .
git commit -m "Describe change"
git push origin main

# Deploy
npx wrangler d1 migrations apply heartland-storm-chaser-db --remote
npm run deploy
```
