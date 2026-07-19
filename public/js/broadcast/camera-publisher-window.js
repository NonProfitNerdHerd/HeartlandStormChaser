/**
 * Dedicated popup window that owns VDO publishing so browsing other tabs/pages
 * does not tear down Truck Front / Truck Dash feeds.
 * Only publishes cameras that the active OBS program scene actually uses.
 */
import {
  DOCK_CAMERAS,
  MAX_PUBLISH_BITRATE_KBPS,
  buildVdoPublisherUrl,
  clearPublisherWindowHeartbeat,
  createPublisherChannel,
  defaultSettings,
  isDockCameraNeededInScene,
  listVideoDevices,
  loadStoredDeviceId,
  loadStoredMicLabel,
  loadStoredMuted,
  lockVdoPublisherBitrate,
  openCameraStream,
  saveStoredSessionActive,
  setVdoPublisherMuted,
  silenceVdoIframeOutput,
  scheduleVdoIframeSilence,
  touchPublisherWindowHeartbeat,
} from "./camera-dock-model.js";
import { scheduleObsBrowserRefresh } from "./obs-browser-refresh.js";
import {
  extractVdoStreamId,
  interpretVdoPublisherStats,
  requestVdoPublisherStats,
} from "./vdo-health.js";
import { escapeHtml } from "./ui-utils.js";

const SCENE_PAUSE_DEBOUNCE_MS = 1500;
const SCENE_POLL_MS = 4000;

const statusEl = document.querySelector("[data-pub-status]");
const gridEl = document.querySelector("[data-pub-grid]");

/** @type {Record<string, { stream: MediaStream | null, publisherUrl: string | null, deviceId: string, label: string, fps: number | null, scenePaused: boolean }>} */
const slots = {};
/** @type {Record<string, boolean>} */
const neededByRole = Object.fromEntries(DOCK_CAMERAS.map((camera) => [camera.role, true]));
/** @type {Record<string, number>} */
const scenePauseTimers = {};

let heartbeatTimer = 0;
let statsTimer = 0;
let scenePollTimer = 0;
let channel = null;
let starting = false;

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function clearScenePauseTimer(role) {
  if (scenePauseTimers[role]) {
    window.clearTimeout(scenePauseTimers[role]);
    scenePauseTimers[role] = 0;
  }
}

function renderShell() {
  if (!gridEl) return;
  gridEl.innerHTML = DOCK_CAMERAS.map((camera) => {
    const deviceId = loadStoredDeviceId(camera.role);
    return `
      <article class="bcc-publisher-card" data-role="${escapeHtml(camera.role)}">
        <div class="bcc-publisher-card__preview">
          <video data-video="${escapeHtml(camera.role)}" autoplay playsinline muted></video>
          <div class="bcc-publisher-card__label">${escapeHtml(camera.label)}</div>
          <iframe
            data-iframe="${escapeHtml(camera.role)}"
            data-current-src="about:blank"
            allow="camera; microphone; autoplay; fullscreen"
            title="${escapeHtml(camera.label)} publisher"
            src="about:blank"
          ></iframe>
        </div>
        <div class="bcc-publisher-card__meta" data-meta="${escapeHtml(camera.role)}">
          ${deviceId ? "Waiting…" : "No camera selected on Broadcast"}
        </div>
      </article>
    `;
  }).join("");
}

function setMeta(role, text) {
  const el = document.querySelector(`[data-meta="${role}"]`);
  if (el) el.textContent = text;
}

function publishStatsToBcc(role, fps, bitrateKbps, bytesSent = null, bytesReceived = null) {
  if (!channel) return;
  try {
    channel.postMessage({
      type: "publish-stats",
      role,
      fps,
      bitrateKbps,
      bytesSent,
      bytesReceived,
      at: Date.now(),
    });
  } catch {
    /* ignore */
  }
}

function stopRole(role, { keepPreview = false } = {}) {
  const slot = slots[role];
  if (!slot) return;
  clearScenePauseTimer(role);
  if (!keepPreview && slot.stream) {
    slot.stream.getTracks().forEach((track) => track.stop());
    slot.stream = null;
    const video = document.querySelector(`[data-video="${role}"]`);
    if (video instanceof HTMLVideoElement) {
      video.srcObject = null;
    }
  }
  slot.publisherUrl = null;
  slot.fps = null;
  const iframe = document.querySelector(`[data-iframe="${role}"]`);
  if (iframe instanceof HTMLIFrameElement) {
    iframe.setAttribute("data-current-src", "about:blank");
    iframe.src = "about:blank";
  }
}

async function startRole(camera, { force = false } = {}) {
  const deviceId = loadStoredDeviceId(camera.role);
  if (!deviceId) {
    stopRole(camera.role);
    if (slots[camera.role]) slots[camera.role].scenePaused = false;
    setMeta(camera.role, "No camera selected on Broadcast");
    return;
  }

  if (!neededByRole[camera.role]) {
    await ensurePreviewOnly(camera, deviceId);
    return;
  }

  const muted = loadStoredMuted(camera.role);
  const existing = slots[camera.role];
  if (
    !force &&
    existing?.publisherUrl &&
    existing.deviceId === deviceId &&
    !existing.scenePaused
  ) {
    setMeta(camera.role, muted ? "PUBLISHING (MUTED)" : "PUBLISHING");
    return;
  }

  stopRole(camera.role);

  try {
    const devices = await listVideoDevices();
    const match = devices.find((device) => device.deviceId === deviceId);
    const label = match?.label || null;
    const settings = defaultSettings(camera.targetBitrateKbps);
    const stream = await openCameraStream(deviceId, settings);
    const audioLabel = muted ? null : loadStoredMicLabel() || null;
    const publisherUrl = buildVdoPublisherUrl(
      camera.pushUrl,
      label,
      settings,
      muted,
      audioLabel,
    );

    slots[camera.role] = {
      stream,
      publisherUrl,
      deviceId,
      label: label || deviceId.slice(0, 8),
      fps: null,
      scenePaused: false,
    };

    const video = document.querySelector(`[data-video="${camera.role}"]`);
    if (video instanceof HTMLVideoElement) {
      video.srcObject = stream;
    }

    const iframe = document.querySelector(`[data-iframe="${camera.role}"]`);
    if (iframe instanceof HTMLIFrameElement) {
      iframe.setAttribute("data-current-src", publisherUrl);
      iframe.src = publisherUrl;
      const nudge = () => {
        setVdoPublisherMuted(iframe, muted);
        silenceVdoIframeOutput(iframe);
        lockVdoPublisherBitrate(iframe, camera.targetBitrateKbps || MAX_PUBLISH_BITRATE_KBPS);
      };
      scheduleVdoIframeSilence(iframe);
      window.setTimeout(nudge, 1500);
    }

    setMeta(camera.role, muted ? "PUBLISHING (MUTED)" : "PUBLISHING");
    scheduleObsBrowserRefresh(camera.obsSourceMatchers, { force: true });
  } catch (error) {
    setMeta(
      camera.role,
      error instanceof Error ? `ERROR: ${error.message}` : "ERROR starting camera",
    );
  }
}

async function ensurePreviewOnly(camera, deviceId) {
  clearScenePauseTimer(camera.role);
  const muted = loadStoredMuted(camera.role);
  let slot = slots[camera.role];

  // Drop VDO publish immediately; keep local preview when possible.
  if (slot?.publisherUrl) {
    stopRole(camera.role, { keepPreview: true });
  }

  try {
    if (!slot?.stream || slot.deviceId !== deviceId) {
      stopRole(camera.role);
      const devices = await listVideoDevices();
      const match = devices.find((device) => device.deviceId === deviceId);
      const label = match?.label || null;
      const settings = defaultSettings(camera.targetBitrateKbps);
      const stream = await openCameraStream(deviceId, settings);
      slot = {
        stream,
        publisherUrl: null,
        deviceId,
        label: label || deviceId.slice(0, 8),
        fps: null,
        scenePaused: true,
      };
      slots[camera.role] = slot;
      const video = document.querySelector(`[data-video="${camera.role}"]`);
      if (video instanceof HTMLVideoElement) {
        video.srcObject = stream;
      }
    } else {
      slot.publisherUrl = null;
      slot.scenePaused = true;
      slot.fps = null;
    }
    setMeta(camera.role, muted ? "NOT IN SCENE (MUTED)" : "NOT IN SCENE");
  } catch (error) {
    setMeta(
      camera.role,
      error instanceof Error ? `ERROR: ${error.message}` : "ERROR starting camera",
    );
  }
}

function pauseRoleForScene(role) {
  const camera = DOCK_CAMERAS.find((item) => item.role === role);
  const deviceId = loadStoredDeviceId(role);
  if (!camera || !deviceId) {
    stopRole(role);
    setMeta(role, "No camera selected on Broadcast");
    return;
  }
  void ensurePreviewOnly(camera, deviceId);
}

  function applySceneNeeds(nextNeeded) {
    /** @type {typeof DOCK_CAMERAS} */
    const toStart = [];
    DOCK_CAMERAS.forEach((camera) => {
      const needed = nextNeeded[camera.role] !== false;
      const wasNeeded = neededByRole[camera.role] !== false;
      neededByRole[camera.role] = needed;

      if (needed && !wasNeeded) {
        clearScenePauseTimer(camera.role);
        toStart.push(camera);
        return;
      }

      if (!needed && wasNeeded) {
        if (scenePauseTimers[camera.role]) return;
        scenePauseTimers[camera.role] = window.setTimeout(() => {
          scenePauseTimers[camera.role] = 0;
          if (neededByRole[camera.role]) return;
          pauseRoleForScene(camera.role);
          updateLiveStatus();
        }, SCENE_PAUSE_DEBOUNCE_MS);
        return;
      }

      if (!needed) {
        const slot = slots[camera.role];
        if (slot?.publisherUrl) {
          pauseRoleForScene(camera.role);
        }
      }
    });

    if (toStart.length) {
      void (async () => {
        for (const camera of toStart) {
          await startRole(camera, { force: true });
          await new Promise((r) => window.setTimeout(r, 400));
        }
        updateLiveStatus();
      })();
    } else {
      updateLiveStatus();
    }
  }

function updateLiveStatus() {
  const live = DOCK_CAMERAS.filter((camera) => slots[camera.role]?.publisherUrl).length;
  const paused = DOCK_CAMERAS.filter((camera) => slots[camera.role]?.scenePaused).length;
  if (live && paused) {
    setStatus(`LIVE · ${live} publishing · ${paused} idle (not in scene)`);
  } else if (live) {
    setStatus(`LIVE · ${live} camera${live === 1 ? "" : "s"}`);
  } else if (paused) {
    setStatus(`Idle · ${paused} camera${paused === 1 ? "" : "s"} not in active scene`);
  } else {
    setStatus("Waiting for camera selection");
  }
}

async function startAll(reason = "start") {
  if (starting) return;
  starting = true;
  setStatus(reason === "reload" ? "Reloading cameras…" : "Publishing…");
  try {
    saveStoredSessionActive(true);
    for (const camera of DOCK_CAMERAS) {
      if (!slots[camera.role]) {
        slots[camera.role] = {
          stream: null,
          publisherUrl: null,
          deviceId: "",
          label: "",
          fps: null,
          scenePaused: false,
        };
      }
      await startRole(camera, { force: reason === "reload" });
      // Brief gap so Truck Front (first in DOCK_CAMERAS) claims the uplink before Dash.
      await new Promise((r) => window.setTimeout(r, 400));
    }
    const matchers = DOCK_CAMERAS.filter((camera) => neededByRole[camera.role]).flatMap(
      (camera) => camera.obsSourceMatchers,
    );
    if (matchers.length) {
      scheduleObsBrowserRefresh(matchers, { force: true });
    }
    updateLiveStatus();
  } finally {
    starting = false;
  }
}

async function pollSceneNeeds() {
  try {
    const response = await fetch("/api/broadcast/status", { credentials: "same-origin" });
    if (!response.ok) return;
    const data = await response.json();
    const sources = data?.listener?.sources || [];
    const obsConnected = Boolean(data?.listener?.obsConnected);
    /** @type {Record<string, boolean>} */
    const next = {};
    DOCK_CAMERAS.forEach((camera) => {
      next[camera.role] = isDockCameraNeededInScene(
        sources,
        camera.obsSourceMatchers,
        obsConnected,
      );
    });
    const changed = DOCK_CAMERAS.some(
      (camera) => Boolean(neededByRole[camera.role]) !== Boolean(next[camera.role]),
    );
    if (changed) {
      applySceneNeeds(next);
    }
  } catch {
    /* ignore transient status failures */
  }
}

function startHeartbeat() {
  touchPublisherWindowHeartbeat();
  heartbeatTimer = window.setInterval(() => {
    touchPublisherWindowHeartbeat();
  }, 2000);
}

function tickPublisherStats() {
  DOCK_CAMERAS.forEach((camera) => {
    const slot = slots[camera.role];
    if (!slot?.publisherUrl) return;
    const iframe = document.querySelector(`[data-iframe="${camera.role}"]`);
    requestVdoPublisherStats(iframe instanceof HTMLIFrameElement ? iframe : null);
  });
}

function onStatsMessage(event) {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  const origin = String(event.origin || "");
  if (origin && !origin.includes("vdo.ninja")) return;

  DOCK_CAMERAS.forEach((camera) => {
    const iframe = document.querySelector(`[data-iframe="${camera.role}"]`);
    if (!(iframe instanceof HTMLIFrameElement) || event.source !== iframe.contentWindow) return;
    const stats = interpretVdoPublisherStats(data, extractVdoStreamId(camera.pushUrl));
    if (
      stats.fps == null &&
      stats.bitrateKbps == null &&
      stats.bytesSent == null &&
      stats.bytesReceived == null
    ) {
      return;
    }
    const slot = slots[camera.role];
    if (!slot?.publisherUrl) return;
    if (slot && stats.fps != null) slot.fps = stats.fps;
    const muted = loadStoredMuted(camera.role);
    const fpsLabel = stats.fps != null ? ` · ${Math.round(stats.fps)} fps` : "";
    const rateLabel =
      stats.bitrateKbps != null ? ` · ${Math.round(stats.bitrateKbps)} kbps` : "";
    setMeta(camera.role, `${muted ? "PUBLISHING (MUTED)" : "PUBLISHING"}${fpsLabel}${rateLabel}`);
    publishStatsToBcc(
      camera.role,
      stats.fps,
      stats.bitrateKbps,
      stats.bytesSent,
      stats.bytesReceived,
    );
  });
}

function bindUi() {
  document.querySelector("[data-pub-restart]")?.addEventListener("click", () => {
    void startAll("reload");
  });
  document.querySelector("[data-pub-obs-refresh]")?.addEventListener("click", () => {
    scheduleObsBrowserRefresh(["truck_front", "truck_dash"], { force: true });
    setStatus("Requested OBS viewer refresh");
  });
}

function bindChannel() {
  channel = createPublisherChannel();
  if (!channel) return;
  channel.onmessage = (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "scene-needed" && data.needed && typeof data.needed === "object") {
      applySceneNeeds(data.needed);
      return;
    }
    if (data.type === "reload") {
      void startAll("reload");
    }
  };
}

window.addEventListener("pagehide", () => {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  if (statsTimer) window.clearInterval(statsTimer);
  if (scenePollTimer) window.clearInterval(scenePollTimer);
  DOCK_CAMERAS.forEach((camera) => clearScenePauseTimer(camera.role));
  clearPublisherWindowHeartbeat();
  DOCK_CAMERAS.forEach((camera) => stopRole(camera.role));
  channel?.close();
});

window.addEventListener("online", () => {
  window.setTimeout(() => {
    void startAll("reload");
  }, 2000);
});

window.addEventListener("offline", () => {
  setStatus("Network offline — will hard-restart publishers when back online");
});

window.addEventListener("message", onStatsMessage);

renderShell();
bindUi();
bindChannel();
startHeartbeat();
statsTimer = window.setInterval(tickPublisherStats, 1500);
scenePollTimer = window.setInterval(() => {
  void pollSceneNeeds();
}, SCENE_POLL_MS);
void pollSceneNeeds().then(() => startAll("start"));
