/**
 * Real VDO.Ninja publish health via a hidden viewer iframe.
 * "Publisher Live" must mean the view room is receiving video — not just local camera intent.
 */

const VDO_ORIGIN = "https://vdo.ninja";

/**
 * @param {string} viewUrl
 */
export function buildVdoMonitorUrl(viewUrl) {
  const url = new URL(viewUrl);
  url.searchParams.set("api", "");
  url.searchParams.set("cleanoutput", "");
  url.searchParams.set("autoplay", "");
  // Health iframe is video-only — never play published mic back into BCC.
  url.searchParams.set("muted", "");
  url.searchParams.set("deafen", "");
  url.searchParams.set("volume", "0");
  url.searchParams.set("noaudio", "");
  // Low-bitrate monitor — health only; must not compete with the real publish path.
  url.searchParams.set("bitrate", "300");
  url.searchParams.set("quality", "2");
  return url.toString();
}

function silenceMonitorIframe(iframe) {
  if (!iframe?.contentWindow) return;
  if (!iframe.src || iframe.src === "about:blank") return;
  try {
    const win = iframe.contentWindow;
    win.postMessage({ volume: 0 }, "*");
    win.postMessage({ action: "volume", volume: 0 }, "*");
    win.postMessage({ deafen: true }, "*");
    win.postMessage({ action: "deafen" }, "*");
    win.postMessage({ muted: true }, "*");
    win.postMessage({ mute: true }, "*");
    win.postMessage({ speaker: false }, "*");
    win.postMessage({ noaudio: true }, "*");
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} pushOrViewUrl
 */
export function extractVdoStreamId(pushOrViewUrl) {
  try {
    const url = new URL(pushOrViewUrl);
    return url.searchParams.get("view") || url.searchParams.get("push") || "";
  } catch {
    return "";
  }
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function asFiniteNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a bitrate number that may be bps or kbps into kbps.
 * @param {number | null} bitrate
 */
function toKbps(bitrate) {
  if (bitrate == null || bitrate <= 0) return null;
  // Heuristic: WebRTC often reports bits/sec; VDO docs use kbps for commands.
  if (bitrate > 20000) return bitrate / 1000;
  return bitrate;
}

/**
 * Deep-scan VDO/WebRTC-ish stats trees for fps, bitrate, and byte counters.
 * @param {unknown} node
 * @param {{ fps: number | null, bitrateKbps: number | null, bytesSent: number | null, bytesReceived: number | null }} acc
 * @param {number} depth
 */
function deepScanMetrics(node, acc, depth = 0) {
  if (node == null || depth > 10) return;
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item) => deepScanMetrics(item, acc, depth + 1));
    return;
  }

  const obj = /** @type {Record<string, unknown>} */ (node);
  for (const [key, val] of Object.entries(obj)) {
    const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const num = asFiniteNumber(val);

    if (num != null) {
      if (
        (k === "fps" ||
          k === "framerate" ||
          k === "framespersecond" ||
          k.endsWith("fps") ||
          k.includes("framerate")) &&
        num > 0 &&
        num <= 120
      ) {
        acc.fps = num;
      }

      if (
        (k.includes("bitrate") || k === "bitspersecond" || k.endsWith("bps")) &&
        !k.includes("audio") &&
        num > 0
      ) {
        const kbps = toKbps(num);
        if (kbps != null && kbps > 1) {
          // Prefer the larger plausible video bitrate when multiple peers exist.
          if (acc.bitrateKbps == null || kbps > acc.bitrateKbps) {
            acc.bitrateKbps = kbps;
          }
        }
      }

      if ((k === "bytessent" || k.endsWith("bytessent") || k === "bytesSent".toLowerCase()) && num >= 0) {
        acc.bytesSent = Math.max(acc.bytesSent || 0, num);
      }
      if (k.includes("bytessent") && !k.includes("audio") && num >= 0) {
        acc.bytesSent = Math.max(acc.bytesSent || 0, num);
      }
      if ((k === "bytesreceived" || k.includes("bytesreceived")) && !k.includes("audio") && num >= 0) {
        acc.bytesReceived = Math.max(acc.bytesReceived || 0, num);
      }
    } else if (val && typeof val === "object") {
      deepScanMetrics(val, acc, depth + 1);
    }
  }
}

/**
 * Read fps/bitrate/byte counters from one stats node (and nested children).
 * @param {unknown} node
 * @returns {{ fps: number | null, bitrateKbps: number | null, bytesSent: number | null, bytesReceived: number | null }}
 */
function metricsFromStreamNode(node) {
  /** @type {{ fps: number | null, bitrateKbps: number | null, bytesSent: number | null, bytesReceived: number | null }} */
  const acc = { fps: null, bitrateKbps: null, bytesSent: null, bytesReceived: null };
  deepScanMetrics(node, acc, 0);
  return acc;
}

/**
 * Track byte counters over time → kbps.
 */
export function createByteRateEstimator() {
  /** @type {Map<string, { bytes: number, at: number }>} */
  const prev = new Map();

  /**
   * @param {string} key
   * @param {number | null | undefined} bytes
   * @returns {number | null} kbps
   */
  function push(key, bytes) {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
    const now = Date.now();
    const last = prev.get(key);
    prev.set(key, { bytes, at: now });
    if (!last || now <= last.at || bytes < last.bytes) return null;
    const dtMs = now - last.at;
    if (dtMs < 400) return null;
    const bits = (bytes - last.bytes) * 8;
    const kbps = bits / dtMs; // bits/ms === kbps
    if (!Number.isFinite(kbps) || kbps <= 0) return null;
    return kbps;
  }

  return { push };
}

/**
 * Walk VDO getStats payload shape:
 * { stats: { inbound: { streamId: {...} }, outbound: { streamId: {...} }, total_* } }
 * @param {unknown} data
 * @param {"inbound" | "outbound" | "any"} prefer
 */
function collectStreamMetrics(data, prefer = "any") {
  /** @type {{ fps: number | null, bitrateKbps: number | null, bytesSent: number | null, bytesReceived: number | null, live: boolean, streamIds: string[] }} */
  const out = {
    fps: null,
    bitrateKbps: null,
    bytesSent: null,
    bytesReceived: null,
    live: false,
    streamIds: [],
  };
  if (!data || typeof data !== "object") return out;

  const root = /** @type {Record<string, unknown>} */ (data);
  const statsBag =
    root.stats && typeof root.stats === "object"
      ? /** @type {Record<string, unknown>} */ (root.stats)
      : root;

  const inbound =
    (statsBag.inbound && typeof statsBag.inbound === "object" ? statsBag.inbound : null) ||
    (statsBag.inbound_stats && typeof statsBag.inbound_stats === "object"
      ? statsBag.inbound_stats
      : null);
  const outbound =
    (statsBag.outbound && typeof statsBag.outbound === "object" ? statsBag.outbound : null) ||
    (statsBag.outbound_stats && typeof statsBag.outbound_stats === "object"
      ? statsBag.outbound_stats
      : null);

  const totalIn =
    asFiniteNumber(statsBag.total_inbound_connections) ??
    asFiniteNumber(root.total_inbound_connections);
  const totalOut =
    asFiniteNumber(statsBag.total_outbound_connections) ??
    asFiniteNumber(root.total_outbound_connections);
  if ((totalIn != null && totalIn > 0) || (totalOut != null && totalOut > 0)) {
    out.live = true;
  }

  /**
   * @param {unknown} bucket
   * @param {boolean} use
   * @param {"in" | "out"} side
   */
  const absorbBucket = (bucket, use, side) => {
    if (!use || !bucket || typeof bucket !== "object") return;
    Object.entries(/** @type {Record<string, unknown>} */ (bucket)).forEach(([id, node]) => {
      if (id) out.streamIds.push(id);
      const m = metricsFromStreamNode(node);
      if (m.fps != null) out.fps = m.fps;
      if (m.bitrateKbps != null) {
        out.bitrateKbps =
          out.bitrateKbps == null ? m.bitrateKbps : Math.max(out.bitrateKbps, m.bitrateKbps);
      }
      if (side === "out" && m.bytesSent != null) {
        out.bytesSent = Math.max(out.bytesSent || 0, m.bytesSent);
      }
      if (side === "in" && m.bytesReceived != null) {
        out.bytesReceived = Math.max(out.bytesReceived || 0, m.bytesReceived);
      }
      // Some stacks put bytesSent on inbound viewer reports of the remote.
      if (m.bytesSent != null && side === "in" && out.bytesReceived == null) {
        out.bytesReceived = m.bytesSent;
      }
      if (m.fps != null || m.bitrateKbps != null || m.bytesSent != null || m.bytesReceived != null) {
        out.live = true;
      }
    });
  };

  if (prefer === "outbound") {
    absorbBucket(outbound, true, "out");
    if (out.fps == null && out.bitrateKbps == null && out.bytesSent == null) {
      absorbBucket(inbound, true, "in");
    }
  } else if (prefer === "inbound") {
    absorbBucket(inbound, true, "in");
    if (out.fps == null && out.bitrateKbps == null && out.bytesReceived == null) {
      absorbBucket(outbound, true, "out");
    }
  } else {
    absorbBucket(inbound, true, "in");
    absorbBucket(outbound, true, "out");
  }

  // Whole-tree fallback (covers odd shapes / continuous stats packets).
  if (out.fps == null || out.bitrateKbps == null || (out.bytesSent == null && out.bytesReceived == null)) {
    const deep = metricsFromStreamNode(statsBag);
    if (out.fps == null && deep.fps != null) out.fps = deep.fps;
    if (out.bitrateKbps == null && deep.bitrateKbps != null) out.bitrateKbps = deep.bitrateKbps;
    if (out.bytesSent == null && deep.bytesSent != null) out.bytesSent = deep.bytesSent;
    if (out.bytesReceived == null && deep.bytesReceived != null) out.bytesReceived = deep.bytesReceived;
  }

  return out;
}

/**
 * Pull fps / bitrate / connection counts from messy VDO stats payloads (viewer / any).
 * @param {unknown} data
 * @param {string} expectedStreamId
 */
export function interpretVdoStats(data, expectedStreamId) {
  const collected = collectStreamMetrics(data, "inbound");
  /** @type {{ live: boolean, fps: number | null, bitrateKbps: number | null, bytesSent: number | null, bytesReceived: number | null, streamIds: string[] }} */
  const out = {
    live: collected.live,
    fps: collected.fps,
    bitrateKbps: collected.bitrateKbps,
    bytesSent: collected.bytesSent,
    bytesReceived: collected.bytesReceived,
    streamIds: collected.streamIds,
  };

  if (!data || typeof data !== "object") return out;
  const root = /** @type {Record<string, unknown>} */ (data);

  const streamIds = new Set(out.streamIds);
  const collectIds = (value) => {
    if (!value) return;
    if (typeof value === "string" && value) {
      streamIds.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collectIds);
      return;
    }
    if (typeof value === "object") {
      const obj = /** @type {Record<string, unknown>} */ (value);
      if (typeof obj.streamID === "string") streamIds.add(obj.streamID);
      if (typeof obj.streamId === "string") streamIds.add(obj.streamId);
      const inbound = obj.inbound || obj.inbound_stats;
      const outbound = obj.outbound || obj.outbound_stats;
      if (inbound && typeof inbound === "object") {
        Object.keys(/** @type {object} */ (inbound)).forEach((k) => streamIds.add(k));
      }
      if (outbound && typeof outbound === "object") {
        Object.keys(/** @type {object} */ (outbound)).forEach((k) => streamIds.add(k));
      }
    }
  };

  if (root.streamIDs) collectIds(root.streamIDs);
  if (root.streamIds) collectIds(root.streamIds);
  if (root.stats) collectIds(root.stats);
  collectIds(root);
  out.streamIds = [...streamIds];

  if (expectedStreamId) {
    const matched = out.streamIds.some(
      (id) => id === expectedStreamId || id.includes(expectedStreamId) || expectedStreamId.includes(id),
    );
    if (matched) out.live = true;
  } else if (out.streamIds.length > 0) {
    out.live = true;
  }

  return out;
}

/**
 * Parse stats from a *publisher* (push) iframe — prefer outbound fps/bitrate.
 * @param {unknown} data
 * @param {string} [expectedStreamId]
 */
export function interpretVdoPublisherStats(data, expectedStreamId = "") {
  const collected = collectStreamMetrics(data, "outbound");
  const base = interpretVdoStats(data, expectedStreamId);
  return {
    live: collected.live || base.live,
    fps: collected.fps ?? base.fps,
    bitrateKbps: collected.bitrateKbps ?? base.bitrateKbps,
    bytesSent: collected.bytesSent ?? base.bytesSent,
    bytesReceived: collected.bytesReceived ?? base.bytesReceived,
    streamIds: collected.streamIds.length ? collected.streamIds : base.streamIds,
  };
}

/**
 * Ask a VDO publisher iframe for outbound stats.
 * @param {HTMLIFrameElement | null} iframe
 */
export function requestVdoPublisherStats(iframe) {
  if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) return;
  if (!iframe.src || iframe.src === "about:blank") return;
  try {
    iframe.contentWindow.postMessage({ requestStatsContinuous: true }, "*");
    iframe.contentWindow.postMessage({ getFreshStats: true, cib: "hsc-pub-fresh" }, "*");
    iframe.contentWindow.postMessage({ getStats: true, cib: "hsc-pub-stats" }, "*");
  } catch {
    /* ignore */
  }
}

/**
 * @param {unknown} data
 * @param {string} expectedStreamId
 */
export function interpretVdoAction(data, expectedStreamId) {
  if (!data || typeof data !== "object") return null;
  const msg = /** @type {Record<string, unknown>} */ (data);
  const action = typeof msg.action === "string" ? msg.action : "";
  const streamID = typeof msg.streamID === "string" ? msg.streamID : "";
  const matches =
    !expectedStreamId ||
    !streamID ||
    streamID === expectedStreamId ||
    streamID.includes(expectedStreamId) ||
    expectedStreamId.includes(streamID);

  if (!matches && streamID) return null;

  if (action === "guest-connected" || action === "video-connected" || action === "scene-connected") {
    return { live: true, event: action };
  }
  if (action === "view-connection" && msg.value) {
    return { live: true, event: action };
  }
  if (action === "push-connection" && msg.value === false) {
    return { live: false, event: action };
  }
  if (action === "view-connection" && msg.value === false) {
    return { live: false, event: action };
  }
  return null;
}

/**
 * Hidden viewer that reports whether the push stream is actually present on VDO.
 * @param {{
 *   role: string,
 *   viewUrl: string,
 *   mount: HTMLElement,
 *   onUpdate: (state: VdoHealthState) => void,
 * }} opts
 */
export function createVdoViewMonitor(opts) {
  const expectedStreamId = extractVdoStreamId(opts.viewUrl);
  /** @type {VdoHealthState} */
  let state = {
    role: opts.role,
    expecting: false,
    expectingSince: 0,
    vdoLive: false,
    liveFailStreak: 0,
    fps: null,
    bitrateKbps: null,
    bytesReceived: null,
    bytesSent: null,
    lastOkAt: 0,
    lastFailAt: 0,
    lastMessageAt: 0,
    reason: "idle",
    streamIds: [],
  };

  const iframe = document.createElement("iframe");
  iframe.className = "bcc-dock-vdo-monitor";
  iframe.setAttribute("data-vdo-monitor", opts.role);
  iframe.setAttribute("aria-hidden", "true");
  iframe.allow = "autoplay; fullscreen";
  iframe.src = "about:blank";
  opts.mount.appendChild(iframe);

  let pollTimer = 0;
  let destroyed = false;

  function emit() {
    if (!destroyed) opts.onUpdate({ ...state });
  }

  function applyLive(live, reason, metrics) {
    const now = Date.now();
    state.lastMessageAt = now;
    if (metrics?.fps != null) state.fps = metrics.fps;
    if (metrics?.bitrateKbps != null) state.bitrateKbps = metrics.bitrateKbps;
    if (metrics?.bytesReceived != null) state.bytesReceived = metrics.bytesReceived;
    if (metrics?.bytesSent != null) state.bytesSent = metrics.bytesSent;
    if (metrics?.streamIds) state.streamIds = metrics.streamIds;

    if (live) {
      state.vdoLive = true;
      state.liveFailStreak = 0;
      state.lastOkAt = now;
      state.reason = reason || "receiving";
      state.lastFailAt = 0;
      emit();
      return;
    }

    if (!state.expecting) {
      state.vdoLive = false;
      state.liveFailStreak = 0;
      state.reason = "idle";
      state.fps = null;
      state.bitrateKbps = null;
      state.bytesReceived = null;
      state.bytesSent = null;
      state.lastFailAt = 0;
      emit();
      return;
    }

    const inGrace = now - (state.expectingSince || now) < VDO_START_GRACE_MS;
    // Empty polls during startup are normal.
    if (inGrace && (reason === "empty-stats" || reason === "no-stream")) {
      state.reason = "starting";
      emit();
      return;
    }

    // Anti-flicker: require several consecutive fails before leaving LIVE.
    if (state.vdoLive || state.lastOkAt > 0) {
      state.liveFailStreak = (state.liveFailStreak || 0) + 1;
      if (state.liveFailStreak < VDO_LIVE_FAIL_STREAK) {
        state.reason = reason || "degraded";
        emit();
        return;
      }
    }

    state.vdoLive = false;
    if (!state.lastFailAt) state.lastFailAt = now;
    state.reason = reason || "no-stream";
    state.fps = null;
    state.bitrateKbps = null;
    state.bytesReceived = null;
    state.bytesSent = null;
    emit();
  }

  function post(cmd) {
    try {
      iframe.contentWindow?.postMessage(cmd, "*");
    } catch {
      /* ignore */
    }
  }

  function poll() {
    if (destroyed || !state.expecting) return;
    if (!iframe.contentWindow || iframe.src === "about:blank") return;
    silenceMonitorIframe(iframe);
    post({ getStreamIDs: true, cib: `hsc-${opts.role}-ids` });
    post({ getFreshStats: true, cib: `hsc-${opts.role}-fresh` });
    post({ getStats: true, cib: `hsc-${opts.role}-stats` });
    post({ getDetailedState: true, cib: `hsc-${opts.role}-state` });
  }

  function onMessage(event) {
    if (destroyed) return;
    if (event.source !== iframe.contentWindow) return;
    const origin = String(event.origin || "");
    if (origin && origin !== VDO_ORIGIN && !origin.includes("vdo.ninja")) return;

    const data = event.data;
    if (!data || typeof data !== "object") return;

    const actionHit = interpretVdoAction(data, expectedStreamId);
    if (actionHit) {
      applyLive(actionHit.live, actionHit.event);
      return;
    }

    const stats = interpretVdoStats(data, expectedStreamId);
    if (
      stats.streamIds.length ||
      stats.live ||
      stats.fps != null ||
      stats.bitrateKbps != null ||
      stats.bytesReceived != null ||
      stats.bytesSent != null
    ) {
      applyLive(stats.live, stats.live ? "stats" : "empty-stats", stats);
    }
  }

  function loadMonitor() {
    const next = buildVdoMonitorUrl(opts.viewUrl);
    iframe.src = "about:blank";
    window.setTimeout(() => {
      if (destroyed) return;
      iframe.src = next;
      iframe.addEventListener(
        "load",
        () => {
          silenceMonitorIframe(iframe);
          window.setTimeout(() => silenceMonitorIframe(iframe), 800);
          window.setTimeout(() => silenceMonitorIframe(iframe), 2500);
        },
        { once: true },
      );
      window.setTimeout(() => {
        silenceMonitorIframe(iframe);
        post({ requestStatsContinuous: true });
        poll();
      }, 1200);
    }, 300);
  }

  function setExpecting(expecting) {
    const was = state.expecting;
    state.expecting = Boolean(expecting);
    if (state.expecting && !was) {
      state.expectingSince = Date.now();
      state.reason = "starting";
      state.vdoLive = false;
      loadMonitor();
      if (!pollTimer) {
        pollTimer = window.setInterval(poll, VDO_MONITOR_POLL_MS);
      }
      emit();
    } else if (!state.expecting && was) {
      state.vdoLive = false;
      state.fps = null;
      state.bitrateKbps = null;
      state.reason = "idle";
      state.expectingSince = 0;
      iframe.src = "about:blank";
      if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = 0;
      }
      emit();
    }
  }

  window.addEventListener("message", onMessage);

  return {
    getState() {
      return { ...state };
    },
    setExpecting,
    reload: loadMonitor,
    destroy() {
      destroyed = true;
      window.removeEventListener("message", onMessage);
      if (pollTimer) window.clearInterval(pollTimer);
      iframe.remove();
    },
  };
}

/**
 * @typedef {{
 *   role: string,
 *   expecting: boolean,
 *   expectingSince: number,
 *   vdoLive: boolean,
 *   liveFailStreak: number,
 *   fps: number | null,
 *   bitrateKbps: number | null,
 *   bytesReceived: number | null,
 *   bytesSent: number | null,
 *   lastOkAt: number,
 *   lastFailAt: number,
 *   lastMessageAt: number,
 *   reason: string,
 *   streamIds: string[],
 * }} VdoHealthState
 */

/** Grace period after starting publish before we call it DOWN. */
export const VDO_START_GRACE_MS = 20_000;
/** Consecutive failed health polls required before leaving LIVE (anti-flicker). */
export const VDO_LIVE_FAIL_STREAK = 4;
/** How long DOWN before hard recover — disabled for monitor-driven recovery in dock. */
export const VDO_DOWN_RECOVER_MS = 60_000;
/** Min gap between hard recovers per camera. */
export const VDO_RECOVER_COOLDOWN_MS = 60_000;
/** Health monitor poll interval (ms) — keep quiet vs the real publish path. */
export const VDO_MONITOR_POLL_MS = 5_000;

/**
 * @param {VdoHealthState} health
 * @param {number} [now]
 * @returns {"idle" | "starting" | "live" | "down"}
 */
export function vdoHealthPhase(health, now = Date.now()) {
  if (!health.expecting) return "idle";
  if (health.vdoLive) return "live";
  if (now - (health.expectingSince || now) < VDO_START_GRACE_MS) return "starting";
  // Sticky: once we've been live, stay "live" until fail streak clears in the monitor.
  if ((health.liveFailStreak || 0) > 0 && (health.liveFailStreak || 0) < VDO_LIVE_FAIL_STREAK) {
    return "live";
  }
  return "down";
}
