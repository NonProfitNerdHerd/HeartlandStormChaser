#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Install WeatherFront OBS Controller into %LOCALAPPDATA%\Heartland\WeatherFrontOBS
  Preserves browser-profile, config, and logs.
#>
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Source = $RepoRoot
$DestRoot = Join-Path $env:LOCALAPPDATA "Heartland\WeatherFrontOBS"
$AppDir = Join-Path $DestRoot "app"
$ConfigDir = Join-Path $DestRoot "config"
$ProfileDir = Join-Path $DestRoot "browser-profile"
$LogsDir = Join-Path $DestRoot "logs"
$StateDir = Join-Path $DestRoot "state"
$ScreenshotsDir = Join-Path $DestRoot "screenshots"

function Test-Node20 {
  $v = (& node -v) 2>$null
  if (-not $v) { return $false }
  if ($v -match '^v(\d+)\.') {
    return [int]$Matches[1] -ge 20
  }
  return $false
}

if (-not (Test-Node20)) {
  Write-Error "Node.js 20 or newer is required."
  exit 1
}

Write-Host "Installing to $DestRoot"
New-Item -ItemType Directory -Force -Path $AppDir, $ConfigDir, $ProfileDir, $LogsDir, $StateDir, $ScreenshotsDir | Out-Null

# Sync application files (exclude git, env, node_modules, tests optional keep)
$robolog = Join-Path $env:TEMP "wf-obs-install.log"
$excludeDirs = @(".git", "node_modules", "logs", "runtime")
# Use robocopy for idempotent sync
$rcArgs = @(
  $Source, $AppDir, "/MIR", "/XD", "node_modules", ".git", "logs",
  "/XF", ".env", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"
)
& robocopy @rcArgs | Out-Null
# robocopy exit codes 0-7 are success-ish
if ($LASTEXITCODE -ge 8) {
  Write-Error "robocopy failed with code $LASTEXITCODE"
  exit 1
}

# Preserve / create config .env
$example = Join-Path $AppDir ".env.example"
$destEnv = Join-Path $ConfigDir ".env"
if (-not (Test-Path $destEnv)) {
  if (Test-Path (Join-Path $Source ".env")) {
    Copy-Item (Join-Path $Source ".env") $destEnv
    Write-Host "Copied existing .env to config."
  } elseif (Test-Path $example) {
    Copy-Item $example $destEnv
    Write-Host "Created config\.env from example - edit secrets before production use."
  }
} else {
  Write-Host "Preserved existing config\.env"
}

Write-Host "Installing npm dependencies in app..."
Push-Location $AppDir
try {
  npm install --omit=dev
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  npx playwright install chromium
  if ($LASTEXITCODE -ne 0) { throw "playwright install chromium failed" }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Install complete."
Write-Host "  App:     $AppDir"
Write-Host "  Config:  $ConfigDir"
Write-Host "  Profile: $ProfileDir (preserved)"
Write-Host "  Logs:    $LogsDir"
Write-Host "Browser profile and login session were NOT overwritten."
Write-Host "Next: npm run install:startup  (or scripts\install-startup-task.ps1 as Admin)"
exit 0
