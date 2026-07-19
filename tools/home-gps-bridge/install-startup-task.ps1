#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the Heartland Home GPS Bridge Windows Scheduled Task (boot autostart).

.DESCRIPTION
  Creates an idempotent task named "Heartland Home GPS Bridge" that starts at
  Windows startup (20s delay), restarts on failure, and loads secrets only from
  the local .env file (never from task arguments).

  Uses LogonType S4U so the task can run whether or not the user is logged on
  without storing the Windows account password. If your environment blocks S4U
  outbound HTTPS, see README.md for the Interactive/AtLogOn fallback.
#>
$ErrorActionPreference = "Stop"

$TaskName = "Heartland Home GPS Bridge"
$Root = $PSScriptRoot
$StartCmd = Join-Path $Root "start-home-gps-bridge.cmd"
$EnvFile = Join-Path $Root ".env"
$LogsDir = Join-Path $Root "logs"
$RuntimeDir = Join-Path $Root "runtime"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
  Write-Error "Administrator privileges are required. Right-click PowerShell and choose 'Run as administrator', then re-run this script."
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js was not found on PATH. Install Node.js 20 or newer, then re-run."
  exit 1
}

$nodeVersion = (& node -v) 2>$null
Write-Host "Found Node.js $nodeVersion"

if (-not (Test-Path $StartCmd)) {
  Write-Error "Missing start script: $StartCmd"
  exit 1
}

if (-not (Test-Path $EnvFile)) {
  Write-Error "Missing .env at $EnvFile. Copy .env.example to .env and configure GPS_API_URL / GPS_API_TOKEN first."
  exit 1
}

$envLines = Get-Content -Path $EnvFile -ErrorAction Stop
$gpsApiUrl = ($envLines | Where-Object { $_ -match '^\s*GPS_API_URL\s*=' } | Select-Object -First 1)
if (-not $gpsApiUrl -or $gpsApiUrl -notmatch '=\s*\S+') {
  Write-Error "GPS_API_URL is missing or empty in .env"
  exit 1
}
$urlValue = ($gpsApiUrl -split '=', 2)[1].Trim().Trim('"').Trim("'")
if ([string]::IsNullOrWhiteSpace($urlValue)) {
  Write-Error "GPS_API_URL is empty in .env"
  exit 1
}
# Never print token; only confirm URL key exists
Write-Host "GPS_API_URL is set (value not printed)."

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

$stdoutLog = Join-Path $LogsDir "task-stdout.log"
$stderrLog = Join-Path $LogsDir "task-stderr.log"

# Action runs the .cmd with absolute paths. Token is NOT in arguments.
$action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$StartCmd`" >> `"$stdoutLog`" 2>> `"$stderrLog`"" `
  -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -AtStartup
# 20-second delay after startup for networking
$trigger.Delay = "PT20S"

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 `
  -RestartInterval ([TimeSpan]::FromMinutes(1)) `
  -MultipleInstances IgnoreNew

# Prefer S4U: run whether logged on or not without storing password.
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = $null
$logonMode = "S4U"
try {
  $principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType S4U `
    -RunLevel Highest
} catch {
  Write-Warning "S4U principal could not be created ($($_.Exception.Message)). Falling back to Interactive AtLogOn."
  $logonMode = "Interactive"
  $principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Highest
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $trigger.Delay = "PT20S"
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null

Write-Host "Scheduled task '$TaskName' registered (logon mode: $logonMode)."

# Verify task XML does not contain the API token
$taskXml = (Export-ScheduledTask -TaskName $TaskName) | Out-String
$tokenLine = ($envLines | Where-Object { $_ -match '^\s*GPS_API_TOKEN\s*=' } | Select-Object -First 1)
if ($tokenLine) {
  $tokenValue = ($tokenLine -split '=', 2)[1].Trim().Trim('"').Trim("'")
  if ($tokenValue.Length -ge 8 -and $taskXml.Contains($tokenValue)) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Error "Refusing to keep scheduled task: API token appeared in task definition. Fix the installer."
    exit 1
  }
}

Write-Host "Starting task..."
Start-ScheduledTask -TaskName $TaskName

$verifiedNmea = $false
$verifiedStatus = $false
Write-Host "Waiting for listeners..."
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $nmea = Test-NetConnection -ComputerName 127.0.0.1 -Port 10110 -WarningAction SilentlyContinue
    if ($nmea.TcpTestSucceeded) { $verifiedNmea = $true }
  } catch { }
  try {
    $status = Test-NetConnection -ComputerName 127.0.0.1 -Port 10111 -WarningAction SilentlyContinue
    if ($status.TcpTestSucceeded) { $verifiedStatus = $true }
  } catch { }
  if ($verifiedNmea -and $verifiedStatus) { break }
}

Write-Host ""
Write-Host "=== Installation result ==="
Write-Host "Task created:     Yes ($TaskName)"
Write-Host "Task started:     Yes"
Write-Host "NMEA :10110:      $(if ($verifiedNmea) { 'Verified listening' } else { 'NOT verified — check logs\bridge.log' })"
Write-Host "Status :10111:    $(if ($verifiedStatus) { 'Verified listening' } else { 'NOT verified — check logs\bridge.log' })"
Write-Host "Logon mode:       $logonMode"
Write-Host ""
Write-Host "Verification commands:"
Write-Host "  Test-NetConnection 127.0.0.1 -Port 10110"
Write-Host "  Start-Process http://127.0.0.1:10111/status"
Write-Host ""
Write-Host "Get-ScheduledTask -TaskName '$TaskName'"
Write-Host ""

if (-not ($verifiedNmea -and $verifiedStatus)) {
  Write-Warning "Task was installed but listeners were not confirmed yet. Check $LogsDir"
  exit 1
}

Write-Host "Success. The Heartland Home GPS Bridge will start automatically after Windows restarts."
exit 0
