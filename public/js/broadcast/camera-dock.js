import {
  DOCK_CAMERAS,
  audioLevelToBars,
  bitrateToBars,
  buildVdoPublisherUrl,
  createAudioLevelMonitor,
  defaultSettings,
  ensureCameraPermission,
  estimateMetrics,
  listVideoDevices,
  loadStoredDeviceId,
  loadStoredMuted,
  loadStoredSessionActive,
  isPublisherWindowAlive,
  notifyPublisherWindowReload,
  openCameraStream,
  openCameraPublisherWindow,
  reloadPublisherIframe,
  resolveObsReceiveStatus,
  saveStoredDeviceId,
  saveStoredMuted,
  saveStoredSessionActive,
  setVdoPublisherMuted,
} from "./camera-dock-model.js";
import { scheduleObsBrowserRefresh } from "./obs-browser-refresh.js";
import { escapeHtml } from "./ui-utils.js";

function emptySlot(role) {
  return {
    role,
    deviceId: loadStoredDeviceId(role),
    deviceLabel: null,
    localStatus: "idle",
    publisherStatus: "stopped",
    obsStatus: "unknown",
    fps: null,
    bitrateKbps: null,
    audioLevel: 0,
    busy: false,
    error: null,
    stream: null,
    publisherUrl: null,
    muted: loadStoredMuted(role),
  };
}

function publisherLabel(status) {
  switch (status) {
    case "publishing":
      return "PUBLISHER LIVE";
    case "starting":
      return "PUBLISHER STARTING";
    case "error":
      return "PUBLISHER ERROR";
    default:
      return "PUBLISHER STOPPED";
  }
}

function publisherTone(status) {
  if (status === "publishing") return "healthy";
  if (status === "starting") return "stale";
  if (status === "error") return "disconnected";
  return "disconnected";
}

function obsLabel(status) {
  if (status === "receiving") return "OBS RECEIVING";
  if (status === "lost") return "OBS LOST";
  return "OBS UNKNOWN";
}

function obsTone(status) {
  if (status === "receiving") return "healthy";
  if (status === "lost") return "stale";
  return "unavailable";
}

/**
 * @param {HTMLElement | null} root
 * @param {() => { sources?: Array<{name?: string, visible?: boolean}>, obsConnected?: boolean }} getObsSnapshot
 */
export function createCameraDock(root, getObsSnapshot) {
  if (!root) {
    return {
      destroy() {},
      refreshObs() {},
      render() {},
      requestPermission() {},
      openPublisherWindow() {
        return false;
      },
    };
  }

  const slots = {};
  DOCK_CAMERAS.forEach((camera) => {
    slots[camera.role] = emptySlot(camera.role);
  });

  let devices = [];
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
  let watchdogTimer = 0;
  let onlineTimer = 0;
  let resumeStarted = false;

  function cameraConfig(role) {
    return DOCK_CAMERAS.find((camera) => camera.role === role);
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
      });
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
    const iframe = root.querySelector(`[data-dock-iframe="${role}"]`);
    if (iframe instanceof HTMLIFrameElement) {
      iframe.src = "about:blank";
    }
  }

  function updateObsStatuses() {
    const snapshot = getObsSnapshot() || {};
    DOCK_CAMERAS.forEach((camera) => {
      slots[camera.role].obsStatus = resolveObsReceiveStatus(
        snapshot.sources,
        camera.obsSourceMatchers,
        Boolean(snapshot.obsConnected),
      );
    });
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
    if (slot.localStatus !== "ready") return "OFF";
    if (slot.muted) return "MUTED";
    const bars = audioLevelToBars(slot.audioLevel);
    return bars > 0 ? "LIVE" : "SILENT";
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
        pub.className = `bcc-badge bcc-badge--${publisherTone(slot.publisherStatus)}`;
        pub.textContent = publisherLabel(slot.publisherStatus);
      }
      const obs = card.querySelector("[data-dock-obs-badge]");
      if (obs) {
        obs.className = `bcc-badge bcc-badge--${obsTone(slot.obsStatus)}`;
        obs.textContent = obsLabel(slot.obsStatus);
      }

      const meters = card.querySelector("[data-dock-meters]");
      if (meters) {
        const bars = bitrateToBars(slot.bitrateKbps, camera.targetBitrateKbps);
        meters.innerHTML = `
          <div class="bcc-dock-preview__meter-text">
            <div>LOCAL: ${slot.localStatus === "ready" ? "CONNECTED" : "DISCONNECTED"}</div>
            <div>FPS: ${slot.fps == null ? "—" : String(Math.round(slot.fps))}</div>
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
        muteBtn.textContent = slot.muted ? "Muted" : "Mute";
        muteBtn.title = slot.muted
          ? "Audio off — not sending mic"
          : "Click to mute and stop sending audio";
      }
    });
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
                <video class="bcc-dock-preview__video" data-dock-video="${escapeHtml(camera.role)}" autoplay playsinline muted></video>
                <div class="bcc-dock-preview__title">${escapeHtml(camera.label)}</div>
                <div class="bcc-dock-preview__badges">
                  <span class="bcc-badge" data-dock-pub-badge>${escapeHtml(publisherLabel(slot.publisherStatus))}</span>
                  <span class="bcc-badge" data-dock-obs-badge>${escapeHtml(obsLabel(slot.obsStatus))}</span>
                </div>
                <div class="bcc-dock-preview__meters" data-dock-meters>
                  <div class="bcc-dock-preview__meter-text">
                    <div>LOCAL: ${slot.localStatus === "ready" ? "CONNECTED" : "DISCONNECTED"}</div>
                    <div>FPS: ${slot.fps == null ? "—" : escapeHtml(String(Math.round(slot.fps)))}</div>
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
                    title="${slot.muted ? "Audio off — not sending mic" : "Click to mute and stop sending audio"}"
                    ${slot.busy ? "disabled" : ""}
                  >${slot.muted ? "Muted" : "Mute"}</button>
                </div>
                <label class="bcc-dock-field">
                  <span>Camera</span>
                  <select data-dock-camera="${escapeHtml(camera.role)}" ${slot.busy ? "disabled" : ""}>
                    ${deviceOptions(slot.deviceId, slots[otherRole].deviceId)}
                  </select>
                </label>
                <p class="bcc-inline-error" data-dock-error ${slot.error ? "" : "hidden"}>${escapeHtml(slot.error || "")}</p>
              </div>
            </article>
          `;
        }).join("")}
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
      select.addEventListener("change", () => {
        const role = select.getAttribute("data-dock-camera");
        if (!role || !(select instanceof HTMLSelectElement)) return;
        void setCamera(role, select.value);
      });
    });

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
  }

  async function requestPermission() {
    try {
      devices = await ensureCameraPermission();
      permissionGranted = true;
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
        slot.fps = null;
        slot.bitrateKbps = null;
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

      // Dedicated publisher window owns VDO push — avoid double-publishing the same room.
      if (isPublisherWindowAlive()) {
        slot.publisherStatus = "publishing";
        slot.publisherUrl = null;
        const metrics = estimateMetrics(stream, camera.targetBitrateKbps, true);
        slot.fps = metrics.fps;
        slot.bitrateKbps = metrics.bitrateKbps;
        notifyPublisherWindowReload("device-changed");
        return;
      }

      slot.publisherStatus = "starting";
      slot.publisherUrl = buildVdoPublisherUrl(
        camera.pushUrl,
        slot.deviceLabel,
        settings,
        slot.muted,
      );
      const metrics = estimateMetrics(stream, camera.targetBitrateKbps, true);
      slot.fps = metrics.fps;
      slot.bitrateKbps = metrics.bitrateKbps;

      window.setTimeout(() => {
        if (slots[role].publisherUrl) {
          slots[role].publisherStatus = "publishing";
          saveStoredSessionActive(true);
          applyMuteToIframe(role);
          void syncSharedAudioMonitor();
          scheduleObsBrowserRefresh(
            cameraConfig(role)?.obsSourceMatchers || ["truck_front", "truck_dash"],
          );
          patchStatusUi();
        }
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

    // Rebuild publisher URL when live so audiodevice=0 / mute sticks.
    if (slot.publisherStatus === "publishing" || slot.publisherStatus === "starting") {
      const settings = defaultSettings(camera.targetBitrateKbps);
      slot.publisherUrl = buildVdoPublisherUrl(
        camera.pushUrl,
        slot.deviceLabel,
        settings,
        slot.muted,
      );
      syncPublisherIframes();
      window.setTimeout(() => applyMuteToIframe(role), 800);
    } else {
      applyMuteToIframe(role);
    }

    await syncSharedAudioMonitor();
    patchStatusUi();
  }

  async function restartPublisher(role) {
    const slot = slots[role];
    if (!slot.deviceId) return;
    await setCamera(role, slot.deviceId);
  }

  function refreshSessionFlag() {
    const anyPublishing = DOCK_CAMERAS.some((camera) => {
      const slot = slots[camera.role];
      return slot.publisherStatus === "publishing" || slot.publisherStatus === "starting";
    });
    saveStoredSessionActive(anyPublishing);
  }

  function softRestartPublisher(role) {
    if (isPublisherWindowAlive()) {
      notifyPublisherWindowReload("watchdog");
      return;
    }
    const slot = slots[role];
    if (!slot.publisherUrl) return;
    const iframe = root.querySelector(`[data-dock-iframe="${role}"]`);
    if (iframe instanceof HTMLIFrameElement) {
      reloadPublisherIframe(iframe, slot.publisherUrl);
      slot.publisherStatus = "starting";
      window.setTimeout(() => {
        if (slots[role].publisherUrl) {
          slots[role].publisherStatus = "publishing";
          applyMuteToIframe(role);
          scheduleObsBrowserRefresh(
            cameraConfig(role)?.obsSourceMatchers || ["truck_front", "truck_dash"],
          );
          patchStatusUi();
        }
      }, 1500);
      patchStatusUi();
    }
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
        slot.publisherStatus = "publishing";
        slot.publisherUrl = null;
      }
    });
    window.setTimeout(() => notifyPublisherWindowReload("window-opened"), 800);
    render();
    return true;
  }

  function tickWatchdog() {
    if (destroyed || !navigator.onLine) return;
    updateObsStatuses();
    const now = Date.now();
    DOCK_CAMERAS.forEach((camera) => {
      const slot = slots[camera.role];
      if (slot.publisherStatus !== "publishing" && slot.publisherStatus !== "starting") {
        obsLostSince[camera.role] = null;
        return;
      }
      if (slot.obsStatus === "lost" || slot.obsStatus === "unknown") {
        if (obsLostSince[camera.role] == null) {
          obsLostSince[camera.role] = now;
        } else if (now - obsLostSince[camera.role] >= 15000) {
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
        if (slot.deviceId && (slot.publisherUrl || loadStoredSessionActive())) {
          void restartPublisher(camera.role);
        }
      });
    }, 2500);
  }

  function stopSlot(role) {
    const slot = slots[role];
    slot.busy = true;
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

  function tickMetrics() {
    DOCK_CAMERAS.forEach((camera) => {
      const slot = slots[camera.role];
      const publishing =
        slot.publisherStatus === "publishing" || slot.publisherStatus === "starting";
      const metrics = estimateMetrics(slot.stream, camera.targetBitrateKbps, publishing);
      slot.fps = metrics.fps;
      if (publishing) {
        slot.bitrateKbps = metrics.bitrateKbps;
      } else {
        slot.bitrateKbps = null;
      }
    });
    if (built) {
      patchStatusUi();
    }
  }

  metricsTimer = window.setInterval(tickMetrics, 2500);
  watchdogTimer = window.setInterval(tickWatchdog, 5000);
  window.addEventListener("online", onOnline);

  render();
  void listVideoDevices().then((listed) => {
    if (destroyed) return;
    if (listed.some((device) => device.label)) {
      devices = listed;
      permissionGranted = true;
      refreshDeviceSelects();
    }
  });

  // Resume publishers after returning to Broadcast (or refresh) when a dock session is active.
  // Skip in-page VDO if the dedicated publisher window already owns the feeds.
  if (loadStoredSessionActive() && !resumeStarted && !isPublisherWindowAlive()) {
    resumeStarted = true;
    window.setTimeout(() => {
      DOCK_CAMERAS.forEach((camera) => {
        const deviceId = loadStoredDeviceId(camera.role);
        if (deviceId) {
          void setCamera(camera.role, deviceId);
        }
      });
    }, 400);
  }

  return {
    render,
    requestPermission,
    openPublisherWindow: handOffToPublisherWindow,
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
      window.removeEventListener("online", onOnline);
      // Keep session_active so other pages resume publishers.
      DOCK_CAMERAS.forEach((camera) => {
        stopPublisher(camera.role);
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
