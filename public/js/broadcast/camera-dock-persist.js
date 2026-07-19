/**
 * Keeps Truck Front / Truck Dash VDO publishers alive across site navigation.
 * Runs on non-Broadcast pages (and as a fallback) when a dock session is active.
 * Only publishes cameras present/visible in the active OBS program scene.
 */
import {
  DOCK_CAMERAS,
  buildVdoPublisherUrl,
  defaultSettings,
  isDockCameraNeededInScene,
  listVideoDevices,
  loadStoredDeviceId,
  loadStoredMicLabel,
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
const SCENE_PAUSE_DEBOUNCE_MS = 1500;

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
  const audioLabel = muted ? null : loadStoredMicLabel() || null;
  const url = buildVdoPublisherUrl(camera.pushUrl, deviceLabel, settings, muted, audioLabel);
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

/**
 * @param {HTMLElement} host
 * @param {string} role
 */
function blankPublisherIframe(host, role) {
  const iframe = host.querySelector(`[data-persist-role="${role}"]`);
  if (!(iframe instanceof HTMLIFrameElement)) return null;
  iframe.setAttribute("data-current-src", "about:blank");
  iframe.src = "about:blank";
  return iframe;
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
  /** @type {Record<string, { url: string | null, iframe: HTMLIFrameElement | null, obsLostSince: number | null, scenePaused: boolean }>} */
  const slots = {};
  /** @type {Record<string, boolean>} */
  const neededByRole = Object.fromEntries(DOCK_CAMERAS.map((camera) => [camera.role, true]));
  /** @type {Record<string, number>} */
  const scenePauseTimers = {};
  let destroyed = false;
  let watchdogTimer = 0;
  let restarting = false;
  let onlineTimer = 0;

  function clearScenePauseTimer(role) {
    if (scenePauseTimers[role]) {
      window.clearTimeout(scenePauseTimers[role]);
      scenePauseTimers[role] = 0;
    }
  }

  async function startRole(camera, reason = "start") {
    const deviceId = loadStoredDeviceId(camera.role);
    if (!deviceId) {
      blankPublisherIframe(host, camera.role);
      delete slots[camera.role];
      return;
    }
    if (!neededByRole[camera.role]) {
      blankPublisherIframe(host, camera.role);
      slots[camera.role] = {
        url: null,
        iframe: host.querySelector(`[data-persist-role="${camera.role}"]`),
        obsLostSince: null,
        scenePaused: true,
      };
      return;
    }

    const muted = loadStoredMuted(camera.role);
    const deviceLabel = await resolveDeviceLabel(deviceId);
    const { iframe, url } = upsertPublisherIframe(host, camera, deviceLabel, muted);
    slots[camera.role] = {
      url,
      iframe,
      obsLostSince: slots[camera.role]?.obsLostSince ?? null,
      scenePaused: false,
    };
    if (reason === "restart") {
      reloadPublisherIframe(iframe, url);
    }
  }

  async function startAll(reason = "start") {
    if (destroyed || restarting) return;
    restarting = true;
    try {
      for (const camera of DOCK_CAMERAS) {
        await startRole(camera, reason);
        await new Promise((r) => window.setTimeout(r, 400));
      }
      const matchers = DOCK_CAMERAS.filter((camera) => neededByRole[camera.role]).flatMap(
        (camera) => camera.obsSourceMatchers,
      );
      if (matchers.length) {
        scheduleObsBrowserRefresh(matchers);
      }
    } finally {
      restarting = false;
    }
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
          if (neededByRole[camera.role] || destroyed) return;
          blankPublisherIframe(host, camera.role);
          slots[camera.role] = {
            url: null,
            iframe: host.querySelector(`[data-persist-role="${camera.role}"]`),
            obsLostSince: null,
            scenePaused: true,
          };
        }, SCENE_PAUSE_DEBOUNCE_MS);
      }
    });

    if (toStart.length) {
      void (async () => {
        for (const camera of toStart) {
          if (destroyed) return;
          await startRole(camera, "restart");
          await new Promise((r) => window.setTimeout(r, 400));
        }
      })();
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

      /** @type {Record<string, boolean>} */
      const nextNeeded = {};
      DOCK_CAMERAS.forEach((camera) => {
        nextNeeded[camera.role] = isDockCameraNeededInScene(
          sources,
          camera.obsSourceMatchers,
          obsConnected,
        );
      });
      const needsChanged = DOCK_CAMERAS.some(
        (camera) => Boolean(neededByRole[camera.role]) !== Boolean(nextNeeded[camera.role]),
      );
      if (needsChanged) {
        applySceneNeeds(nextNeeded);
      }

      for (const camera of DOCK_CAMERAS) {
        const slot = slots[camera.role];
        if (!slot?.url || slot.scenePaused || !neededByRole[camera.role]) {
          if (slot) slot.obsLostSince = null;
          continue;
        }
        const status = resolveObsReceiveStatus(sources, camera.obsSourceMatchers, obsConnected);
        // Only soft-restart when the scene needs this camera but OBS is not receiving.
        if (status === "lost") {
          if (slot.obsLostSince == null) {
            slot.obsLostSince = now;
          } else if (now - slot.obsLostSince >= OBS_LOST_RESTART_MS) {
            slot.obsLostSince = now;
            if (slot.iframe && slot.url) {
              reloadPublisherIframe(slot.iframe, slot.url);
              scheduleObsBrowserRefresh(camera.obsSourceMatchers);
            }
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

  void pollObsAndWatchdog().then(() => startAll("start"));
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
      DOCK_CAMERAS.forEach((camera) => clearScenePauseTimer(camera.role));
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
