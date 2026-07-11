# Keep a Cloudflare Quick Tunnel pointed at the local OBS listener (http://127.0.0.1:8791).
# Idempotent: exits if cloudflared is already running.
# After start, syncs Broadcast settings listener_url in D1 when the hostname changes.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $Root)
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "tunnel-autostart.log"
$MetricsUrl = "http://127.0.0.1:20241/quicktunnel"
$LocalTarget = "http://127.0.0.1:8791"

function Write-Log([string]$Message) {
  $line = "{0} {1}" -f (Get-Date -Format "o"), $Message
  Add-Content -Path $LogFile -Value $line
  Write-Host $line
}

function Get-QuickTunnelHostname {
  try {
    $json = Invoke-RestMethod -Uri $MetricsUrl -TimeoutSec 2
    if ($json.hostname) { return [string]$json.hostname }
  } catch {
    return $null
  }
  return $null
}

function Sync-ListenerUrl([string]$Hostname) {
  $url = "https://$Hostname"
  Push-Location $RepoRoot
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $query = "SELECT value FROM broadcast_settings WHERE key = 'listener_url' LIMIT 1;"
    $raw = (& npx --yes wrangler d1 execute heartland-storm-chaser-db --remote --json --command $query | Out-String)
    if ([string]::IsNullOrWhiteSpace($raw)) {
      $raw = (& npx --yes wrangler d1 execute heartland-storm-chaser-db --remote --command $query | Out-String)
    }
    if ($raw -and $raw.Contains($url)) {
      Write-Log "Broadcast listener_url already matches $url"
      return
    }
    $sql = "INSERT INTO broadcast_settings (key, value, updated_at) VALUES ('listener_url', '$url', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;"
    Write-Log "Updating Broadcast listener_url to $url"
    & npx --yes wrangler d1 execute heartland-storm-chaser-db --remote --command $sql | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "wrangler d1 execute failed with exit $LASTEXITCODE"
    }
    Write-Log "D1 listener_url updated."
  } catch {
    Write-Log ("WARN: could not sync listener_url to D1: " + $_.Exception.Message)
    Write-Log "Paste $url into Broadcast Control → Settings → Listener URL manually."
  } finally {
    $ErrorActionPreference = $prevEap
    Pop-Location
  }
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$existing = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
if ($existing) {
  $hostname = Get-QuickTunnelHostname
  if ($hostname) {
    Write-Log "cloudflared already running; hostname=$hostname"
    Sync-ListenerUrl $hostname
    exit 0
  }
  Write-Log "cloudflared running but quicktunnel metrics unavailable; leaving as-is."
  exit 0
}

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cloudflared) {
  $cloudflaredPath = $cloudflared.Source
} else {
  $fallback = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
  if (Test-Path $fallback) {
    $cloudflaredPath = $fallback
  } else {
    Write-Log "ERROR: cloudflared not found. Install with: winget install --id Cloudflare.cloudflared -e"
    exit 1
  }
}

Write-Log "Starting Quick Tunnel → $LocalTarget"
Start-Process -FilePath $cloudflaredPath -ArgumentList @("tunnel", "--url", $LocalTarget) -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(45)
$hostname = $null
do {
  Start-Sleep -Seconds 2
  $hostname = Get-QuickTunnelHostname
} while (-not $hostname -and (Get-Date) -lt $deadline)

if (-not $hostname) {
  Write-Log "ERROR: Quick Tunnel started but hostname was not published in time."
  exit 1
}

Write-Log "Quick Tunnel hostname=$hostname"
Sync-ListenerUrl $hostname
exit 0
