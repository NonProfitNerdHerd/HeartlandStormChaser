# HeartlandStormChaser

Cloudflare-ready storm chase operations foundation — Workers, static assets, and D1.

**Phase 1 complete:** static pages, Worker API, D1 schema, and workflow documentation.

## Quick start

```powershell
git clone https://github.com/NonProfitNerdHerd/HeartlandStormChaser.git
cd HeartlandStormChaser
npm install
npx wrangler login
npx wrangler d1 migrations apply heartland-storm-chaser-db --local
npm run dev
```

Open http://127.0.0.1:8787 (or the port Wrangler prints).

| Page | URL |
|------|-----|
| Homepage | `/` |
| Dashboard | `/dashboard.html` |
| Settings | `/settings.html` |
| Health API | `/api/health` |
| DB test API | `/api/db-test` |

## Deploy

```powershell
npx wrangler d1 migrations apply heartland-storm-chaser-db --remote
npm run deploy
```

## Documentation

Full step-by-step guide for local dev, D1, Git, GitHub, and deployment:

**[docs/WORKFLOW.md](docs/WORKFLOW.md)**

## Stack

- Cloudflare Workers (API)
- Cloudflare static assets (HTML/CSS/JS)
- Cloudflare D1 (SQLite)
- Wrangler CLI
- GitHub

## Project layout

```
public/       → Static frontend
worker/       → API routes (/api/health, /api/db-test)
migrations/   → D1 SQL schema changes
wrangler.jsonc → Cloudflare configuration
```

## Phase 2+ (not built yet)

- Android GPS device ingestion
- Live alert feeds (weather, public safety, infrastructure, cyber)
- Interactive map on dashboard
- Authentication
