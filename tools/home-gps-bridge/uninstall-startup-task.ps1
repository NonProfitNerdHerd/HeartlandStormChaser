#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Uninstalls the Heartland Home GPS Bridge scheduled task and stops its process.

.PARAMETER CleanupLogs
  Also deletes the local logs directory.
#>
param(
  [switch]$CleanupLogs
)

$ErrorActionPreference = "Stop"

$TaskName = "Heartland Home GPS Bridge"
$Root = $PSScriptRoot
$PidFile = Join-Path $Root "runtime\home-gps-bridge.pid"
$LogsDir = Join-Path $Root "logs"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
  Write-Error "Administrator privileges are required. Run PowerShell as Administrator."
  exit 1
}

$stoppedTask = $false
$removedTask = $false
$stoppedPid = $null

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $stoppedTask = $true
  } catch { }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  $removedTask = $true
  Write-Host "Removed scheduled task '$TaskName'."
} else {
  Write-Host "Scheduled task '$TaskName' was not present (nothing to remove)."
}

if (Test-Path $PidFile) {
  $raw = (Get-Content -Path $PidFile -Raw).Trim()
  $pidValue = 0
  if ([int]::TryParse($raw, [ref]$pidValue) -and $pidValue -gt 0) {
    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($proc) {
      # Only stop if command line looks like our bridge (best-effort) or PID file matches
      try {
        Stop-Process -Id $pidValue -Force -ErrorAction Stop
        $stoppedPid = $pidValue
        Write-Host "Stopped bridge process PID $pidValue."
      } catch {
        Write-Warning "Could not stop PID $pidValue: $($_.Exception.Message)"
      }
    } else {
      Write-Host "PID file present but process $pidValue is not running (stale)."
    }
  }
  Remove-Item -Force -Path $PidFile -ErrorAction SilentlyContinue
  Write-Host "Removed PID file."
} else {
  Write-Host "No PID file found (no bridge process stopped via PID file)."
}

if ($CleanupLogs -and (Test-Path $LogsDir)) {
  Remove-Item -Recurse -Force -Path $LogsDir
  Write-Host "Removed logs directory."
} else {
  Write-Host "Preserved logs and .env / source files."
}

Write-Host ""
Write-Host "=== Uninstall summary ==="
Write-Host "Task stopped:  $stoppedTask"
Write-Host "Task removed:  $removedTask"
Write-Host "Process PID:   $(if ($stoppedPid) { $stoppedPid } else { 'none' })"
Write-Host "Source/.env:   preserved"
Write-Host "Safe to re-run."
exit 0
