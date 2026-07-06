import type { NormalizedAlert } from "./nws-alerts";

export const OVERLAY_NEW_WARNING_MS = 20 * 60 * 1000;

export interface OverlayWarningBarPayload {
  id: string;
  event: string;
  is_new: boolean;
  event_label: string;
  detail_label: string;
  detail_scroll_label: string;
  expires_label: string;
  until_label: string;
  color: string;
  color_primary_left: string;
  color_primary_right: string;
  color_meta_left: string;
  color_meta_right: string;
}

const US_STATE_NAMES: Record<string, string> = {
  AL: "ALABAMA",
  AK: "ALASKA",
  AZ: "ARIZONA",
  AR: "ARKANSAS",
  CA: "CALIFORNIA",
  CO: "COLORADO",
  CT: "CONNECTICUT",
  DE: "DELAWARE",
  FL: "FLORIDA",
  GA: "GEORGIA",
  HI: "HAWAII",
  ID: "IDAHO",
  IL: "ILLINOIS",
  IN: "INDIANA",
  IA: "IOWA",
  KS: "KANSAS",
  KY: "KENTUCKY",
  LA: "LOUISIANA",
  ME: "MAINE",
  MD: "MARYLAND",
  MA: "MASSACHUSETTS",
  MI: "MICHIGAN",
  MN: "MINNESOTA",
  MS: "MISSISSIPPI",
  MO: "MISSOURI",
  MT: "MONTANA",
  NE: "NEBRASKA",
  NV: "NEVADA",
  NH: "NEW HAMPSHIRE",
  NJ: "NEW JERSEY",
  NM: "NEW MEXICO",
  NY: "NEW YORK",
  NC: "NORTH CAROLINA",
  ND: "NORTH DAKOTA",
  OH: "OHIO",
  OK: "OKLAHOMA",
  OR: "OREGON",
  PA: "PENNSYLVANIA",
  RI: "RHODE ISLAND",
  SC: "SOUTH CAROLINA",
  SD: "SOUTH DAKOTA",
  TN: "TENNESSEE",
  TX: "TEXAS",
  UT: "UTAH",
  VT: "VERMONT",
  VA: "VIRGINIA",
  WA: "WASHINGTON",
  WV: "WEST VIRGINIA",
  WI: "WISCONSIN",
  WY: "WYOMING",
  DC: "DISTRICT OF COLUMBIA",
};

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return null;
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
  );
}

function mixHex(base: string, target: string, targetWeight: number): string {
  const a = parseHexColor(base);
  const b = parseHexColor(target);
  if (!a || !b) {
    return base;
  }

  const weight = Math.max(0, Math.min(1, targetWeight));
  return toHex(
    a.r * (1 - weight) + b.r * weight,
    a.g * (1 - weight) + b.g * weight,
    a.b * (1 - weight) + b.b * weight,
  );
}

function darkenHex(hex: string, amount: number): string {
  return mixHex(hex, "#000000", amount);
}

function lightenHex(hex: string, amount: number): string {
  return mixHex(hex, "#ffffff", amount);
}

function parseUtcTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = Date.parse(withZone);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatEventLabel(event: string): string {
  return event
    .replace(/thunderstorm/gi, "T-STORM")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function extractStatesLabel(areaDesc: string): string {
  const states = new Set<string>();
  for (const part of areaDesc.split(";")) {
    const stateMatch = part.trim().match(/,\s*([A-Z]{2})$/i);
    if (stateMatch) {
      const code = stateMatch[1].toUpperCase();
      states.add(US_STATE_NAMES[code] ?? code);
    }
  }

  if (states.size) {
    return Array.from(states).join(", ");
  }

  return "AREA";
}

function formatUntilTimestamp(value: string | null | undefined): string {
  const parsed = parseUtcTimestamp(value);
  if (parsed == null) {
    return "—";
  }

  const date = new Date(parsed);
  const weekday = date
    .toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Chicago" })
    .toUpperCase();
  const timeParts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/Chicago",
    hour12: true,
  }).formatToParts(date);

  let hour = "";
  let minute = "";
  let dayPeriod = "";
  let timeZone = "";
  for (const part of timeParts) {
    if (part.type === "hour") hour = part.value;
    if (part.type === "minute") minute = part.value;
    if (part.type === "dayPeriod") dayPeriod = part.value.toUpperCase();
    if (part.type === "timeZoneName") timeZone = part.value.toUpperCase();
  }

  return `${weekday} ${hour}:${minute}${dayPeriod} ${timeZone}`;
}

function formatExpiresLabel(expiresAt: string | null | undefined): string {
  const parsed = parseUtcTimestamp(expiresAt);
  if (parsed == null) {
    return "EXPIRES —";
  }

  const minutes = Math.max(0, Math.round((parsed - Date.now()) / 60000));
  if (minutes < 60) {
    return `EXPIRES IN ${minutes} MIN`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) {
    return `EXPIRES IN ${hours} HR`;
  }
  return `EXPIRES IN ${hours} HR ${remainder} MIN`;
}

function formatCounties(areaDesc: string): string {
  return areaDesc
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ")
    .toUpperCase();
}

function extractDetailParts(alert: NormalizedAlert): string[] {
  const parts: string[] = [];
  const source = `${alert.headline ?? ""} ${alert.description ?? ""}`;

  const hailInchMatch = source.match(
    /hail(?:\s+up\s+to)?\s+(\d+(?:\.\d+)?)\s*(?:inch|inches|in)\b/i,
  );
  const hailSizeMatch = source.match(
    /\b(pea|penny|nickel|quarter|half dollar|golf ball|tennis ball|baseball|softball)\s+size\s+hail\b/i,
  );
  if (hailInchMatch) {
    const sizeName = hailSizeMatch ? ` (${hailSizeMatch[1].toUpperCase()})` : "";
    parts.push(`HAIL: UP TO ${hailInchMatch[1]}"${sizeName}`);
  } else if (hailSizeMatch) {
    parts.push(`HAIL: ${hailSizeMatch[1].toUpperCase()} SIZE`);
  }

  const windMatch =
    source.match(/(?:wind(?:s| gusts)?|gusts)\s+(?:up\s+to\s+)?(\d+)\s*mph/i) ||
    source.match(/(\d+)\s*mph\s+wind/i);
  if (windMatch) {
    parts.push(`WIND: ${windMatch[1]} MPH`);
  }

  if (alert.area_desc) {
    parts.push(`COUNTIES: ${formatCounties(alert.area_desc)}`);
  }

  return parts;
}

function flattenToSingleLine(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\*/g, "")
    .trim();
}

function formatAlertDateTimePhrase(value: string | null | undefined): string {
  const parsed = parseUtcTimestamp(value);
  if (parsed == null) {
    return "—";
  }

  const date = new Date(parsed);
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/Chicago",
    hour12: true,
  }).formatToParts(date);

  let month = "";
  let day = "";
  let hour = "";
  let minute = "";
  let dayPeriod = "";
  let timeZone = "";
  for (const part of parts) {
    if (part.type === "month") month = part.value;
    if (part.type === "day") day = part.value;
    if (part.type === "hour") hour = part.value;
    if (part.type === "minute") minute = part.value;
    if (part.type === "dayPeriod") dayPeriod = part.value.toUpperCase();
    if (part.type === "timeZoneName") timeZone = part.value.toUpperCase();
  }

  return `${month} ${day} at ${hour}:${minute}${dayPeriod} ${timeZone}`;
}

function formatAlertDisplayTimestamp(value: string | null | undefined): string {
  const parsed = parseUtcTimestamp(value);
  if (parsed == null) {
    return "—";
  }

  return new Date(parsed).toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "America/Chicago",
  });
}

function formatDetailScrollLabel(alert: NormalizedAlert): string {
  const issuedAt = alert.sent || alert.effective;
  const expiresAt = alert.expires || alert.ends;
  const sender = alert.sender_name || "National Weather Service";
  const lead =
    alert.headline?.trim() ||
    `${alert.event} issued ${formatAlertDateTimePhrase(issuedAt)} until ${formatAlertDateTimePhrase(expiresAt)} by ${sender}`;

  const bodyParts: string[] = [];
  if (alert.description) {
    bodyParts.push(flattenToSingleLine(alert.description));
  }
  if (alert.instruction) {
    bodyParts.push(`Instruction ${flattenToSingleLine(alert.instruction)}`);
  }
  bodyParts.push(`Issuing office ${sender}`);
  bodyParts.push(`Issued ${formatAlertDisplayTimestamp(issuedAt)}`);
  bodyParts.push(`Expires ${formatAlertDisplayTimestamp(expiresAt)}`);

  return flattenToSingleLine(`${lead} ${bodyParts.join(" ")}`);
}

function formatDetailLabel(alert: NormalizedAlert): string {
  const parts = extractDetailParts(alert);
  if (parts.length) {
    return parts.join(" | ");
  }

  if (alert.headline) {
    return alert.headline.toUpperCase();
  }

  return alert.event.toUpperCase();
}

function cleanAreaLine(line: string): string {
  return line
    .trim()
    .replace(/^[-•]\s*/, "")
    .replace(/\.\.\.$/, "")
    .replace(/\s+County\s+in\s+.+$/i, "")
    .replace(/\s+County$/i, "")
    .replace(
      /\s+in\s+(?:north|south|east|west|central|northeastern|northwestern|southeastern|southwestern).+$/i,
      "",
    )
    .trim();
}

function extractAffectedAreas(alert: NormalizedAlert): string {
  const description = alert.description?.replace(/\r\n/g, "\n") ?? "";

  const areaBlocks = [
    description.match(/\*[^\n]*\bfor\.{3}\s*\n([\s\S]*?)(?=\n\s*\*|$)/i),
    description.match(/\*[^\n]*following areas:?\s*\n([\s\S]*?)(?=\n\s*\*|$)/i),
  ];

  for (const match of areaBlocks) {
    if (!match?.[1]) {
      continue;
    }

    const areas = match[1]
      .split("\n")
      .map((line) => cleanAreaLine(line))
      .filter(Boolean);

    if (areas.length) {
      return areas.join("; ");
    }
  }

  return alert.area_desc
    .split(";")
    .map((part) =>
      part
        .trim()
        .replace(/,\s*[A-Z]{2}$/i, "")
        .replace(/\s+County$/i, "")
        .trim(),
    )
    .filter(Boolean)
    .join("; ");
}

function formatUntilLabel(alert: NormalizedAlert): string {
  const expiresAt = alert.expires || alert.ends;
  const state = extractStatesLabel(alert.area_desc);
  const until = formatUntilTimestamp(expiresAt);
  const area = extractAffectedAreas(alert);
  return `${state} - UNTIL ${until} - ${area}`;
}

export function isNewOverlayWarning(alert: NormalizedAlert): boolean {
  const issuedAt = parseUtcTimestamp(alert.sent || alert.effective);
  if (issuedAt == null) {
    return false;
  }

  return Date.now() - issuedAt < OVERLAY_NEW_WARNING_MS;
}

export function buildOverlayWarningBarPayload(
  alert: NormalizedAlert,
): OverlayWarningBarPayload {
  const color = alert.color || "#ff8c00";
  const expiresAt = alert.expires || alert.ends;

  return {
    id: alert.id,
    event: alert.event,
    is_new: isNewOverlayWarning(alert),
    event_label: formatEventLabel(alert.event),
    detail_label: formatDetailLabel(alert),
    detail_scroll_label: formatDetailScrollLabel(alert),
    expires_label: formatExpiresLabel(expiresAt),
    until_label: formatUntilLabel(alert),
    color,
    color_primary_left: color,
    color_primary_right: lightenHex(color, 0.12),
    color_meta_left: "#000000",
    color_meta_right: mixHex(darkenHex(color, 0.55), "#3b0a14", 0.45),
  };
}

export function buildOverlayWarningBarPayloads(
  alerts: NormalizedAlert[],
): OverlayWarningBarPayload[] {
  return alerts.map((alert) => buildOverlayWarningBarPayload(alert));
}
