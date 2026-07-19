import { statusPresentation } from "./status-model.js";

export function renderStatusBadge(el, status, text, options = {}) {
  if (!el) return;
  const presentation = statusPresentation(status);
  const actionable = Boolean(options.actionable);
  const title = options.title || "";
  el.className = `bcc-badge bcc-badge--${presentation.tone}${actionable ? " bcc-badge--action" : ""}`;
  el.innerHTML = `<span class="bcc-badge__icon" aria-hidden="true">${presentation.icon}</span><span class="bcc-badge__text">${escapeHtml(text || presentation.label)}</span>`;
  if (actionable) {
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    if (title) el.setAttribute("title", title);
    el.setAttribute("aria-label", title || text || presentation.label);
  } else {
    el.removeAttribute("role");
    el.removeAttribute("tabindex");
    el.removeAttribute("title");
    el.removeAttribute("aria-label");
  }
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Resolve YouTube watch URL from API watch_url or external_platform_id. */
export function youtubeWatchUrl(broadcast) {
  if (!broadcast) return null;
  if (typeof broadcast.watch_url === "string" && broadcast.watch_url.trim()) {
    return broadcast.watch_url.trim();
  }
  const raw = broadcast.external_platform_id;
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.broadcastId) {
      return `https://www.youtube.com/watch?v=${parsed.broadcastId}`;
    }
  } catch {
    /* ignore */
  }
  if (raw.startsWith("yt:")) {
    const parts = raw.split(":");
    if (parts[1]) return `https://www.youtube.com/watch?v=${parts[1]}`;
  }
  return null;
}

export function formatClock(date = new Date()) {
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatRelative(iso) {
  if (!iso) return "Unavailable";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "Unavailable";
  const delta = Math.max(0, Date.now() - ms);
  if (delta < 5000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return new Date(ms).toLocaleTimeString();
}

export function confirmAction(message) {
  return window.confirm(message);
}
