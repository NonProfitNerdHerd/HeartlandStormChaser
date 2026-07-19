# Heartland Home GPS Bridge

Continuously pulls the **authoritative Platform GPS Source** from the Heartland Storm Chaser Cloudflare Worker and exposes it on this Windows PC as a local NMEA 0183 TCP stream for **GPSComplete / GPSDirect** → Windows Location Services.

## What each component does

| Piece | Role |
|-------|------|
| Truck Android GPS app | Uploads GPS to the Worker (`POST /api/gps/update`) |
| Platform GPS Source | The one device marked `is_platform_source` in D1 — the app’s authoritative location |
| `GET /api/gps/home-bridge` | Authenticated read of that location (bearer token) |
| **Home GPS Bridge** (this tool) | Polls the API, converts to NMEA, serves TCP + status |
| GPSComplete / GPSDirect | TCP **client** that feeds Windows Location Services |
| Windows Location Services | Apps that honor the OS location sensor |

**Why GPSComplete alone is not enough:** GPSComplete/GPSDirect needs a live NMEA feed on an IP:port. It does not talk to the Storm Chaser Worker. This bridge is the missing link.

**Do not use GPSReverse** for this use case — GPSReverse converts the other direction.

```
Truck GPS → Worker platform location → Home GPS Bridge
  → 127.0.0.1:10110 (NMEA TCP server)
  → GPSComplete/GPSDirect (TCP client)
  → Windows Location Services
```

Local ports are **loopback-only** (`127.0.0.1`). They are intentionally not reachable from other computers.

---

## Prerequisites

1. **Node.js 20 or newer**  
   - Download: https://nodejs.org/  
   - Verify: `node -v`  
   - Find the path: `where.exe node`

2. Deployed Worker with secret `HOME_GPS_BRIDGE_TOKEN` (see [Backend deploy](#backend-deploy)).

3. **GPSComplete** with the **GPSDirect** driver (or equivalent) installed.

---

## Configure the bridge

```powershell
cd tools\home-gps-bridge
copy .env.example .env
notepad .env
```

Set at least:

```env
GPS_API_URL=https://YOUR-WORKER-HOST/api/gps/home-bridge
GPS_API_TOKEN=the-same-value-as-HOME_GPS_BRIDGE_TOKEN
```

Never commit `.env`. Never put the token in a scheduled-task argument.

There are **no npm dependencies**. Node built-ins only.

---

## Manual start (first-time verification)

```powershell
cd tools\home-gps-bridge
.\start-home-gps-bridge.cmd
```

Or:

```powershell
npm start
```

You should see:

```text
NMEA server listening on 127.0.0.1:10110
Status server listening on http://127.0.0.1:10111/status
```

Then verify:

```powershell
Test-NetConnection 127.0.0.1 -Port 10110
```

Expect `TcpTestSucceeded : True`.

Open status:

```powershell
Start-Process http://127.0.0.1:10111/status
```

Confirm GPS state is **Fresh** or **Delayed** when the truck platform source is live. Coordinates are not shown on the status page by design.

---

## Configure GPSComplete / GPSDirect

1. Open GPSComplete.
2. Configure the driver as **GPSDirect**.
3. Source type: **IP:Port**
4. IP address: `127.0.0.1`
5. Port: `10110`
6. Enable **Keep live updates**.
7. Enable **Maximum precision** when available.

Remember: **GPSComplete is the TCP client**; **Home GPS Bridge is the TCP server**.

Verify Windows location with GPSComplete’s Sensor Testing Tool or Windows **Sensor Explorer** / Location privacy settings. Browser maps may still use IP geolocation and ignore Windows Location Services — that is expected.

---

## Autostart (required for finished install)

> **Production home PC:** Prefer the verified Interactive / `node.exe` procedure in
> [`docs/home-pc-autostart.md`](../../docs/home-pc-autostart.md)
> (S4U AtStartup and `cmd` wrappers failed after reboot on the first deploy PC).

After manual verification succeeds, install the Scheduled Task **as Administrator**:

```powershell
cd path\to\HeartlandStormChaser\tools\home-gps-bridge
powershell -ExecutionPolicy Bypass -File .\install-startup-task.ps1
```

The installer:

- Creates task **`Heartland Home GPS Bridge`**
- Starts at **Windows startup** (20s delay) when S4U is available
- Restarts every 1 minute on failure (up to 999 attempts)
- Loads the token only from `.env` (never from task XML/args)
- Verifies ports 10110 and 10111

Confirm the task:

```powershell
Get-ScheduledTask -TaskName 'Heartland Home GPS Bridge'
```

Restart Windows, then again:

```powershell
Test-NetConnection 127.0.0.1 -Port 10110
Start-Process http://127.0.0.1:10111/status
```

### Autostart security note

True “run whether or not the user is logged on” normally requires storing a Windows password **or** running as SYSTEM. This installer uses **S4U** for the installing user so the task can start at boot **without embedding a password**. If your PC policy blocks S4U / pre-login HTTPS, the script falls back to **Interactive AtLogOn** (same class of limitation as the OBS listener) and documents that in the installer output. Do not paste your Windows password into scripts.

---

## Uninstall autostart

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-startup-task.ps1
```

Optional log cleanup:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-startup-task.ps1 -CleanupLogs
```

This removes **only** the Heartland Home GPS Bridge task and its PID-tracked process. Source files and `.env` are preserved.

---

## Updating the bridge

1. Pull/update source under `tools/home-gps-bridge`.
2. Keep your existing `.env`.
3. Re-run `install-startup-task.ps1` as Administrator (idempotent) or restart the task:

```powershell
Restart-ScheduledTask -TaskName 'Heartland Home GPS Bridge'
```

---

## Backend deploy

Do **not** deploy from this README automatically — run these yourself when ready.

1. Create the Worker secret (paste the token when prompted; it will not echo):

```powershell
cd path\to\HeartlandStormChaser
npx wrangler secret put HOME_GPS_BRIDGE_TOKEN
```

2. Deploy the Worker:

```powershell
npm run deploy
```

3. Verify with a valid token (PowerShell; avoid echoing the token into shared logs):

```powershell
$token = Read-Host -AsSecureString
$BSTR = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
Invoke-RestMethod -Uri "https://YOUR-WORKER-HOST/api/gps/home-bridge" -Headers @{ Authorization = "Bearer $plain" }
$plain = $null
```

4. Confirm invalid token is rejected (expect 401):

```powershell
try {
  Invoke-WebRequest -Uri "https://YOUR-WORKER-HOST/api/gps/home-bridge" -Headers @{ Authorization = "Bearer wrong" }
} catch { $_.Exception.Response.StatusCode.value__ }
```

Local Worker secret for `wrangler dev`: add `HOME_GPS_BRIDGE_TOKEN=...` to `.dev.vars` (gitignored).

---

## npm scripts

```powershell
cd tools\home-gps-bridge
npm start    # run bridge (requires .env)
npm test     # automated tests
npm run check
```

From repo root: `npm run test:home-gps-bridge`

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| Invalid API token / Unauthorized | `GPS_API_TOKEN` must match Worker secret `HOME_GPS_BRIDGE_TOKEN`. Status shows authentication `unauthorized`. |
| Stale platform location | Truck GPS not uploading, or wrong Platform GPS Source selected in the app. Status shows **Stale**; NMEA emits invalid fix (RMC `V`). |
| Missing Node.js | Install Node 20+, reopen Admin PowerShell, `where.exe node`. |
| Malformed GPS data | Backend returned bad JSON/coords; check `logs\bridge.log` (no coordinates logged by default). |
| Port 10110 in use | Another bridge instance, or another NMEA server. Stop the other process; check `runtime\home-gps-bridge.pid`. |
| Port 10111 in use | Same — only one bridge should run. |
| Scheduled task failures | Event Viewer → Task Scheduler; `logs\task-stdout.log`, `logs\task-stderr.log`, `logs\bridge.log`. Re-run installer as Admin. |
| Windows update removed GPSDirect | Reinstall GPSComplete/GPSDirect; re-point to `127.0.0.1:10110`. |
| Browser map shows home IP location | Many browsers ignore Windows Location Services. Use Sensor Explorer / GPSComplete tools instead. |
| S4U / no network before login | Use Interactive fallback from installer output, or move install off OneDrive-only paths if using SYSTEM (not default). |

---

## Status classifications

- **Fresh** — fix newer than ~10s  
- **Delayed** — fix age under `STALE_AFTER_SECONDS` but older than 10s  
- **Stale** — older than `STALE_AFTER_SECONDS` (default 30); invalid NMEA  
- **Unavailable** — no accepted fix yet / backend empty  
- **Unauthorized** — 401/403 from API  
- **Malformed** — bad JSON or invalid coordinates  

---

## Intended install sequence

1. Deploy Worker + set `HOME_GPS_BRIDGE_TOKEN`
2. Configure `.env`
3. Manual `start-home-gps-bridge.cmd`
4. Confirm coordinates via your usual app sources / status health
5. `Test-NetConnection 127.0.0.1 -Port 10110`
6. Open status page
7. Configure GPSComplete
8. Run `install-startup-task.ps1` as Administrator
9. Restart Windows
10. Confirm task + ports again
