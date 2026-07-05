/**
 * Fetches /api/health and displays the result on the homepage.
 */
(function () {
  const output = document.getElementById("api-health-output");
  const badge = document.getElementById("api-health-badge");
  if (!output || !badge) return;

  output.textContent = "Checking backend…";
  output.classList.add("status-panel__body--loading");

  fetch("/api/health")
    .then(function (response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return response.json();
    })
    .then(function (data) {
      output.classList.remove("status-panel__body--loading");
      output.textContent = JSON.stringify(data, null, 2);

      if (data.ok) {
        badge.textContent = "Online";
        badge.className = "badge badge--success";
      } else {
        badge.textContent = "Degraded";
        badge.className = "badge badge--warning";
      }
    })
    .catch(function (error) {
      output.classList.remove("status-panel__body--loading");
      output.textContent = "Could not reach /api/health: " + error.message;
      badge.textContent = "Offline";
      badge.className = "badge badge--danger";
    });
})();
