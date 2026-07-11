import { escapeHtml, formatRelative, renderStatusBadge } from "./ui-utils.js";

export function renderHeader(root, state) {
  const listener = state.data?.listener || {};
  const telemetry = state.data?.telemetry || {};
  const gps = telemetry.gps;

  const clockEl = root.querySelector("[data-bcc-clock]");
  if (clockEl) clockEl.textContent = state.clockText;

  const updatedEl = root.querySelector("[data-bcc-updated]");
  if (updatedEl) {
    updatedEl.textContent = state.lastSuccessAt
      ? `Updated ${formatRelative(state.lastSuccessAt)}`
      : "No successful update yet";
  }

  renderStatusBadge(
    root.querySelector("[data-bcc-badge-listener]"),
    !state.data?.configured
      ? "unavailable"
      : listener.listenerConnected
        ? "healthy"
        : state.reconnecting
          ? "stale"
          : "disconnected",
    !state.data?.configured
      ? "Listener not configured"
      : listener.listenerConnected
        ? "Listener online"
        : state.reconnecting
          ? "Listener reconnecting"
          : "Listener offline",
  );

  renderStatusBadge(
    root.querySelector("[data-bcc-badge-obs]"),
    listener.obsConnected ? "healthy" : listener.obsConnecting ? "stale" : "disconnected",
    listener.obsConnected
      ? "OBS connected"
      : listener.obsConnecting
        ? "OBS reconnecting"
        : "OBS disconnected",
  );

  renderStatusBadge(
    root.querySelector("[data-bcc-badge-stream]"),
    listener.streamingActive ? "healthy" : listener.obsConnected ? "unknown" : "unavailable",
    listener.streamingActive ? "Streaming" : "Not streaming",
  );

  renderStatusBadge(
    root.querySelector("[data-bcc-badge-recording]"),
    listener.recordingActive ? "healthy" : listener.obsConnected ? "unknown" : "unavailable",
    listener.recordingActive ? "Recording" : "Not recording",
  );

  renderStatusBadge(
    root.querySelector("[data-bcc-badge-gps]"),
    gps?.status === "LIVE" ? "healthy" : gps?.status === "STALE" ? "stale" : "unavailable",
    gps ? `GPS ${gps.status}` : "GPS unavailable",
  );

  const errorEl = root.querySelector("[data-bcc-header-error]");
  if (errorEl) {
    const message = state.error || listener.error || listener.obsLastError || "";
    errorEl.hidden = !message;
    errorEl.textContent = message;
  }
}

export function renderHealthCards(container, cards) {
  if (!container) return;
  if (!cards?.length) {
    container.innerHTML = `<p class="bcc-empty">Health data unavailable</p>`;
    return;
  }

  container.innerHTML = cards
    .map((card) => {
      const tone = card.status || "unknown";
      return `
        <article class="bcc-health-card bcc-health-card--${escapeHtml(tone)}" data-health-id="${escapeHtml(card.id)}">
          <div class="bcc-health-card__top">
            <h3 class="bcc-health-card__name">${escapeHtml(card.name)}</h3>
            <span class="bcc-badge bcc-badge--${escapeHtml(tone)}">
              <span class="bcc-badge__text">${escapeHtml(card.label)}</span>
            </span>
          </div>
          <p class="bcc-health-card__meta">Updated ${escapeHtml(formatRelative(card.lastUpdate))}</p>
          ${card.error ? `<p class="bcc-health-card__error">${escapeHtml(card.error)}</p>` : ""}
        </article>
      `;
    })
    .join("");
}
