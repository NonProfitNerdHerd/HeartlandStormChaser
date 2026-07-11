/** @typedef {"front" | "dash"} DockRole */

export const DOCK_CAMERAS = [
  {
    role: "front",
    label: "Truck Front",
    linkKey: "truck_front",
    pushUrl: "https://vdo.ninja/?push=heartland2012_truck_front",
    viewUrl: "https://vdo.ninja/?view=heartland2012_truck_front",
    obsSourceMatchers: ["truck_front", "heartland2012_truck_front"],
    targetBitrateKbps: 2000,
  },
  {
    role: "dash",
    label: "Truck Dash",
    linkKey: "truck_dash",
    pushUrl: "https://vdo.ninja/?push=heartland2012_truck_dash",
    viewUrl: "https://vdo.ninja/?view=heartland2012_truck_dash",
    obsSourceMatchers: ["truck_dash", "heartland2012_truck_dash"],
    targetBitrateKbps: 1200,
  },
];

const STORAGE_PREFIX = "hsc_dock_";

export function storageKey(role, field) {
  return STORAGE_PREFIX + role + "_" + field;
}

export function loadStoredDeviceId(role) {
  try {
    return localStorage.getItem(storageKey(role, "deviceId")) || "";
  } catch {
    return "";
  }
}

export function saveStoredDeviceId(role, deviceId) {
  try {
    if (deviceId) {
      localStorage.setItem(storageKey(role, "deviceId"), deviceId);
    } else {
      localStorage.removeItem(storageKey(role, "deviceId"));
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} baseUrl
 * @param {string | null} deviceLabel
 * @param {{ width: number, height: number, fps: number, targetBitrateKbps: number }} settings
 * @param {boolean} muted
 */
export function buildVdoPublisherUrl(baseUrl, deviceLabel, settings, muted = true) {
  const url = new URL(baseUrl);
  url.searchParams.set("webcam", "");
  url.searchParams.set("quality", "0");
  url.searchParams.set("width", String(settings.width));
  url.searchParams.set("height", String(settings.height));
  url.searchParams.set("frameRate", String(settings.fps));
  url.searchParams.set("bitrate", String(settings.targetBitrateKbps));
  url.searchParams.set("autostart", "");
  url.searchParams.set("nopreview", "");
  if (deviceLabel) {
    url.searchParams.set("videodevice", deviceLabel);
  }
  if (muted) {
    url.searchParams.set("audiodevice", "0");
    url.searchParams.set("mute", "");
  }
  return url.toString();
}

/**
 * @param {HTMLIFrameElement | null} iframe
 * @param {boolean} muted
 */
export function setVdoPublisherMuted(iframe, muted) {
  if (!iframe?.contentWindow) return;
  const win = iframe.contentWindow;
  win.postMessage({ mute: muted }, "*");
  win.postMessage({ action: muted ? "mute" : "unmute" }, "*");
  win.postMessage({ mic: !muted }, "*");
}

export function loadStoredMuted(role) {
  try {
    const raw = localStorage.getItem(storageKey(role, "muted"));
    if (raw === null) return true;
    return raw !== "0";
  } catch {
    return true;
  }
}

export function saveStoredMuted(role, muted) {
  try {
    localStorage.setItem(storageKey(role, "muted"), muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function loadStoredSessionActive() {
  try {
    return localStorage.getItem(STORAGE_PREFIX + "session_active") === "1";
  } catch {
    return false;
  }
}

export function saveStoredSessionActive(active) {
  try {
    if (active) {
      localStorage.setItem(STORAGE_PREFIX + "session_active", "1");
    } else {
      localStorage.removeItem(STORAGE_PREFIX + "session_active");
    }
  } catch {
    /* ignore */
  }
}

const PUBLISHER_WINDOW_NAME = "hsc_camera_publisher";
const PUBLISHER_HEARTBEAT_KEY = STORAGE_PREFIX + "publisher_window_heartbeat";
const PUBLISHER_CHANNEL = "hsc-camera-publisher";
const PUBLISHER_HEARTBEAT_FRESH_MS = 5000;

export function getPublisherWindowName() {
  return PUBLISHER_WINDOW_NAME;
}

export function getPublisherWindowUrl() {
  return "/broadcast/publisher/";
}

export function touchPublisherWindowHeartbeat() {
  try {
    localStorage.setItem(PUBLISHER_HEARTBEAT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function clearPublisherWindowHeartbeat() {
  try {
    localStorage.removeItem(PUBLISHER_HEARTBEAT_KEY);
  } catch {
    /* ignore */
  }
}

/** True when the dedicated publisher window is alive (heartbeat within last few seconds). */
export function isPublisherWindowAlive() {
  try {
    const raw = localStorage.getItem(PUBLISHER_HEARTBEAT_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < PUBLISHER_HEARTBEAT_FRESH_MS;
  } catch {
    return false;
  }
}

export function openCameraPublisherWindow() {
  const features = "popup=yes,width=520,height=720,menubar=no,toolbar=no,location=no,status=no";
  const win = window.open(getPublisherWindowUrl(), getPublisherWindowName(), features);
  if (win) {
    try {
      win.focus();
    } catch {
      /* ignore */
    }
  }
  return win;
}

export function createPublisherChannel() {
  try {
    return typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(PUBLISHER_CHANNEL) : null;
  } catch {
    return null;
  }
}

/** Notify the publisher window to reload cameras from localStorage. */
export function notifyPublisherWindowReload(reason = "reload") {
  const channel = createPublisherChannel();
  if (!channel) return;
  try {
    channel.postMessage({ type: "reload", reason, at: Date.now() });
  } catch {
    /* ignore */
  } finally {
    channel.close();
  }
}

/** OBS WebSocket sceneIndex 0 is bottom of the UI list — sort high→low for top-to-bottom. */
export function scenesInObsUiOrder(scenes) {
  return [...(scenes || [])].sort((a, b) => (b.sceneIndex ?? 0) - (a.sceneIndex ?? 0));
}

/**
 * Soft-reload a VDO publisher iframe without destroying the element.
 * @param {HTMLIFrameElement | null} iframe
 * @param {string} url
 */
export function reloadPublisherIframe(iframe, url) {
  if (!(iframe instanceof HTMLIFrameElement) || !url) return;
  iframe.setAttribute("data-current-src", "about:blank");
  iframe.src = "about:blank";
  window.setTimeout(() => {
    iframe.setAttribute("data-current-src", url);
    iframe.src = url;
  }, 400);
}

export async function listVideoDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
}

export async function ensureCameraPermission() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
  stream.getTracks().forEach((track) => track.stop());
  return listVideoDevices();
}

/**
 * @param {string} deviceId
 * @param {{ width: number, height: number, fps: number }} settings
 */
export async function openCameraStream(deviceId, settings) {
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: settings.width },
      height: { ideal: settings.height },
      frameRate: { ideal: settings.fps },
    },
    audio: false,
  });
}

/**
 * Map bitrate (kbps) to 0–5 cellular-style bars.
 * @param {number | null | undefined} bitrateKbps
 * @param {number} targetBitrateKbps
 */
export function bitrateToBars(bitrateKbps, targetBitrateKbps) {
  if (bitrateKbps == null || !Number.isFinite(bitrateKbps) || bitrateKbps <= 0) {
    return 0;
  }
  const target = Math.max(targetBitrateKbps, 1);
  const ratio = bitrateKbps / target;
  if (ratio >= 0.9) return 5;
  if (ratio >= 0.7) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.3) return 2;
  return 1;
}

/**
 * Map 0–1 audio level to 0–5 cellular-style bars.
 * Tuned for speech peaks (“hello hello”).
 * @param {number | null | undefined} level
 */
export function audioLevelToBars(level) {
  if (level == null || !Number.isFinite(level) || level <= 0.02) {
    return 0;
  }
  if (level >= 0.45) return 5;
  if (level >= 0.28) return 4;
  if (level >= 0.16) return 3;
  if (level >= 0.08) return 2;
  return 1;
}

/**
 * Shared local mic monitor for UI meters (one stream for all dock cards).
 * Uses attack/decay smoothing so bars rise on speech and fall cleanly.
 * @param {(level: number) => void} onLevel
 */
export function createAudioLevelMonitor(onLevel) {
  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;
  let mediaStream = null;
  let rafId = 0;
  let running = false;
  let smoothed = 0;
  let startPromise = null;
  /** @type {Uint8Array | null} */
  let freqData = null;

  function readInstantLevel() {
    if (!analyser) return 0;
    const bins = analyser.frequencyBinCount;
    if (!freqData || freqData.length !== bins) {
      freqData = new Uint8Array(bins);
    }
    analyser.getByteFrequencyData(freqData);

    // Emphasize speech band (~300Hz–3.4kHz).
    const sampleRate = audioCtx?.sampleRate || 48000;
    const binHz = sampleRate / analyser.fftSize;
    const start = Math.max(1, Math.floor(300 / binHz));
    const end = Math.min(freqData.length - 1, Math.ceil(3400 / binHz));
    let sum = 0;
    let count = 0;
    for (let i = start; i <= end; i += 1) {
      sum += freqData[i];
      count += 1;
    }
    if (!count) return 0;
    const avg = sum / count / 255;
    return Math.min(1, avg * 1.8);
  }

  function tick() {
    if (!running) return;
    const instant = readInstantLevel();
    if (instant > smoothed) {
      smoothed = smoothed * 0.35 + instant * 0.65;
    } else {
      smoothed = smoothed * 0.82;
    }
    if (smoothed < 0.01) smoothed = 0;
    onLevel(smoothed);
    rafId = requestAnimationFrame(tick);
  }

  async function start() {
    if (running) {
      if (audioCtx?.state === "suspended") {
        await audioCtx.resume();
      }
      return;
    }
    if (startPromise) {
      await startPromise;
      return;
    }

    startPromise = (async () => {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
        video: false,
      });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtx();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;
      sourceNode = audioCtx.createMediaStreamSource(mediaStream);
      sourceNode.connect(analyser);
      running = true;
      smoothed = 0;
      tick();
    })();

    try {
      await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    try {
      sourceNode?.disconnect();
    } catch {
      /* ignore */
    }
    sourceNode = null;
    analyser = null;
    if (audioCtx) {
      try {
        await audioCtx.close();
      } catch {
        /* ignore */
      }
      audioCtx = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    smoothed = 0;
    onLevel(0);
  }

  return {
    start,
    stop,
    get isRunning() {
      return running;
    },
  };
}

/**
 * @param {MediaStream | null} stream
 * @param {number} targetBitrateKbps
 * @param {boolean} publishing
 */
export function estimateMetrics(stream, targetBitrateKbps, publishing) {
  if (!stream) {
    return { fps: null, bitrateKbps: null };
  }
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== "live") {
    return { fps: null, bitrateKbps: null };
  }
  const settings = track.getSettings ? track.getSettings() : {};
  const fps = typeof settings.frameRate === "number" ? settings.frameRate : null;
  return {
    fps,
    bitrateKbps: publishing ? targetBitrateKbps : null,
  };
}

/**
 * @param {Array<{ name?: string, visible?: boolean }> | null | undefined} sources
 * @param {string[]} matchers
 * @param {boolean} obsConnected
 * @returns {"receiving" | "lost" | "unknown"}
 */
export function resolveObsReceiveStatus(sources, matchers, obsConnected) {
  if (!obsConnected) {
    return "unknown";
  }
  const list = sources || [];
  const lowerMatchers = matchers.map((m) => m.toLowerCase());
  const match = list.find((source) => {
    const name = String(source.name || "").toLowerCase();
    return lowerMatchers.some((matcher) => name.includes(matcher));
  });
  if (!match) {
    return "lost";
  }
  return match.visible === false ? "lost" : "receiving";
}

export function defaultSettings(targetBitrateKbps) {
  return {
    width: 1280,
    height: 720,
    fps: 30,
    targetBitrateKbps,
  };
}
