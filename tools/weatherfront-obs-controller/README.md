# WeatherFront OBS Controller

Launches a **dedicated Chromium window** for [WeatherFront](https://app.weatherfront.com), injects the truck’s **Platform GPS** from the local Home GPS Bridge, keeps location-follow active, and exposes a stable window title for OBS Window Capture:

**`Heartland WeatherFront OBS`**

This is **not** an iframe, overlay page, or WeatherFront replacement. It is a headed Playwright Chromium app window.

## Data flow

```
Truck GPS → Cloudflare platform location → Home GPS Bridge
  → http://127.0.0.1:10111/location
  → WeatherFront OBS Controller
  → Chromium (app.weatherfront.com) + setGeolocation + follow button
  → OBS Window Capture (exact title)
```

**GPSComplete / GPSDirect / GPSReverse are not used** on this path. Leave them alone if you use them for Windows Location Services; this controller talks only to the bridge’s localhost `/location` JSON.

## Why not an ordinary browser tab?

OBS must capture one unambiguous window. This controller:

- Uses Playwright’s bundled Chromium (not your daily Chrome/Edge profile)
- Stores login/settings in `%LOCALAPPDATA%\Heartland\WeatherFrontOBS\browser-profile`
- Forces window title `Heartland WeatherFront OBS`
- Never attaches to your normal browser windows

## Prerequisites

1. **Node.js 20+**
2. **Home GPS Bridge** running (`tools/home-gps-bridge`) with healthy `http://127.0.0.1:10111/location`
3. OBS Studio (for capture), optional OBS WebSocket on `4455`

## Development (from this repo)

```powershell
cd C:\Users\ikere\OneDrive\Documents\GitHub\HeartlandLauncherBasement\HeartlandStormChaser\tools\weatherfront-obs-controller
copy .env.example .env
notepad .env
npm install
npx playwright install chromium
npm start
```

Status: [http://127.0.0.1:10112/status](http://127.0.0.1:10112/status)

### First-run WeatherFront login

1. Start the Home GPS Bridge; confirm `/location` returns `valid: true` when the truck is live.
2. `npm start` — Chromium opens WeatherFront.
3. **Log in manually** in that window (credentials are never stored in code).
4. Configure radar product, overlays, zoom once — the persistent profile keeps them.
5. Confirm status shows login `OK`, follow found/active when possible, title correct.
6. Point OBS Window Capture at **Heartland WeatherFront OBS** (title must match; cursor off).

### Inspect location-follow button

```powershell
npm run inspect:weatherfront
```

Log in if needed, press Enter in the terminal. Candidates + screenshot go to `%LOCALAPPDATA%\Heartland\WeatherFrontOBS\screenshots\` (not Git).

### OBS WebSocket setup (optional, explicit)

```powershell
# In .env: OBS_WEBSOCKET_ENABLED=true, OBS_SCENE_NAME=YourScene, OBS_SOURCE_NAME=WeatherFront Radar
npm run obs:setup
```

Then verify in OBS: Window Capture → window title **Heartland WeatherFront OBS** → Match priority: title must match → Capture cursor: Off.

Manual OBS setup is preferred if WebSocket Window Capture settings differ on your build.

## Production install (not from OneDrive/Git)

```powershell
cd ...\tools\weatherfront-obs-controller
powershell -ExecutionPolicy Bypass -File .\scripts\install-local.ps1
```

Installs app under `%LOCALAPPDATA%\Heartland\WeatherFrontOBS\app`, config under `...\config`, profile under `...\browser-profile`.

### Autostart (interactive logon)

> **Production home PC:** Prefer the verified `node.exe` AtLogOn procedure in
> [`docs/home-pc-autostart.md`](../../docs/home-pc-autostart.md)
> (the stock `install-startup-task.ps1` cmd wrapper returned `LastTaskResult : 1` when hand-start worked).

```powershell
# Administrator PowerShell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup-task.ps1
```

Task name: **`Heartland WeatherFront OBS Controller`**

- Starts **at user logon** (+ ~25s delay), Interactive session only  
- Does **not** run in Session 0 / before login  
- Does **not** enable Windows automatic login (you must decide that yourself)  
- GPS Bridge can still start at boot; WeatherFront/OBS need a desktop session  

Uninstall task only (keeps profile):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-startup-task.ps1
```

## npm scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Run controller |
| `npm test` | Automated tests |
| `npm run check` | Syntax check |
| `npm run inspect:weatherfront` | Toolbar discovery helper |
| `npm run obs:setup` | Explicit OBS source create/update |
| `npm run install:local` | Copy to LOCALAPPDATA |
| `npm run install:startup` | Scheduled task |
| `npm run uninstall:startup` | Remove task only |

## Troubleshooting

| Symptom | Check |
|---------|--------|
| GPS bridge unavailable | Start Home GPS Bridge; `http://127.0.0.1:10111/location` |
| Stale location | Truck GPS / platform source; controller keeps last map position, does not invent home GPS |
| LOGIN_REQUIRED | Log in inside the Chromium window; status must not claim healthy until OK |
| Follow button not found | `npm run inspect:weatherfront`; update selectors if WeatherFront changed DOM |
| Follow inactive | Status “Reactivate follow”; watchdog retries with cooldown |
| Black/frozen OBS | Window minimized/locked; unlock Windows; don’t minimize Chromium; match exact title |
| Port 10112 in use | Another controller instance; check PID under `%LOCALAPPDATA%\...\state\` |
| Playwright Chromium missing | `npx playwright install chromium` |
| Scheduled task failure | Event Viewer + `%LOCALAPPDATA%\Heartland\WeatherFrontOBS\logs\` |

## Security

- Status/control bind to **127.0.0.1 only**
- Mutating `/control/*` requires POST + local control token
- No credentials in Git; profile outside repo/OneDrive
- Geolocation granted only for WeatherFront origin
- No Cloudflare deploys from this tool
