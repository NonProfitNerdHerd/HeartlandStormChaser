# Ensure the OBS listener is running on 127.0.0.1:8791 (idempotent).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "listener-autostart.log"

function Write-Log([string]$Message) {
  $line = "{0} {1}" -f (Get-Date -Format "o"), $Message
  Add-Content -Path $LogFile -Value $line
  Write-Host $line
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Root

if (-not (Test-Path ".env")) {
  Write-Log "ERROR: .env missing. Copy .env.example to .env and set LISTENER_AUTH_TOKEN."
  exit 1
}

try {
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:8791/health" -UseBasicParsing -TimeoutSec 2
  if ($health.StatusCode -eq 200) {
    Write-Log "Listener already healthy on :8791"
    exit 0
  }
} catch {
  # not running — start it
}

if (-not (Test-Path "node_modules")) {
  Write-Log "Installing npm dependencies…"
  npm install
}

Write-Log "Starting OBS listener…"
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCmd) {
  $npm = $npmCmd.Source
} else {
  $npm = (Get-Command npm -ErrorAction Stop).Source
}

Start-Process -FilePath $npm -ArgumentList "start" -WorkingDirectory $Root -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:8791/health" -UseBasicParsing -TimeoutSec 2
    if ($health.StatusCode -eq 200) {
      Write-Log "Listener is healthy on :8791"
      exit 0
    }
  } catch {
    # keep waiting
  }
} while ((Get-Date) -lt $deadline)

Write-Log "ERROR: Listener did not become healthy within 30s"
exit 1
