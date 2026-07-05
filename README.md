# HeartlandStormChaser

Pre-production storm chase operations platform on Cloudflare Workers, D1, static web pages, an Android GPS sender app, and OBS browser overlays.

| | |
|---|---|
| **Default branch** | `main` |
| **Worker name** | `heartlandstormchaser` |
| **D1 database** | `heartland-storm-chaser-db` |
| **Live URL** | `https://heartlandstormchaser.ike-j-rebout.workers.dev` |

## What's built

- **GPS system** — device pairing, 10-second location updates, platform GPS source, live/stale status
- **Weather** — cached NWS API for platform coordinates
- **Web GPS page** — device list, platform controls, weather, Android APK QR placeholder
- **OBS overlay** — `/overlays/gps-weather.html` with live GPS + weather
- **Android app** (`android-gps/`) — pairing, GPS broadcast tab, overlays city/ticker tab
- **Chasers Streams** — YouTube live status and quad-view page

## Quick start

```powershell
git clone https://github.com/NonProfitNerdHerd/HeartlandStormChaser.git
cd HeartlandStormChaser
git checkout main
npm install
npx wrangler login
copy .dev.vars.example .dev.vars
npx wrangler d1 migrations apply heartland-storm-chaser-db --local
npm run dev
```

Open http://127.0.0.1:8787 (or the port Wrangler prints).

Set `GPS_PAIRING_PIN` in `.dev.vars` for local GPS pairing tests.

## Web pages

| Page | URL |
|------|-----|
| Homepage | `/` |
| Dashboard | `/dashboard.html` |
| GPS | `/gps.html` |
| Chasers Streams | `/chasers-streams.html` |
| Settings | `/settings.html` |
| OBS GPS/weather overlay | `/overlays/gps-weather.html` |

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Worker liveness |
| GET | `/api/db-test` | D1 connectivity |
| POST | `/api/gps/pair` | Pair Android device with PIN |
| POST | `/api/gps/update` | GPS update (Bearer token) |
| GET | `/api/gps/devices` | List devices + locations |
| GET/POST | `/api/gps/platform` | Read/set platform GPS source |
| GET | `/api/weather/platform` | Weather for platform location |
| GET/PUT | `/api/overlay/settings` | Overlay city/state/ticker settings |
| GET | `/api/overlays/gps-weather-data` | Combined data for OBS overlay |

## Android app

Gradle project in [`android-gps/`](android-gps/). Open that folder in Android Studio, pair against your Worker URL, then use the **GPS** and **Overlays** tabs.

### Automatic APK builds (GitHub Actions)

Every push to **`main`** runs [`.github/workflows/android-apk.yml`](.github/workflows/android-apk.yml), which:

1. Builds a debug APK from `android-gps/`
2. Publishes it to **GitHub Releases** (latest release)
3. Updates D1 overlay settings so `/gps.html` shows the QR code, download link, and **APK version**

**Before each release-worthy push**, bump the version in `android-gps/app/build.gradle.kts`:

```kotlin
versionCode = 4
versionName = "0.4.0"
```

**GitHub repo secrets** (Settings → Secrets and variables → Actions) required for automatic QR updates:

| Secret | Purpose |
|--------|----------|
| `CLOUDFLARE_API_TOKEN` | Wrangler access to update D1 overlay settings |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

If those secrets are missing, the APK still builds and publishes to GitHub Releases, but the GPS page QR code will not update until you set the secrets or manually update `overlay_settings` in D1.

See [`android-gps/README.md`](android-gps/README.md) for local Android Studio build steps.

## Cloudflare secrets

Set these in **Workers & Pages → heartlandstormchaser → Settings → Variables and Secrets**:

| Secret | Used for |
|--------|----------|
| `GPS_PAIRING_PIN` | Android/web device pairing |
| `YOUTUBE_API_KEY` | Chasers Streams live status |

## Deploy

```powershell
npx wrangler d1 migrations apply heartland-storm-chaser-db --remote
npm run deploy
```

Pushes to `main` also deploy via GitHub Actions when CI is configured.

## Documentation

Full local dev, D1, Git, and deployment guide:

**[docs/WORKFLOW.md](docs/WORKFLOW.md)**

## Project layout

```
public/          → Static frontend (HTML/CSS/JS)
public/overlays/ → OBS browser source pages
worker/          → Cloudflare Worker API routes
worker/lib/      → GPS auth, NWS weather, DB helpers
migrations/      → D1 SQL schema changes
android-gps/     → Android GPS sender app (Kotlin)
wrangler.jsonc   → Cloudflare Worker + D1 config
docs/            → Workflow and setup guides
```

## Stack

- Cloudflare Workers
- Cloudflare D1 (SQLite)
- Static assets via Wrangler
- National Weather Service API (cached)
- Android (Kotlin, Google Play Services Location)
- GitHub Actions (deploy on push to `main`)

## Not built yet

- Web Overlays settings page (Phase 4)
- OBS ticker overlay (ticker text is stored; overlay UI not built)
- Live alert feeds (weather, public safety, infrastructure, cyber)
- Interactive chase map on dashboard
- Authentication
