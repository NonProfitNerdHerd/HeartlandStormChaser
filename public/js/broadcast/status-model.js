/** @typedef {"healthy"|"stale"|"disconnected"|"unavailable"|"unknown"} HealthTone */

/**
 * @param {HealthTone | string} status
 * @returns {{ tone: string, icon: string, label: string }}
 */
export function statusPresentation(status) {
  switch (status) {
    case "healthy":
      return { tone: "healthy", icon: "●", label: "Healthy" };
    case "stale":
    case "reconnecting":
      return { tone: "stale", icon: "◐", label: status === "reconnecting" ? "Reconnecting" : "Stale" };
    case "disconnected":
      return { tone: "disconnected", icon: "○", label: "Disconnected" };
    case "unavailable":
    case "disabled":
      return { tone: "unavailable", icon: "–", label: status === "disabled" ? "Disabled" : "Unavailable" };
    default:
      return { tone: "unknown", icon: "?", label: "Unknown" };
  }
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function displayValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Unavailable";
  }
  return String(value);
}

/**
 * @param {number | null | undefined} value
 * @param {number} [digits]
 * @returns {string}
 */
export function displayNumber(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }
  return value.toFixed(digits);
}

/**
 * Merge listener events into a capped client-side log.
 * @param {Array<{id:string,timestamp:string,category:string,message:string,severity:string}>} existing
 * @param {Array<{id:string,timestamp:string,category:string,message:string,severity:string}>} incoming
 * @param {number} [max]
 */
export function mergeEventLog(existing, incoming, max = 150) {
  const byId = new Map();
  for (const entry of [...existing, ...incoming]) {
    if (entry && entry.id) {
      byId.set(entry.id, entry);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, max);
}

/**
 * @param {string | null | undefined} gpsStatus
 * @returns {boolean}
 */
export function isGpsStale(gpsStatus) {
  return gpsStatus === "STALE";
}

/**
 * Compute next poll delay with backoff.
 * @param {boolean} ok
 * @param {number} failures
 * @param {number} [baseMs]
 * @param {number} [maxMs]
 */
export function nextPollDelay(ok, failures, baseMs = 3000, maxMs = 15000) {
  if (ok) {
    return baseMs;
  }
  const delay = baseMs * Math.pow(2, Math.min(failures, 3));
  return Math.min(delay, maxMs);
}
