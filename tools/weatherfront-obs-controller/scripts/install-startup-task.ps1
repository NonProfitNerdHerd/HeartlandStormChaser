#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install AtLogOn scheduled task for WeatherFront OBS Controller (interactive session only).
#>
$ErrorActionPreference = "Stop"

$TaskName = "Heartland WeatherFront OBS Controller"
$DestRoot = Join-Path $env:LOCALAPPDATA "Heartland\WeatherFrontOBS"
$AppDir = Join-Path $DestRoot "app"
$ConfigEnv = Join-Path $DestRoot "config\.env"
$StartCmd = Join-Path $AppDir "scripts\start-weatherfront-controller.cmd"
$LogsDir = Join-Path $DestRoot "logs"

function Test-IsAdministrator {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
  Write-Error "Run PowerShell as Administrator."
  exit 1
}

if (-not (Test-Path $AppDir)) {
  Write-Error "Local install missing at $AppDir. Run install-local.ps1 first."
  exit 1
}
if (-not (Test-Path $ConfigEnv)) {
  Write-Error "Missing $ConfigEnv"
  exit 1
}
if (-not (Test-Path $StartCmd)) {
  Write-Error "Missing $StartCmd"
  exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js not on PATH."
  exit 1
}

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
$stdoutLog = Join-Path $LogsDir "task-stdout.log"
$stderrLog = Join-Path $LogsDir "task-stderr.log"

$action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$StartCmd`" >> `"$stdoutLog`" 2>> `"$stderrLog`"" `
  -WorkingDirectory $AppDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = "PT25S"

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

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null

Write-Host "Registered task '$TaskName' (AtLogOn + 25s delay, Interactive)."
Write-Host "NOTE: WeatherFront/OBS need an interactive desktop. This does NOT enable Windows auto-login."
Write-Host "GPS Bridge may start at boot; this controller starts after you log on."

Start-ScheduledTask -TaskName $TaskName
Write-Host "Started task. Waiting for status port 10112..."

$ok = $false
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 2
  try {
    $t = Test-NetConnection 127.0.0.1 -Port 10112 -WarningAction SilentlyContinue
    if ($t.TcpTestSucceeded) { $ok = $true; break }
  } catch {}
}

Write-Host "Status :10112 verified: $ok"
Write-Host "Open: http://127.0.0.1:10112/status"
Write-Host "Get-ScheduledTask -TaskName '$TaskName'"
if (-not $ok) {
  Write-Warning "Task registered but port not confirmed yet. Check $LogsDir"
  exit 1
}
exit 0
