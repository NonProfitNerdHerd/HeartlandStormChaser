# Home PC autostart install guide

After Windows restart **and login**, this stack should come up automatically:

1. Home GPS Bridge (`:10110` NMEA, `:10111` status/location)
2. WeatherFront OBS Chromium controller (`:10112`)
3. OBS listener (+ Quick Tunnel, if configured) (`:8791`)
4. OBS Studio (optional Startup shortcut)

## What actually works (read this first)

Manual `start-*.cmd` can succeed while Scheduled Tasks fail. On the production home PC we found:

| Approach | Result |
|----------|--------|
| Task runs `cmd` + `.cmd` with `>>` log redirect | Often `LastTaskResult : 1`, empty logs, ports closed |
| GPS bridge **S4U / At startup** (“whether logged on or not”) | Fails after reboot even when post-login start works |
| Task runs **`node.exe` directly**, **Interactive + At logon** | Reliable |
| App under **OneDrive** at boot | Fragile — use `%LOCALAPPDATA%\Heartland\...` |

**Rule:** Never hand-start the bridge/WeatherFront *and* fire the scheduled task at the same time while testing (PID lock / leftover `node` processes).

---

## Prerequisites (every PC)

1. Windows user account you log into daily  
2. **Node.js 20+** installed for **all users**  
   - Confirm: `where.exe node` → preferably `C:\Program Files\nodejs\node.exe`  
3. HeartlandStormChaser repo (or the tool folders) on the machine  
4. Working secrets in `.env` files (see each tool’s `.env.example`)  
5. **Administrator** PowerShell for task registration  

---

## Part A — Home GPS Bridge

### A1. Copy off OneDrive to local disk

**From:** `HeartlandStormChaser\tools\home-gps-bridge`  

**To:** `%LOCALAPPDATA%\Heartland\HomeGpsBridge`  
(example: `C:\Users\<YOU>\AppData\Local\Heartland\HomeGpsBridge`)

Include **`.env`** with at least:

```env
GPS_API_URL=https://YOUR-WORKER-HOST/api/gps/home-bridge
GPS_API_TOKEN=same-as-HOME_GPS_BRIDGE_TOKEN-worker-secret
```

### A2. Manual test

```powershell
cd $env:LOCALAPPDATA\Heartland\HomeGpsBridge
.\start-home-gps-bridge.cmd
```

Open http://127.0.0.1:10111/status — confirm healthy GPS.  

Stop with **Ctrl+C** before registering the task.

### A3. Register Scheduled Task (working method)

Admin PowerShell:

```powershell
$TaskName = 'Heartland Home GPS Bridge'
$Root = "$env:LOCALAPPDATA\Heartland\HomeGpsBridge"
$Node = 'C:\Program Files\nodejs\node.exe'

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction `
  -Execute $Node `
  -Argument '--env-file=".env" "src\index.js"' `
  -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = 'PT20S'

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 `
  -RestartInterval ([TimeSpan]::FromMinutes(1)) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force

Start-ScheduledTask -TaskName $TaskName
Start-Sleep 8
Test-NetConnection 127.0.0.1 -Port 10111
Get-ScheduledTaskInfo -TaskName $TaskName | Format-List LastRunTime, LastTaskResult
```

**Success:** `TcpTestSucceeded : True`, `LastTaskResult` is `0` or `267009` (still running).

> The repo’s `install-startup-task.ps1` defaults to S4U/AtStartup. Prefer the Interactive/`node.exe` method above until that installer is updated.

Also see [`tools/home-gps-bridge/README.md`](../tools/home-gps-bridge/README.md).

---

## Part B — WeatherFront OBS Controller

### B1. Local install from repo

Admin PowerShell (adjust path):

```powershell
powershell -ExecutionPolicy Bypass -File "C:\PATH\TO\HeartlandStormChaser\tools\weatherfront-obs-controller\scripts\install-local.ps1"
```

Installs under `%LOCALAPPDATA%\Heartland\WeatherFrontOBS\` (config at `...\config\.env`).

First time: edit `config\.env`, run once manually, **log into WeatherFront** inside the Chromium window, configure radar/follow as needed.

### B2. Manual test

```powershell
& "$env:LOCALAPPDATA\Heartland\WeatherFrontOBS\app\scripts\start-weatherfront-controller.cmd"
```

Confirm Chromium titled **Heartland WeatherFront OBS** and http://127.0.0.1:10112/status.  

Stop with **Ctrl+C** before registering the task.

### B3. Register Scheduled Task (working method)

```powershell
$TaskName = 'Heartland WeatherFront OBS Controller'
$AppDir = "$env:LOCALAPPDATA\Heartland\WeatherFrontOBS\app"
$EnvFile = "$env:LOCALAPPDATA\Heartland\WeatherFrontOBS\config\.env"
$Node = 'C:\Program Files\nodejs\node.exe'

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction `
  -Execute $Node `
  -Argument "--env-file=`"$EnvFile`" `"src\index.js`"" `
  -WorkingDirectory $AppDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = 'PT30S'

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 `
  -RestartInterval ([TimeSpan]::FromMinutes(1)) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force

Start-ScheduledTask -TaskName $TaskName
Start-Sleep 15
Test-NetConnection 127.0.0.1 -Port 10112
Get-ScheduledTaskInfo -TaskName $TaskName | Format-List LastRunTime, LastTaskResult
```

**Success:** Chromium opens; port `10112` OK.

> Stock `scripts\install-startup-task.ps1` (cmd wrapper) failed with `LastTaskResult : 1` when hand-start worked. Prefer the `node.exe` method above.

Also see [`tools/weatherfront-obs-controller/README.md`](../tools/weatherfront-obs-controller/README.md).

---

## Part C — OBS listener (+ Quick Tunnel)

```powershell
cd C:\PATH\TO\HeartlandStormChaser\services\obs-listener
# Ensure .env exists (copy from .env.example)
powershell -ExecutionPolicy Bypass -File .\scripts\install-listener-autostart.ps1
```

Confirm: http://127.0.0.1:8791/health  

Details: [`docs/broadcast-control.md`](broadcast-control.md).

---

## Part D — OBS Studio (optional)

1. `Win+R` → `shell:startup`  
2. New shortcut →  
   `C:\Program Files\obs-studio\bin\64bit\obs64.exe`  
3. “Start in”:  
   `C:\Program Files\obs-studio\bin\64bit`  

(The Heartland tasks do **not** launch OBS by themselves.)

---

## Part E — Reboot verification

1. Restart Windows  
2. **Log in** (Interactive At Logon tasks need a desktop session)  
3. Wait ~45–60 seconds  
4. Check:

```powershell
Test-NetConnection 127.0.0.1 -Port 10111   # GPS bridge
Test-NetConnection 127.0.0.1 -Port 10112   # WeatherFront
Test-NetConnection 127.0.0.1 -Port 8791    # OBS listener (if installed)

Get-ScheduledTaskInfo -TaskName 'Heartland Home GPS Bridge' | Format-List LastRunTime, LastTaskResult
Get-ScheduledTaskInfo -TaskName 'Heartland WeatherFront OBS Controller' | Format-List LastRunTime, LastTaskResult
```

Before trusting a reboot, confirm each task with `Start-ScheduledTask` (not only hand `.cmd`).

---

## Ports

| Port | Service |
|------|---------|
| 10110 | GPS Bridge NMEA TCP |
| 10111 | GPS Bridge status /location |
| 10112 | WeatherFront controller status |
| 8791 | OBS listener |
| 4455 | OBS WebSocket (typical) |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Hand start works, task `LastTaskResult : 1` | `cmd` wrapper / bad action | Run `node.exe` directly (A3 / B3) |
| Works after login start, fails after reboot | S4U / AtStartup | Use **Interactive + AtLogOn** |
| Port refused | Process not running | Check `LastTaskResult` — “already running” would make the port test **succeed** |
| Task fails; another instance / no new log lines | Stale PID / leftover `node` | Stop `*\nodejs\node.exe`, delete `runtime\*.pid`, retry |
| Empty `task-stderr` / `task-stdout` | Redirect often useless under Task Scheduler | Prefer direct `node.exe`; check app logs |
| GPS up, no WeatherFront map dot / HUD live | Bridge down or stale, or follow inactive | Fix `:10111` first; then controller status `:10112` |
| App under OneDrive only | Sync / path not ready | Install under `%LOCALAPPDATA%\Heartland\...` |

### Clean leftover Node (GPS / WeatherFront)

```powershell
Get-Process node -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like '*\nodejs\node.exe' } |
  Stop-Process -Force

Remove-Item "$env:LOCALAPPDATA\Heartland\HomeGpsBridge\runtime\home-gps-bridge.pid" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:LOCALAPPDATA\Heartland\WeatherFrontOBS\state\*.pid" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:LOCALAPPDATA\Heartland\WeatherFrontOBS\app\runtime\*.pid" -Force -ErrorAction SilentlyContinue
```

---

## Related docs

- [`tools/home-gps-bridge/README.md`](../tools/home-gps-bridge/README.md)  
- [`tools/weatherfront-obs-controller/README.md`](../tools/weatherfront-obs-controller/README.md)  
- [`docs/broadcast-control.md`](broadcast-control.md)  
