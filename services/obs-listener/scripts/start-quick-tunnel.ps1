# Expose the local OBS listener with a Cloudflare Quick Tunnel (temporary public HTTPS URL).
# Run this on the Desktop after start-listener.ps1 is running.
# Paste the printed https://*.trycloudflare.com URL into Broadcast Control → Settings → Listener URL.
$ErrorActionPreference = "Stop"

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
  $fallback = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
  if (Test-Path $fallback) {
    $cloudflaredPath = $fallback
  } else {
    Write-Host "cloudflared not found. Install with:"
    Write-Host '  winget install --id Cloudflare.cloudflared -e'
    exit 1
  }
} else {
  $cloudflaredPath = $cloudflared.Source
}

Write-Host "Starting Quick Tunnel to http://127.0.0.1:8791 ..."
Write-Host "Copy the https://....trycloudflare.com URL into Broadcast Control Center Settings."
& $cloudflaredPath tunnel --url http://127.0.0.1:8791
