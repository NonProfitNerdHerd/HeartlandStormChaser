/**
 * Quad VDO.Ninja view monitor — pick a camera per pane and watch the view feed.
 */
import { DOCK_CAMERAS } from "./camera-dock-model.js";
import { escapeHtml } from "./ui-utils.js";

const STORAGE_KEY = "hsc_monitor_pane_keys";
const PANE_COUNT = 4;

const statusEl = document.querySelector("[data-mon-status]");
const quadEl = document.querySelector("[data-mon-quad]");

/** @type {Array<{ key: string, label: string, viewUrl: string }>} */
let cameras = [];

/** Per-pane mute; selecting a camera always resets that pane to muted. */
/** @type {boolean[]} */
let paneMuted = Array.from({ length: PANE_COUNT }, () => true);

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function loadPaneKeys() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return Array.from({ length: PANE_COUNT }, () => "");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return Array.from({ length: PANE_COUNT }, () => "");
    return Array.from({ length: PANE_COUNT }, (_, i) =>
      typeof parsed[i] === "string" ? parsed[i] : "",
    );
  } catch {
    return Array.from({ length: PANE_COUNT }, () => "");
  }
}

function savePaneKeys(keys) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    /* ignore */
  }
}

/**
 * Build a quiet viewer URL for an iframe monitor pane.
 * @param {string} viewUrl
 * @param {boolean} muted
 */
function buildViewerUrl(viewUrl, muted = true) {
  try {
    const url = new URL(viewUrl);
    url.searchParams.set("cleanoutput", "");
    url.searchParams.set("autostart", "");
    url.searchParams.set("transparent", "");
    url.searchParams.delete("mute");
    url.searchParams.delete("muted");
    if (muted) {
      url.searchParams.set("muted", "");
    }
    return url.toString();
  } catch {
    return viewUrl;
  }
}

/**
 * Best-effort live mute toggle for VDO.Ninja viewer iframes.
 * @param {HTMLIFrameElement} iframe
 * @param {boolean} muted
 */
function setViewerMuted(iframe, muted) {
  try {
    const win = iframe.contentWindow;
    if (!win) return;
    win.postMessage({ mute: muted }, "*");
    win.postMessage({ action: muted ? "mute" : "unmute" }, "*");
    win.postMessage({ muted }, "*");
  } catch {
    /* cross-origin — URL rebuild handles mute */
  }
}

function defaultCameras() {
  return DOCK_CAMERAS.map((camera) => ({
    key: camera.linkKey,
    label: camera.label,
    viewUrl: camera.viewUrl,
  }));
}

/**
 * @param {Array<{ link_key?: string, display_name?: string, view_url?: string }> | null | undefined} links
 */
function mergeCameras(links) {
  /** @type {Map<string, { key: string, label: string, viewUrl: string }>} */
  const map = new Map();
  defaultCameras().forEach((camera) => map.set(camera.key, camera));
  (links || []).forEach((link) => {
    const key = String(link.link_key || "").trim();
    const viewUrl = String(link.view_url || "").trim();
    if (!key || !viewUrl) return;
    map.set(key, {
      key,
      label: String(link.display_name || key),
      viewUrl,
    });
  });
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function cameraOptions(selectedKey) {
  let html = `<option value="">Select camera…</option>`;
  cameras.forEach((camera) => {
    const selected = camera.key === selectedKey ? " selected" : "";
    html += `<option value="${escapeHtml(camera.key)}"${selected}>${escapeHtml(camera.label)}</option>`;
  });
  return html;
}

function findCamera(key) {
  return cameras.find((camera) => camera.key === key) || null;
}

function muteButtonHtml(index, hasCamera) {
  const muted = paneMuted[index] !== false;
  if (!hasCamera) {
    return `<button type="button" class="bcc-monitor-pane__mute" data-pane-mute="${index}" hidden disabled aria-hidden="true">Muted</button>`;
  }
  return `
    <button
      type="button"
      class="bcc-monitor-pane__mute${muted ? " bcc-monitor-pane__mute--on" : ""}"
      data-pane-mute="${index}"
      aria-pressed="${muted ? "true" : "false"}"
      title="${muted ? "Click to unmute this pane" : "Click to mute this pane"}"
    >${muted ? "Muted" : "Unmuted"}</button>
  `;
}

function updateMuteButton(index, hasCamera) {
  const button = document.querySelector(`[data-pane-mute="${index}"]`);
  if (!(button instanceof HTMLButtonElement)) return;
  if (!hasCamera) {
    button.hidden = true;
    button.disabled = true;
    button.setAttribute("aria-hidden", "true");
    return;
  }
  const muted = paneMuted[index] !== false;
  button.hidden = false;
  button.disabled = false;
  button.removeAttribute("aria-hidden");
  button.setAttribute("aria-pressed", muted ? "true" : "false");
  button.classList.toggle("bcc-monitor-pane__mute--on", muted);
  button.textContent = muted ? "Muted" : "Unmuted";
  button.title = muted ? "Click to unmute this pane" : "Click to mute this pane";
}

function renderShell(keys) {
  if (!quadEl) return;
  // Restored selections still start muted (operator unmutes deliberately).
  paneMuted = Array.from({ length: PANE_COUNT }, () => true);

  quadEl.innerHTML = Array.from({ length: PANE_COUNT }, (_, index) => {
    const key = keys[index] || "";
    const camera = findCamera(key);
    const muted = paneMuted[index] !== false;
    const src = camera ? buildViewerUrl(camera.viewUrl, muted) : "about:blank";
    return `
      <article class="bcc-monitor-pane" data-pane="${index}">
        <div class="bcc-monitor-pane__toolbar">
          <span>Cam ${index + 1}</span>
          <select data-pane-select="${index}">
            ${cameraOptions(key)}
          </select>
        </div>
        <div class="bcc-monitor-pane__frame">
          <iframe
            data-pane-iframe="${index}"
            data-current-src="${escapeHtml(src)}"
            allow="autoplay; fullscreen"
            title="Camera monitor pane ${index + 1}"
            src="${escapeHtml(src)}"
          ></iframe>
          ${muteButtonHtml(index, Boolean(camera))}
          <p class="bcc-monitor-pane__empty" data-pane-empty="${index}" ${camera ? "hidden" : ""}>No camera selected</p>
        </div>
      </article>
    `;
  }).join("");

  quadEl.querySelectorAll("[data-pane-select]").forEach((select) => {
    select.addEventListener("change", () => {
      if (!(select instanceof HTMLSelectElement)) return;
      const index = Number(select.getAttribute("data-pane-select"));
      if (!Number.isFinite(index)) return;
      const next = loadPaneKeys();
      next[index] = select.value;
      savePaneKeys(next);
      // Selecting (or clearing) a camera always starts muted.
      paneMuted[index] = true;
      applyPane(index, select.value);
    });
  });

  quadEl.querySelectorAll("[data-pane-mute]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      const index = Number(button.getAttribute("data-pane-mute"));
      if (!Number.isFinite(index)) return;
      togglePaneMute(index);
    });
  });
}

function applyPane(index, key) {
  const camera = findCamera(key);
  const iframe = document.querySelector(`[data-pane-iframe="${index}"]`);
  const empty = document.querySelector(`[data-pane-empty="${index}"]`);
  const muted = paneMuted[index] !== false;
  const src = camera ? buildViewerUrl(camera.viewUrl, muted) : "about:blank";
  if (iframe instanceof HTMLIFrameElement) {
    if (iframe.getAttribute("data-current-src") !== src) {
      iframe.setAttribute("data-current-src", src);
      iframe.src = src;
    }
  }
  if (empty instanceof HTMLElement) {
    empty.hidden = Boolean(camera);
  }
  updateMuteButton(index, Boolean(camera));
}

function togglePaneMute(index) {
  const keys = loadPaneKeys();
  const key = keys[index] || "";
  const camera = findCamera(key);
  if (!camera) return;

  paneMuted[index] = !(paneMuted[index] !== false);
  const muted = paneMuted[index] !== false;
  const iframe = document.querySelector(`[data-pane-iframe="${index}"]`);
  const src = buildViewerUrl(camera.viewUrl, muted);

  if (iframe instanceof HTMLIFrameElement) {
    // Rebuild URL so VDO viewer mute sticks; also nudge via postMessage.
    iframe.setAttribute("data-current-src", src);
    iframe.src = src;
    window.setTimeout(() => setViewerMuted(iframe, muted), 400);
  }
  updateMuteButton(index, true);
}

function refreshFeeds() {
  const keys = loadPaneKeys();
  keys.forEach((key, index) => {
    const camera = findCamera(key);
    const iframe = document.querySelector(`[data-pane-iframe="${index}"]`);
    if (!(iframe instanceof HTMLIFrameElement) || !camera) return;
    const muted = paneMuted[index] !== false;
    const src = buildViewerUrl(camera.viewUrl, muted);
    iframe.setAttribute("data-current-src", "about:blank");
    iframe.src = "about:blank";
    window.setTimeout(() => {
      iframe.setAttribute("data-current-src", src);
      iframe.src = src;
      window.setTimeout(() => setViewerMuted(iframe, muted), 400);
    }, 300);
  });
  setStatus("Refreshed monitor feeds");
}

async function loadCameras() {
  setStatus("Loading cameras…");
  try {
    const response = await fetch("/api/broadcast/vdo-links", { credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Failed to load cameras (${response.status})`);
    }
    cameras = mergeCameras(data.links || []);
    setStatus(`${cameras.length} camera${cameras.length === 1 ? "" : "s"} available`);
  } catch (error) {
    cameras = defaultCameras();
    setStatus(
      error instanceof Error
        ? `${error.message} — showing default Truck cameras`
        : "Showing default Truck cameras",
    );
  }

  const keys = loadPaneKeys();
  // Drop stored keys that no longer exist.
  const cleaned = keys.map((key) => (key && findCamera(key) ? key : ""));
  savePaneKeys(cleaned);
  renderShell(cleaned);
}

document.querySelector("[data-mon-refresh]")?.addEventListener("click", () => {
  refreshFeeds();
});

void loadCameras();
