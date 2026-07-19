#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Remove installed app files. Optionally remove profile/config/logs.
#>
param(
  [switch]$RemoveProfile,
  [switch]$RemoveConfig,
  [switch]$RemoveLogs
)

$ErrorActionPreference = "Stop"
$DestRoot = Join-Path $env:LOCALAPPDATA "Heartland\WeatherFrontOBS"
$AppDir = Join-Path $DestRoot "app"

# Ensure startup task gone first
& (Join-Path $PSScriptRoot "uninstall-startup-task.ps1")

if (Test-Path $AppDir) {
  Remove-Item -Recurse -Force $AppDir
  Write-Host "Removed $AppDir"
}

if ($RemoveConfig) {
  Remove-Item -Recurse -Force (Join-Path $DestRoot "config") -ErrorAction SilentlyContinue
  Write-Host "Removed config"
}
if ($RemoveLogs) {
  Remove-Item -Recurse -Force (Join-Path $DestRoot "logs") -ErrorAction SilentlyContinue
  Write-Host "Removed logs"
}
if ($RemoveProfile) {
  Remove-Item -Recurse -Force (Join-Path $DestRoot "browser-profile") -ErrorAction SilentlyContinue
  Write-Host "Removed browser profile (WeatherFront login cleared)"
} else {
  Write-Host "Preserved browser-profile (default)."
}

Write-Host "Uninstall local complete."
exit 0
