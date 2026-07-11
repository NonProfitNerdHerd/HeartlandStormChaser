import { statusPresentation } from "./status-model.js";

export function renderStatusBadge(el, status, text) {
  if (!el) return;
  const presentation = statusPresentation(status);
  el.className = `bcc-badge bcc-badge--${presentation.tone}`;
  el.innerHTML = `<span class="bcc-badge__icon" aria-hidden="true">${presentation.icon}</span><span class="bcc-badge__text">${escapeHtml(text || presentation.label)}</span>`;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
