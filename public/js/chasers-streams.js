(function () {
  var API = "/api/chasers-streams";

  var state = {
    sources: [],
    slots: [],
    cache: null,
    editingId: null,
    focusedSlot: null,
    refreshing: false,
  };

  var form = document.getElementById("stream-form");
  var formTitle = document.getElementById("form-title");
  var formMessage = document.getElementById("form-message");
  var formCancel = document.getElementById("form-cancel");
  var formSubmit = document.getElementById("form-submit");
  var sourceIdInput = document.getElementById("source-id");
  var streamList = document.getElementById("stream-list");
  var quadGrid = document.getElementById("quad-grid");
  var refreshStatus = document.getElementById("refresh-status");
  var refreshLiveBtn = document.getElementById("refresh-live-btn");
  var refreshForceBtn = document.getElementById("refresh-live-force-btn");

  function showFormMessage(text, type) {
    formMessage.hidden = false;
    formMessage.textContent = text;
    formMessage.className = "form-message form-message--" + type;
  }

  function clearFormMessage() {
    formMessage.hidden = true;
    formMessage.textContent = "";
    formMessage.className = "form-message";
  }

  async function api(path, options) {
    var response = await fetch(path, options);
    var data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Request failed (" + response.status + ")");
    }
    return data;
  }

  function formatCheckedAt(isoOrSql) {
    if (!isoOrSql) return "never";
    var d = new Date(isoOrSql.replace(" ", "T") + (isoOrSql.includes("T") ? "" : "Z"));
    if (Number.isNaN(d.getTime())) return isoOrSql;
    return d.toLocaleString();
  }

  function updateRefreshStatus(extra) {
    var cache = state.cache;
    if (!cache || !cache.last_refreshed_at) {
      refreshStatus.textContent =
        extra || "Live status not checked yet. Click Refresh live status.";
      return;
    }

    var age =
      cache.cache_age_seconds != null
        ? cache.cache_age_seconds
        : Math.floor((Date.now() - Date.parse(cache.last_refreshed_at)) / 1000);

    var liveCount = state.sources.filter(function (s) {
      return s.enabled && s.is_live;
    }).length;

    refreshStatus.textContent =
      (extra ? extra + " · " : "") +
      liveCount +
      " live · Last checked " +
      formatCheckedAt(cache.last_refreshed_at) +
      (age >= 0 ? " (" + age + "s ago)" : "");
  }

  function getFormData() {
    return {
      display_name: document.getElementById("display-name").value.trim(),
      channel_id: document.getElementById("channel-id").value.trim(),
      notes: document.getElementById("notes").value.trim(),
      enabled: document.getElementById("enabled").checked,
    };
  }

  function resetForm() {
    state.editingId = null;
    form.reset();
    document.getElementById("enabled").checked = true;
    sourceIdInput.value = "";
    formTitle.textContent = "Add stream";
    formSubmit.textContent = "Save stream";
    formCancel.hidden = true;
    clearFormMessage();
  }

  function startEdit(source) {
    state.editingId = source.id;
    sourceIdInput.value = source.id;
    document.getElementById("display-name").value = source.display_name;
    document.getElementById("channel-id").value = source.channel_id || "";
    document.getElementById("notes").value = source.notes || "";
    document.getElementById("enabled").checked = source.enabled;
    formTitle.textContent = "Edit stream";
    formSubmit.textContent = "Update stream";
    formCancel.hidden = false;
    clearFormMessage();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function enabledSources() {
    return state.sources.filter(function (s) {
      return s.enabled;
    });
  }

  function assignOptions(selectedId) {
    var html = '<option value="">— Unassigned —</option>';
    enabledSources().forEach(function (source) {
      var selected = source.id === selectedId ? " selected" : "";
      var liveTag = source.is_live ? " ● LIVE" : "";
      html +=
        '<option value="' +
        escapeAttr(source.id) +
        '"' +
        selected +
        ">" +
        escapeHtml(source.display_name + liveTag) +
        "</option>";
    });
    return html;
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return String(text).replace(/"/g, "&quot;");
  }

  function liveBadge(source) {
    if (!source.enabled) {
      return '<span class="badge badge--muted">Disabled</span>';
    }
    if (source.is_live) {
      return '<span class="badge badge--live">Live</span>';
    }
    return '<span class="badge badge--muted">Offline</span>';
  }

  function renderStreamList() {
    if (state.sources.length === 0) {
      streamList.innerHTML =
        '<p class="stream-list__empty">No streamers yet. Add one above.</p>';
      return;
    }

    streamList.innerHTML = state.sources
      .map(function (source) {
        var itemClass = source.enabled ? "stream-item" : "stream-item stream-item--disabled";
        var notes = source.notes
          ? '<p class="stream-item__notes">' + escapeHtml(source.notes) + "</p>"
          : "";
        var liveTitle =
          source.is_live && source.live_title
            ? '<p class="stream-item__live-title">' + escapeHtml(source.live_title) + "</p>"
            : "";
        var channel = source.channel_id
          ? '<p class="stream-item__channel">' + escapeHtml(source.channel_id) + "</p>"
          : "";

        return (
          '<article class="' +
          itemClass +
          '" data-source-id="' +
          escapeAttr(source.id) +
          '">' +
          '<div class="stream-item__header">' +
          '<h3 class="stream-item__name">' +
          escapeHtml(source.display_name) +
          "</h3>" +
          liveBadge(source) +
          "</div>" +
          channel +
          liveTitle +
          notes +
          '<div class="stream-item__actions">' +
          '<select class="stream-item__assign" data-action="assign" aria-label="Assign to slot">' +
          '<option value="">Assign to slot…</option>' +
          '<option value="1">Slot 1</option>' +
          '<option value="2">Slot 2</option>' +
          '<option value="3">Slot 3</option>' +
          '<option value="4">Slot 4</option>' +
          "</select>" +
          '<button type="button" class="btn btn--secondary btn--small" data-action="edit">Edit</button>' +
          '<button type="button" class="btn btn--secondary btn--small" data-action="toggle">' +
          (source.enabled ? "Disable" : "Enable") +
          "</button>" +
          '<button type="button" class="btn btn--danger btn--small" data-action="delete">Delete</button>' +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  function renderQuad() {
    quadGrid.innerHTML = state.slots
      .map(function (slot) {
        var source = slot.source;
        var focused = state.focusedSlot === slot.slot_number ? " quad-slot--focused" : "";
        var name = source ? escapeHtml(source.display_name) : "Empty";
        var statusBadge = "";

        if (source) {
          if (!source.enabled) {
            statusBadge = ' <span class="badge badge--warning">Disabled</span>';
          } else if (source.is_live) {
            statusBadge = ' <span class="badge badge--live">Live</span>';
          } else {
            statusBadge = ' <span class="badge badge--muted">Offline</span>';
          }
        }

        var body = "";
        if (source && source.is_live && source.embed_url) {
          body =
            '<div class="quad-slot__video">' +
            '<iframe src="' +
            escapeAttr(source.embed_url) +
            '?autoplay=0&rel=0" title="' +
            escapeAttr(source.display_name) +
            '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>' +
            "</div>";
        } else if (source) {
          var offlineMsg = source.enabled
            ? escapeHtml(source.display_name) + " is offline.<br />Refresh live status to check again."
            : escapeHtml(source.display_name) + " is disabled.";
          body = '<div class="quad-slot__placeholder">' + offlineMsg + "</div>";
        } else {
          body =
            '<div class="quad-slot__placeholder">No stream assigned.<br />Pick a streamer from the sidebar.</div>';
        }

        return (
          '<article class="quad-slot' +
          focused +
          '" data-slot="' +
          slot.slot_number +
          '">' +
          '<div class="quad-slot__header">' +
          '<div><p class="quad-slot__label">Slot ' +
          slot.slot_number +
          '</p><p class="quad-slot__name">' +
          name +
          statusBadge +
          "</p></div>" +
          '<div class="quad-slot__controls">' +
          '<button type="button" class="btn btn--secondary btn--small" data-action="focus" title="Focus">Focus</button>' +
          '<button type="button" class="btn btn--secondary btn--small" data-action="clear" title="Clear slot">Clear</button>' +
          "</div>" +
          "</div>" +
          body +
          '<div class="quad-slot__footer">' +
          '<select data-action="slot-assign" aria-label="Assign stream to slot ' +
          slot.slot_number +
          '">' +
          assignOptions(source ? source.id : null) +
          "</select>" +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  async function loadSources() {
    var data = await api(API + "/sources");
    state.sources = data.sources || [];
    state.cache = data.cache || null;
    renderStreamList();
    updateRefreshStatus();
  }

  async function loadSlots() {
    var data = await api(API + "/slots");
    state.slots = data.slots || [];
    renderQuad();
  }

  async function refreshAll() {
    await loadSources();
    await loadSlots();
  }

  async function refreshLiveStatus(force) {
    if (state.refreshing) return;
    state.refreshing = true;
    refreshLiveBtn.disabled = true;
    refreshForceBtn.disabled = true;
    refreshStatus.textContent = "Checking YouTube live status…";

    try {
      var data = await api(API + "/refresh-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: force === true }),
      });

      state.sources = data.sources || state.sources;
      state.cache = data.cache || {
        last_refreshed_at: data.last_refreshed_at,
        cache_age_seconds: 0,
        cache_ttl_seconds: 120,
      };

      var msg = data.skipped_api
        ? "Using cached status (all tablets share this)"
        : data.refreshed
          ? "Refreshed from YouTube"
          : "Status updated";

      renderStreamList();
      await loadSlots();
      updateRefreshStatus(msg);
    } catch (error) {
      refreshStatus.textContent = "Refresh failed: " + error.message;
    } finally {
      state.refreshing = false;
      refreshLiveBtn.disabled = false;
      refreshForceBtn.disabled = false;
    }
  }

  async function saveSource(event) {
    event.preventDefault();
    clearFormMessage();

    var payload = getFormData();

    try {
      if (state.editingId) {
        await api(API + "/sources/" + state.editingId, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        showFormMessage("Stream updated.", "success");
      } else {
        await api(API + "/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        showFormMessage("Stream saved.", "success");
      }
      resetForm();
      await refreshAll();
    } catch (error) {
      showFormMessage(error.message, "error");
    }
  }

  async function deleteSource(id) {
    if (!confirm("Delete this stream source? Assigned slots will be cleared.")) {
      return;
    }
    await api(API + "/sources/" + id, { method: "DELETE" });
    if (state.editingId === id) {
      resetForm();
    }
    await refreshAll();
  }

  async function toggleSource(source) {
    await api(API + "/sources/" + source.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: source.display_name,
        channel_id: source.channel_id,
        notes: source.notes,
        enabled: !source.enabled,
      }),
    });
    await refreshAll();
  }

  async function assignSlot(slotNumber, sourceId) {
    await api(API + "/slots/" + slotNumber, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId || null }),
    });
    await loadSlots();
  }

  async function clearSlot(slotNumber) {
    await api(API + "/slots/" + slotNumber, { method: "DELETE" });
    if (state.focusedSlot === slotNumber) {
      state.focusedSlot = null;
    }
    await loadSlots();
  }

  function findSource(id) {
    return state.sources.find(function (s) {
      return s.id === id;
    });
  }

  streamList.addEventListener("click", function (event) {
    var target = event.target;
    if (!(target instanceof HTMLElement)) return;

    var action = target.getAttribute("data-action");
    if (!action) return;

    var item = target.closest("[data-source-id]");
    if (!item) return;
    var id = item.getAttribute("data-source-id");
    var source = findSource(id);
    if (!source) return;

    if (action === "edit") {
      startEdit(source);
    } else if (action === "delete") {
      deleteSource(id).catch(function (err) {
        alert(err.message);
      });
    } else if (action === "toggle") {
      toggleSource(source).catch(function (err) {
        alert(err.message);
      });
    }
  });

  streamList.addEventListener("change", function (event) {
    var target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.getAttribute("data-action") !== "assign") return;

    var slotNumber = target.value;
    var item = target.closest("[data-source-id]");
    if (!item || !slotNumber) {
      target.value = "";
      return;
    }

    var id = item.getAttribute("data-source-id");
    assignSlot(Number(slotNumber), id)
      .then(function () {
        target.value = "";
      })
      .catch(function (err) {
        alert(err.message);
        target.value = "";
      });
  });

  quadGrid.addEventListener("click", function (event) {
    var target = event.target;
    if (!(target instanceof HTMLElement)) return;

    var action = target.getAttribute("data-action");
    if (!action) return;

    var slotEl = target.closest("[data-slot]");
    if (!slotEl) return;
    var slotNumber = Number(slotEl.getAttribute("data-slot"));

    if (action === "clear") {
      clearSlot(slotNumber).catch(function (err) {
        alert(err.message);
      });
    } else if (action === "focus") {
      state.focusedSlot = state.focusedSlot === slotNumber ? null : slotNumber;
      renderQuad();
    }
  });

  quadGrid.addEventListener("change", function (event) {
    var target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.getAttribute("data-action") !== "slot-assign") return;

    var slotEl = target.closest("[data-slot]");
    if (!slotEl) return;
    var slotNumber = Number(slotEl.getAttribute("data-slot"));

    assignSlot(slotNumber, target.value || null).catch(function (err) {
      alert(err.message);
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && state.focusedSlot !== null) {
      state.focusedSlot = null;
      renderQuad();
    }
  });

  form.addEventListener("submit", saveSource);
  formCancel.addEventListener("click", resetForm);
  refreshLiveBtn.addEventListener("click", function () {
    refreshLiveStatus(false);
  });
  refreshForceBtn.addEventListener("click", function () {
    refreshLiveStatus(true);
  });

  refreshAll().catch(function (err) {
    streamList.innerHTML =
      '<p class="stream-list__empty">Failed to load: ' + escapeHtml(err.message) + "</p>";
    quadGrid.innerHTML = '<p class="stream-list__empty">Failed to load quad view.</p>';
  });
})();
