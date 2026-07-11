/**
 * Keeps Truck Front / Truck Dash VDO publishers alive across site navigation.
 * Runs on non-Broadcast pages (and as a fallback) when a dock session is active.
 */
import {
  DOCK_CAMERAS,
  buildVdoPublisherUrl,
  defaultSettings,
  listVideoDevices,
  loadStoredDeviceId,
  loadStoredMuted,
  loadStoredSessionActive,
  isPublisherWindowAlive,
  reloadPublisherIframe,
  resolveObsReceiveStatus,
  saveStoredSessionActive,
} from "./camera-dock-model.js";
import { scheduleObsBrowserRefresh } from "./obs-browser-refresh.js";

const HOST_ID = "hsc-camera-persist";
const WATCHDOG_MS = 8000;
const OBS_LOST_RESTART_MS = 15000;
const NETWORK_BACK_MS = 2500;

function ensureHost() {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;left:-9999px;top:0;";
    document.body.appendChild(host);
  }
  return host;
}

function isBroadcastControlPage() {
  return Boolean(document.body?.dataset?.page === "broadcast");
}

/**
 * @param {HTMLElement} host
 * @param {typeof DOCK_CAMERAS[number]} camera
 * @param {string} deviceLabel
 * @param {boolean} muted
 */
function upsertPublisherIframe(host, camera, deviceLabel, muted) {
  const settings = defaultSettings(camera.targetBitrateKbps);
  const url = buildVdoPublisherUrl(camera.pushUrl, deviceLabel, settings, muted);
  let iframe = host.querySelector(`[data-persist-role="${camera.role}"]`);
  if (!(iframe instanceof HTMLIFrameElement)) {
    iframe = document.createElement("iframe");
    iframe.setAttribute("data-persist-role", camera.role);
    iframe.setAttribute("allow", "camera; microphone; autoplay; fullscreen");
    iframe.title = `${camera.label} persistent publisher`;
    iframe.style.cssText = "width:1px;height:1px;border:0;";
    host.appendChild(iframe);
  }
  const current = iframe.getAttribute("data-current-src");
  if (current !== url) {
    iframe.setAttribute("data-current-src", url);
    iframe.src = url;
  }
  return { iframe, url };
}

async function resolveDeviceLabel(deviceId) {
  if (!deviceId) return null;
  try {
    const devices = await listVideoDevices();
    return devices.find((device) => device.deviceId === deviceId)?.label || null;
  } catch {
    return null;
  }
}

export function startCameraDockPersist() {
  // Broadcast page owns the interactive dock; avoid double publishers.
  if (isBroadcastControlPage()) {
    return { destroy() {} };
  }

  // Dedicated publisher popup owns the feeds — do not remount on every page.
  if (isPublisherWindowAlive()) {
    return { destroy() {} };
  }

  if (!loadStoredSessionActive()) {
    return { destroy() {} };
  }

  const hasAnyDevice = DOCK_CAMERAS.some((camera) => loadStoredDeviceId(camera.role));
  if (!hasAnyDevice) {
    saveStoredSessionActive(false);
    return { destroy() {} };
  }

  const host = ensureHost();
  /** @type {Record<string, { url: string, iframe: HTMLIFrameElement, obsLostSince: number | null }>} */
  const slots = {};
  let destroyed = false;
  let watchdogTimer = 0;
  let restarting = false;
  let onlineTimer = 0;

  async function startAll(reason = "start") {
    if (destroyed || restarting) return;
    restarting = true;
    try {
      for (const camera of DOCK_CAMERAS) {
        const deviceId = loadStoredDeviceId(camera.role);
        if (!deviceId) continue;
        const muted = loadStoredMuted(camera.role);
        const deviceLabel = await resolveDeviceLabel(deviceId);
        const { iframe, url } = upsertPublisherIframe(host, camera, deviceLabel, muted);
        slots[camera.role] = {
          url,
          iframe,
          obsLostSince: slots[camera.role]?.obsLostSince ?? null,
        };
        if (reason === "restart") {
          reloadPublisherIframe(iframe, url);
        }
      }
      scheduleObsBrowserRefresh(["truck_front", "truck_dash"]);
    } finally {
      restarting = false;
    }
  }

  async function pollObsAndWatchdog() {
    if (destroyed || !navigator.onLine) return;

    try {
      const response = await fetch("/api/broadcast/status", { credentials: "same-origin" });
      if (!response.ok) return;
      const data = await response.json();
      const sources = data?.listener?.sources || [];
      const obsConnected = Boolean(data?.listener?.obsConnected);
      const now = Date.now();

      for (const camera of DOCK_CAMERAS) {
        const slot = slots[camera.role];
        if (!slot) continue;
        const status = resolveObsReceiveStatus(sources, camera.obsSourceMatchers, obsConnected);
        if (status === "lost" || status === "unknown") {
          if (slot.obsLostSince == null) {
            slot.obsLostSince = now;
          } else if (now - slot.obsLostSince >= OBS_LOST_RESTART_MS) {
            slot.obsLostSince = now;
            reloadPublisherIframe(slot.iframe, slot.url);
            scheduleObsBrowserRefresh(camera.obsSourceMatchers);
          }
        } else {
          slot.obsLostSince = null;
        }
      }
    } catch {
      /* ignore transient status failures */
    }
  }

  function onOnline() {
    if (onlineTimer) window.clearTimeout(onlineTimer);
    onlineTimer = window.setTimeout(() => {
      void startAll("restart");
    }, NETWORK_BACK_MS);
  }

  function onVisibility() {
    if (document.visibilityState === "visible" && navigator.onLine) {
      void startAll("restart");
    }
  }

  void startAll("start");
  watchdogTimer = window.setInterval(() => {
    void pollObsAndWatchdog();
  }, WATCHDOG_MS);

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);

  return {
    destroy() {
      destroyed = true;
      if (watchdogTimer) window.clearInterval(watchdogTimer);
      if (onlineTimer) window.clearTimeout(onlineTimer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      host.replaceChildren();
    },
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    startCameraDockPersist();
  });
} else {
  startCameraDockPersist();
}
