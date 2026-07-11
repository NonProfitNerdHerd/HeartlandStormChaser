# Start the HeartlandStormChaser OBS listener (run on the Desktop PC that hosts main OBS).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example — edit LISTENER_AUTH_TOKEN and OBS_PASSWORD, then re-run."
  exit 1
}

if (-not (Test-Path "node_modules")) {
  npm install
}

Write-Host "Starting OBS listener on http://127.0.0.1:8791 ..."
npm start
