# Register Windows Task Scheduler jobs so the OBS listener + Quick Tunnel stay running.
# Run once (as the user who should own the processes):
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-listener-autostart.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$EnsureListener = Join-Path $PSScriptRoot "ensure-listener.ps1"
$EnsureTunnel = Join-Path $PSScriptRoot "ensure-quick-tunnel.ps1"

$tasks = @(
  @{
    Name = "HeartlandStormChaser-OBS-Listener-Logon"
    Script = $EnsureListener
    Kind = "logon"
  },
  @{
    Name = "HeartlandStormChaser-OBS-Listener-Watchdog"
    Script = $EnsureListener
    Kind = "watchdog"
  },
  @{
    Name = "HeartlandStormChaser-OBS-Tunnel-Logon"
    Script = $EnsureTunnel
    Kind = "logon"
  },
  @{
    Name = "HeartlandStormChaser-OBS-Tunnel-Watchdog"
    Script = $EnsureTunnel
    Kind = "watchdog"
  }
)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::FromMinutes(5)) `
  -RestartCount 3 `
  -RestartInterval ([TimeSpan]::FromMinutes(1))

foreach ($task in $tasks) {
  if (-not (Test-Path $task.Script)) {
    throw "Missing script: $($task.Script)"
  }

  $action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$($task.Script)`"" `
    -WorkingDirectory $Root

  if ($task.Kind -eq "logon") {
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  } else {
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(1) `
      -RepetitionInterval ([TimeSpan]::FromMinutes(5)) `
      -RepetitionDuration ([TimeSpan]::FromDays(9999))
  }

  Register-ScheduledTask `
    -TaskName $task.Name `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

  Write-Host "Registered $($task.Name)"
}

Write-Host ""
Write-Host "Running ensure-listener once now…"
& $EnsureListener
Write-Host ""
Write-Host "Running ensure-quick-tunnel once now…"
& $EnsureTunnel
Write-Host ""
Write-Host "Done. Listener + Quick Tunnel will restart at logon and every 5 minutes if down."
Write-Host "If the Quick Tunnel hostname changes, ensure-quick-tunnel updates Broadcast listener_url in D1 (needs wrangler auth)."
