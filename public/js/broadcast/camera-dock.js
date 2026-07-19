import {
  DOCK_CAMERAS,
  audioLevelToBars,
  bitrateToBars,
  buildVdoPublisherUrl,
  createAudioLevelMonitor,
  createPublisherChannel,
  defaultSettings,
  ensureCameraPermission,
  listAudioDevices,
  listVideoDevices,
  loadStoredDeviceId,
  loadStoredMicDeviceId,
  loadStoredMicLabel,
  loadStoredMuted,
  loadStoredPreviewRotated,
  loadStoredSessionActive,
  isDockCameraNeededInScene,
  isPublisherWindowAlive,
  notifyPublisherSceneNeeds,
  notifyPublisherWindowReload,
  openCameraStream,
  openCameraPublisherWindow,
  reloadPublisherIframe,
  resolveObsReceiveStatus,
  saveStoredDeviceId,
  saveStoredMicDeviceId,
  saveStoredMicLabel,
  saveStoredMuted,
  saveStoredPreviewRotated,
  saveStoredSessionActive,
  setVdoPublisherMuted,
  silenceVdoIframeOutput,
  scheduleVdoIframeSilence,
  lockVdoPublisherBitrate,
  MAX_PUBLISH_BITRATE_KBPS,
} from "./camera-dock-model.js";
import { scheduleObsBrowserRefresh } from "./obs-browser-refresh.js";
import {
  VDO_RECOVER_COOLDOWN_MS,
  createByteRateEstimator,
  createVdoViewMonitor,
  extractVdoStreamId,
  interpretVdoPublisherStats,
  requestVdoPublisherStats,
  vdoHealthPhase,
} from "./vdo-health.js";
import { escapeHtml } from "./ui-utils.js";

function emptySlot(role) {
  return {
    role,
    deviceId: loadStoredDeviceId(role),
    deviceLabel: null,
    localStatus: "idle",
    publisherStatus: "stopped",
    /** True when camera is ready but paused because active OBS scene does not use it. */
    scenePaused: false,
    obsStatus: "unknown",
    /** Outbound/inbound VDO fps from publisher or view monitor. */
    fps: null,
    bitrateKbps: null,
    publishFps: null,
    publishBitrateKbps: null,
    viewFps: null,
    viewBitrateKbps: null,
    vdoPhase: "idle",
    vdoReason: "idle",
    audioLevel: 0,
    busy: false,
    error: null,
    stream: null,
    publisherUrl: null,
    muted: loadStoredMuted(role),
    previewRotated: loadStoredPreviewRotated(role),
  };
}

function publisherLabel(phase) {
  switch (phase) {
    case "live":
      return "PUBLISHER LIVE";
    case "starting":
      return "PUBLISHER STARTING";
    case "paused":
      return "NOT IN SCENE";
    case "down":
      return "PUBLISHER DOWN";
    default:
      return "PUBLISHER STOPPED";
  }
}

function publisherTone(phase) {
  if (phase === "live") return "healthy";
  if (phase === "starting") return "stale";
  if (phase === "paused") return "unavailable";
  if (phase === "down") return "disconnected";
  return "disconnected";
}

/** Debounce before stopping an unused camera so brief scene flips don't thrash. */
const SCENE_PAUSE_DEBOUNCE_MS = 1500;
/** Full restart when VDO is down but OBS still shows the source. */
const PUBLISHER_DOWN_OBS_OK_RESTART_MS = 3000;
const PUBLISHER_OBS_OK_RECOVER_COOLDOWN_MS = 15000;

function obsLabel(status) {
  if (status === "receiving") return "OBS RECEIVING";
  if (status === "lost") return "OBS LOST";
  if (status === "stale") return "OBS STALE";
  return "OBS UNKNOWN";
}

function obsTone(status) {
  if (status === "receiving") return "healthy";
  if (status === "lost" || status === "stale") return "stale";
  return "unavailable";
}

function formatBitrateKbps(kbps) {
  if (kbps == null || !Number.isFinite(kbps) || kbps <= 0) return "—";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

function syncDisplayedVdoMetrics(slot) {
  // Prefer real publisher outbound; fall back to view-monitor inbound (same push stream).
  slot.fps = slot.publishFps ?? slot.viewFps ?? null;
  slot.bitrateKbps = slot.publishBitrateKbps ?? slot.viewBitrateKbps ?? null;
}

/**
 * @param {HTMLElement | null} root
 * @param {() => { sources?: Array<{name?: string, visible?: boolean}>, obsConnected?: boolean }} getObsSnapshot
 * @param {{ onStatusChange?: () => void } | null | undefined} options
 */
export function createCameraDock(root, getObsSnapshot, options) {
  if (!root) {
    return {
      destroy() {},
      refreshObs() {},
      render() {},
      requestPermission() {},
      getBannerIssue() {
        return null;
      },
      openPublisherWindow() {
        return false;
      },
    };
  }

  const onStatusChange = typeof options?.onStatusChange === "function" ? options.onStatusChange : null;

  const slots = {};
  DOCK_CAMERAS.forEach((camera) => {
    // Always start muted on page load (operator unmutes when needed).
    saveStoredMuted(camera.role, true);
    slots[camera.role] = emptySlot(camera.role);
    slots[camera.role].muted = true;
  });

  let devices = [];
  let audioDevices = [];
  let micDeviceId = loadStoredMicDeviceId();
  let micLabel = loadStoredMicLabel();
  let permissionGranted = false;
  let metricsTimer = null;
  let destroyed = false;
  let built = false;
  let sharedAudioLevel = 0;
  /** @type {{ start: () => Promise<void>, stop: () => Promise<void>, isRunning: boolean } | null} */
  let sharedAudioMonitor = null;
  /** @type {Record<string, number>} */
  const lastAudioBars = {};
  /** @type {Record<string, number | null>} */
  const obsLostSince = {};
  /** @type {Record<string, number>} */
  const lastHealthRecoverAt = {};
  /** @type {Record<string, number>} */
  const lastSoftRecoverAt = {};
  /** @type {Record<string, number | null>} */
  const publisherDownObsOkSince = {};
  /** @type {Record<string, ReturnType<typeof createVdoViewMonitor>>} */
  const vdoMonitors = {};
  const publishByteRate = createByteRateEstimator();
  const viewByteRate = createByteRateEstimator();
  let watchdogTimer = 0;
  let onlineTimer = 0;
  let resumeStarted = false;
  /** @type {Record<string, number>} */
  const scenePauseTimers = {};
  /** @type {Record<string, boolean> | null} */
  let lastNotifiedSceneNeeds = null;

  // Persist outside render() so innerHTML rebuilds don't destroy health iframes.
  let monitorHost = root.parentElement?.querySelector("[data-dock-monitor-host]");
  if (!(monitorHost instanceof HTMLElement)) {
    monitorHost = document.createElement("div");
    monitorHost.className = "bcc-dock-vdo-monitors";
    monitorHost.setAttribute("data-dock-monitor-host", "");
    monitorHost.hidden = true;
    root.insertAdjacentElement("afterend", monitorHost);
  }

  DOCK_CAMERAS.forEach((camera) => {
    vdoMonitors[camera.role] = createVdoViewMonitor({
      role: camera.role,
      viewUrl: camera.viewUrl,
      mount: monitorHost,
      onUpdate(health) {
        const slot = slots[camera.role];
        if (!slot) return;
        const phase = vdoHealthPhase(health);
        slot.vdoPhase = phase;
        slot.vdoReason = health.reason;
        if (health.vdoLive) {
          if (health.fps != null) slot.viewFps = health.fps;
          if (health.bitrateKbps != null) slot.viewBitrateKbps = health.bitrateKbps;
          const fromBytes = viewByteRate.push(
            camera.role,
            health.bytesReceived ?? health.bytesSent ?? null,
          );
          if (fromBytes != null) slot.viewBitrateKbps = fromBytes;
          syncDisplayedVdoMetrics(slot);
          if (slot.publisherStatus === "starting") {
            slot.publisherStatus = "publishing";
          }
          slot.error = null;
        } else if (phase === "down") {
          slot.viewFps = null;
          slot.viewBitrateKbps = null;
          slot.publishFps = null;
          slot.publishBitrateKbps = null;
          syncDisplayedVdoMetrics(slot);
        }
        if (built) {
          updateObsStatuses();
          patchStatusUi();
          maybeRecoverPublisherDownWhileObsOk(camera.role, phase);
        }
      },
    });
  });

  function cameraConfig(role) {
    return DOCK_CAMERAS.find((camera) => camera.role === role);
  }

  function resolveMicLabel() {
    if (micDeviceId) {
      const match = audioDevices.find((device) => device.deviceId === micDeviceId);
      if (match?.label) {
        micLabel = match.label;
        saveStoredMicLabel(micLabel);
        return micLabel;
      }
      if (micLabel) return micLabel;
    }
    return null;
  }

  function buildPublisherUrlForSlot(camera, slot) {
    return buildVdoPublisherUrl(
      camera.pushUrl,
      slot.deviceLabel,
      defaultSettings(camera.targetBitrateKbps),
      slot.muted,
      slot.muted ? null : resolveMicLabel(),
    );
  }

  function publisherIntentActive(slot) {
    return slot.publisherStatus === "publishing" || slot.publisherStatus === "starting";
  }

  function sessionWantsCamera(slot) {
    return Boolean(slot.deviceId) && (slot.localStatus === "ready" || slot.scenePaused);
  }

  function cameraNeededInScene(camera) {
    const snapshot = getObsSnapshot() || {};
    return isDockCameraNeededInScene(
      snapshot.sources,
      camera.obsSourceMatchers,
      Boolean(snapshot.obsConnected),
    );
  }

  function clearScenePauseTimer(role) {
    if (scenePauseTimers[role]) {
      window.clearTimeout(scenePauseTimers[role]);
      scenePauseTimers[role] = 0;
    }
  }

  function beginVdoPublish(role) {
    const camera = cameraConfig(role);
    const slot = slots[role];
    if (!camera || !slot?.deviceId || slot.localStatus !== "ready") return;

    if (isPublisherWindowAlive()) {
      slot.scenePaused = false;
      slot.publisherStatus = "starting";
      slot.publisherUrl = null;
      slot.vdoPhase = "starting";
      syncVdoExpecting(role);
      return;
    }

    const settings = defaultSettings(camera.targetBitrateKbps);
    slot.scenePaused = false;
    slot.publisherStatus = "starting";
    slot.vdoPhase = "starting";
    slot.publisherUrl = buildPublisherUrlForSlot(camera, slot);
    syncVdoExpecting(role);
    syncPublisherIframes();
    window.setTimeout(() => {
      if (!slots[role].publisherUrl) return;
      applyMuteToIframe(role);
      scheduleObsBrowserRefresh(camera.obsSourceMatchers, { force: true });
      patchStatusUi();
    }, 1500);
  }

  function pauseVdoPublishForScene(role) {
    const slot = slots[role];
    if (!slot) return;
    clearScenePauseTimer(role);
    stopPublisher(role);
    slot.scenePaused = true;
    slot.publisherStatus = "paused";
    slot.vdoPhase = "paused";
    slot.vdoReason = "not-in-scene";
    slot.publishFps = null;
    slot.publishBitrateKbps = null;
    slot.viewFps = null;
    slot.viewBitrateKbps = null;
    syncDisplayedVdoMetrics(slot);
    syncVdoExpecting(role);
  }

  function syncSceneAwarePublish() {
    if (destroyed) return;

    /** @type {Record<string, boolean>} */
    const neededByRole = {};
    DOCK_CAMERAS.forEach((camera) => {
      neededByRole[camera.role] = cameraNeededInScene(camera);
    });

    const needsChanged =
      !lastNotifiedSceneNeeds ||
      DOCK_CAMERAS.some((camera) => lastNotifiedSceneNeeds[camera.role] !== neededByRole[camera.role]);
    if (needsChanged) {
      lastNotifiedSceneNeeds = { ...neededByRole };
      notifyPublisherSceneNeeds(neededByRole);
    }

    /** @type {string[]} */
    const resumeRoles = [];

    DOCK_CAMERAS.forEach((camera) => {
      const slot = slots[camera.role];
      if (!slot || !sessionWantsCamera(slot)) {
        clearScenePauseTimer(camera.role);
        return;
      }

      const needed = neededByRole[camera.role];
      if (needed) {
        clearScenePauseTimer(camera.role);
        if (slot.scenePaused || slot.publisherStatus === "paused") {
          resumeRoles.push(camera.role);
        } else if (
          slot.localStatus === "ready" &&
          !publisherIntentActive(slot) &&
          slot.publisherStatus !== "error" &&
          !isPublisherWindowAlive()
        ) {
          resumeRoles.push(camera.role);
        }
        return;
      }

      // Not needed in active scene — pause VDO after a short debounce.
      if (slot.scenePaused || slot.publisherStatus === "paused") {
        clearScenePauseTimer(camera.role);
        return;
      }
      if (!publisherIntentActive(slot) && !slot.publisherUrl) {
        slot.scenePaused = true;
        slot.publisherStatus = "paused";
        slot.vdoPhase = "paused";
        syncVdoExpecting(camera.role);
        return;
      }
      if (scenePauseTimers[camera.role]) return;
      scenePauseTimers[camera.role] = window.setTimeout(() => {
        scenePauseTimers[camera.role] = 0;
        if (!cameraNeededInScene(camera) && sessionWantsCamera(slots[camera.role])) {
          pauseVdoPublishForScene(camera.role);
          if (built) patchStatusUi();
        }
      }, SCENE_PAUSE_DEBOUNCE_MS);
    });

    // Truck Front before Truck Dash so the primary camera claims uplink first.
    if (resumeRoles.length) {
      window.setTimeout(() => {
        void (async () => {
          for (const role of resumeRoles) {
            if (destroyed) return;
            const liveSlot = slots[role];
            const liveCamera = cameraConfig(role);
            if (!liveSlot || !liveCamera) continue;
            if (!cameraNeededInScene(liveCamera) || !sessionWantsCamera(liveSlot)) continue;
            if (publisherIntentActive(liveSlot) && !liveSlot.scenePaused) continue;
            if (liveSlot.localStatus === "ready") {
              beginVdoPublish(role);
            } else if (liveSlot.deviceId) {
              await setCamera(role, liveSlot.deviceId);
            }
            if (built) {
              syncPublisherIframes();
              patchStatusUi();
            }
            await new Promise((r) => window.setTimeout(r, 400));
          }
        })();
      }, 0);
    }
  }

  function syncVdoExpecting(role) {
    const slot = slots[role];
    const monitor = vdoMonitors[role];
    if (!slot || !monitor) return;
    const expecting =
      Boolean(slot.deviceId) &&
      slot.localStatus === "ready" &&
      publisherIntentActive(slot) &&
      !slot.scenePaused &&
      navigator.onLine !== false;
    monitor.setExpecting(expecting);
    if (!expecting) {
      if (slot.scenePaused || slot.publisherStatus === "paused") {
        slot.vdoPhase = "paused";
        slot.vdoReason = "not-in-scene";
      } else {
        slot.vdoPhase = "idle";
        slot.vdoReason = "idle";
      }
    } else {
      slot.vdoPhase = vdoHealthPhase(monitor.getState());
    }
  }

  function anyCameraLive() {
    return DOCK_CAMERAS.some((camera) => {
      const slot = slots[camera.role];
      return (
        slot.localStatus === "ready" &&
        (slot.publisherStatus === "publishing" || slot.publisherStatus === "starting")
      );
    });
  }

  function stopStream(role) {
    const slot = slots[role];
    if (slot.stream) {
      slot.stream.getTracks().forEach((track) => track.stop());
      slot.stream = null;
    }
    void syncSharedAudioMonitor();
  }

  function anyUnmutedLive() {
    return DOCK_CAMERAS.some((camera) => {
      const slot = slots[camera.role];
      return (
        !slot.muted &&
        slot.localStatus === "ready" &&
        (slot.publisherStatus === "publishing" || slot.publisherStatus === "starting")
      );
    });
  }

  async function syncSharedAudioMonitor() {
    if (!anyUnmutedLive()) {
      if (sharedAudioMonitor) {
        await sharedAudioMonitor.stop();
      }
      sharedAudioLevel = 0;
      DOCK_CAMERAS.forEach((camera) => {
        slots[camera.role].audioLevel = 0;
        patchAudioUi(camera.role);
      });
      return;
    }

    if (!sharedAudioMonitor) {
      sharedAudioMonitor = createAudioLevelMonitor((level) => {
        sharedAudioLevel = level;
        DOCK_CAMERAS.forEach((camera) => {
          const slot = slots[camera.role];
          slot.audioLevel = slot.muted ? 0 : level;
          patchAudioUi(camera.role);
        });
      }, () => micDeviceId);
    }

    try {
      await sharedAudioMonitor.start();
    } catch {
      sharedAudioLevel = 0;
      DOCK_CAMERAS.forEach((camera) => {
        slots[camera.role].audioLevel = 0;
        patchAudioUi(camera.role);
      });
    }
  }

  function stopPublisher(role) {
    const slot = slots[role];
    slot.publisherUrl = null;
    slot.publisherStatus = "stopped";
    slot.bitrateKbps = null;
    slot.fps = null;
    slot.publishFps = null;
    slot.publishBitrateKbps = null;
    slot.viewFps = null;
    slot.viewBitrateKbps = null;
    slot.vdoPhase = "idle";
    slot.vdoReason = "idle";
    const iframe = root.querySelector(`[data-dock-iframe="${role}"]`);
    if (iframe instanceof HTMLIFrameElement) {
      iframe.setAttribute("data-current-src", "about:blank");
      iframe.src = "about:blank";
    }
    syncVdoExpecting(role);
  }

  function updateObsStatuses() {
    const snapshot = getObsSnapshot() || {};
    DOCK_CAMERAS.forEach((camera) => {
      const slot = slots[camera.role];
      // Video first: OBS badge follows real OBS source visibility, not flaky VDO monitor phase.
      slot.obsStatus = resolveObsReceiveStatus(
        snapshot.sources,
        camera.obsSourceMatchers,
        Boolean(snapshot.obsConnected),
      );
    });
    syncSceneAwarePublish();
  }

  function renderSignalBars(bars, kind = "signal") {
    const label = kind === "audio" ? "Audio" : "Signal";
    let html = `<div class="bcc-signal${kind === "audio" ? " bcc-signal--audio" : ""}" title="${label} strength" aria-label="${label} ${bars} of 5">`;
    for (let i = 1; i <= 5; i += 1) {
      html += `<span class="bcc-signal__bar${i <= bars ? " bcc-signal__bar--on" : ""}" style="height:${6 + i * 3}px"></span>`;
    }
    html += `</div>`;
    return html;
  }

  function audioStatusLabel(slot) {
    if (slot.localStatus !== "ready") return "AUDIO OFF";
    if (slot.muted) return "AUDIO MUTED";
    const bars = audioLevelToBars(slot.audioLevel);
    return bars > 0 ? "AUDIO LIVE" : "AUDIO SILENT";
  }

  function deviceOptions(selectedId, otherSelectedId) {
    if (!devices.length) {
      return `<option value="">${permissionGranted ? "No cameras found" : "Allow camera access…"}</option>`;
    }
    let html = `<option value="">Select camera…</option>`;
    devices.forEach((device) => {
      const label = device.label || `Camera ${device.deviceId.slice(0, 6)}`;
      const disabled = device.deviceId && device.deviceId === otherSelectedId ? " disabled" : "";
      const selected = device.deviceId === selectedId ? " selected" : "";
      html += `<option value="${escapeHtml(device.deviceId)}"${selected}${disabled}>${escapeHtml(label)}</option>`;
    });
    return html;
  }

  function micOptions() {
    if (!audioDevices.length) {
      return `<option value="">${permissionGranted ? "No microphones found" : "Allow mic access…"}</option>`;
    }
    let html = `<option value="">Default microphone</option>`;
    audioDevices.forEach((device) => {
      const label = device.label || `Mic ${device.deviceId.slice(0, 6)}`;
      const selected = device.deviceId === micDeviceId ? " selected" : "";
      html += `<option value="${escapeHtml(device.deviceId)}"${selected}>${escapeHtml(label)}</option>`;
    });
    return html;
  }

  function syncVideos() {
    DOCK_CAMERAS.forEach((camera) => {
      const slot = slots[camera.role];
      const video = root.querySelector(`[data-dock-video="${camera.role}"]`);
      if (video instanceof HTMLVideoElement) {
        if (slot.stream && video.srcObject !== slot.stream) {
          video.srcObject = slot.stream;
        } else if (!slot.stream && video.srcObject) {
          video.srcObject = null;
        }
        video.classList.toggle("bcc-dock-preview__video--flip", Boolean(slot.previewRotated));
      }
    });
  }

  function syncPublisherIframes() {
    DOCK_CAMERAS.forEach((camera) => {
      const slot = slots[camera.role];
      const iframe = root.querySelector(`[data-dock-iframe="${camera.role}"]`);
      if (!(iframe instanceof HTMLIFrameElement)) return;
      const next = slot.publisherUrl || "about:blank";
      if (iframe.getAttribute("data-current-src") !== next) {
        iframe.setAttribute("data-current-src", next);
        iframe.src = next;
        if (next !== "about:blank") {
          scheduleVdoIframeSilence(iframe);
          window.setTimeout(() => applyMuteToIframe(camera.role), 1500);
        }
      } else if (next !== "about:blank") {
        silenceVdoIframeOutput(iframe);
      }
    });
  }

  function patchStatusUi() {
    DOCK_CAMERAS.forEach((camera) => {
      const slot = slots[camera.role];
      const card = root.querySelector(`[data-dock-role="${camera.role}"]`);
      if (!card) return;

      const pub = card.querySelector("[data-dock-pub-badge]");
      if (pub) {
        const phase =
          slot.publisherStatus === "error"
            ? "down"
            : slot.publisherStatus === "paused" || slot.scenePaused
              ? "paused"
              : slot.vdoPhase ||
                (publisherIntentActive(slot) ? "starting" : "idle");
        pub.className = `bcc-badge bcc-badge--${publisherTone(phase)}`;
        pub.textContent =
          slot.publisherStatus === "error" ? "PUBLISHER ERROR" : publisherLabel(phase);
      }
      const obs = card.querySelector("[data-dock-obs-badge]");
      if (obs) {
        obs.className = `bcc-badge bcc-badge--${obsTone(slot.obsStatus)}`;
        obs.textContent = obsLabel(slot.obsStatus);
      }

      const meters = card.querySelector("[data-dock-meters]");
      if (meters) {
        const bars = bitrateToBars(slot.bitrateKbps, camera.targetBitrateKbps);
        const vdoLabel =
          slot.vdoPhase === "live"
            ? "LIVE"
            : slot.vdoPhase === "starting"
              ? "STARTING"
              : slot.vdoPhase === "paused"
                ? "IDLE"
                : slot.vdoPhase === "down"
                  ? "DOWN"
                  : "—";
        const vdoFps = slot.fps != null ? String(Math.round(slot.fps)) : "—";
        const vdoRate = formatBitrateKbps(slot.bitrateKbps);
        meters.innerHTML = `
          <div class="bcc-dock-preview__meter-text">
            <div>LOCAL: ${slot.localStatus === "ready" ? "CONNECTED" : "DISCONNECTED"}</div>
            <div>VDO: ${vdoLabel} · ${vdoFps} fps · ${vdoRate}</div>
          </div>
          ${renderSignalBars(bars)}
        `;
      }

      patchAudioUi(camera.role);

      const overlay = card.querySelector("[data-dock-overlay]");
      if (overlay) {
        if (slot.localStatus === "ready") {
          overlay.hidden = true;
          overlay.textContent = "";
        } else {
          overlay.hidden = false;
          overlay.textContent =
            slot.localStatus === "error"
              ? "Camera error — check connection"
              : "No local preview";
        }
      }

      const err = card.querySelector("[data-dock-error]");
      if (err) {
        if (slot.error) {
          err.hidden = false;
          err.textContent = slot.error;
        } else {
          err.hidden = true;
          err.textContent = "";
        }
      }

      const muteBtn = card.querySelector("[data-dock-mute]");
      if (muteBtn instanceof HTMLButtonElement) {
        muteBtn.disabled = slot.busy;
        muteBtn.setAttribute("aria-pressed", slot.muted ? "true" : "false");
        muteBtn.className = `btn bcc-dock-btn ${slot.muted ? "btn--danger" : "btn--secondary"}`;
        muteBtn.textContent = slot.muted ? "Audio Muted" : "Audio Live";
        muteBtn.title = slot.muted
          ? "Mic not sending — click to send mic to VDO (page stays silent)"
          : "Mic sending to VDO — click to mute uplink (page stays silent)";
      }
    });
    onStatusChange?.();
  }

  /**
   * Camera issue for the top status banner, or null when OK.
   * Alerts (down/error) beat warns (starting). Skips scene-paused cameras.
   * @returns {{ level: "alert" | "warn", message: string } | null}
   */
  function getBannerIssue() {
    /** @type {{ level: "warn", message: string } | null} */
    let warnIssue = null;

    for (const camera of DOCK_CAMERAS) {
      const slot = slots[camera.role];
      if (!slot?.deviceId) continue;
      if (slot.localStatus !== "ready" && !slot.scenePaused) continue;
      if (slot.scenePaused || slot.publisherStatus === "paused") continue;
      if (!cameraNeededInScene(camera)) continue;

      const label = camera.label.toUpperCase();

      if (slot.publisherStatus === "error" || slot.localStatus === "error") {
        return { level: "alert", message: `PUBLISHER ERROR — ${label}` };
      }

      const isStarting =
        slot.vdoPhase === "starting" ||
        (slot.publisherStatus === "starting" && slot.vdoPhase !== "down");
      if (isStarting) {
        if (!warnIssue) {
          warnIssue = { level: "warn", message: `PUBLISHER STARTING — ${label}` };
        }
        continue;
      }

      if (isPublisherWindowAlive()) {
        if (slot.vdoPhase === "down") {
          return { level: "alert", message: `PUBLISHER DOWN — ${label}` };
        }
        if (slot.obsStatus === "lost") {
          return { level: "alert", message: `OBS NOT RECEIVING — ${label}` };
        }
        continue;
      }

      if (slot.publisherStatus === "stopped") {
        return { level: "alert", message: `PUBLISHER STOPPED — ${label}` };
      }
      if (slot.vdoPhase === "down") {
        return { level: "alert", message: `PUBLISHER DOWN — ${label}` };
      }
      if (publisherIntentActive(slot) && slot.obsStatus === "lost") {
        return { level: "alert", message: `OBS NOT RECEIVING — ${label}` };
      }
    }
    return warnIssue;
  }

  function patchAudioUi(role) {
    const slot = slots[role];
    const card = root.querySelector(`[data-dock-role="${role}"]`);
    if (!card || !slot) return;
    const audio = card.querySelector("[data-dock-audio]");
    if (!audio) return;

    // Muted = no bars. Unmuted + live = show mic level.
    const bars =
      slot.localStatus === "ready" && !slot.muted
        ? audioLevelToBars(slot.audioLevel)
        : 0;
    const prevBars = lastAudioBars[role];
    const labelEl = audio.querySelector("[data-dock-audio-label]");
    const nextLabel = audioStatusLabel(slot);
    if (labelEl && labelEl.textContent !== nextLabel) {
      labelEl.textContent = nextLabel;
    }

    if (prevBars === bars) return;
    lastAudioBars[role] = bars;

    const signal = audio.querySelector(".bcc-signal");
    if (!signal) return;
    signal.setAttribute("aria-label", `Audio ${bars} of 5`);
    const barEls = signal.querySelectorAll(".bcc-signal__bar");
    barEls.forEach((bar, index) => {
      bar.classList.toggle("bcc-signal__bar--on", index < bars);
    });
  }

  function render() {
    if (destroyed) return;
    updateObsStatuses();

    const activeRole =
      document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
        ? document.activeElement.getAttribute("data-dock-camera") ||
          document.activeElement.getAttribute("data-dock-restart") ||
          document.activeElement.getAttribute("data-dock-stop")
        : null;

    root.innerHTML = `
      <div class="bcc-dock">
        <div class="bcc-dock-grid">
        ${DOCK_CAMERAS.map((camera) => {
          const slot = slots[camera.role];
          const otherRole = camera.role === "front" ? "dash" : "front";
          const bars = bitrateToBars(slot.bitrateKbps, camera.targetBitrateKbps);
          const audioBars =
            slot.localStatus === "ready" && !slot.muted
              ? audioLevelToBars(slot.audioLevel)
              : 0;
          lastAudioBars[camera.role] = audioBars;
          return `
            <article class="bcc-dock-card" data-dock-role="${escapeHtml(camera.role)}">
              <div class="bcc-dock-preview">
                <video class="bcc-dock-preview__video${slot.previewRotated ? " bcc-dock-preview__video--flip" : ""}" data-dock-video="${escapeHtml(camera.role)}" autoplay playsinline muted></video>
                <div class="bcc-dock-preview__title">${escapeHtml(camera.label)}</div>
                <button
                  type="button"
                  class="bcc-dock-preview__rotate"
                  data-dock-rotate="${escapeHtml(camera.role)}"
                  aria-label="Rotate ${escapeHtml(camera.label)} preview 180 degrees"
                  title="Rotate local preview 180°"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 5V2L8 6l4 4V7c3.31 0 6 2.69 6 6a6 6 0 0 1-9.33 4.98l-1.34 1.52A8 8 0 0 0 20 13c0-4.42-3.58-8-8-8z" fill="currentColor"/>
                    <path d="M12 19v3l4-4-4-4v3c-3.31 0-6-2.69-6-6a6 6 0 0 1 9.33-4.98l1.34-1.52A8 8 0 0 0 4 13c0 4.42 3.58 8 8 8z" fill="currentColor" opacity="0.55"/>
                  </svg>
                </button>
                <div class="bcc-dock-preview__badges">
                  <span class="bcc-badge" data-dock-pub-badge>${escapeHtml(
                    slot.publisherStatus === "error"
                      ? "PUBLISHER ERROR"
                      : publisherLabel(
                          slot.publisherStatus === "paused" || slot.scenePaused
                            ? "paused"
                            : slot.vdoPhase ||
                              (publisherIntentActive(slot) ? "starting" : "idle"),
                        ),
                  )}</span>
                  <span class="bcc-badge" data-dock-obs-badge>${escapeHtml(obsLabel(slot.obsStatus))}</span>
                </div>
                <div class="bcc-dock-preview__meters" data-dock-meters>
                  <div class="bcc-dock-preview__meter-text">
                    <div>LOCAL: ${slot.localStatus === "ready" ? "CONNECTED" : "DISCONNECTED"}</div>
                    <div>VDO: ${
                      slot.vdoPhase === "live"
                        ? "LIVE"
                        : slot.vdoPhase === "starting"
                          ? "STARTING"
                          : slot.vdoPhase === "paused"
                            ? "IDLE"
                            : slot.vdoPhase === "down"
                              ? "DOWN"
                              : "—"
                    } · ${
                      slot.fps != null ? escapeHtml(String(Math.round(slot.fps))) : "—"
                    } fps · ${escapeHtml(formatBitrateKbps(slot.bitrateKbps))}</div>
                  </div>
                  ${renderSignalBars(bars)}
                </div>
                <div class="bcc-dock-preview__audio" data-dock-audio>
                  <div class="bcc-dock-preview__meter-text">
                    <div>AUDIO</div>
                    <div data-dock-audio-label>${escapeHtml(audioStatusLabel(slot))}</div>
                  </div>
                  ${renderSignalBars(audioBars, "audio")}
                </div>
                <div class="bcc-dock-preview__overlay" data-dock-overlay ${slot.localStatus === "ready" ? "hidden" : ""}>
                  ${
                    slot.localStatus === "error"
                      ? "Camera error — check connection"
                      : "No local preview"
                  }
                </div>
                <iframe
                  class="bcc-dock-publisher"
                  data-dock-iframe="${escapeHtml(camera.role)}"
                  data-current-src="${escapeHtml(slot.publisherUrl || "about:blank")}"
                  title="${escapeHtml(camera.label)} VDO publisher"
                  allow="camera; microphone; autoplay; fullscreen"
                  src="${escapeHtml(slot.publisherUrl || "about:blank")}"
                ></iframe>
              </div>
              <div class="bcc-dock-controls">
                <div class="bcc-dock-controls__row">
                  <button type="button" class="btn btn--primary bcc-dock-btn" data-dock-restart="${escapeHtml(camera.role)}" ${slot.busy || !slot.deviceId ? "disabled" : ""}>Restart</button>
                  <button type="button" class="btn btn--secondary bcc-dock-btn" data-dock-stop="${escapeHtml(camera.role)}" ${slot.busy ? "disabled" : ""}>Stop</button>
                  <button
                    type="button"
                    class="btn bcc-dock-btn ${slot.muted ? "btn--danger" : "btn--secondary"}"
                    data-dock-mute="${escapeHtml(camera.role)}"
                    aria-pressed="${slot.muted ? "true" : "false"}"
                    title="${
                      slot.muted
                        ? "Mic not sending — click to send mic to VDO (page stays silent)"
                        : "Mic sending to VDO — click to mute uplink (page stays silent)"
                    }"
                    ${slot.busy ? "disabled" : ""}
                  >${slot.muted ? "Audio Muted" : "Audio Live"}</button>
                </div>
                <label class="bcc-dock-field">
                  <span>Cam</span>
                  <select data-dock-camera="${escapeHtml(camera.role)}" ${slot.busy ? "disabled" : ""}>
                    ${deviceOptions(slot.deviceId, slots[otherRole].deviceId)}
                  </select>
                </label>
                ${
                  camera.role === "front"
                    ? `
                <label class="bcc-dock-field">
                  <span>Mic</span>
                  <select data-dock-mic ${slot.busy ? "disabled" : ""}>
                    ${micOptions()}
                  </select>
                </label>`
                    : ""
                }
                <p class="bcc-inline-error" data-dock-error ${slot.error ? "" : "hidden"}>${escapeHtml(slot.error || "")}</p>
              </div>
            </article>
          `;
        }).join("")}
        </div>
      </div>
    `;

    built = true;
    bindEvents();
    syncVideos();
    patchStatusUi();

    if (activeRole) {
      const el = root.querySelector(`[data-dock-camera="${activeRole}"]`);
      if (el instanceof HTMLElement) el.focus();
    }
  }

  function bindEvents() {
    root.querySelectorAll("[data-dock-camera]").forEach((select) => {
      const ensureThenMaybeSet = () => {
        if (permissionGranted) return;
        void requestPermission();
      };
      select.addEventListener("pointerdown", ensureThenMaybeSet);
      select.addEventListener("focus", ensureThenMaybeSet);
      select.addEventListener("change", () => {
        const role = select.getAttribute("data-dock-camera");
        if (!role || !(select instanceof HTMLSelectElement)) return;
        void setCamera(role, select.value);
      });
    });

    const micSelect = root.querySelector("[data-dock-mic]");
    if (micSelect instanceof HTMLSelectElement) {
      const ensureMic = () => {
        if (permissionGranted) return;
        void requestPermission();
      };
      micSelect.addEventListener("pointerdown", ensureMic);
      micSelect.addEventListener("focus", ensureMic);
      micSelect.addEventListener("change", () => {
        void setMicrophone(micSelect.value);
      });
    }

    root.querySelectorAll("[data-dock-restart]").forEach((button) => {
      button.addEventListener("click", () => {
        const role = button.getAttribute("data-dock-restart");
        if (role) void restartPublisher(role);
      });
    });

    root.querySelectorAll("[data-dock-stop]").forEach((button) => {
      button.addEventListener("click", () => {
        const role = button.getAttribute("data-dock-stop");
        if (role) stopSlot(role);
      });
    });

    root.querySelectorAll("[data-dock-mute]").forEach((button) => {
      button.addEventListener("click", () => {
        const role = button.getAttribute("data-dock-mute");
        if (role) void toggleMute(role);
      });
    });

    root.querySelectorAll("[data-dock-rotate]").forEach((button) => {
      button.addEventListener("click", () => {
        const role = button.getAttribute("data-dock-rotate");
        if (!role || !slots[role]) return;
        slots[role].previewRotated = !slots[role].previewRotated;
        saveStoredPreviewRotated(role, slots[role].previewRotated);
        const video = root.querySelector(`[data-dock-video="${role}"]`);
        if (video instanceof HTMLVideoElement) {
          video.classList.toggle("bcc-dock-preview__video--flip", slots[role].previewRotated);
        }
      });
    });
  }

  function refreshDeviceSelects() {
    DOCK_CAMERAS.forEach((camera) => {
      const otherRole = camera.role === "front" ? "dash" : "front";
      const select = root.querySelector(`[data-dock-camera="${camera.role}"]`);
      if (!(select instanceof HTMLSelectElement)) return;
      const previous = select.value;
      select.innerHTML = deviceOptions(slots[camera.role].deviceId, slots[otherRole].deviceId);
      if (previous && [...select.options].some((opt) => opt.value === previous)) {
        select.value = previous;
      }
    });
    const micSelect = root.querySelector("[data-dock-mic]");
    if (micSelect instanceof HTMLSelectElement) {
      const previous = micSelect.value;
      micSelect.innerHTML = micOptions();
      if (previous && [...micSelect.options].some((opt) => opt.value === previous)) {
        micSelect.value = previous;
      } else if (micDeviceId) {
        micSelect.value = micDeviceId;
      }
    }
  }

  async function requestPermission() {
    try {
      devices = await ensureCameraPermission();
      audioDevices = await listAudioDevices();
      permissionGranted = true;
      if (micDeviceId) {
        const match = audioDevices.find((device) => device.deviceId === micDeviceId);
        if (match?.label) {
          micLabel = match.label;
          saveStoredMicLabel(micLabel);
        }
      }
      DOCK_CAMERAS.forEach((camera) => {
        const slot = slots[camera.role];
        if (slot.deviceId) {
          const match = devices.find((device) => device.deviceId === slot.deviceId);
          slot.deviceLabel = match?.label || null;
        }
        slot.error = null;
      });
      if (built) {
        refreshDeviceSelects();
        patchStatusUi();
      } else {
        render();
      }
    } catch (error) {
      permissionGranted = false;
      devices = [];
      audioDevices = [];
      DOCK_CAMERAS.forEach((camera) => {
        slots[camera.role].error =
          error instanceof Error ? error.message : "Camera permission denied";
      });
      if (built) {
        refreshDeviceSelects();
        patchStatusUi();
      } else {
        render();
      }
    }
  }

  async function setMicrophone(deviceId) {
    micDeviceId = deviceId || "";
    saveStoredMicDeviceId(micDeviceId);
    const match = audioDevices.find((device) => device.deviceId === micDeviceId);
    micLabel = match?.label || (micDeviceId ? micLabel : "");
    saveStoredMicLabel(micLabel);

    if (isPublisherWindowAlive()) {
      notifyPublisherWindowReload("mic-changed");
      await syncSharedAudioMonitor();
      patchStatusUi();
      return;
    }

    // Rebuild unmuted live publishers so VDO picks the new mic.
    DOCK_CAMERAS.forEach((camera) => {
      const slot = slots[camera.role];
      if (!publisherIntentActive(slot) || slot.muted || slot.scenePaused) return;
      slot.publisherUrl = buildPublisherUrlForSlot(camera, slot);
      slot.publisherStatus = "starting";
      slot.vdoPhase = "starting";
      syncVdoExpecting(camera.role);
    });
    syncPublisherIframes();
    await syncSharedAudioMonitor();
    patchStatusUi();
  }

  async function setCamera(role, deviceId) {
    const camera = cameraConfig(role);
    const slot = slots[role];
    if (!camera || !slot) return;

    slot.busy = true;
    slot.error = null;
    render();

    try {
      stopPublisher(role);
      stopStream(role);

      slot.deviceId = deviceId;
      saveStoredDeviceId(role, deviceId);

      if (!deviceId) {
        slot.localStatus = "idle";
        slot.deviceLabel = null;
        slot.scenePaused = false;
        slot.fps = null;
        slot.bitrateKbps = null;
        stopPublisher(role);
        if (isPublisherWindowAlive()) {
          notifyPublisherWindowReload("device-cleared");
        }
        return;
      }

      if (!permissionGranted) {
        devices = await ensureCameraPermission();
        permissionGranted = true;
      }

      const match = devices.find((device) => device.deviceId === deviceId);
      slot.deviceLabel = match?.label || null;
      const settings = defaultSettings(camera.targetBitrateKbps);
      const stream = await openCameraStream(deviceId, settings);
      slot.stream = stream;
      slot.localStatus = "ready";
      saveStoredSessionActive(true);

      // Outbound VDO fps comes from publisher iframe stats — clear until proven.
      slot.fps = null;
      slot.bitrateKbps = null;

      // Active scene does not use this camera — keep local preview, skip VDO uplink.
      if (!cameraNeededInScene(camera)) {
        slot.scenePaused = true;
        slot.publisherStatus = "paused";
        slot.publisherUrl = null;
        slot.vdoPhase = "paused";
        slot.vdoReason = "not-in-scene";
        syncVdoExpecting(role);
        if (isPublisherWindowAlive()) {
          notifyPublisherWindowReload("device-changed");
        }
        return;
      }

      slot.scenePaused = false;

      // Dedicated publisher window owns VDO push — avoid double-publishing the same room.
      if (isPublisherWindowAlive()) {
        slot.publisherStatus = "starting";
        slot.publisherUrl = null;
        slot.vdoPhase = "starting";
        syncVdoExpecting(role);
        notifyPublisherWindowReload("device-changed");
        scheduleObsBrowserRefresh(camera.obsSourceMatchers, { force: true });
        return;
      }

      slot.publisherStatus = "starting";
      slot.vdoPhase = "starting";
      slot.publisherUrl = buildPublisherUrlForSlot(camera, slot);
      syncVdoExpecting(role);

      window.setTimeout(() => {
        if (!slots[role].publisherUrl) return;
        applyMuteToIframe(role);
        void syncSharedAudioMonitor();
        scheduleObsBrowserRefresh(camera.obsSourceMatchers, { force: true });
        // Stay on "starting" until the VDO view monitor reports live.
        patchStatusUi();
      }, 1500);
    } catch (error) {
      slot.localStatus = "error";
      slot.publisherStatus = "error";
      slot.error = error instanceof Error ? error.message : "Failed to start camera";
      stopStream(role);
      stopPublisher(role);
    } finally {
      slot.busy = false;
      render();
      syncPublisherIframes();
      void syncSharedAudioMonitor();
    }
  }

  function applyMuteToIframe(role) {
    const slot = slots[role];
    const iframe = root.querySelector(`[data-dock-iframe="${role}"]`);
    if (iframe instanceof HTMLIFrameElement) {
      setVdoPublisherMuted(iframe, slot.muted);
      silenceVdoIframeOutput(iframe);
      scheduleVdoIframeSilence(iframe);
      const camera = cameraConfig(role);
      lockVdoPublisherBitrate(
        iframe,
        camera?.targetBitrateKbps || MAX_PUBLISH_BITRATE_KBPS,
      );
    }
  }

  async function toggleMute(role) {
    const camera = cameraConfig(role);
    const slot = slots[role];
    if (!camera || !slot || slot.busy) return;

    slot.muted = !slot.muted;
    saveStoredMuted(role, slot.muted);

    if (isPublisherWindowAlive()) {
      notifyPublisherWindowReload("mute-changed");
      patchStatusUi();
      return;
    }

    // Rebuild publisher URL when live so audiodevice / mute sticks.
    if (publisherIntentActive(slot) && !slot.scenePaused) {
      slot.publisherUrl = buildPublisherUrlForSlot(camera, slot);
      slot.publisherStatus = "starting";
      slot.vdoPhase = "starting";
      syncPublisherIframes();
      syncVdoExpecting(role);
      window.setTimeout(() => applyMuteToIframe(role), 800);
    } else {
      applyMuteToIframe(role);
    }

    await syncSharedAudioMonitor();
    patchStatusUi();
  }

  async function restartPublisher(role, { resetCooldown = true } = {}) {
    const slot = slots[role];
    if (!slot.deviceId) return;
    if (resetCooldown) {
      // Manual Restart — allow immediate follow-up recovers.
      lastHealthRecoverAt[role] = 0;
      lastSoftRecoverAt[role] = 0;
      publisherDownObsOkSince[role] = null;
    }
    // Hard tear-down so VDO drops the zombie push before we rejoin.
    stopPublisher(role);
    stopStream(role);
    slot.localStatus = "idle";
    slot.scenePaused = false;
    vdoMonitors[role]?.reload();
    await new Promise((r) => window.setTimeout(r, 600));
    await setCamera(role, slot.deviceId);
  }

  function refreshSessionFlag() {
    const anyActive = DOCK_CAMERAS.some((camera) => {
      const slot = slots[camera.role];
      return (
        Boolean(slot.deviceId) &&
        (publisherIntentActive(slot) ||
          slot.scenePaused ||
          slot.publisherStatus === "paused" ||
          slot.localStatus === "ready")
      );
    });
    saveStoredSessionActive(anyActive);
  }

  function softRestartPublisher(role) {
    if (isPublisherWindowAlive()) {
      notifyPublisherWindowReload("watchdog");
      vdoMonitors[role]?.reload();
      return;
    }
    const slot = slots[role];
    // Soft iframe reload is not enough when the push peer is dead — full restart.
    if (!slot.publisherUrl) {
      if (slot.deviceId) {
        void hardRecoverPublisher(role, "missing-publisher-url");
      }
      return;
    }
    const iframe = root.querySelector(`[data-dock-iframe="${role}"]`);
    if (iframe instanceof HTMLIFrameElement) {
      reloadPublisherIframe(iframe, slot.publisherUrl);
      slot.publisherStatus = "starting";
      slot.vdoPhase = "starting";
      syncVdoExpecting(role);
      window.setTimeout(() => {
        if (slots[role].publisherUrl) {
          applyMuteToIframe(role);
          scheduleObsBrowserRefresh(
            cameraConfig(role)?.obsSourceMatchers || ["truck_front", "truck_dash"],
            { force: true },
          );
          patchStatusUi();
        }
      }, 1500);
      patchStatusUi();
    }
  }

  async function hardRecoverPublisher(role, reason) {
    const slot = slots[role];
    if (!slot?.deviceId || slot.busy) return;
    if (slot.scenePaused || slot.publisherStatus === "paused") return;
    const camera = cameraConfig(role);
    if (camera && !cameraNeededInScene(camera)) return;

    const now = Date.now();
    const cooldown =
      reason === "obs-receiving-publisher-down" || reason === "missing-publisher-url"
        ? PUBLISHER_OBS_OK_RECOVER_COOLDOWN_MS
        : VDO_RECOVER_COOLDOWN_MS;
    if (now - (lastHealthRecoverAt[role] || 0) < cooldown) return;
    lastHealthRecoverAt[role] = now;
    lastSoftRecoverAt[role] = now;
    slot.error = `VDO publish lost (${reason}) — restarting camera…`;
    patchStatusUi();
    await restartPublisher(role, { resetCooldown: false });
    scheduleObsBrowserRefresh(
      cameraConfig(role)?.obsSourceMatchers || ["truck_front", "truck_dash"],
      { force: true },
    );
  }

  /**
   * If OBS still has this camera but VDO publish is down, force the same path as Restart.
   * @param {string} role
   * @param {string} phase
   */
  function maybeRecoverPublisherDownWhileObsOk(role, phase) {
    const slot = slots[role];
    const camera = cameraConfig(role);
    if (!slot || !camera || !publisherIntentActive(slot)) return;
    if (slot.scenePaused || slot.publisherStatus === "paused") return;
    if (!cameraNeededInScene(camera)) return;
    if (phase !== "down" || slot.obsStatus !== "receiving") {
      publisherDownObsOkSince[role] = null;
      return;
    }

    const now = Date.now();
    if (publisherDownObsOkSince[role] == null) {
      publisherDownObsOkSince[role] = now;
      return;
    }
    if (now - publisherDownObsOkSince[role] < PUBLISHER_DOWN_OBS_OK_RESTART_MS) return;
    publisherDownObsOkSince[role] = now;
    void hardRecoverPublisher(role, "obs-receiving-publisher-down");
  }

  function handOffToPublisherWindow() {
    const win = openCameraPublisherWindow();
    if (!win) {
      DOCK_CAMERAS.forEach((camera) => {
        slots[camera.role].error =
          "Popup blocked — allow popups for this site, then try Open camera publisher again.";
      });
      patchStatusUi();
      return false;
    }

    saveStoredSessionActive(true);
    // Stop in-page VDO publishers so only the popup pushes to VDO.
    DOCK_CAMERAS.forEach((camera) => {
      const slot = slots[camera.role];
      stopPublisher(camera.role);
      if (slot.deviceId && slot.localStatus === "ready") {
        if (cameraNeededInScene(camera)) {
          slot.scenePaused = false;
          slot.publisherStatus = "starting";
          slot.publisherUrl = null;
          slot.vdoPhase = "starting";
        } else {
          slot.scenePaused = true;
          slot.publisherStatus = "paused";
          slot.publisherUrl = null;
          slot.vdoPhase = "paused";
          slot.vdoReason = "not-in-scene";
        }
        syncVdoExpecting(camera.role);
      }
    });
    window.setTimeout(() => {
      notifyPublisherSceneNeeds(
        Object.fromEntries(
          DOCK_CAMERAS.map((camera) => [camera.role, cameraNeededInScene(camera)]),
        ),
      );
      notifyPublisherWindowReload("window-opened");
    }, 800);
    render();
    return true;
  }

  function tickWatchdog() {
    if (destroyed) return;
    updateObsStatuses();
    const now = Date.now();

    if (!navigator.onLine) {
      DOCK_CAMERAS.forEach((camera) => {
        const slot = slots[camera.role];
        if (publisherIntentActive(slot)) {
          // Status-only while offline — do not tear down publishers here.
          slot.vdoPhase = "down";
          slot.vdoReason = "offline";
        }
        syncVdoExpecting(camera.role);
      });
      if (built) patchStatusUi();
      return;
    }

    DOCK_CAMERAS.forEach((camera) => {
      const slot = slots[camera.role];
      if (!publisherIntentActive(slot)) {
        obsLostSince[camera.role] = null;
        publisherDownObsOkSince[camera.role] = null;
        syncVdoExpecting(camera.role);
        return;
      }

      syncVdoExpecting(camera.role);
      const health = vdoMonitors[camera.role]?.getState();
      const phase = health ? vdoHealthPhase(health) : slot.vdoPhase;
      slot.vdoPhase = phase;

      // Publisher down while OBS still receiving → full Restart (not soft iframe reload).
      maybeRecoverPublisherDownWhileObsOk(camera.role, phase);

      // Long OBS+VDO outage: soft reload only (no full camera tear-down).
      if (slot.obsStatus === "lost" || slot.obsStatus === "unknown") {
        if (obsLostSince[camera.role] == null) {
          obsLostSince[camera.role] = now;
        } else if (now - obsLostSince[camera.role] >= 45000 && phase === "down") {
          obsLostSince[camera.role] = now;
          softRestartPublisher(camera.role);
        }
      } else {
        obsLostSince[camera.role] = null;
      }
    });
    if (built) patchStatusUi();
  }

  function onOnline() {
    if (onlineTimer) window.clearTimeout(onlineTimer);
    onlineTimer = window.setTimeout(() => {
      DOCK_CAMERAS.forEach((camera) => {
        const slot = slots[camera.role];
        if (!slot.deviceId || !cameraNeededInScene(camera)) return;
        if (slot.publisherUrl || loadStoredSessionActive()) {
          lastHealthRecoverAt[camera.role] = 0;
          void hardRecoverPublisher(camera.role, "network-online");
        }
      });
    }, 2500);
  }

  function stopSlot(role) {
    const slot = slots[role];
    slot.busy = true;
    clearScenePauseTimer(role);
    slot.scenePaused = false;
    stopPublisher(role);
    stopStream(role);
    slot.localStatus = "idle";
    slot.fps = null;
    slot.bitrateKbps = null;
    slot.error = null;
    slot.busy = false;
    refreshSessionFlag();
    if (isPublisherWindowAlive()) {
      notifyPublisherWindowReload("stopped");
    }
    render();
  }

  function applyOutboundPublishStats(role, stats) {
    const slot = slots[role];
    if (!slot || !publisherIntentActive(slot)) return;
    if (stats.fps != null && stats.fps > 0) {
      slot.publishFps = stats.fps;
    }
    if (stats.bitrateKbps != null && stats.bitrateKbps > 0) {
      slot.publishBitrateKbps = stats.bitrateKbps;
    }
    const fromBytes = publishByteRate.push(role, stats.bytesSent ?? stats.bytesReceived ?? null);
    if (fromBytes != null) {
      slot.publishBitrateKbps = fromBytes;
    }
    syncDisplayedVdoMetrics(slot);
    if (built) patchStatusUi();
  }

  function onPublisherStatsMessage(event) {
    if (destroyed) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    const origin = String(event.origin || "");
    if (origin && !origin.includes("vdo.ninja")) return;

    DOCK_CAMERAS.forEach((camera) => {
      const iframe = root.querySelector(`[data-dock-iframe="${camera.role}"]`);
      if (!(iframe instanceof HTMLIFrameElement) || event.source !== iframe.contentWindow) {
        return;
      }
      const stats = interpretVdoPublisherStats(data, extractVdoStreamId(camera.pushUrl));
      if (
        stats.fps != null ||
        stats.bitrateKbps != null ||
        stats.bytesSent != null ||
        stats.bytesReceived != null
      ) {
        applyOutboundPublishStats(camera.role, stats);
      }
    });
  }

  function tickMetrics() {
    DOCK_CAMERAS.forEach((camera) => {
      const slot = slots[camera.role];
      if (!publisherIntentActive(slot)) {
        if (slot.vdoPhase !== "live") {
          slot.bitrateKbps = null;
          slot.fps = null;
        }
        return;
      }
      // Soft fps fallback: capture track rate while waiting for VDO outbound stats.
      if (slot.publishFps == null && slot.stream) {
        const track = slot.stream.getVideoTracks()[0];
        const settings = track?.getSettings?.() || {};
        if (typeof settings.frameRate === "number" && settings.frameRate > 0) {
          slot.publishFps = settings.frameRate;
          syncDisplayedVdoMetrics(slot);
        }
      }
      // In-page publisher: poll outbound stats from the push iframe.
      if (slot.publisherUrl) {
        const iframe = root.querySelector(`[data-dock-iframe="${camera.role}"]`);
        requestVdoPublisherStats(iframe instanceof HTMLIFrameElement ? iframe : null);
      }
    });
    if (built) {
      patchStatusUi();
    }
  }

  /** @type {BroadcastChannel | null} */
  let publisherStatsChannel = null;
  try {
    publisherStatsChannel = createPublisherChannel();
    if (publisherStatsChannel) {
      publisherStatsChannel.onmessage = (event) => {
        const data = event.data;
        if (!data || typeof data !== "object" || data.type !== "publish-stats") return;
        const role = typeof data.role === "string" ? data.role : "";
        if (!slots[role]) return;
        applyOutboundPublishStats(role, {
          fps: typeof data.fps === "number" ? data.fps : null,
          bitrateKbps: typeof data.bitrateKbps === "number" ? data.bitrateKbps : null,
          bytesSent: typeof data.bytesSent === "number" ? data.bytesSent : null,
          bytesReceived: typeof data.bytesReceived === "number" ? data.bytesReceived : null,
        });
      };
    }
  } catch {
    publisherStatsChannel = null;
  }

  metricsTimer = window.setInterval(tickMetrics, 1500);
  watchdogTimer = window.setInterval(tickWatchdog, 2000);
  window.addEventListener("online", onOnline);
  window.addEventListener("message", onPublisherStatsMessage);

  render();
  // Prompt for camera + mic as soon as BCC loads so device pickers populate.
  void requestPermission();
  void listVideoDevices().then((listed) => {
    if (destroyed || permissionGranted) return;
    if (listed.some((device) => device.label)) {
      devices = listed;
      permissionGranted = true;
      refreshDeviceSelects();
    }
  });

  // Resume publishers after returning to Broadcast (or refresh) when a dock session is active.
  // Skip in-page VDO if the dedicated publisher window already owns the feeds.
  // Start Truck Front before Truck Dash so the primary camera claims uplink first.
  if (loadStoredSessionActive() && !resumeStarted && !isPublisherWindowAlive()) {
    resumeStarted = true;
    window.setTimeout(() => {
      void (async () => {
        for (const camera of DOCK_CAMERAS) {
          if (destroyed) return;
          const deviceId = loadStoredDeviceId(camera.role);
          if (deviceId) {
            await setCamera(camera.role, deviceId);
            await new Promise((r) => window.setTimeout(r, 400));
          }
        }
      })();
    }, 400);
  }

  return {
    render,
    requestPermission,
    openPublisherWindow: handOffToPublisherWindow,
    getBannerIssue,
    refreshObs() {
      updateObsStatuses();
      if (built) {
        patchStatusUi();
      }
    },
    /** @param {Array<{ link_key?: string, push_url?: string }> | null | undefined} links */
    applyVdoLinks(links) {
      if (!links?.length) return;
      DOCK_CAMERAS.forEach((camera) => {
        const match = links.find((link) => link.link_key === camera.linkKey);
        if (match?.push_url) {
          camera.pushUrl = match.push_url;
        }
      });
    },
    destroy() {
      destroyed = true;
      if (metricsTimer) {
        window.clearInterval(metricsTimer);
      }
      if (watchdogTimer) {
        window.clearInterval(watchdogTimer);
      }
      if (onlineTimer) {
        window.clearTimeout(onlineTimer);
      }
      DOCK_CAMERAS.forEach((camera) => clearScenePauseTimer(camera.role));
      window.removeEventListener("online", onOnline);
      window.removeEventListener("message", onPublisherStatsMessage);
      try {
        publisherStatsChannel?.close();
      } catch {
        /* ignore */
      }
      publisherStatsChannel = null;
      // Keep session_active so other pages resume publishers.
      DOCK_CAMERAS.forEach((camera) => {
        stopPublisher(camera.role);
        vdoMonitors[camera.role]?.destroy();
        delete vdoMonitors[camera.role];
        if (slots[camera.role].stream) {
          slots[camera.role].stream.getTracks().forEach((track) => track.stop());
          slots[camera.role].stream = null;
        }
      });
      void sharedAudioMonitor?.stop();
      sharedAudioMonitor = null;
    },
  };
}
