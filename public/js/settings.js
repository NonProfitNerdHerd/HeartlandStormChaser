/**
 * Settings page — fetches /api/health and /api/db-test.
 */
(function () {
  function fetchStatus(url, outputId, badgeId) {
    var output = document.getElementById(outputId);
    var badge = document.getElementById(badgeId);
    if (!output || !badge) return;

    output.textContent = "Checking…";
    output.classList.add("status-panel__body--loading");

    fetch(url)
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
          badge.textContent = "Connected";
          badge.className = "badge badge--success";
        } else {
          badge.textContent = "Error";
          badge.className = "badge badge--danger";
        }
      })
      .catch(function (error) {
        output.classList.remove("status-panel__body--loading");
        output.textContent = "Could not reach " + url + ": " + error.message;
        badge.textContent = "Offline";
        badge.className = "badge badge--danger";
      });
  }

  fetchStatus("/api/health", "health-output", "health-badge");
  fetchStatus("/api/db-test", "db-output", "db-badge");
})();
