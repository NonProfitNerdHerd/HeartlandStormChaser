(function () {
  var params = new URLSearchParams(window.location.search);
  var chaseId = params.get("id");

  var nameEl = document.getElementById("chase-name");
  var metaEl = document.getElementById("chase-meta");
  var summaryEl = document.getElementById("chase-summary");
  var notesEl = document.getElementById("chase-notes");
  var notesMessageEl = document.getElementById("notes-message");
  var breakdownEl = document.getElementById("expense-breakdown");
  var expenseTotalEl = document.getElementById("expense-total");
  var expensesBody = document.getElementById("expenses-body");
  var completeBtn = document.getElementById("complete-btn");
  var deleteBtn = document.getElementById("delete-btn");
  var saveNotesBtn = document.getElementById("save-notes-btn");
  var expenseDialog = document.getElementById("expense-dialog");
  var expenseForm = document.getElementById("expense-form");
  var expenseCancelBtn = document.getElementById("expense-cancel-btn");

  var map = null;
  var routeLayer = null;
  var currentChase = null;
  var editingExpenseId = null;

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
    return "$" + Number(value || 0).toFixed(2);
  }

  function toDatetimeLocalValue(value) {
    if (!value) return "";
    var normalized = value.includes("T") ? value : value.replace(" ", "T");
    var withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : normalized + "Z";
    var date = new Date(withZone);
    if (Number.isNaN(date.getTime())) return "";
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
      "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  async function api(path, options) {
    var response = await fetch(path, options);
    var data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Request failed");
    }
    return data;
  }

  function initMap() {
    if (map || !document.getElementById("chase-map")) return;
    map = L.map("chase-map", { zoomControl: true }).setView([39.8283, -98.5795], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
  }

  function renderRoute(points, chase) {
    initMap();
    if (!map) return;

    if (routeLayer) {
      map.removeLayer(routeLayer);
      routeLayer = null;
    }

    var latlngs = (points || [])
      .filter(function (p) { return p.lat != null && p.lng != null; })
      .map(function (p) { return [p.lat, p.lng]; });

    if (!latlngs.length) {
      if (chase.start_lat != null && chase.start_lng != null) {
        latlngs.push([chase.start_lat, chase.start_lng]);
      }
    }

    if (!latlngs.length) {
      return;
    }

    routeLayer = L.layerGroup().addTo(map);

    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: "#38bdf8", weight: 4, opacity: 0.9 }).addTo(routeLayer);
    }

    L.circleMarker(latlngs[0], {
      radius: 8,
      color: "#22c55e",
      fillColor: "#22c55e",
      fillOpacity: 1,
    }).bindTooltip("Start").addTo(routeLayer);

    var end = latlngs[latlngs.length - 1];
    if (latlngs.length > 1) {
      L.circleMarker(end, {
        radius: 8,
        color: "#ef4444",
        fillColor: "#ef4444",
        fillOpacity: 1,
      }).bindTooltip("End").addTo(routeLayer);
    }

    map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] });
  }

  function renderSummary(chase, breakdown) {
    nameEl.textContent = chase.chase_name;
    metaEl.textContent = "Status: " + chase.status + " · Device " + chase.device_id;
    notesEl.value = chase.notes || "";

    summaryEl.innerHTML =
      "<dt>Status</dt><dd>" + escapeHtml(chase.status) + "</dd>" +
      "<dt>Started</dt><dd>" + escapeHtml(formatTimestamp(chase.start_time)) + "</dd>" +
      "<dt>Ended</dt><dd>" + escapeHtml(formatTimestamp(chase.end_time)) + "</dd>" +
      "<dt>Distance</dt><dd>" + escapeHtml(Number(chase.total_distance_miles || 0).toFixed(1) + " mi") + "</dd>" +
      "<dt>Total expenses</dt><dd>" + escapeHtml(formatMoney(chase.total_expenses)) + "</dd>";

    breakdownEl.innerHTML = Object.keys(breakdown || {}).map(function (category) {
      return (
        '<div class="expense-breakdown__item">' +
        "<span>" + escapeHtml(category) + "</span>" +
        "<strong>" + escapeHtml(formatMoney(breakdown[category])) + "</strong>" +
        "</div>"
      );
    }).join("");

    expenseTotalEl.textContent = "Total: " + formatMoney(chase.total_expenses);
    completeBtn.hidden = chase.status === "completed";
  }

  function renderExpenses(expenses) {
    if (!expenses.length) {
      expensesBody.innerHTML = '<tr><td colspan="5" class="chases-empty">No expenses recorded.</td></tr>';
      return;
    }

    expensesBody.innerHTML = expenses.map(function (expense) {
      return (
        "<tr>" +
        "<td>" + escapeHtml(formatTimestamp(expense.expense_time)) + "</td>" +
        "<td>" + escapeHtml(expense.category) + "</td>" +
        "<td>" + escapeHtml(formatMoney(expense.amount)) + "</td>" +
        "<td>" + escapeHtml(expense.description || "—") + "</td>" +
        '<td><div class="chases-actions">' +
        '<button type="button" class="btn btn--secondary btn--small" data-edit-expense="' + escapeHtml(expense.id) + '">Edit</button>' +
        '<button type="button" class="btn btn--danger btn--small" data-delete-expense="' + escapeHtml(expense.id) + '">Delete</button>' +
        "</div></td>" +
        "</tr>"
      );
    }).join("");
  }

  function openExpenseDialog(expense) {
    editingExpenseId = expense ? expense.id : null;
    document.getElementById("expense-dialog-title").textContent = expense ? "Edit expense" : "Add expense";
    document.getElementById("expense-category").value = expense ? expense.category : "Gas";
    document.getElementById("expense-amount").value = expense ? expense.amount : "";
    document.getElementById("expense-description").value = expense ? expense.description || "" : "";
    document.getElementById("expense-time").value = expense
      ? toDatetimeLocalValue(expense.expense_time)
      : toDatetimeLocalValue(new Date().toISOString());
    expenseDialog.showModal();
  }

  async function loadChase() {
    if (!chaseId) {
      metaEl.textContent = "Missing chase id.";
      return;
    }

    try {
      var data = await api("/api/chases/" + encodeURIComponent(chaseId));
      currentChase = data.chase;
      renderSummary(data.chase, data.expense_breakdown);
      renderExpenses(data.expenses || []);
      renderRoute(data.points || [], data.chase);
    } catch (error) {
      metaEl.textContent = error.message;
    }
  }

  saveNotesBtn.addEventListener("click", async function () {
    if (!chaseId) return;
    try {
      await api("/api/chases/" + encodeURIComponent(chaseId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesEl.value }),
      });
      notesMessageEl.hidden = false;
      notesMessageEl.className = "chase-message chase-message--success";
      notesMessageEl.textContent = "Notes saved.";
    } catch (error) {
      notesMessageEl.hidden = false;
      notesMessageEl.className = "chase-message chase-message--error";
      notesMessageEl.textContent = error.message;
    }
  });

  completeBtn.addEventListener("click", async function () {
    if (!chaseId || !window.confirm("Mark this chase as completed?")) return;
    try {
      await api("/api/chases/" + encodeURIComponent(chaseId) + "/complete", { method: "POST" });
      await loadChase();
    } catch (error) {
      window.alert(error.message);
    }
  });

  deleteBtn.addEventListener("click", async function () {
    if (!chaseId || !window.confirm("Delete this chase permanently?")) return;
    try {
      await api("/api/chases/" + encodeURIComponent(chaseId), { method: "DELETE" });
      window.location.href = "/chases.html";
    } catch (error) {
      window.alert(error.message);
    }
  });

  expensesBody.addEventListener("click", async function (event) {
    var editBtn = event.target.closest("[data-edit-expense]");
    if (editBtn) {
      var expenseId = editBtn.getAttribute("data-edit-expense");
      var data = await api("/api/chases/" + encodeURIComponent(chaseId));
      var expense = (data.expenses || []).find(function (e) { return e.id === expenseId; });
      if (expense) openExpenseDialog(expense);
      return;
    }

    var deleteExpenseBtn = event.target.closest("[data-delete-expense]");
    if (!deleteExpenseBtn) return;
    var id = deleteExpenseBtn.getAttribute("data-delete-expense");
    if (!id || !window.confirm("Delete this expense?")) return;
    try {
      await api("/api/chases/" + encodeURIComponent(chaseId) + "/expenses/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      await loadChase();
    } catch (error) {
      window.alert(error.message);
    }
  });

  expenseCancelBtn.addEventListener("click", function () {
    expenseDialog.close();
  });

  expenseForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!chaseId) return;

    var payload = {
      category: document.getElementById("expense-category").value,
      amount: Number(document.getElementById("expense-amount").value),
      description: document.getElementById("expense-description").value,
      expense_time: new Date(document.getElementById("expense-time").value).toISOString(),
    };

    try {
      if (editingExpenseId) {
        await api("/api/chases/" + encodeURIComponent(chaseId) + "/expenses/" + encodeURIComponent(editingExpenseId), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await api("/api/chases/" + encodeURIComponent(chaseId) + "/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      expenseDialog.close();
      await loadChase();
    } catch (error) {
      window.alert(error.message);
    }
  });

  loadChase();
})();
