/**
 * Updates the System Status card from /api/health.
 * Other cards remain static placeholders until later phases.
 */
(function () {
  var badge = document.getElementById("system-badge");
  var message = document.getElementById("system-message");
  if (!badge || !message) return;

  fetch("/api/health")
    .then(function (response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return response.json();
    })
    .then(function (data) {
      if (data.ok) {
        badge.textContent = "Online";
        badge.className = "badge badge--success";
        message.textContent =
          "Worker API responding · " +
          data.service +
          " · " +
          data.environment +
          " · " +
          data.timestamp;
      } else {
        badge.textContent = "Degraded";
        badge.className = "badge badge--warning";
        message.textContent = "API returned ok: false";
      }
    })
    .catch(function (error) {
      badge.textContent = "Offline";
      badge.className = "badge badge--danger";
      message.textContent = "Could not reach /api/health: " + error.message;
    });
})();
