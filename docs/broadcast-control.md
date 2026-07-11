# Broadcast Control Center (Phase 1)

Control and monitor OBS Studio from the HeartlandStormChaser web app using a local OBS listener. The browser never talks to OBS WebSocket directly and never receives the OBS password.

## Architecture

```
Browser (Broadcast Control Center)
  → Cloudflare Worker `/api/broadcast/*` (session auth)
    → Local OBS Listener HTTP API (bearer token)
      → OBS Studio WebSocket 5.x
```

GPS, weather, warnings, and overlay target fields are loaded from existing platform APIs inside the Worker (`getPlatformSource`, NWS weather/alerts, overlay settings). They are not reimplemented on the page.

## Page URL

- Preferred: `/broadcast/control/` (also `/broadcast/control` redirects here)
- File: `public/broadcast/control/index.html`

Other site pages were not modified. Open Broadcast from this page’s own nav link, or go directly to the URL after signing in.

## Configure OBS WebSocket

1. In OBS Studio: **Tools → WebSocket Server Settings**
2. Enable the WebSocket server
3. Note the port (default `4455`) and set a password
4. Leave the server bound to localhost unless you intentionally expose it on LAN

## Local OBS listener

Directory: `services/obs-listener`

### Environment variables

Copy `services/obs-listener/.env.example` to `services/obs-listener/.env`:

| Variable | Purpose |
|----------|---------|
| `LISTENER_HOST` | Bind address (default `127.0.0.1`) |
| `LISTENER_PORT` | HTTP port (default `8791`) |
| `LISTENER_AUTH_TOKEN` | Bearer token required by the listener |
| `OBS_HOST` | OBS WebSocket host (default `127.0.0.1`) |
| `OBS_PORT` | OBS WebSocket port (default `4455`) |
| `OBS_PASSWORD` | OBS WebSocket password |
| `OBS_RECONNECT_MS` | Reconnect delay (default `3000`) |

### Start the listener (Windows)

```powershell
cd services\obs-listener
copy .env.example .env
# edit .env with your token and OBS password
npm install
npm start
```

### Always-on (home PC — recommended)

So Broadcast Control stays reachable when you go live without warning:

```powershell
cd services\obs-listener
powershell -ExecutionPolicy Bypass -File .\scripts\install-listener-autostart.ps1
```

That registers Task Scheduler jobs to:

1. Start the OBS listener at Windows logon
2. Start / keep a Cloudflare Quick Tunnel to `127.0.0.1:8791`
3. Re-check both every 5 minutes (no-op if already healthy)
4. If the Quick Tunnel hostname changes, sync `listener_url` in D1 via Wrangler

Manual one-shots:

```powershell
.\scripts\ensure-listener.ps1
.\scripts\ensure-quick-tunnel.ps1
```

Remove with `.\scripts\uninstall-listener-autostart.ps1`.

For chase-day reliability, prefer a **named Cloudflare Tunnel** with a fixed hostname instead of Quick Tunnel (`*.trycloudflare.com`). Quick Tunnel URLs can change on restart; the ensure script syncs D1 when that happens, but a named tunnel avoids the churn.

### Confirm connectivity

```powershell
curl.exe http://127.0.0.1:8791/health
curl.exe -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8791/status
```

Healthy responses include `"ok": true` and `"obsConnected": true` when OBS is running with WebSocket enabled.

## Worker / Cloudflare configuration

You can configure the listener from the **Settings** panel at the bottom of `/broadcast/control/` (recommended):

| Field | Purpose |
|-------|---------|
| Listener URL | Tunnel or LAN URL of the OBS listener |
| Listener auth token | Must match `LISTENER_AUTH_TOKEN` on the vehicle PC |
| OBS host / port / password | Pulled by the local listener when `PLATFORM_BASE_URL` is set |
| Reconnect interval | OBS reconnect delay in ms |

Secrets are write-only in the UI (leave blank to keep the current value).

Optional env fallbacks (`.dev.vars` / Wrangler secrets) still work if nothing is saved in the browser yet:

| Variable | Purpose |
|----------|---------|
| `OBS_LISTENER_URL` | Base URL of the listener |
| `OBS_LISTENER_TOKEN` | Bearer token matching the listener `LISTENER_AUTH_TOKEN` |

On the vehicle PC, set in `services/obs-listener/.env`:

```
LISTENER_AUTH_TOKEN=same-token-as-browser-settings
PLATFORM_BASE_URL=https://heartlandstormchaser.ike-j-rebout.workers.dev
```

The listener polls `/api/broadcast/agent-config` about every 15 seconds and applies OBS host/port/password changes.

Apply the permission migration:

```powershell
npx wrangler d1 migrations apply heartland-storm-chaser-db --remote
```

## API endpoints

All require a signed-in web session (Worker auth gate). Writes also require an authenticated user (not device bearer alone).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/broadcast/status` | Aggregated OBS + telemetry + health cards |
| GET | `/api/broadcast/scenes` | Scene list |
| POST | `/api/broadcast/scenes/activate` | `{ "sceneName": "..." }` |
| GET | `/api/broadcast/sources` | Active-scene sources |
| POST | `/api/broadcast/sources/visibility` | `{ "sourceName", "visible" }` |
| POST | `/api/broadcast/sources/mute` | `{ "sourceName", "muted" }` |
| GET | `/api/broadcast/stats` | OBS stats |
| POST | `/api/broadcast/stream/start` | Start streaming |
| POST | `/api/broadcast/stream/stop` | Stop streaming |
| POST | `/api/broadcast/recording/start` | Start recording |
| POST | `/api/broadcast/recording/stop` | Stop recording |
| POST | `/api/broadcast/reconnect` | Reconnect listener → OBS |

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Listener not configured | `OBS_LISTENER_URL` / `OBS_LISTENER_TOKEN` missing on Worker |
| Listener offline | Listener process not running; tunnel down; wrong URL |
| OBS disconnected | OBS closed; WebSocket disabled; wrong `OBS_PASSWORD` / port |
| Invalid password | OBS WebSocket password mismatch |
| 401 on control | Sign in again; session expired |
| Scenes empty | OBS connected but no scenes; refresh status |
| GPS stale | Platform GPS device not updating within 30s live threshold |

## Scenes

Scene buttons are loaded live from OBS. Rename or add scenes in OBS; they appear on the next status refresh. Example names (not hardcoded): Front Camera, Cab Camera, Radar Full, Starting Soon, Be Right Back, Ending, Emergency.

## Phase 1 included

- OBS / listener connection status with auto-reconnect
- Stream and recording status + controls (stop confirms)
- Dynamic scene switcher
- Active-scene source visibility / mute
- OBS statistics panel
- Health cards, telemetry (existing GPS/weather), event log
- Polling with backoff (about 3–15s)

## Later phases (not in Phase 1)

- Central nav link on every existing page
- Durable Object / persistent agent channel (no tunnel required)
- Source thumbnails in the UI
- Frame-accurate camera health
- Distance/ETA to target
- Role-strict `broadcast.control` enforcement only (admin-only option)
- Windows service installer
