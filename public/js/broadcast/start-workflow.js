import { BroadcastApi } from "./api.js";
import { confirmAction, escapeHtml, youtubeWatchUrl } from "./ui-utils.js";

const SELECTABLE_STATUSES = new Set([
  "draft",
  "scheduled",
  "selected",
  "preparing",
  "prepared",
  "failed",
  "waiting_for_ingest",
  "ready_to_go_live",
  "starting_output",
]);

const ENDED_STATUSES = new Set(["completed", "cancelled", "ending"]);

function operatorTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

/** YYYY-MM-DD in the given IANA time zone. */
function calendarDayKey(instant, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(instant));
  } catch {
    return String(instant || "").slice(0, 10);
  }
}

function formatWhen(iso, timeZone) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      timeZone: timeZone || undefined,
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso || "—";
  }
}

function durationText(startIso) {
  if (!startIso) return "—";
  const ms = Date.now() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function renderSteps(steps) {
  if (!steps?.length) return "";
  return `<ol class="bcc-workflow__steps">${steps
    .map((s) => {
      const tone = s.status || "pending";
      return `<li class="bcc-workflow__step bcc-workflow__step--${escapeHtml(tone)}">
        <strong>${escapeHtml(s.label || s.key)}</strong>
        <span>${escapeHtml(s.status || "pending")}${s.detail ? ` — ${escapeHtml(s.detail)}` : ""}</span>
      </li>`;
    })
    .join("")}</ol>`;
}

function isSelectable(b) {
  return Boolean(b && SELECTABLE_STATUSES.has(b.status));
}

function isEnded(b) {
  return Boolean(b && ENDED_STATUSES.has(b.status));
}

/**
 * Chase-day Start Streaming: pick today's broadcast → prepare → Start Stream.
 *
 * @param {HTMLDialogElement | null} dialog
 * @param {{
 *   getStatus: () => object | null,
 *   openSchedule: (broadcastId?: string) => void,
 *   onChanged?: () => void,
 * }} opts
 */
export function createStartWorkflow(dialog, opts) {
  if (!dialog) {
    return { open() {}, close() {} };
  }

  let broadcast = null;
  /** @type {object[]} */
  let todays = [];
  let steps = [];
  /** @type {"select"|"preparing"|"ready"|"working"|"live"|"summary"} */
  let phase = "select";
  let busy = false;
  let error = null;
  let pollTimer = 0;
  let summary = null;
  let todayLabel = "";

  function close() {
    stopPoll();
    if (typeof dialog.close === "function") dialog.close();
  }

  function stopPoll() {
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = 0;
    }
  }

  function status() {
    return opts.getStatus?.() || null;
  }

  function watchUrl(b = broadcast) {
    return youtubeWatchUrl(b);
  }

  function canGoLive(b) {
    if (!b) return false;
    if (!isSelectable(b)) return false;
    if (["live", "ending"].includes(b.status)) return false;
    return true;
  }

  function openEdit(id) {
    close();
    opts.openSchedule?.(id || broadcast?.id);
  }

  async function loadContext() {
    error = null;
    const tz = operatorTimeZone();
    const todayKey = calendarDayKey(Date.now(), tz);
    try {
      todayLabel = new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date());
    } catch {
      todayLabel = todayKey;
    }

    const data = await BroadcastApi.listScheduled();
    const all = data.broadcasts || [];
    todays = all
      .filter((b) => calendarDayKey(b.scheduled_at, tz) === todayKey)
      .filter((b) => isSelectable(b) || isEnded(b) || b.status === "live")
      .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));

    const active = data.activeWorkflow || null;
    if (active?.status === "live") {
      broadcast = active;
      phase = "live";
      startLivePoll();
      return;
    }
    if (active && ["ending", "completed"].includes(active.status)) {
      broadcast = active;
      phase = "summary";
      summary = {
        title: active.title,
        status: active.status,
        started: active.actual_start_at,
        ended: active.actual_end_at,
        emergency: Boolean(active.emergency_stopped),
      };
      return;
    }

    // Always force an explicit pick — do not sticky-select yesterday's broadcast.
    broadcast = null;
    phase = "select";
  }

  async function selectAndPrepare(id) {
    if (busy) return;
    const target = todays.find((b) => b.id === id);
    if (!target || !isSelectable(target)) {
      error = "That broadcast cannot be started";
      render();
      return;
    }

    busy = true;
    error = null;
    broadcast = target;
    phase = "preparing";
    steps = [];
    render();

    try {
      const selected = await BroadcastApi.selectScheduled(id);
      broadcast = selected.broadcast || target;
      opts.onChanged?.();

      const prepared = await BroadcastApi.prepareScheduled(id);
      steps = prepared.steps || [];
      broadcast = prepared.broadcast || broadcast;
      if (prepared.youtube_ingest?.watch_url && broadcast) {
        broadcast = { ...broadcast, watch_url: prepared.youtube_ingest.watch_url };
      }

      if (!prepared.ok) {
        error = prepared.error || broadcast?.error_message || "Prepare failed — update the broadcast, then try again";
        phase = "select";
      } else {
        phase = "ready";
      }
      opts.onChanged?.();
    } catch (err) {
      const data = err && typeof err === "object" && "data" in err ? err.data : null;
      if (data?.steps) steps = data.steps;
      if (data?.broadcast) broadcast = data.broadcast;
      error =
        (err instanceof Error ? err.message : null) ||
        data?.error ||
        "Prepare failed — update the broadcast, then try again";
      phase = "select";
    } finally {
      busy = false;
      render();
    }
  }

  async function runGoLive() {
    if (!broadcast || busy) return;
    if (!canGoLive(broadcast)) {
      error = "This broadcast cannot go live from its current status";
      phase = "select";
      render();
      return;
    }
    busy = true;
    error = null;
    phase = "working";
    steps = [];
    render();
    try {
      await BroadcastApi.selectScheduled(broadcast.id);
      const result = await BroadcastApi.goLiveScheduled(broadcast.id);
      steps = result.steps || [];
      broadcast = result.broadcast;
      if (result.youtube_ingest?.watch_url && broadcast) {
        broadcast = { ...broadcast, watch_url: result.youtube_ingest.watch_url };
      }
      if (!result.ok) {
        error = result.error || "Go Live failed — tap Start Stream again to retry";
        phase = "ready";
      } else {
        phase = "live";
        startLivePoll();
      }
      opts.onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : "Go Live failed — tap Start Stream again to retry";
      phase = "ready";
    } finally {
      busy = false;
      render();
    }
  }

  function startLivePoll() {
    stopPoll();
    pollTimer = window.setInterval(() => {
      opts.onChanged?.();
      render();
    }, 2000);
  }

  async function runEnd(emergency) {
    if (!broadcast || busy) return;
    const ok = confirmAction(
      emergency
        ? "Emergency stop will immediately stop OBS output. Continue?"
        : "End this broadcast? OBS will switch to the ending scene (if set) and stop streaming.",
    );
    if (!ok) return;
    busy = true;
    error = null;
    render();
    try {
      const result = emergency
        ? await BroadcastApi.emergencyStopScheduled(broadcast.id)
        : await BroadcastApi.endScheduled(broadcast.id);
      steps = result.steps || steps;
      broadcast = result.broadcast;
      summary = {
        title: broadcast.title,
        status: broadcast.status,
        started: broadcast.actual_start_at,
        ended: broadcast.actual_end_at,
        emergency: Boolean(broadcast.emergency_stopped),
      };
      phase = "summary";
      stopPoll();
      opts.onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : "End failed";
    } finally {
      busy = false;
      render();
    }
  }

  function renderLiveMonitor() {
    const st = status();
    const listener = st?.listener || {};
    const stats = listener.stats || {};
    const updated = listener.listenerUpdatedAt || "";
    return `
      <div class="bcc-workflow__monitor">
        <dl class="bcc-workflow__grid">
          <div><dt>OBS streaming</dt><dd>${listener.streamingActive ? "Yes" : "No"}</dd></div>
          <div><dt>Bitrate</dt><dd>${escapeHtml(String(stats.outputBytesPerSec ?? stats.bitrate ?? "—"))}</dd></div>
          <div><dt>CPU</dt><dd>${stats.cpuUsage == null ? "—" : `${escapeHtml(String(stats.cpuUsage))}%`}</dd></div>
          <div><dt>Stream timecode</dt><dd>${escapeHtml(stats.streamTimecode || "—")}</dd></div>
          <div><dt>On air</dt><dd>${escapeHtml(durationText(broadcast?.actual_start_at))}</dd></div>
          <div><dt>Last update</dt><dd>${escapeHtml(updated || "—")}</dd></div>
        </dl>
      </div>
    `;
  }

  function renderPickList() {
    if (!todays.length) {
      return `<p class="bcc-empty">No broadcasts scheduled for today (${escapeHtml(todayLabel)}). Open Schedule to create one.</p>`;
    }
    return todays
      .map((b) => {
        const ended = isEnded(b);
        const selectable = isSelectable(b) && !busy;
        const classes = [
          "bcc-workflow__pick",
          ended ? "bcc-workflow__pick--ended" : "",
          broadcast?.id === b.id && !ended ? "bcc-workflow__pick--active" : "",
        ]
          .filter(Boolean)
          .join(" ");
        if (ended) {
          return `
            <div class="${classes}" aria-disabled="true">
              <strong>${escapeHtml(b.title)}</strong>
              <span>${escapeHtml(formatWhen(b.scheduled_at, b.time_zone))}</span>
              <span>${escapeHtml(b.status)} · ended — not selectable</span>
            </div>`;
        }
        return `
          <button type="button" class="${classes}" data-pick="${escapeHtml(b.id)}" ${selectable ? "" : "disabled"}>
            <strong>${escapeHtml(b.title)}</strong>
            <span>${escapeHtml(formatWhen(b.scheduled_at, b.time_zone))}</span>
            <span>${escapeHtml(b.status)} · ${escapeHtml(b.platform)}${youtubeWatchUrl(b) ? " · has YouTube link" : ""}</span>
          </button>`;
      })
      .join("");
  }

  function render() {
    const watch = watchUrl();
    const goEnabled = canGoLive(broadcast) && !busy;
    const needsEdit = Boolean(error && broadcast && phase === "select");

    dialog.innerHTML = `
      <div class="bcc-dialog bcc-dialog--workflow">
        <header class="bcc-dialog__header">
          <h2 class="bcc-dialog__title">Start Streaming</h2>
          <button type="button" class="btn btn--secondary btn--small" data-close>Close</button>
        </header>
        ${error ? `<p class="bcc-inline-error">${escapeHtml(error)}</p>` : ""}
        <div class="bcc-workflow">
          ${
            phase === "select"
              ? `
            <section>
              <h3>Step 1 — Select today's broadcast</h3>
              <p class="bcc-empty">Showing broadcasts scheduled for ${escapeHtml(todayLabel)}. Pick one to check that it is ready.</p>
              <div class="bcc-workflow__list">
                ${renderPickList()}
              </div>
              ${
                needsEdit
                  ? `<div class="bcc-workflow__actions">
                       <button type="button" class="btn btn--primary" data-edit>Update broadcast</button>
                       <button type="button" class="btn btn--secondary" data-open-schedule>Schedule Broadcast</button>
                     </div>`
                  : `<button type="button" class="btn btn--secondary" data-open-schedule>Schedule Broadcast</button>`
              }
            </section>`
              : ""
          }

          ${
            phase === "preparing"
              ? `
            <section>
              <h3>Step 2 — Checking readiness…</h3>
              <p><strong>${escapeHtml(broadcast?.title || "")}</strong></p>
              ${renderSteps(steps)}
              <p class="bcc-empty">Validating OBS, destination, and scenes. Keep this dialog open.</p>
            </section>`
              : ""
          }

          ${
            phase === "ready"
              ? `
            <section>
              <h3>Step 3 — Ready to start</h3>
              <div class="bcc-workflow__selected">
                <p><strong>${escapeHtml(broadcast?.title || "")}</strong></p>
                <p>${escapeHtml(formatWhen(broadcast?.scheduled_at, broadcast?.time_zone))} · ${escapeHtml(broadcast?.platform || "")} · ${escapeHtml(broadcast?.status || "")}</p>
                ${
                  watch
                    ? `<p>YouTube: <a href="${escapeHtml(watch)}" target="_blank" rel="noopener noreferrer">${escapeHtml(watch)}</a></p>`
                    : broadcast?.platform === "youtube"
                      ? `<p class="bcc-empty">YouTube link is ready after Start Stream arms the destination.</p>`
                      : ""
                }
                ${renderSteps(steps)}
                <div class="bcc-workflow__actions">
                  <button type="button" class="btn btn--primary" data-go-live ${goEnabled ? "" : "disabled"}>
                    ${busy ? "Working…" : "Start Stream"}
                  </button>
                  <button type="button" class="btn btn--secondary" data-clear-select>Change selection</button>
                  <button type="button" class="btn btn--secondary" data-edit>Edit broadcast</button>
                </div>
              </div>
            </section>`
              : ""
          }

          ${
            phase === "working"
              ? `
            <section>
              <h3>Starting stream…</h3>
              <p><strong>${escapeHtml(broadcast?.title || "")}</strong></p>
              ${
                watch
                  ? `<p>YouTube: <a href="${escapeHtml(watch)}" target="_blank" rel="noopener noreferrer">${escapeHtml(watch)}</a></p>`
                  : ""
              }
              ${renderSteps(steps)}
              <p class="bcc-empty">Arming home OBS and YouTube. Keep this dialog open.</p>
            </section>`
              : ""
          }

          ${
            phase === "live"
              ? `
            <section>
              <h3>Live</h3>
              <p><strong>${escapeHtml(broadcast?.title || "")}</strong> is live.</p>
              ${
                watch
                  ? `<p>YouTube: <a href="${escapeHtml(watch)}" target="_blank" rel="noopener noreferrer">${escapeHtml(watch)}</a></p>`
                  : ""
              }
              ${renderLiveMonitor()}
              <div class="bcc-workflow__actions">
                <button type="button" class="btn btn--primary" data-end ${busy ? "disabled" : ""}>End Broadcast</button>
                <button type="button" class="btn btn--danger" data-emergency ${busy ? "disabled" : ""}>Emergency Stop</button>
              </div>
            </section>`
              : ""
          }

          ${
            phase === "summary"
              ? `
            <section>
              <h3>Session summary</h3>
              <dl class="bcc-workflow__grid">
                <div><dt>Title</dt><dd>${escapeHtml(summary?.title || broadcast?.title || "—")}</dd></div>
                <div><dt>Status</dt><dd>${escapeHtml(summary?.status || broadcast?.status || "—")}</dd></div>
                <div><dt>Started</dt><dd>${escapeHtml(summary?.started || "—")}</dd></div>
                <div><dt>Ended</dt><dd>${escapeHtml(summary?.ended || "—")}</dd></div>
                <div><dt>Emergency stop</dt><dd>${summary?.emergency ? "Yes" : "No"}</dd></div>
              </dl>
              <button type="button" class="btn btn--secondary" data-close>Close</button>
            </section>`
              : ""
          }
        </div>
      </div>
    `;

    dialog.querySelector("[data-close]")?.addEventListener("click", close);
    dialog.querySelector("[data-open-schedule]")?.addEventListener("click", () => {
      close();
      opts.openSchedule?.();
    });
    dialog.querySelector("[data-edit]")?.addEventListener("click", () => {
      openEdit(broadcast?.id);
    });
    dialog.querySelectorAll("[data-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-pick");
        if (id) void selectAndPrepare(id);
      });
    });
    dialog.querySelector("[data-clear-select]")?.addEventListener("click", () => {
      broadcast = null;
      error = null;
      steps = [];
      phase = "select";
      render();
    });
    dialog.querySelector("[data-go-live]")?.addEventListener("click", () => void runGoLive());
    dialog.querySelector("[data-end]")?.addEventListener("click", () => void runEnd(false));
    dialog.querySelector("[data-emergency]")?.addEventListener("click", () => void runEnd(true));
  }

  return {
    async open() {
      summary = null;
      steps = [];
      error = null;
      broadcast = null;
      phase = "select";
      if (typeof dialog.showModal === "function") dialog.showModal();
      try {
        await loadContext();
      } catch (err) {
        error = err instanceof Error ? err.message : "Failed to load workflow";
        phase = "select";
      }
      render();
      if (phase === "live") startLivePoll();
    },
    close,
  };
}
