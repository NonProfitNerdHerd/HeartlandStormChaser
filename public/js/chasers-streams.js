(function () {
  var API = "/api/chasers-streams";

  var state = {
    sources: [],
    slots: [],
    editingId: null,
    focusedSlot: null,
  };

  var form = document.getElementById("stream-form");
  var formTitle = document.getElementById("form-title");
  var formMessage = document.getElementById("form-message");
  var formCancel = document.getElementById("form-cancel");
  var formSubmit = document.getElementById("form-submit");
  var sourceIdInput = document.getElementById("source-id");
  var streamList = document.getElementById("stream-list");
  var quadGrid = document.getElementById("quad-grid");

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

  function getFormData() {
    return {
      display_name: document.getElementById("display-name").value.trim(),
      youtube_url: document.getElementById("youtube-url").value.trim(),
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
    document.getElementById("youtube-url").value = source.youtube_url;
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
      html +=
        '<option value="' +
        escapeAttr(source.id) +
        '"' +
        selected +
        ">" +
        escapeHtml(source.display_name) +
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

  function renderStreamList() {
    if (state.sources.length === 0) {
      streamList.innerHTML =
        '<p class="stream-list__empty">No streamers yet. Add one above.</p>';
      return;
    }

    streamList.innerHTML = state.sources
      .map(function (source) {
        var badgeClass = source.enabled ? "badge--success" : "badge--muted";
        var badgeText = source.enabled ? "Enabled" : "Disabled";
        var itemClass = source.enabled ? "stream-item" : "stream-item stream-item--disabled";
        var notes = source.notes
          ? '<p class="stream-item__notes">' + escapeHtml(source.notes) + "</p>"
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
          '<span class="badge ' +
          badgeClass +
          '">' +
          badgeText +
          "</span>" +
          "</div>" +
          notes +
          '<div class="stream-item__actions">' +
          '<select class="stream-item__assign" data-action="assign" aria-label="Assign to slot">' +
          '<option value="">Assign to slot…</option>' +
          "<option value=\"1\">Slot 1</option>" +
          "<option value=\"2\">Slot 2</option>" +
          "<option value=\"3\">Slot 3</option>" +
          "<option value=\"4\">Slot 4</option>" +
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
        var disabledNote =
          source && !source.enabled
            ? ' <span class="badge badge--warning">Disabled</span>'
            : "";

        var body = "";
        if (source && source.embed_url) {
          body =
            '<div class="quad-slot__video">' +
            '<iframe src="' +
            escapeAttr(source.embed_url) +
            '?autoplay=0&rel=0" title="' +
            escapeAttr(source.display_name) +
            '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>' +
            "</div>";
        } else {
          body =
            '<div class="quad-slot__placeholder">No stream assigned.<br />Pick a streamer below or from the sidebar.</div>';
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
          disabledNote +
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
    renderStreamList();
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
        youtube_url: source.youtube_url,
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

  refreshAll().catch(function (err) {
    streamList.innerHTML =
      '<p class="stream-list__empty">Failed to load: ' + escapeHtml(err.message) + "</p>";
    quadGrid.innerHTML =
      '<p class="stream-list__empty">Failed to load quad view.</p>';
  });
})();
