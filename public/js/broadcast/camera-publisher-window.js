/**
 * Dedicated popup window that owns VDO publishing so browsing other tabs/pages
 * does not tear down Truck Front / Truck Dash feeds.
 */
import {
  DOCK_CAMERAS,
  buildVdoPublisherUrl,
  clearPublisherWindowHeartbeat,
  createPublisherChannel,
  defaultSettings,
  listVideoDevices,
  loadStoredDeviceId,
  loadStoredMuted,
  openCameraStream,
  reloadPublisherIframe,
  saveStoredSessionActive,
  touchPublisherWindowHeartbeat,
} from "./camera-dock-model.js";
import { scheduleObsBrowserRefresh } from "./obs-browser-refresh.js";
import { escapeHtml } from "./ui-utils.js";

const statusEl = document.querySelector("[data-pub-status]");
const gridEl = document.querySelector("[data-pub-grid]");

/** @type {Record<string, { stream: MediaStream | null, publisherUrl: string | null, deviceId: string, label: string }>} */
const slots = {};
let heartbeatTimer = 0;
let channel = null;
let starting = false;

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
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

function stopRole(role) {
  const slot = slots[role];
  if (!slot) return;
  if (slot.stream) {
    slot.stream.getTracks().forEach((track) => track.stop());
    slot.stream = null;
  }
  slot.publisherUrl = null;
  const video = document.querySelector(`[data-video="${role}"]`);
  if (video instanceof HTMLVideoElement) {
    video.srcObject = null;
  }
  const iframe = document.querySelector(`[data-iframe="${role}"]`);
  if (iframe instanceof HTMLIFrameElement) {
    iframe.setAttribute("data-current-src", "about:blank");
    iframe.src = "about:blank";
  }
}

async function startRole(camera) {
  const deviceId = loadStoredDeviceId(camera.role);
  if (!deviceId) {
    stopRole(camera.role);
    setMeta(camera.role, "No camera selected on Broadcast");
    return;
  }

  const muted = loadStoredMuted(camera.role);
  stopRole(camera.role);

  try {
    const devices = await listVideoDevices();
    const match = devices.find((device) => device.deviceId === deviceId);
    const label = match?.label || null;
    const settings = defaultSettings(camera.targetBitrateKbps);
    const stream = await openCameraStream(deviceId, settings);
    const publisherUrl = buildVdoPublisherUrl(camera.pushUrl, label, settings, muted);

    slots[camera.role] = {
      stream,
      publisherUrl,
      deviceId,
      label: label || deviceId.slice(0, 8),
    };

    const video = document.querySelector(`[data-video="${camera.role}"]`);
    if (video instanceof HTMLVideoElement) {
      video.srcObject = stream;
    }

    const iframe = document.querySelector(`[data-iframe="${camera.role}"]`);
    if (iframe instanceof HTMLIFrameElement) {
      iframe.setAttribute("data-current-src", publisherUrl);
      iframe.src = publisherUrl;
    }

    setMeta(camera.role, muted ? "PUBLISHING (MUTED)" : "PUBLISHING");
  } catch (error) {
    setMeta(
      camera.role,
      error instanceof Error ? `ERROR: ${error.message}` : "ERROR starting camera",
    );
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
        };
      }
      await startRole(camera);
    }
    scheduleObsBrowserRefresh(["truck_front", "truck_dash"]);
    const live = DOCK_CAMERAS.filter((camera) => slots[camera.role]?.publisherUrl).length;
    setStatus(live ? `LIVE · ${live} camera${live === 1 ? "" : "s"}` : "Waiting for camera selection");
  } finally {
    starting = false;
  }
}

function softRestartAll() {
  DOCK_CAMERAS.forEach((camera) => {
    const slot = slots[camera.role];
    const iframe = document.querySelector(`[data-iframe="${camera.role}"]`);
    if (slot?.publisherUrl && iframe instanceof HTMLIFrameElement) {
      reloadPublisherIframe(iframe, slot.publisherUrl);
    }
  });
  scheduleObsBrowserRefresh(["truck_front", "truck_dash"]);
  setStatus("Restarted publishers");
}

function startHeartbeat() {
  touchPublisherWindowHeartbeat();
  heartbeatTimer = window.setInterval(() => {
    touchPublisherWindowHeartbeat();
  }, 2000);
}

function bindUi() {
  document.querySelector("[data-pub-restart]")?.addEventListener("click", () => {
    void startAll("reload");
  });
  document.querySelector("[data-pub-obs-refresh]")?.addEventListener("click", () => {
    scheduleObsBrowserRefresh(["truck_front", "truck_dash"]);
    setStatus("Requested OBS viewer refresh");
  });
}

function bindChannel() {
  channel = createPublisherChannel();
  if (!channel) return;
  channel.onmessage = (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "reload") {
      void startAll("reload");
    }
  };
}

window.addEventListener("pagehide", () => {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  clearPublisherWindowHeartbeat();
  DOCK_CAMERAS.forEach((camera) => stopRole(camera.role));
  channel?.close();
});

window.addEventListener("online", () => {
  window.setTimeout(() => {
    softRestartAll();
  }, 2000);
});

renderShell();
bindUi();
bindChannel();
startHeartbeat();
void startAll("start");
