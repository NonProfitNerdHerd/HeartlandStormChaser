(function () {
  var params = new URLSearchParams(window.location.search);
  var chaseId = params.get("id");

  var nameEl = document.getElementById("chase-name");
  var metaEl = document.getElementById("chase-meta");
  var summaryEl = document.getElementById("chase-summary");
  var notesEl = document.getElementById("chase-notes");
  var notesMessageEl = document.getElementById("notes-message");
  var notesListEl = document.getElementById("chase-notes-body");
  var notesSectionEl = document.getElementById("chase-notes-section");
  var breakdownEl = document.getElementById("expense-breakdown");
  var expenseTotalEl = document.getElementById("expense-total");
  var expensesBody = document.getElementById("expenses-body");
  var completeBtn = document.getElementById("complete-btn");
  var deleteBtn = document.getElementById("delete-btn");
  var deleteChaseDialog = document.getElementById("delete-chase-dialog");
  var deleteChaseForm = document.getElementById("delete-chase-form");
  var deleteChaseConfirmInput = document.getElementById("delete-chase-confirm-input");
  var deleteChaseConfirmBtn = document.getElementById("delete-chase-confirm-btn");
  var deleteChaseCancelBtn = document.getElementById("delete-chase-cancel-btn");
  var deleteChaseMessage = document.getElementById("delete-chase-message");
  var saveNotesBtn = document.getElementById("save-notes-btn");
  var googleMapsBtn = document.getElementById("chase-map-google-btn");
  var addExpenseForm = document.getElementById("add-expense-form");
  var addExpenseCategory = document.getElementById("add-expense-category");
  var addExpenseAmount = document.getElementById("add-expense-amount");
  var addExpenseDescription = document.getElementById("add-expense-description");
  var addExpenseMessage = document.getElementById("add-expense-message");
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

  function setInlineMessage(el, text, isError) {
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    el.className = "chase-message" + (isError ? " chase-message--error" : " chase-message--success");
  }

  function readExpensePayload(categoryEl, amountEl, descriptionEl) {
    var amount = Number(amountEl.value);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("Enter a valid amount.");
    }

    return {
      category: categoryEl.value,
      amount: amount,
      description: descriptionEl.value.trim(),
    };
  }

  async function api(path, options) {
    var response = await fetch(path, options);
    var data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Request failed");
    }
    return data;
  }

  function buildGoogleMapsUrl(points, chase) {
    var latlngs = (points || [])
      .filter(function (p) { return p.lat != null && p.lng != null; })
      .map(function (p) { return [p.lat, p.lng]; });

    if (!latlngs.length && chase && chase.start_lat != null && chase.start_lng != null) {
      latlngs.push([chase.start_lat, chase.start_lng]);
    }

    if (!latlngs.length) {
      return null;
    }

    if (latlngs.length === 1) {
      return "https://www.google.com/maps?q=" + latlngs[0][0] + "," + latlngs[0][1];
    }

    var selected = [latlngs[0]];
    if (latlngs.length > 2) {
      var maxMiddle = 8;
      var step = Math.max(1, Math.ceil((latlngs.length - 2) / maxMiddle));
      for (var i = 1; i < latlngs.length - 1; i += step) {
        if (selected.length >= 9) {
          break;
        }
        selected.push(latlngs[i]);
      }
    }
    selected.push(latlngs[latlngs.length - 1]);

    return "https://www.google.com/maps/dir/" + selected.map(function (ll) {
      return ll[0] + "," + ll[1];
    }).join("/");
  }

  function updateGoogleMapsButton(points, chase) {
    if (!googleMapsBtn) return;
    var url = buildGoogleMapsUrl(points, chase);
    if (!url) {
      googleMapsBtn.hidden = true;
      googleMapsBtn.removeAttribute("href");
      return;
    }

    googleMapsBtn.href = url;
    googleMapsBtn.hidden = false;
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
    updateGoogleMapsButton(points, chase);
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

  function renderNotes(notes) {
    if (!notesListEl || !notesSectionEl) return;

    if (!notes || !notes.length) {
      notesSectionEl.hidden = true;
      notesListEl.innerHTML = "";
      return;
    }

    notesSectionEl.hidden = false;
    notesListEl.innerHTML = notes.map(function (note) {
      return (
        "<tr>" +
        "<td>" + escapeHtml(formatTimestamp(note.created_at)) + "</td>" +
        "<td>" + escapeHtml(note.body) + "</td>" +
        "</tr>"
      );
    }).join("");
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
      renderNotes(data.notes || []);
      renderExpenses(data.expenses || []);
      renderRoute(data.points || [], data.chase);
    } catch (error) {
      metaEl.textContent = error.message;
    }
  }

  saveNotesBtn.addEventListener("click", async function () {
    if (!chaseId) return;

    var noteBody = notesEl.value.trim();
    if (!noteBody) {
      setInlineMessage(notesMessageEl, "Enter a note before adding.", true);
      return;
    }

    try {
      await api("/api/chases/" + encodeURIComponent(chaseId) + "/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteBody }),
      });
      notesEl.value = "";
      setInlineMessage(notesMessageEl, "Note added.", false);
      await loadChase();
    } catch (error) {
      setInlineMessage(notesMessageEl, error.message, true);
    }
  });

  if (addExpenseForm) {
    addExpenseForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!chaseId) return;

      try {
        var payload = readExpensePayload(
          addExpenseCategory,
          addExpenseAmount,
          addExpenseDescription,
        );

        await api("/api/chases/" + encodeURIComponent(chaseId) + "/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        addExpenseAmount.value = "";
        addExpenseDescription.value = "";
        setInlineMessage(addExpenseMessage, "Expense added.", false);
        await loadChase();
      } catch (error) {
        setInlineMessage(addExpenseMessage, error.message, true);
      }
    });
  }

  completeBtn.addEventListener("click", async function () {
    if (!chaseId || !window.confirm("Mark this chase as completed?")) return;
    try {
      await api("/api/chases/" + encodeURIComponent(chaseId) + "/complete", { method: "POST" });
      await loadChase();
    } catch (error) {
      window.alert(error.message);
    }
  });

  deleteBtn.addEventListener("click", function () {
    if (!chaseId || !deleteChaseDialog) return;
    if (deleteChaseConfirmInput) {
      deleteChaseConfirmInput.value = "";
    }
    if (deleteChaseConfirmBtn) {
      deleteChaseConfirmBtn.disabled = true;
    }
    setInlineMessage(deleteChaseMessage, "", false);
    deleteChaseDialog.showModal();
    if (deleteChaseConfirmInput) {
      deleteChaseConfirmInput.focus();
    }
  });

  if (deleteChaseConfirmInput && deleteChaseConfirmBtn) {
    deleteChaseConfirmInput.addEventListener("input", function () {
      deleteChaseConfirmBtn.disabled = deleteChaseConfirmInput.value.trim() !== "delete";
    });
  }

  if (deleteChaseCancelBtn && deleteChaseDialog) {
    deleteChaseCancelBtn.addEventListener("click", function () {
      deleteChaseDialog.close();
    });
  }

  if (deleteChaseForm) {
    deleteChaseForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!chaseId || !deleteChaseConfirmInput) return;
      if (deleteChaseConfirmInput.value.trim() !== "delete") {
        setInlineMessage(deleteChaseMessage, 'Type "delete" to confirm.', true);
        return;
      }

      if (deleteChaseConfirmBtn) {
        deleteChaseConfirmBtn.disabled = true;
      }

      try {
        await api("/api/chases/" + encodeURIComponent(chaseId), { method: "DELETE" });
        if (deleteChaseDialog) {
          deleteChaseDialog.close();
        }
        window.location.href = "/chases.html";
      } catch (error) {
        setInlineMessage(deleteChaseMessage, error.message, true);
        if (deleteChaseConfirmBtn) {
          deleteChaseConfirmBtn.disabled = false;
        }
      }
    });
  }

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
    if (!chaseId || !editingExpenseId) return;

    try {
      var payload = readExpensePayload(
        document.getElementById("expense-category"),
        document.getElementById("expense-amount"),
        document.getElementById("expense-description"),
      );

      await api("/api/chases/" + encodeURIComponent(chaseId) + "/expenses/" + encodeURIComponent(editingExpenseId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expenseDialog.close();
      await loadChase();
    } catch (error) {
      window.alert(error.message);
    }
  });

  loadChase();
})();
