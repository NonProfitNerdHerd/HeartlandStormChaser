export const GPS_LIVE_THRESHOLD_MS = 30_000;
export const GPS_HISTORY_INTERVAL_SECONDS = 60;

export type GpsConnectionStatus = "LIVE" | "STALE" | "UNKNOWN";

export function parseUtcTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = Date.parse(withZone);
  return Number.isNaN(parsed) ? null : parsed;
}

export function getGpsConnectionStatus(receivedAtUtc: string | null | undefined): GpsConnectionStatus {
  const parsed = parseUtcTimestamp(receivedAtUtc);
  if (parsed === null) {
    return "UNKNOWN";
  }

  return Date.now() - parsed <= GPS_LIVE_THRESHOLD_MS ? "LIVE" : "STALE";
}
