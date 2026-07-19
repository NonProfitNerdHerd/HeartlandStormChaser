import { escapeHtml, formatRelative, renderStatusBadge } from "./ui-utils.js";

/**
 * Convert heading degrees to an 8-point cardinal (matches radar HUD style).
 * @param {number | null | undefined} degrees
 */
function headingToCardinal(degrees) {
  if (degrees == null || !Number.isFinite(Number(degrees))) return null;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round((((Number(degrees) % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

/**
 * @param {{ speed_mph?: number | null, heading_degrees?: number | null } | null | undefined} gps
 */
export function formatSpeedHeading(gps) {
  if (!gps || gps.speed_mph == null || !Number.isFinite(Number(gps.speed_mph))) {
    return "—";
  }
  const mph = Math.round(Number(gps.speed_mph));
  const dir = headingToCardinal(gps.heading_degrees);
  return dir ? `${mph}mph ${dir}` : `${mph}mph`;
}

/**
 * Top-of-page broadcast health banner.
 * Priority: red (pipeline) > orange (publisher starting / GPS) > green.
 * Recording never drives the banner.
 *
 * @param {object} state
 * @param {(() => ({ level: "alert" | "warn", message: string } | string | null)) | null | undefined} getCameraIssue
 * @returns {{ level: "ok" | "warn" | "alert", message: string }}
 */
export function resolveBroadcastBanner(state, getCameraIssue) {
  const listener = state.data?.listener || {};
  const gps = state.data?.telemetry?.gps;
  const configured = Boolean(state.data?.configured);

  if (state.error && !state.data) {
    return { level: "alert", message: "CANNOT REACH BROADCAST API" };
  }
  if (!configured) {
    return { level: "alert", message: "LISTENER NOT CONFIGURED" };
  }
  if (!listener.listenerConnected) {
    return {
      level: "alert",
      message: state.reconnecting ? "LISTENER RECONNECTING" : "LISTENER OFFLINE",
    };
  }
  if (!listener.obsConnected) {
    return {
      level: "alert",
      message: listener.obsConnecting ? "OBS RECONNECTING" : "OBS DISCONNECTED",
    };
  }
  if (!listener.streamingActive) {
    return { level: "alert", message: "NOT STREAMING" };
  }

  const cameraIssue = typeof getCameraIssue === "function" ? getCameraIssue() : null;
  if (cameraIssue) {
    if (typeof cameraIssue === "string") {
      return { level: "alert", message: cameraIssue };
    }
    if (cameraIssue.level === "alert" || cameraIssue.level === "warn") {
      // Camera alert/warn beats GPS status (more actionable while streaming).
      return { level: cameraIssue.level, message: cameraIssue.message };
    }
  }

  if (!gps || gps.status !== "LIVE") {
    if (gps?.status === "STALE") {
      return { level: "warn", message: "GPS STALE" };
    }
    return { level: "warn", message: "GPS UNAVAILABLE" };
  }

  return { level: "ok", message: "ON AIR — ALL SYSTEMS GO" };
}

/**
 * @param {object} state
 * @param {(() => ({ level: "alert" | "warn", message: string } | string | null)) | null | undefined} getCameraIssue
 */
export function renderStatusBanner(state, getCameraIssue) {
  const banner = document.querySelector("[data-bcc-status-banner]");
  const messageEl = document.querySelector("[data-bcc-status-banner-message]");
  if (!banner || !messageEl) return;

  const { level, message } = resolveBroadcastBanner(state, getCameraIssue);
  banner.classList.toggle("bcc-status-banner--ok", level === "ok");
  banner.classList.toggle("bcc-status-banner--warn", level === "warn");
  banner.classList.toggle("bcc-status-banner--alert", level === "alert");
  messageEl.textContent = message;
}

/**
 * @param {HTMLElement} root
 * @param {object} state
 * @param {(() => ({ level: "alert" | "warn", message: string } | string | null)) | null | undefined} getCameraIssue
 */
export function renderHeader(root, state, getCameraIssue) {
  const listener = state.data?.listener || {};
  const telemetry = state.data?.telemetry || {};
  const gps = telemetry.gps;

  renderStatusBanner(state, getCameraIssue);

  const clockEl = root.querySelector("[data-bcc-clock]");
  if (clockEl) clockEl.textContent = state.clockText;

  const updatedEl = root.querySelector("[data-bcc-updated]");
  if (updatedEl) {
    updatedEl.textContent = state.lastSuccessAt
      ? `Updated ${formatRelative(state.lastSuccessAt)}`
      : "No successful update yet";
  }

  const speedEl = root.querySelector("[data-bcc-speed]");
  if (speedEl) {
    speedEl.textContent = formatSpeedHeading(gps);
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
    {
      actionable: true,
      title: "Click to reconnect listener",
    },
  );

  renderStatusBadge(
    root.querySelector("[data-bcc-badge-obs]"),
    listener.obsConnected ? "healthy" : listener.obsConnecting ? "stale" : "disconnected",
    listener.obsConnected
      ? "OBS connected"
      : listener.obsConnecting
        ? "OBS reconnecting"
        : "OBS disconnected",
    {
      actionable: true,
      title: "Click to refresh OBS status",
    },
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
