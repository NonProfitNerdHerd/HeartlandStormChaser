import { BroadcastApi } from "./api.js";
import { confirmAction, escapeHtml } from "./ui-utils.js";

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

/**
 * @param {HTMLDialogElement | null} dialog
 * @param {{
 *   getStatus: () => object | null,
 *   openSchedule: () => void,
 *   onChanged?: () => void,
 * }} opts
 */
export function createStartWorkflow(dialog, opts) {
  if (!dialog) {
    return { open() {}, close() {} };
  }

  let broadcast = null;
  let upcoming = [];
  let steps = [];
  let phase = "select"; // select | validate | prepare | start | ingest | live | summary
  let busy = false;
  let error = null;
  let pollTimer = 0;
  let startIdempotency = null;
  let summary = null;
  let youtubeIngest = null;

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

  async function loadContext() {
    error = null;
    const data = await BroadcastApi.listScheduled();
    upcoming = (data.broadcasts || []).filter((b) =>
      ["draft", "scheduled", "selected", "prepared", "failed"].includes(b.status),
    );
    broadcast = data.activeWorkflow || data.selectedBroadcast || null;
    if (broadcast) {
      restorePhaseFromStatus(broadcast.status);
    } else {
      phase = "select";
    }
  }

  function restorePhaseFromStatus(s) {
    if (["preparing", "prepared"].includes(s)) phase = "prepare";
    else if (s === "starting_output") phase = "start";
    else if (s === "waiting_for_ingest") phase = "ingest";
    else if (s === "ready_to_go_live") phase = "ingest";
    else if (["going_live", "live"].includes(s)) phase = "live";
    else if (["ending", "completed"].includes(s)) phase = "summary";
    else if (s === "failed") phase = "prepare";
    else phase = "select";
  }

  async function selectBroadcast(id) {
    if (busy) return;
    busy = true;
    error = null;
    render();
    try {
      const data = await BroadcastApi.selectScheduled(id);
      broadcast = data.broadcast;
      phase = "validate";
      opts.onChanged?.();
      render();
    } catch (err) {
      error = err instanceof Error ? err.message : "Select failed";
    } finally {
      busy = false;
      render();
    }
  }

  async function runPrepare() {
    if (!broadcast || busy) return;
    busy = true;
    error = null;
    phase = "prepare";
    render();
    try {
      const result = await BroadcastApi.prepareScheduled(broadcast.id);
      steps = result.steps || [];
      broadcast = result.broadcast;
      if (result.youtube_ingest) {
        youtubeIngest = result.youtube_ingest;
      }
      if (!result.ok) {
        error = result.error || "Prepare failed";
      } else {
        phase = "start";
      }
      opts.onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : "Prepare failed";
    } finally {
      busy = false;
      render();
    }
  }

  async function runStartOutput() {
    if (!broadcast || busy) return;
    busy = true;
    error = null;
    startIdempotency = startIdempotency || `start-${broadcast.id}-${Date.now()}`;
    render();
    try {
      const result = await BroadcastApi.startScheduledOutput(broadcast.id, startIdempotency);
      steps = result.steps || steps;
      broadcast = result.broadcast;
      if (!result.ok) {
        error = result.error || "Start output failed";
        phase = "start";
      } else {
        phase = "ingest";
        startIngestPoll();
      }
      opts.onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : "Start output failed";
    } finally {
      busy = false;
      render();
    }
  }

  function startIngestPoll() {
    stopPoll();
    void tickIngest();
    pollTimer = window.setInterval(() => {
      void tickIngest();
    }, 3000);
  }

  async function tickIngest() {
    if (!broadcast) return;
    try {
      const result = await BroadcastApi.confirmScheduledIngest(broadcast.id);
      steps = result.steps || steps;
      broadcast = result.broadcast || broadcast;
      if (result.ok && broadcast.status === "ready_to_go_live") {
        // keep polling lightly for live monitor later
      }
      render();
      opts.onChanged?.();
    } catch {
      /* keep waiting */
    }
  }

  async function runGoLive() {
    if (!broadcast || busy) return;
    if (broadcast.status !== "ready_to_go_live") {
      error = "Ingest is not ready yet";
      render();
      return;
    }
    busy = true;
    error = null;
    render();
    try {
      const result = await BroadcastApi.goLiveScheduled(broadcast.id);
      steps = result.steps || steps;
      broadcast = result.broadcast;
      if (!result.ok) {
        error = result.error || "Go live failed";
      } else {
        phase = "live";
        startLivePoll();
      }
      opts.onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : "Go live failed";
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

  function renderSteps(list) {
    if (!list?.length) return "";
    return `
      <ol class="bcc-workflow__steps">
        ${list
          .map(
            (s) => `
          <li class="bcc-workflow__step bcc-workflow__step--${escapeHtml(s.status)}">
            <strong>${escapeHtml(s.label)}</strong>
            <span>${escapeHtml(s.status)}</span>
            ${s.detail ? `<div>${escapeHtml(s.detail)}</div>` : ""}
          </li>`,
          )
          .join("")}
      </ol>
    `;
  }

  function renderLiveMonitor() {
    const st = status();
    const listener = st?.listener || {};
    const stats = listener.stats || {};
    const updated = st?.updatedAt || listener.listenerUpdatedAt;
    const stale =
      updated && Date.now() - new Date(updated).getTime() > 20000
        ? "STALE"
        : "OK";
    return `
      <div class="bcc-workflow__monitor">
        <h3>${escapeHtml(broadcast?.title || "Broadcast")}</h3>
        <dl class="bcc-workflow__grid">
          <div><dt>Live duration</dt><dd>${escapeHtml(durationText(broadcast?.actual_start_at))}</dd></div>
          <div><dt>OBS connection</dt><dd>${listener.obsConnected ? "Connected" : "Disconnected"}</dd></div>
          <div><dt>OBS streaming</dt><dd>${listener.streamingActive ? "Active" : "Inactive"}</dd></div>
          <div><dt>Platform</dt><dd>${escapeHtml(broadcast?.platform || "obs")}</dd></div>
          <div><dt>Ingest</dt><dd>${listener.streamingActive ? "Active" : "Waiting"}</dd></div>
          <div><dt>Current scene</dt><dd>${escapeHtml(listener.currentProgramScene || "—")}</dd></div>
          <div><dt>Active FPS</dt><dd>${stats.activeFps == null ? "—" : escapeHtml(String(stats.activeFps))}</dd></div>
          <div><dt>CPU</dt><dd>${stats.cpuUsage == null ? "—" : `${escapeHtml(String(stats.cpuUsage))}%`}</dd></div>
          <div><dt>Skipped frames</dt><dd>${escapeHtml(String(stats.outputSkippedFrames ?? "—"))}</dd></div>
          <div><dt>Stream timecode</dt><dd>${escapeHtml(stats.streamTimecode || "—")}</dd></div>
          <div><dt>Last update</dt><dd>${escapeHtml(updated || "—")} (${stale})</dd></div>
          <div><dt>Status</dt><dd>${escapeHtml(broadcast?.status || "—")}</dd></div>
        </dl>
      </div>
    `;
  }

  function render() {
    const st = status();
    const canGoLive = broadcast?.status === "ready_to_go_live" && Boolean(st?.listener?.streamingActive);

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
              <h3>1. Select or confirm broadcast</h3>
              ${
                broadcast
                  ? `<p>Selected: <strong>${escapeHtml(broadcast.title)}</strong> · ${escapeHtml(formatWhen(broadcast.scheduled_at, broadcast.time_zone))} · ${escapeHtml(broadcast.platform)} · ${escapeHtml(broadcast.status)}</p>
                     <button type="button" class="btn btn--secondary" data-clear-select>Change selection</button>
                     <button type="button" class="btn btn--primary" data-to-validate ${busy ? "disabled" : ""}>Continue</button>`
                  : `<p class="bcc-empty">No broadcast selected. Choose one below or open the schedule.</p>`
              }
              <div class="bcc-workflow__list">
                ${
                  upcoming.length
                    ? upcoming
                        .map(
                          (b) => `
                  <button type="button" class="bcc-workflow__pick" data-pick="${escapeHtml(b.id)}" ${busy ? "disabled" : ""}>
                    <strong>${escapeHtml(b.title)}</strong>
                    <span>${escapeHtml(formatWhen(b.scheduled_at, b.time_zone))}</span>
                    <span>${escapeHtml(b.status)} · ${escapeHtml(b.platform)}</span>
                  </button>`,
                        )
                        .join("")
                    : `<p class="bcc-empty">No upcoming broadcasts.</p>`
                }
              </div>
              <button type="button" class="btn btn--secondary" data-open-schedule>Schedule Broadcast</button>
            </section>`
              : ""
          }

          ${
            phase === "validate" || phase === "prepare"
              ? `
            <section>
              <h3>2–3. Validate & prepare</h3>
              <p><strong>${escapeHtml(broadcast?.title || "")}</strong> · ${escapeHtml(broadcast?.status || "")}</p>
              ${renderSteps(steps)}
              <div class="bcc-workflow__actions">
                <button type="button" class="btn btn--secondary" data-back-select>Back</button>
                <button type="button" class="btn btn--primary" data-prepare ${busy ? "disabled" : ""}>${busy ? "Working…" : "Prepare broadcast"}</button>
              </div>
            </section>`
              : ""
          }

          ${
            phase === "start"
              ? `
            <section>
              <h3>4. Start OBS streaming</h3>
              <p>Prepared for <strong>${escapeHtml(broadcast?.title || "")}</strong>. This starts the Desktop OBS stream output for that broadcast.</p>
              ${
                youtubeIngest
                  ? `<div class="bcc-workflow__ingest">
                       <p><strong>YouTube RTMP (paste into OBS → Settings → Stream)</strong></p>
                       <p>Server: <code>${escapeHtml(youtubeIngest.server_url)}</code></p>
                       <p>Stream key: <code>${escapeHtml(youtubeIngest.stream_key)}</code></p>
                       <p class="bcc-empty">Keep this key private. If OBS already uses this destination, you can start streaming now.</p>
                     </div>`
                  : ""
              }
              ${renderSteps(steps)}
              <div class="bcc-workflow__actions">
                <button type="button" class="btn btn--primary" data-start-output ${busy ? "disabled" : ""}>${busy ? "Starting…" : "Start OBS streaming"}</button>
              </div>
            </section>`
              : ""
          }

          ${
            phase === "ingest"
              ? `
            <section>
              <h3>5. Wait for ingest</h3>
              <p>${broadcast?.status === "ready_to_go_live" ? "Ready to Go Live" : "Waiting for Video"}</p>
              ${renderSteps(steps)}
              ${renderLiveMonitor()}
              <div class="bcc-workflow__actions">
                <button type="button" class="btn btn--primary" data-go-live ${!canGoLive || busy ? "disabled" : ""}>Go Live</button>
                <button type="button" class="btn btn--danger" data-emergency ${busy ? "disabled" : ""}>Emergency Stop</button>
              </div>
            </section>`
              : ""
          }

          ${
            phase === "live"
              ? `
            <section>
              <h3>Live</h3>
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
    dialog.querySelectorAll("[data-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-pick");
        if (id) void selectBroadcast(id);
      });
    });
    dialog.querySelector("[data-clear-select]")?.addEventListener("click", () => {
      broadcast = null;
      phase = "select";
      render();
    });
    dialog.querySelector("[data-to-validate]")?.addEventListener("click", () => {
      phase = "validate";
      render();
    });
    dialog.querySelector("[data-back-select]")?.addEventListener("click", () => {
      phase = "select";
      render();
    });
    dialog.querySelector("[data-prepare]")?.addEventListener("click", () => void runPrepare());
    dialog.querySelector("[data-start-output]")?.addEventListener("click", () => void runStartOutput());
    dialog.querySelector("[data-go-live]")?.addEventListener("click", () => void runGoLive());
    dialog.querySelector("[data-end]")?.addEventListener("click", () => void runEnd(false));
    dialog.querySelector("[data-emergency]")?.addEventListener("click", () => void runEnd(true));
  }

  return {
    async open() {
      startIdempotency = null;
      summary = null;
      steps = [];
      error = null;
      if (typeof dialog.showModal === "function") dialog.showModal();
      try {
        await loadContext();
      } catch (err) {
        error = err instanceof Error ? err.message : "Failed to load workflow";
        phase = "select";
      }
      render();
      if (phase === "ingest" || phase === "live") {
        if (phase === "ingest") startIngestPoll();
        else startLivePoll();
      }
    },
    close,
  };
}
