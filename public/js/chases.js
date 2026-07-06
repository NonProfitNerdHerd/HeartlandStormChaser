(function () {
  var statusEl = document.getElementById("chases-status");
  var countEl = document.getElementById("chases-count");
  var bodyEl = document.getElementById("chases-body");
  var refreshBtn = document.getElementById("refresh-btn");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTimestamp(value) {
    if (!value) return "—";
    var normalized = value.includes("T") ? value : value.replace(" ", "T");
    var withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : normalized + "Z";
    var date = new Date(withZone);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  function formatMoney(value) {
    if (value == null || Number.isNaN(Number(value))) return "$0.00";
    return "$" + Number(value).toFixed(2);
  }

  function formatDistance(value) {
    if (value == null || Number.isNaN(Number(value))) return "—";
    return Number(value).toFixed(1) + " mi";
  }

  function statusBadge(status) {
    var cls = "badge badge--muted";
    if (status === "active") cls = "badge badge--active";
    if (status === "paused") cls = "badge badge--paused";
    if (status === "completed") cls = "badge badge--completed";
    return '<span class="' + cls + '">' + escapeHtml(status) + "</span>";
  }

  async function api(path, options) {
    var response = await fetch(path, options);
    var data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Request failed");
    }
    return data;
  }

  function renderChases(chases) {
    var active = chases.filter(function (c) { return c.status === "active" || c.status === "paused"; });
    statusEl.textContent = active.length
      ? active.length + " active chase" + (active.length === 1 ? "" : "s") + " in progress"
      : "No active chases";
    countEl.textContent = chases.length + " total";

    if (!chases.length) {
      bodyEl.innerHTML = '<tr><td colspan="7" class="chases-empty">No chases recorded yet. Start one from the Android app.</td></tr>';
      return;
    }

    bodyEl.innerHTML = chases.map(function (chase) {
      return (
        "<tr>" +
        "<td><strong>" + escapeHtml(chase.chase_name) + "</strong></td>" +
        "<td>" + statusBadge(chase.status) + "</td>" +
        "<td>" + escapeHtml(formatTimestamp(chase.start_time)) + "</td>" +
        "<td>" + escapeHtml(formatTimestamp(chase.end_time)) + "</td>" +
        "<td>" + escapeHtml(formatDistance(chase.total_distance_miles)) + "</td>" +
        "<td>" + escapeHtml(formatMoney(chase.total_expenses)) + "</td>" +
        '<td><div class="chases-actions">' +
        '<a class="btn btn--secondary btn--small" href="/chase.html?id=' + encodeURIComponent(chase.id) + '">View</a>' +
        '<button type="button" class="btn btn--danger btn--small" data-delete-chase="' + escapeHtml(chase.id) + '">Delete</button>' +
        "</div></td>" +
        "</tr>"
      );
    }).join("");
  }

  async function loadChases() {
    statusEl.textContent = "Loading chases…";
    try {
      var data = await api("/api/chases");
      renderChases(data.chases || []);
    } catch (error) {
      statusEl.textContent = error.message;
      bodyEl.innerHTML = '<tr><td colspan="7" class="chases-empty">' + escapeHtml(error.message) + "</td></tr>";
    }
  }

  bodyEl.addEventListener("click", async function (event) {
    var button = event.target.closest("[data-delete-chase]");
    if (!button) return;
    var chaseId = button.getAttribute("data-delete-chase");
    if (!chaseId) return;
    if (!window.confirm("Delete this chase and all of its GPS points and expenses?")) return;

    try {
      await api("/api/chases/" + encodeURIComponent(chaseId), { method: "DELETE" });
      await loadChases();
    } catch (error) {
      window.alert(error.message);
    }
  });

  refreshBtn.addEventListener("click", loadChases);
  loadChases();
})();
