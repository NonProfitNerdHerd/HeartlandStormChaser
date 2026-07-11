# Unregister OBS listener / Quick Tunnel Task Scheduler jobs.
$ErrorActionPreference = "Stop"
foreach ($name in @(
  "HeartlandStormChaser-OBS-Listener-Logon",
  "HeartlandStormChaser-OBS-Listener-Watchdog",
  "HeartlandStormChaser-OBS-Tunnel-Logon",
  "HeartlandStormChaser-OBS-Tunnel-Watchdog"
)) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Host "Removed $name"
  } else {
    Write-Host "Task not found: $name"
  }
}
