#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$TaskName = "Heartland WeatherFront OBS Controller"
$PidFile = Join-Path $env:LOCALAPPDATA "Heartland\WeatherFrontOBS\state\weatherfront-obs-controller.pid"

function Test-IsAdministrator {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
  Write-Error "Run as Administrator."
  exit 1
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'."
} else {
  Write-Host "Task '$TaskName' not present."
}

if (Test-Path $PidFile) {
  $raw = (Get-Content $PidFile -Raw).Trim()
  $procId = 0
  if ([int]::TryParse($raw, [ref]$procId) -and $procId -gt 0) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped controller PID $procId."
    }
  }
  Remove-Item -Force $PidFile -ErrorAction SilentlyContinue
}

Write-Host "Preserved browser-profile, config, logs, and Home GPS Bridge task."
Write-Host "Safe to re-run."
exit 0
