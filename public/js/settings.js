/**
 * Settings page — fetches /api/health.
 * /api/db-test is wired in Step 6 after D1 is configured.
 */
(function () {
  var healthBadge = document.getElementById("health-badge");
  var healthOutput = document.getElementById("health-output");
  if (!healthBadge || !healthOutput) return;

  healthOutput.textContent = "Checking backend…";
  healthOutput.classList.add("status-panel__body--loading");

  fetch("/api/health")
    .then(function (response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return response.json();
    })
    .then(function (data) {
      healthOutput.classList.remove("status-panel__body--loading");
      healthOutput.textContent = JSON.stringify(data, null, 2);

      if (data.ok) {
        healthBadge.textContent = "Online";
        healthBadge.className = "badge badge--success";
      } else {
        healthBadge.textContent = "Degraded";
        healthBadge.className = "badge badge--warning";
      }
    })
    .catch(function (error) {
      healthOutput.classList.remove("status-panel__body--loading");
      healthOutput.textContent = "Could not reach /api/health: " + error.message;
      healthBadge.textContent = "Offline";
      healthBadge.className = "badge badge--danger";
    });
})();
