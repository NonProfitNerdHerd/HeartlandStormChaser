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
| Overlays (OBS) | `/overlays.html` |
| Chasers Streams | `/chasers-streams.html` |
| Settings | `/settings.html` |
| OBS GPS/weather overlay | `/overlays/gps-weather.html` |
| Broadcast Control Center | `/broadcast/control/` |

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
| GET | `/api/broadcast/status` | OBS listener + telemetry aggregate |

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
| `GPS_PAIRING_PIN` | Android device pairing |
| `WEB_AUTH_BOOTSTRAP_PASSWORD` | Creates the first web user `IJRebout` on first sign-in when no users exist yet |
| `OBS_LISTENER_URL` | Base URL of the local OBS listener (tunnel or localhost for `wrangler dev`) |
| `OBS_LISTENER_TOKEN` | Bearer token matching the listener `LISTENER_AUTH_TOKEN` |
| `YOUTUBE_API_KEY` | Chasers Streams live status |
| `YOUTUBE_CLIENT_ID` | YouTube Live OAuth (Broadcast Control schedule/go-live) |
| `YOUTUBE_CLIENT_SECRET` | YouTube Live OAuth client secret |
| `YOUTUBE_REDIRECT_URI` | Optional override; default `{worker origin}/api/broadcast/youtube/oauth/callback` |

### Web sign-in

- **Android** still uses the pairing PIN only.
- **Web** uses username/password sign-in at `/login.html`.
- The first account is bootstrapped as **`IJRebout`** with the `admin` role when you sign in for the first time and no users exist yet.
- Set `WEB_AUTH_BOOTSTRAP_PASSWORD` as a Worker secret, then sign in once to create that account. After that, you can add more users in D1 later as permissions evolve.
- OBS overlay pages under `/overlays/` and their public overlay APIs stay open without web login.

## Deploy

```powershell
npx wrangler d1 migrations apply heartland-storm-chaser-db --remote
npm run deploy
```

Pushes to `main` also deploy via GitHub Actions when CI is configured.

## Home PC autostart (OBS / GPS / WeatherFront)

On the broadcast home PC, after Windows **restart + login**, these should come up automatically:

| Service | Port | Notes |
|---------|------|--------|
| Home GPS Bridge | `10111` (status), `10110` (NMEA) | Install under `%LOCALAPPDATA%\Heartland\HomeGpsBridge` |
| WeatherFront Chromium controller | `10112` | `%LOCALAPPDATA%\Heartland\WeatherFrontOBS` |
| OBS listener (+ tunnel) | `8791` | See broadcast-control docs |
| OBS Studio | — | Optional Windows Startup shortcut |

**Working pattern:** Scheduled Tasks as **Interactive + At logon**, running **`node.exe` directly** (not fragile `cmd` wrappers or S4U-at-startup).

Full step-by-step (copy to a new PC, verify, reboot checklist, troubleshooting):

**[docs/home-pc-autostart.md](docs/home-pc-autostart.md)**

## Documentation

Full local dev, D1, Git, and deployment guide:

**[docs/WORKFLOW.md](docs/WORKFLOW.md)**

Broadcast Control Center (OBS listener setup):

**[docs/broadcast-control.md](docs/broadcast-control.md)**

Home PC reboot autostart (GPS bridge, WeatherFront, listener, OBS):

**[docs/home-pc-autostart.md](docs/home-pc-autostart.md)**

## Project layout

```
public/          → Static frontend (HTML/CSS/JS)
public/overlays/ → OBS browser source pages
public/broadcast/→ Broadcast Control Center page
worker/          → Cloudflare Worker API routes
worker/lib/      → GPS auth, NWS weather, OBS listener client, DB helpers
services/obs-listener/ → Local OBS WebSocket listener (Node/TS)
migrations/      → D1 SQL schema changes
android-gps/     → Android GPS sender app (Kotlin)
wrangler.jsonc   → Cloudflare Worker + D1 config
docs/            → Workflow, broadcast control, home PC autostart guides
tools/           → Home GPS Bridge, WeatherFront OBS controller, etc.
```

## Stack

- Cloudflare Workers
- Cloudflare D1 (SQLite)
- Static assets via Wrangler
- National Weather Service API (cached)
- Android (Kotlin, Google Play Services Location)
- GitHub Actions (deploy on push to `main`)

## Not built yet

- OBS ticker overlay and standalone weather widget (listed as coming soon on `/overlays.html`)
- Live alert feeds (weather, public safety, infrastructure, cyber)
- Interactive chase map on dashboard
- Authentication
