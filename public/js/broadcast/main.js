import { BroadcastApi } from "./api.js";
import { createCameraDock } from "./camera-dock.js";
import { renderHeader, renderHealthCards } from "./header.js";
import { renderSceneSwitcher, renderSources } from "./scenes-sources.js";
import {
  renderEventLog,
  renderStats,
  renderStreamControls,
  renderTelemetry,
} from "./panels.js";
import { createScheduleModal } from "./schedule-modal.js";
import { renderSettings } from "./settings.js";
import { createStartWorkflow } from "./start-workflow.js";
import { renderVdoLinks } from "./vdo-links.js";
import { mergeEventLog, nextPollDelay } from "./status-model.js";
import { formatClock } from "./ui-utils.js";

const WORKFLOW_ACTIVE_STATUSES = new Set([
  "selected",
  "preparing",
  "prepared",
  "starting_output",
  "waiting_for_ingest",
  "ready_to_go_live",
  "going_live",
  "live",
  "ending",
]);

const state = {
  data: null,
  error: null,
  lastSuccessAt: null,
  reconnecting: false,
  sceneBusy: false,
  sceneError: null,
  controlBusy: false,
  controlError: null,
  settingsSaving: false,
  settingsTesting: false,
  settingsError: null,
  settingsMessage: null,
  vdoBusyKey: null,
  vdoError: null,
  vdoMessage: null,
  eventLog: [],
  failures: 0,
  clockText: formatClock(),
  pollTimer: null,
  clockTimer: null,
  destroyed: false,
};

const root = document.getElementById("broadcast-control-root");

/** @type {ReturnType<typeof createCameraDock> | null} */
let cameraDock = null;
/** @type {ReturnType<typeof createScheduleModal> | null} */
let scheduleModal = null;
/** @type {ReturnType<typeof createStartWorkflow> | null} */
let startWorkflow = null;

function hasActiveWorkflow() {
  const wf = state.data?.activeWorkflow;
  return Boolean(wf && WORKFLOW_ACTIVE_STATUSES.has(wf.status));
}

function pushLocalEvent(category, message, severity = "information") {
  state.eventLog = mergeEventLog(
    state.eventLog,
    [
      {
        id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: new Date().toISOString(),
        category,
        message,
        severity,
      },
    ],
    150,
  );
}

function renderSettingsPanel(force = false) {
  const container = root?.querySelector("[data-bcc-settings]");
  if (!container) return;
  const form = container.querySelector("form");
  if (!force && form && form.contains(document.activeElement)) {
    return;
  }
  renderSettings(
    container,
    state.data?.settings,
    {
      saving: state.settingsSaving,
      testing: state.settingsTesting,
      error: state.settingsError,
      message: state.settingsMessage,
    },
    saveSettings,
    testConnection,
    state.data?.youtube,
    {
      onConnect: () => {
        window.location.href = "/api/broadcast/youtube/oauth/start";
      },
      onDisconnect: () => {
        void disconnectYoutube();
      },
    },
  );
}

function renderVdoPanel(force = false) {
  const container = root?.querySelector("[data-bcc-vdo-links]");
  if (!container) return;
  if (!force && state.vdoBusyKey && container.querySelector(`[data-vdo-activate="${state.vdoBusyKey}"]`)) {
    // still re-render when busy so button label updates
  }
  renderVdoLinks(
    container,
    state.data?.vdoLinks || [],
    {
      busyKey: state.vdoBusyKey,
      error: state.vdoError,
      message: state.vdoMessage,
    },
    activateVdoLink,
  );
}

function renderAll() {
  if (!root || state.destroyed) return;

  renderHeader(root, state);
  renderHealthCards(root.querySelector("[data-bcc-health]"), state.data?.health || []);
  renderSceneSwitcher(root.querySelector("[data-bcc-scenes]"), state, activateScene);
  renderSources(root.querySelector("[data-bcc-sources]"), state, {
    setVisibility,
    setMute,
    refreshStatus: () => refresh(true),
    refreshSource,
  });
  renderStats(
    root.querySelector("[data-bcc-stats]"),
    state.data?.listener?.stats,
    Boolean(state.data?.listener?.obsConnected),
  );
  renderStreamControls(root.querySelector("[data-bcc-controls]"), state, {
    startStream,
    stopStream,
    startRecording,
    stopRecording,
    reconnect,
    refresh,
    scheduleBroadcast: () => scheduleModal?.open(),
    openStartWorkflow: () => void startWorkflow?.open(),
    hasActiveWorkflow,
    allowCameras: () => {
      void cameraDock?.requestPermission?.();
    },
    openPublisherWindow: () => {
      const opened = cameraDock?.openPublisherWindow?.();
      if (opened) {
        pushLocalEvent(
          "dock",
          "Camera publisher window opened — leave it open while browsing other pages",
          "success",
        );
        renderEventLog(root.querySelector("[data-bcc-events]"), state.eventLog);
      }
    },
  });
  renderTelemetry(root.querySelector("[data-bcc-telemetry]"), state.data?.telemetry);
  renderEventLog(root.querySelector("[data-bcc-events]"), state.eventLog);
  renderSettingsPanel(false);
  renderVdoPanel(false);
  if (cameraDock) {
    cameraDock.applyVdoLinks?.(state.data?.vdoLinks);
    cameraDock.refreshObs();
  }
}

async function refresh(force = false) {
  if (state.destroyed) return;
  try {
    const data = await BroadcastApi.getStatus(force);
    const wasOffline = state.reconnecting || state.failures > 0;
    state.data = data;
    state.error = null;
    state.lastSuccessAt = new Date().toISOString();
    state.reconnecting = false;
    state.failures = 0;
    state.eventLog = mergeEventLog(state.eventLog, data.listener?.events || [], 150);
    if (wasOffline) {
      pushLocalEvent("listener", "Automatic reconnection succeeded", "success");
    }
    const scenes = (data.listener?.scenes || []).map((s) => (typeof s === "string" ? s : s?.name)).filter(Boolean);
    scheduleModal?.setScenes?.(scenes);
    renderAll();
  } catch (error) {
    state.failures += 1;
    state.reconnecting = true;
    state.error = error instanceof Error ? error.message : "Status request failed";
    pushLocalEvent("api", state.error, "error");
    if (state.failures === 1) {
      pushLocalEvent("listener", "Automatic reconnection attempted", "warning");
    }
    renderAll();
  }
}

function schedulePoll() {
  if (state.destroyed) return;
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
  }
  const delay = nextPollDelay(state.failures === 0 && !state.error, state.failures);
  state.pollTimer = setTimeout(async () => {
    await refresh(false);
    schedulePoll();
  }, delay);
}

async function testConnection() {
  state.settingsTesting = true;
  state.settingsError = null;
  state.settingsMessage = null;
  renderSettingsPanel(true);
  try {
    const data = await BroadcastApi.getStatus(true);
    state.data = data;
    const listener = data.listener || {};
    if (!data.configured) {
      state.settingsError =
        "Listener URL/token not saved yet. Save Settings first (tunnel HTTPS URL + matching token).";
    } else if (!listener.listenerConnected) {
      state.settingsError =
        listener.error ||
        "Worker cannot reach the listener. Confirm the Quick Tunnel is running and the Listener URL is correct.";
    } else if (!listener.obsConnected) {
      state.settingsMessage =
        "Listener online. OBS is still disconnected — enable WebSocket in OBS and save the OBS password in Settings.";
      pushLocalEvent("settings", "Listener reachable; OBS not connected", "warning");
    } else {
      state.settingsMessage = "Connection OK — listener online and OBS connected.";
      pushLocalEvent("settings", "Listener and OBS connection OK", "success");
    }
    renderAll();
  } catch (error) {
    state.settingsError = error instanceof Error ? error.message : "Connection test failed";
    pushLocalEvent("settings", state.settingsError, "error");
    renderSettingsPanel(true);
  } finally {
    state.settingsTesting = false;
    renderSettingsPanel(true);
  }
}

async function disconnectYoutube() {
  if (!window.confirm("Disconnect YouTube from Broadcast Control?")) return;
  state.settingsSaving = true;
  state.settingsError = null;
  state.settingsMessage = null;
  renderSettingsPanel(true);
  try {
    const result = await BroadcastApi.disconnectYoutube();
    if (state.data) {
      state.data.youtube = result.youtube;
    }
    state.settingsMessage = "YouTube disconnected.";
    pushLocalEvent("settings", "YouTube disconnected", "information");
  } catch (error) {
    state.settingsError = error instanceof Error ? error.message : "Disconnect failed";
  } finally {
    state.settingsSaving = false;
    renderSettingsPanel(true);
  }
}

async function saveSettings(payload) {
  state.settingsSaving = true;
  state.settingsError = null;
  state.settingsMessage = null;
  renderSettingsPanel(true);
  try {
    const body = {
      listener_url: payload.listener_url || "",
      obs_host: payload.obs_host || "127.0.0.1",
      obs_port: payload.obs_port || "4455",
      obs_reconnect_ms: payload.obs_reconnect_ms || "3000",
    };
    if (payload.listener_token && payload.listener_token.trim()) {
      body.listener_token = payload.listener_token.trim();
    }
    if (payload.obs_password) {
      body.obs_password = payload.obs_password;
    }

    const result = await BroadcastApi.saveSettings(body);
    if (state.data) {
      state.data.settings = result.settings;
    } else {
      state.data = { settings: result.settings };
    }
    state.settingsMessage = "Settings saved. Listener will pick up OBS changes within about 15 seconds.";
    pushLocalEvent("settings", "Broadcast settings saved", "success");
    await refresh(true);
  } catch (error) {
    state.settingsError = error instanceof Error ? error.message : "Failed to save settings";
    pushLocalEvent("settings", state.settingsError, "error");
  } finally {
    state.settingsSaving = false;
    renderSettingsPanel(true);
  }
}

async function activateVdoLink(linkKey) {
  state.vdoBusyKey = linkKey;
  state.vdoError = null;
  state.vdoMessage = null;
  renderVdoPanel(true);
  try {
    const result = await BroadcastApi.activateVdoLink(linkKey);
    if (state.data) {
      state.data.vdoLinks = result.links;
    } else {
      state.data = { vdoLinks: result.links };
    }
    const active = (result.links || []).find((link) => link.link_key === linkKey);
    state.vdoMessage = active
      ? `Primary send link: ${active.display_name}`
      : "Primary send link updated";
    pushLocalEvent("vdo", state.vdoMessage, "success");
  } catch (error) {
    state.vdoError = error instanceof Error ? error.message : "Failed to activate VDO link";
    pushLocalEvent("vdo", state.vdoError, "error");
  } finally {
    state.vdoBusyKey = null;
    renderVdoPanel(true);
  }
}

async function activateScene(sceneName) {
  state.sceneBusy = true;
  state.sceneError = null;
  renderAll();
  try {
    await BroadcastApi.activateScene(sceneName);
    pushLocalEvent("scene", `Requested scene ${sceneName}`, "information");
    await refresh(true);
  } catch (error) {
    state.sceneError = error instanceof Error ? error.message : "Scene change failed";
    pushLocalEvent("scene", state.sceneError, "error");
  } finally {
    state.sceneBusy = false;
    renderAll();
  }
}

async function setVisibility(sourceName, visible) {
  try {
    await BroadcastApi.setSourceVisibility(sourceName, visible);
    pushLocalEvent("source", `${visible ? "Show" : "Hide"} ${sourceName}`, "information");
    await refresh(true);
  } catch (error) {
    pushLocalEvent(
      "source",
      error instanceof Error ? error.message : "Visibility change failed",
      "error",
    );
    renderAll();
  }
}

async function setMute(sourceName, muted) {
  try {
    await BroadcastApi.setSourceMute(sourceName, muted);
    pushLocalEvent("audio", `${muted ? "Mute" : "Unmute"} ${sourceName}`, "information");
    await refresh(true);
  } catch (error) {
    pushLocalEvent(
      "audio",
      error instanceof Error ? error.message : "Mute change failed",
      "error",
    );
    renderAll();
  }
}

async function refreshSource(sourceName) {
  try {
    await BroadcastApi.refreshSource({ sourceName });
    pushLocalEvent("source", `Refreshed OBS browser source ${sourceName}`, "success");
    await refresh(true);
  } catch (error) {
    pushLocalEvent(
      "source",
      error instanceof Error ? error.message : "Browser source refresh failed",
      "error",
    );
    renderAll();
  }
}

async function runControl(action, fn) {
  state.controlBusy = true;
  state.controlError = null;
  renderAll();
  try {
    await fn();
    await refresh(true);
  } catch (error) {
    state.controlError = error instanceof Error ? error.message : `${action} failed`;
    pushLocalEvent("control", state.controlError, "error");
  } finally {
    state.controlBusy = false;
    renderAll();
  }
}

const startStream = () => {
  void startWorkflow?.open();
};
const stopStream = () => runControl("stop stream", () => BroadcastApi.stopStream());
const startRecording = () => runControl("start recording", () => BroadcastApi.startRecording());
const stopRecording = () => runControl("stop recording", () => BroadcastApi.stopRecording());
const reconnect = () =>
  runControl("reconnect", async () => {
    pushLocalEvent("listener", "Manual reconnect requested", "information");
    await BroadcastApi.reconnect();
  });

function startClock() {
  state.clockTimer = setInterval(() => {
    state.clockText = formatClock();
    const clockEl = root?.querySelector("[data-bcc-clock]");
    if (clockEl) clockEl.textContent = state.clockText;
  }, 1000);
}

function bindTabs() {
  if (!root) return;
  const buttons = root.querySelectorAll("[data-bcc-tab]");
  if (!buttons.length) return;

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.getAttribute("data-bcc-tab");
      if (!tab) return;
      buttons.forEach((btn) => {
        const active = btn.getAttribute("data-bcc-tab") === tab;
        btn.classList.toggle("bcc-tabs__btn--active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
        btn.tabIndex = active ? 0 : -1;
      });
      root.querySelectorAll("[data-bcc-tab-panel]").forEach((panel) => {
        const show = panel.getAttribute("data-bcc-tab-panel") === tab;
        if (show) {
          panel.removeAttribute("hidden");
        } else {
          panel.setAttribute("hidden", "");
        }
      });
      if (tab === "settings") {
        renderSettingsPanel(true);
      }
      if (tab === "vdo") {
        renderVdoPanel(true);
      }
    });
  });
}

function destroy() {
  state.destroyed = true;
  if (state.pollTimer) clearTimeout(state.pollTimer);
  if (state.clockTimer) clearInterval(state.clockTimer);
  if (cameraDock) {
    cameraDock.destroy();
    cameraDock = null;
  }
}

window.addEventListener("pagehide", destroy);

async function init() {
  if (!root) return;
  cameraDock = createCameraDock(root.querySelector("[data-bcc-camera-dock]"), () => ({
    sources: state.data?.listener?.sources || [],
    obsConnected: Boolean(state.data?.listener?.obsConnected),
  }));
  scheduleModal = createScheduleModal(document.getElementById("bcc-schedule-dialog"), {
    scenes: [],
    onSelected: () => {
      void refresh(true);
    },
  });
  startWorkflow = createStartWorkflow(document.getElementById("bcc-start-workflow-dialog"), {
    getStatus: () => state.data,
    openSchedule: () => scheduleModal?.open(),
    onChanged: () => {
      void refresh(true);
    },
  });
  bindTabs();
  pushLocalEvent("ui", "Broadcast Control Center loaded", "information");
  const youtubeParam = new URLSearchParams(window.location.search).get("youtube");
  if (youtubeParam === "connected") {
    state.settingsMessage = "YouTube connected successfully.";
    pushLocalEvent("settings", "YouTube connected", "success");
    window.history.replaceState({}, "", "/broadcast/control/");
  } else if (youtubeParam === "error") {
    const message = new URLSearchParams(window.location.search).get("message") || "YouTube connect failed";
    state.settingsError = message;
    pushLocalEvent("settings", message, "error");
    window.history.replaceState({}, "", "/broadcast/control/");
  }
  renderAll();
  startClock();
  await refresh(true);
  schedulePoll();
}

init();
