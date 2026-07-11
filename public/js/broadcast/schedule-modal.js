import { BroadcastApi } from "./api.js";
import { escapeHtml } from "./ui-utils.js";

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatWhen(iso, timeZone) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      timeZone: timeZone || undefined,
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function emptyForm() {
  const local = new Date();
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  const stamp = local.toISOString().slice(0, 16);
  return {
    id: null,
    title: "",
    description: "",
    scheduled_local: stamp,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    platform: "obs",
    visibility: "private",
    expected_duration_minutes: 120,
    auto_start: false,
    auto_stop: false,
    starting_scene: "",
    main_live_scene: "",
    ending_scene: "",
    obs_profile: "",
    operator_notes: "",
    save_as_draft: false,
  };
}

/**
 * @param {HTMLDialogElement | null} dialog
 * @param {{ scenes?: string[], onSelected?: (b: object|null) => void, openStartWorkflow?: () => void }} opts
 */
export function createScheduleModal(dialog, opts = {}) {
  if (!dialog) {
    return { open() {}, close() {}, refresh() {} };
  }

  let view = "month";
  let cursor = startOfMonth(new Date());
  let broadcasts = [];
  let selectedId = null;
  let mode = "list"; // list | form | detail
  let form = emptyForm();
  let busy = false;
  let error = null;

  function scenes() {
    return opts.scenes || [];
  }

  function close() {
    if (typeof dialog.close === "function") dialog.close();
  }

  async function load() {
    error = null;
    try {
      const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1).toISOString();
      const to = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0, 23, 59, 59).toISOString();
      const data = await BroadcastApi.listScheduled(from, to);
      broadcasts = data.broadcasts || [];
      selectedId = data.selectedBroadcast?.id || null;
      opts.onSelected?.(data.selectedBroadcast || null);
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load schedule";
      broadcasts = [];
    }
    render();
  }

  function broadcastsOnDay(dayStr) {
    return broadcasts.filter((b) => String(b.scheduled_at || "").startsWith(dayStr));
  }

  function openForm(broadcast, dayKey = null) {
    if (broadcast) {
      const d = new Date(broadcast.scheduled_at);
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      form = {
        id: broadcast.id,
        title: broadcast.title || "",
        description: broadcast.description || "",
        scheduled_local: local.toISOString().slice(0, 16),
        time_zone: broadcast.time_zone || "America/Chicago",
        platform: broadcast.platform || "obs",
        visibility: broadcast.visibility || "private",
        expected_duration_minutes: broadcast.expected_duration_minutes ?? 120,
        auto_start: Boolean(broadcast.auto_start),
        auto_stop: Boolean(broadcast.auto_stop),
        starting_scene: broadcast.starting_scene || "",
        main_live_scene: broadcast.main_live_scene || "",
        ending_scene: broadcast.ending_scene || "",
        obs_profile: broadcast.obs_profile || "",
        operator_notes: broadcast.operator_notes || "",
        save_as_draft: broadcast.status === "draft",
      };
    } else {
      form = emptyForm();
      if (dayKey) {
        const timePart = form.scheduled_local.slice(11, 16) || "12:00";
        form.scheduled_local = `${dayKey}T${timePart}`;
      }
    }
    mode = "form";
    render();
  }

  function openDetail(id) {
    form.id = id;
    mode = "detail";
    render();
  }

  async function saveForm(asDraft) {
    if (busy) return;
    busy = true;
    error = null;
    render();
    try {
      const scheduledAt = new Date(form.scheduled_local).toISOString();
      const payload = {
        title: form.title,
        description: form.description,
        scheduled_at: scheduledAt,
        time_zone: form.time_zone,
        platform: form.platform,
        visibility: form.visibility,
        expected_duration_minutes: Number(form.expected_duration_minutes) || null,
        auto_start: form.auto_start,
        auto_stop: form.auto_stop,
        starting_scene: form.starting_scene || null,
        main_live_scene: form.main_live_scene || null,
        ending_scene: form.ending_scene || null,
        obs_profile: form.obs_profile || null,
        operator_notes: form.operator_notes || null,
        save_as_draft: Boolean(asDraft),
      };
      if (form.id) {
        await BroadcastApi.updateScheduled(form.id, payload);
      } else {
        await BroadcastApi.createScheduled(payload);
      }
      mode = "list";
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : "Save failed";
      busy = false;
      render();
    } finally {
      busy = false;
    }
  }

  async function selectBroadcast(id) {
    if (busy) return;
    busy = true;
    try {
      const data = await BroadcastApi.selectScheduled(id);
      selectedId = data.broadcast?.id || id;
      opts.onSelected?.(data.broadcast || null);
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : "Select failed";
      busy = false;
      render();
    } finally {
      busy = false;
    }
  }

  function renderMonth() {
    const first = startOfMonth(cursor);
    const startPad = first.getDay();
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i += 1) cells.push(`<div class="bcc-cal__cell bcc-cal__cell--empty"></div>`);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), day);
      const key = ymd(date);
      const items = broadcastsOnDay(key);
      cells.push(`
        <div class="bcc-cal__cell">
          <div class="bcc-cal__day">${day}</div>
          ${items
            .slice(0, 3)
            .map(
              (b) => `
            <button type="button" class="bcc-cal__event${b.is_selected ? " bcc-cal__event--selected" : ""}" data-open-detail="${escapeHtml(b.id)}">
              ${escapeHtml(b.title)}
            </button>`,
            )
            .join("")}
          ${items.length > 3 ? `<div class="bcc-cal__more">+${items.length - 3}</div>` : ""}
          <button type="button" class="bcc-cal__add" data-add-day="${escapeHtml(key)}" aria-label="Add broadcast on ${escapeHtml(key)}">Add+</button>
        </div>
      `);
    }
    return `
      <div class="bcc-cal__weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div>${d}</div>`).join("")}</div>
      <div class="bcc-cal__grid">${cells.join("")}</div>
    `;
  }

  function renderAgenda() {
    const sorted = [...broadcasts].sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
    if (!sorted.length) return `<p class="bcc-empty">No broadcasts in this range.</p>`;
    return `
      <ul class="bcc-agenda">
        ${sorted
          .map(
            (b) => `
          <li class="bcc-agenda__item${b.is_selected ? " bcc-agenda__item--selected" : ""}">
            <button type="button" class="bcc-agenda__btn" data-open-detail="${escapeHtml(b.id)}">
              <strong>${escapeHtml(b.title)}</strong>
              <span>${escapeHtml(formatWhen(b.scheduled_at, b.time_zone))}</span>
              <span class="bcc-agenda__meta">${escapeHtml(b.platform)} · ${escapeHtml(b.visibility)} · ${escapeHtml(b.status)}${b.is_selected ? " · selected" : ""}${b.status === "live" ? " · LIVE" : ""}</span>
            </button>
          </li>`,
          )
          .join("")}
      </ul>
    `;
  }

  function renderForm() {
    const sceneOpts = scenes()
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
      .join("");
    return `
      <form class="bcc-sched-form" data-sched-form>
        <label class="bcc-sched-form__field"><span>Title</span><input name="title" required value="${escapeHtml(form.title)}" /></label>
        <label class="bcc-sched-form__field"><span>Description</span><textarea name="description" rows="2">${escapeHtml(form.description)}</textarea></label>
        <div class="bcc-sched-form__row">
          <label class="bcc-sched-form__field"><span>Date & time</span><input type="datetime-local" name="scheduled_local" required value="${escapeHtml(form.scheduled_local)}" /></label>
          <label class="bcc-sched-form__field"><span>Time zone</span><input name="time_zone" value="${escapeHtml(form.time_zone)}" /></label>
        </div>
        <div class="bcc-sched-form__row">
          <label class="bcc-sched-form__field"><span>Platform</span>
            <select name="platform">
              <option value="obs" ${form.platform === "obs" ? "selected" : ""}>OBS destination (supported)</option>
              <option value="youtube" ${form.platform === "youtube" ? "selected" : ""}>YouTube Live</option>
            </select>
          </label>
          <label class="bcc-sched-form__field"><span>Visibility</span>
            <select name="visibility">
              <option value="private" ${form.visibility === "private" ? "selected" : ""}>Private</option>
              <option value="unlisted" ${form.visibility === "unlisted" ? "selected" : ""}>Unlisted</option>
              <option value="public" ${form.visibility === "public" ? "selected" : ""}>Public</option>
            </select>
          </label>
        </div>
        <p class="bcc-sched-form__hint">YouTube Live requires Connect YouTube in Broadcast Settings. Thumbnail, latency, and DVR UI options are not exposed yet; auto-start/stop are sent to YouTube when supported. OBS still pushes RTMP using the stream key created during Prepare.</p>
        <label class="bcc-sched-form__field"><span>Expected duration (minutes)</span><input type="number" min="1" name="expected_duration_minutes" value="${escapeHtml(String(form.expected_duration_minutes ?? ""))}" /></label>
        <div class="bcc-sched-form__row">
          <label class="bcc-sched-form__check"><input type="checkbox" name="auto_start" ${form.auto_start ? "checked" : ""} /> Auto-start preference</label>
          <label class="bcc-sched-form__check"><input type="checkbox" name="auto_stop" ${form.auto_stop ? "checked" : ""} /> Auto-stop preference</label>
        </div>
        <div class="bcc-sched-form__row">
          <label class="bcc-sched-form__field"><span>Starting scene</span>
            <input list="bcc-scene-list" name="starting_scene" value="${escapeHtml(form.starting_scene)}" placeholder="Optional" />
          </label>
          <label class="bcc-sched-form__field"><span>Main live scene</span>
            <input list="bcc-scene-list" name="main_live_scene" value="${escapeHtml(form.main_live_scene)}" placeholder="Optional" />
          </label>
          <label class="bcc-sched-form__field"><span>Ending scene</span>
            <input list="bcc-scene-list" name="ending_scene" value="${escapeHtml(form.ending_scene)}" placeholder="Optional" />
          </label>
        </div>
        <datalist id="bcc-scene-list">${sceneOpts}</datalist>
        <label class="bcc-sched-form__field"><span>OBS profile / scene collection</span><input name="obs_profile" value="${escapeHtml(form.obs_profile)}" placeholder="Not applied remotely yet" disabled title="OBS profile switching is not exposed by the current listener" /></label>
        <label class="bcc-sched-form__field"><span>Operator notes</span><textarea name="operator_notes" rows="2">${escapeHtml(form.operator_notes)}</textarea></label>
        <div class="bcc-sched-form__actions">
          <button type="button" class="btn btn--secondary" data-form-cancel>Back</button>
          <button type="button" class="btn btn--secondary" data-form-draft ${busy ? "disabled" : ""}>Save as draft</button>
          <button type="submit" class="btn btn--primary" ${busy ? "disabled" : ""}>Schedule broadcast</button>
        </div>
      </form>
    `;
  }

  function renderDetail() {
    const b = broadcasts.find((x) => x.id === form.id);
    if (!b) return `<p class="bcc-empty">Broadcast not found.</p><button type="button" class="btn btn--secondary" data-form-cancel>Back</button>`;
    const canDelete = ["draft", "cancelled", "completed", "failed"].includes(b.status);
    return `
      <article class="bcc-sched-detail">
        <h3>${escapeHtml(b.title)}</h3>
        <p>${escapeHtml(formatWhen(b.scheduled_at, b.time_zone))}</p>
        <dl class="bcc-sched-detail__meta">
          <div><dt>Status</dt><dd>${escapeHtml(b.status)}</dd></div>
          <div><dt>Platform</dt><dd>${escapeHtml(b.platform)}</dd></div>
          <div><dt>Visibility</dt><dd>${escapeHtml(b.visibility)}</dd></div>
          <div><dt>Selected</dt><dd>${b.is_selected ? "Yes" : "No"}</dd></div>
          <div><dt>Starting scene</dt><dd>${escapeHtml(b.starting_scene || "—")}</dd></div>
          <div><dt>Main live scene</dt><dd>${escapeHtml(b.main_live_scene || "—")}</dd></div>
          <div><dt>Ending scene</dt><dd>${escapeHtml(b.ending_scene || "—")}</dd></div>
        </dl>
        ${b.description ? `<p>${escapeHtml(b.description)}</p>` : ""}
        ${b.operator_notes ? `<p><em>${escapeHtml(b.operator_notes)}</em></p>` : ""}
        <div class="bcc-sched-detail__actions">
          <button type="button" class="btn btn--secondary" data-form-cancel>Back</button>
          <button type="button" class="btn btn--primary" data-select="${escapeHtml(b.id)}" ${busy ? "disabled" : ""}>Select broadcast</button>
          <button type="button" class="btn btn--secondary" data-edit="${escapeHtml(b.id)}">Edit</button>
          <button type="button" class="btn btn--secondary" data-cancel-b="${escapeHtml(b.id)}" ${busy ? "disabled" : ""}>Cancel</button>
          ${canDelete ? `<button type="button" class="btn btn--danger" data-delete="${escapeHtml(b.id)}" ${busy ? "disabled" : ""}>Delete</button>` : ""}
        </div>
      </article>
    `;
  }

  function render() {
    const monthLabel = cursor.toLocaleString(undefined, { month: "long", year: "numeric" });
    dialog.innerHTML = `
      <div class="bcc-dialog">
        <header class="bcc-dialog__header">
          <h2 class="bcc-dialog__title">Broadcast Schedule</h2>
          <button type="button" class="btn btn--secondary btn--small" data-close>Close</button>
        </header>
        ${error ? `<p class="bcc-inline-error">${escapeHtml(error)}</p>` : ""}
        ${
          mode === "list"
            ? `
          <div class="bcc-sched-toolbar">
            <div class="bcc-sched-toolbar__nav">
              <button type="button" class="btn btn--secondary btn--small" data-nav="prev">Previous</button>
              <button type="button" class="btn btn--secondary btn--small" data-nav="today">Today</button>
              <button type="button" class="btn btn--secondary btn--small" data-nav="next">Next</button>
              <strong>${escapeHtml(monthLabel)}</strong>
            </div>
            <div class="bcc-sched-toolbar__views">
              <button type="button" class="btn btn--small ${view === "month" ? "btn--primary" : "btn--secondary"}" data-view="month">Month</button>
              <button type="button" class="btn btn--small ${view === "week" ? "btn--primary" : "btn--secondary"}" data-view="week">Week</button>
              <button type="button" class="btn btn--small ${view === "agenda" ? "btn--primary" : "btn--secondary"}" data-view="agenda">Agenda</button>
              <button type="button" class="btn btn--primary btn--small" data-create>Create Broadcast</button>
            </div>
          </div>
          <p class="bcc-sched-selected">Selected: ${
            selectedId
              ? escapeHtml(broadcasts.find((b) => b.id === selectedId)?.title || selectedId)
              : "None"
          }</p>
          <div class="bcc-sched-body">
            ${view === "agenda" || view === "week" ? renderAgenda() : renderMonth()}
          </div>
        `
            : mode === "form"
              ? renderForm()
              : renderDetail()
        }
      </div>
    `;
    bind();
  }

  function readForm(formEl) {
    const fd = new FormData(formEl);
    form.title = String(fd.get("title") || "");
    form.description = String(fd.get("description") || "");
    form.scheduled_local = String(fd.get("scheduled_local") || "");
    form.time_zone = String(fd.get("time_zone") || "");
    form.platform = String(fd.get("platform") || "obs");
    form.visibility = String(fd.get("visibility") || "private");
    form.expected_duration_minutes = Number(fd.get("expected_duration_minutes")) || null;
    form.auto_start = formEl.querySelector('[name="auto_start"]')?.checked || false;
    form.auto_stop = formEl.querySelector('[name="auto_stop"]')?.checked || false;
    form.starting_scene = String(fd.get("starting_scene") || "");
    form.main_live_scene = String(fd.get("main_live_scene") || "");
    form.ending_scene = String(fd.get("ending_scene") || "");
    form.operator_notes = String(fd.get("operator_notes") || "");
  }

  function bind() {
    dialog.querySelector("[data-close]")?.addEventListener("click", close);
    dialog.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nav = btn.getAttribute("data-nav");
        if (nav === "prev") cursor = addMonths(cursor, -1);
        if (nav === "next") cursor = addMonths(cursor, 1);
        if (nav === "today") cursor = startOfMonth(new Date());
        void load();
      });
    });
    dialog.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        view = btn.getAttribute("data-view") || "month";
        render();
      });
    });
    dialog.querySelector("[data-create]")?.addEventListener("click", () => openForm(null));
    dialog.querySelectorAll("[data-add-day]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        openForm(null, btn.getAttribute("data-add-day"));
      });
    });
    dialog.querySelectorAll("[data-open-detail]").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.getAttribute("data-open-detail")));
    });
    dialog.querySelector("[data-form-cancel]")?.addEventListener("click", () => {
      mode = "list";
      render();
    });
    dialog.querySelector("[data-form-draft]")?.addEventListener("click", () => {
      const formEl = dialog.querySelector("[data-sched-form]");
      if (formEl instanceof HTMLFormElement) {
        readForm(formEl);
        void saveForm(true);
      }
    });
    const formEl = dialog.querySelector("[data-sched-form]");
    if (formEl instanceof HTMLFormElement) {
      formEl.addEventListener("submit", (event) => {
        event.preventDefault();
        readForm(formEl);
        void saveForm(false);
      });
    }
    dialog.querySelector("[data-select]")?.addEventListener("click", () => {
      const id = dialog.querySelector("[data-select]")?.getAttribute("data-select");
      if (id) void selectBroadcast(id);
    });
    dialog.querySelector("[data-edit]")?.addEventListener("click", () => {
      const id = dialog.querySelector("[data-edit]")?.getAttribute("data-edit");
      const b = broadcasts.find((x) => x.id === id);
      if (b) openForm(b);
    });
    dialog.querySelector("[data-cancel-b]")?.addEventListener("click", async () => {
      const id = dialog.querySelector("[data-cancel-b]")?.getAttribute("data-cancel-b");
      if (!id || busy) return;
      busy = true;
      try {
        await BroadcastApi.cancelScheduled(id);
        mode = "list";
        await load();
      } catch (err) {
        error = err instanceof Error ? err.message : "Cancel failed";
        busy = false;
        render();
      } finally {
        busy = false;
      }
    });
    dialog.querySelector("[data-delete]")?.addEventListener("click", async () => {
      const id = dialog.querySelector("[data-delete]")?.getAttribute("data-delete");
      if (!id || busy) return;
      if (!window.confirm("Delete this broadcast?")) return;
      busy = true;
      try {
        await BroadcastApi.deleteScheduled(id);
        mode = "list";
        await load();
      } catch (err) {
        error = err instanceof Error ? err.message : "Delete failed";
        busy = false;
        render();
      } finally {
        busy = false;
      }
    });
  }

  return {
    open() {
      mode = "list";
      if (typeof dialog.showModal === "function") dialog.showModal();
      void load();
    },
    close,
    refresh: load,
    setScenes(list) {
      opts.scenes = list || [];
    },
  };
}
