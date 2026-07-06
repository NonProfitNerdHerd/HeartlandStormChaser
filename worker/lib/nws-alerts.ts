import {
  boundingBox,
  distanceToGeometryMiles,
  geometryIntersectsBoundingBox,
} from "./geo";

import type { GeoJsonGeometry } from "./geojson";
import type { Env } from "../index";

const NWS_USER_AGENT = "HeartlandStormChaser/1.0 (contact@heartlandstormchaser.local)";
const NWS_ALERTS_URL =
  "https://api.weather.gov/alerts/active?status=actual&message_type=alert";
const WARNINGS_CACHE_ID = "nws_active_alerts";
const MAX_GEOMETRY_FETCHES = 50;

export const WARNINGS_POLL_INTERVALS_SECONDS = [60, 300, 600, 1800, 3600] as const;
export const DEFAULT_WARNINGS_POLL_INTERVAL_SECONDS = 3600;

export interface NormalizedAlert {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string;
  description: string;
  instruction: string | null;
  area_desc: string;
  area_label: string;
  sender_name: string;
  sent: string;
  effective: string;
  onset: string | null;
  expires: string;
  ends: string | null;
  distance_miles: number;
  severity_rank: number;
  event_priority_rank: number;
  color: string;
  geometry: GeoJsonGeometry | null;
  source: "nws";
}

interface StoredNwsAlert {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string;
  description: string;
  instruction: string | null;
  area_desc: string;
  area_label: string;
  sender_name: string;
  sent: string;
  effective: string;
  onset: string | null;
  expires: string;
  ends: string | null;
  severity_rank: number;
  color: string;
  geometry: GeoJsonGeometry | null;
  source: "nws";
}

interface NwsAlertFeature {
  id?: string;
  type?: string;
  geometry?: GeoJsonGeometry | null;
  properties?: Record<string, unknown>;
}

interface NwsAlertsResponse {
  features?: NwsAlertFeature[];
}

export type EventFiltersMap = Record<string, boolean>;

interface WarningsCacheRow {
  id: string;
  alerts_json: string;
  fetched_at: string | null;
  poll_interval_seconds: number;
  radius_miles: number;
  event_filters_json: string;
}

export interface WarningsSettings {
  poll_interval_seconds: number;
  radius_miles: number;
  event_filters: EventFiltersMap;
  fetched_at: string | null;
  next_refresh_at: string | null;
  cached_alert_count: number;
}

export const DEFAULT_WARNINGS_RADIUS_MILES = 700;
export const MIN_WARNINGS_RADIUS_MILES = 5;
export const MAX_WARNINGS_RADIUS_MILES = 1000;
export const ALERT_EXPIRE_GRACE_MS = 60 * 1000;

function normalizeRadiusMiles(value: number): number {
  return Math.min(
    MAX_WARNINGS_RADIUS_MILES,
    Math.max(MIN_WARNINGS_RADIUS_MILES, Math.round(value)),
  );
}

const geometryCache = new Map<string, GeoJsonGeometry | null>();

const ALERT_COLORS: Record<string, string> = {
  "Tornado Warning": "#ff0000",
  "Severe Thunderstorm Warning": "#ffa500",
  "Flash Flood Warning": "#008000",
  "Flash Flood Watch": "#2e8b57",
  "Flood Warning": "#00ff00",
  "Flood Watch": "#2e8b57",
  "Tornado Watch": "#ffff00",
  "Severe Thunderstorm Watch": "#db7093",
  "Special Weather Statement": "#ffeb3b",
  "Winter Storm Warning": "#ff69b4",
  "Blizzard Warning": "#ff4500",
  "High Wind Warning": "#daa520",
  "Dust Storm Warning": "#ffe4b5",
};

const SEVERITY_RANK: Record<string, number> = {
  Extreme: 0,
  Severe: 1,
  Moderate: 2,
  Minor: 3,
  Unknown: 4,
};

const URGENCY_RANK: Record<string, number> = {
  Immediate: 0,
  Expected: 1,
  Future: 2,
  Past: 3,
  Unknown: 4,
};

const EVENT_TYPE_RANK: Record<string, number> = {
  "Tornado Warning": 0,
  "Severe Thunderstorm Warning": 1,
  "Flash Flood Warning": 2,
  "Tornado Watch": 3,
  "Severe Thunderstorm Watch": 4,
  "Flash Flood Watch": 5,
  "Flood Warning": 6,
  "Flood Watch": 7,
  "Winter Storm Warning": 8,
  "Blizzard Warning": 9,
  "High Wind Warning": 10,
  "Dust Storm Warning": 11,
  "Special Weather Statement": 12,
};

export function eventTypeRank(event: string): number {
  return EVENT_TYPE_RANK[event] ?? 100;
}

export function parseEventFiltersJson(json: string | null | undefined): EventFiltersMap {
  try {
    const parsed = JSON.parse(json || "{}") as EventFiltersMap;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to empty filters.
  }
  return {};
}

export function isEventEnabledInFilters(filters: EventFiltersMap, event: string): boolean {
  if (Object.prototype.hasOwnProperty.call(filters, event)) {
    return filters[event] !== false;
  }
  return true;
}

export function filterAlertsByEventFilters(
  alerts: NormalizedAlert[],
  filters: EventFiltersMap,
): NormalizedAlert[] {
  return alerts.filter((alert) => isEventEnabledInFilters(filters, alert.event));
}

function normalizePollIntervalSeconds(value: number): number {
  if (!WARNINGS_POLL_INTERVALS_SECONDS.includes(value as (typeof WARNINGS_POLL_INTERVALS_SECONDS)[number])) {
    return DEFAULT_WARNINGS_POLL_INTERVAL_SECONDS;
  }
  return value;
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

function getAlertExpiresAt(alert: { expires: string; ends: string | null }): string | null {
  return alert.ends || alert.expires || null;
}

export function isAlertActive(
  alert: { expires: string; ends: string | null },
  nowMs: number = Date.now(),
): boolean {
  const expiresAt = parseUtcTimestamp(getAlertExpiresAt(alert));
  if (expiresAt == null) {
    return true;
  }

  return nowMs < expiresAt + ALERT_EXPIRE_GRACE_MS;
}

async function nwsFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": NWS_USER_AGENT,
    },
  });
}

function alertColor(event: string): string {
  return ALERT_COLORS[event] ?? "#ff8c00";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readUgcCodes(properties: Record<string, unknown>): string[] {
  const geocode = properties.geocode;
  if (!geocode || typeof geocode !== "object") {
    return [];
  }

  const ugc = (geocode as Record<string, unknown>).UGC;
  if (!Array.isArray(ugc)) {
    return [];
  }

  return ugc.filter((code): code is string => typeof code === "string" && code.length >= 2);
}

function formatAreaLabel(areaDesc: string, ugcCodes: string[]): string {
  const state = ugcCodes[0]?.slice(0, 2).toUpperCase() ?? "";
  let location = (areaDesc.split(";")[0] ?? areaDesc).trim();
  location = location.replace(/,\s*[A-Z]{2}$/i, "").replace(/\s+County$/i, "").trim();

  if (state && location) {
    return `${state}-${location}`;
  }
  if (state) {
    return state;
  }
  return location || "Affected area";
}

function severityRank(severity: string, urgency: string): number {
  const severityScore = (SEVERITY_RANK[severity] ?? 99) * 10;
  const urgencyScore = URGENCY_RANK[urgency] ?? 99;
  return severityScore + urgencyScore;
}

function compareAlerts(a: NormalizedAlert, b: NormalizedAlert): number {
  if (a.event_priority_rank !== b.event_priority_rank) {
    return a.event_priority_rank - b.event_priority_rank;
  }
  if (a.severity_rank !== b.severity_rank) {
    return a.severity_rank - b.severity_rank;
  }
  if (a.distance_miles !== b.distance_miles) {
    return a.distance_miles - b.distance_miles;
  }
  return a.event.localeCompare(b.event);
}

async function readWarningsCacheRow(env: Env): Promise<WarningsCacheRow> {
  const row = await env.DB.prepare(
    `SELECT id, alerts_json, fetched_at, poll_interval_seconds, radius_miles, event_filters_json
     FROM warnings_cache
     WHERE id = ?`,
  )
    .bind(WARNINGS_CACHE_ID)
    .first<WarningsCacheRow>();

  if (!row) {
    return {
      id: WARNINGS_CACHE_ID,
      alerts_json: "[]",
      fetched_at: null,
      poll_interval_seconds: DEFAULT_WARNINGS_POLL_INTERVAL_SECONDS,
      radius_miles: DEFAULT_WARNINGS_RADIUS_MILES,
      event_filters_json: "{}",
    };
  }

  return {
    ...row,
    radius_miles: normalizeRadiusMiles(
      row.radius_miles ?? DEFAULT_WARNINGS_RADIUS_MILES,
    ),
    event_filters_json: row.event_filters_json ?? "{}",
  };
}

function parseStoredAlerts(alertsJson: string): StoredNwsAlert[] {
  try {
    const parsed = JSON.parse(alertsJson) as StoredNwsAlert[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isCacheStale(fetchedAt: string | null, pollIntervalSeconds: number): boolean {
  const fetchedMs = parseUtcTimestamp(fetchedAt);
  if (fetchedMs === null) {
    return true;
  }
  return Date.now() - fetchedMs >= pollIntervalSeconds * 1000;
}

function buildSettings(row: WarningsCacheRow): WarningsSettings {
  const alerts = parseStoredAlerts(row.alerts_json);
  const fetchedMs = parseUtcTimestamp(row.fetched_at);
  const nextRefreshMs =
    fetchedMs === null ? null : fetchedMs + row.poll_interval_seconds * 1000;

  return {
    poll_interval_seconds: row.poll_interval_seconds,
    radius_miles: row.radius_miles,
    event_filters: parseEventFiltersJson(row.event_filters_json),
    fetched_at: row.fetched_at,
    next_refresh_at:
      nextRefreshMs === null ? null : new Date(nextRefreshMs).toISOString(),
    cached_alert_count: alerts.length,
  };
}

export async function getWarningsSettings(env: Env): Promise<WarningsSettings> {
  const row = await readWarningsCacheRow(env);
  return buildSettings(row);
}

export async function updateWarningsPollInterval(
  env: Env,
  pollIntervalSeconds: number,
): Promise<WarningsSettings> {
  const normalized = normalizePollIntervalSeconds(pollIntervalSeconds);

  await env.DB.prepare(
    `INSERT INTO warnings_cache (id, alerts_json, fetched_at, poll_interval_seconds, radius_miles)
     VALUES (?, '[]', NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET poll_interval_seconds = excluded.poll_interval_seconds`,
  )
    .bind(WARNINGS_CACHE_ID, normalized, DEFAULT_WARNINGS_RADIUS_MILES)
    .run();

  return getWarningsSettings(env);
}

export async function updateWarningsRadius(
  env: Env,
  radiusMiles: number,
): Promise<WarningsSettings> {
  const normalized = normalizeRadiusMiles(radiusMiles);

  await env.DB.prepare(
    `INSERT INTO warnings_cache (id, alerts_json, fetched_at, poll_interval_seconds, radius_miles)
     VALUES (?, '[]', NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET radius_miles = excluded.radius_miles`,
  )
    .bind(WARNINGS_CACHE_ID, DEFAULT_WARNINGS_POLL_INTERVAL_SECONDS, normalized)
    .run();

  return getWarningsSettings(env);
}

export async function updateWarningsEventFilters(
  env: Env,
  eventFilters: EventFiltersMap,
): Promise<WarningsSettings> {
  const normalized = parseEventFiltersJson(JSON.stringify(eventFilters));

  await env.DB.prepare(
    `INSERT INTO warnings_cache (id, alerts_json, fetched_at, poll_interval_seconds, radius_miles, event_filters_json)
     VALUES (?, '[]', NULL, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET event_filters_json = excluded.event_filters_json`,
  )
    .bind(
      WARNINGS_CACHE_ID,
      DEFAULT_WARNINGS_POLL_INTERVAL_SECONDS,
      DEFAULT_WARNINGS_RADIUS_MILES,
      JSON.stringify(normalized),
    )
    .run();

  return getWarningsSettings(env);
}

async function fetchActiveAlertFeatures(): Promise<NwsAlertFeature[]> {
  const response = await nwsFetch(NWS_ALERTS_URL);
  if (!response.ok) {
    throw new Error(`NWS alerts request failed (${response.status})`);
  }

  const payload = (await response.json()) as NwsAlertsResponse;
  return payload.features ?? [];
}

async function resolveAlertGeometry(
  feature: NwsAlertFeature,
  properties: Record<string, unknown>,
  fetchBudget: { remaining: number },
): Promise<GeoJsonGeometry | null> {
  if (feature.geometry) {
    return feature.geometry;
  }

  const cacheKey =
    readString(properties.id) ||
    readString(properties["@id"]) ||
    readString(feature.id);

  if (cacheKey && geometryCache.has(cacheKey)) {
    return geometryCache.get(cacheKey) ?? null;
  }

  const storeGeometry = (geometry: GeoJsonGeometry | null) => {
    if (cacheKey) {
      geometryCache.set(cacheKey, geometry);
    }
    return geometry;
  };

  const alertUrl = readString(properties["@id"]) || readString(properties.id);
  if (alertUrl && fetchBudget.remaining > 0) {
    fetchBudget.remaining -= 1;
    try {
      const response = await nwsFetch(alertUrl);
      if (response.ok) {
        const detail = (await response.json()) as NwsAlertFeature;
        if (detail.geometry) {
          return storeGeometry(detail.geometry);
        }
      }
    } catch {
      // Fall through to zone lookup.
    }
  }

  const zones = properties.affectedZones;
  if (Array.isArray(zones)) {
    for (const zoneUrl of zones.slice(0, 2)) {
      if (typeof zoneUrl !== "string" || !zoneUrl || fetchBudget.remaining <= 0) {
        continue;
      }

      fetchBudget.remaining -= 1;
      try {
        const zoneResponse = await nwsFetch(zoneUrl);
        if (zoneResponse.ok) {
          const zoneData = (await zoneResponse.json()) as NwsAlertFeature;
          if (zoneData.geometry) {
            return storeGeometry(zoneData.geometry);
          }
        }
      } catch {
        // Try the next zone.
      }
    }
  }

  return storeGeometry(null);
}

async function buildStoredAlertsFromNws(): Promise<StoredNwsAlert[]> {
  geometryCache.clear();
  const features = await fetchActiveAlertFeatures();
  const fetchBudget = { remaining: MAX_GEOMETRY_FETCHES };

  const enriched = await Promise.all(
    features.map(async (feature) => {
      const properties = feature.properties ?? {};
      const geometry = await resolveAlertGeometry(feature, properties, fetchBudget);
      return { feature, properties, geometry };
    }),
  );

  return enriched
    .map(({ feature, properties, geometry }) => {
      if (!geometry) {
        return null;
      }

      const event = readString(properties.event);
      const severity = readString(properties.severity) || "Unknown";
      const urgency = readString(properties.urgency) || "Unknown";
      const id =
        readString(properties.id) ||
        readString(feature.id) ||
        readString(properties["@id"]) ||
        `${event}-${readString(properties.sent)}`;

      const areaDesc = readString(properties.areaDesc);
      const areaLabel = formatAreaLabel(areaDesc, readUgcCodes(properties));

      const alert: StoredNwsAlert = {
        id,
        event,
        severity,
        urgency,
        certainty: readString(properties.certainty) || "Unknown",
        headline: readString(properties.headline),
        description: readString(properties.description),
        instruction: readNullableString(properties.instruction),
        area_desc: areaDesc,
        area_label: areaLabel,
        sender_name: readString(properties.senderName),
        sent: readString(properties.sent),
        effective: readString(properties.effective),
        onset: readNullableString(properties.onset),
        expires: readString(properties.expires),
        ends: readNullableString(properties.ends),
        severity_rank: severityRank(severity, urgency),
        color: alertColor(event),
        geometry,
        source: "nws",
      };

      return alert;
    })
    .filter((alert): alert is StoredNwsAlert => alert != null);
}

export async function getOrRefreshCachedAlerts(
  env: Env,
  options: { force?: boolean } = {},
): Promise<{ alerts: StoredNwsAlert[]; fetched_at: string; from_cache: boolean; settings: WarningsSettings }> {
  const row = await readWarningsCacheRow(env);
  const stale = options.force || isCacheStale(row.fetched_at, row.poll_interval_seconds);

  if (!stale) {
    return {
      alerts: parseStoredAlerts(row.alerts_json),
      fetched_at: row.fetched_at ?? new Date().toISOString(),
      from_cache: true,
      settings: buildSettings(row),
    };
  }

  const alerts = await buildStoredAlertsFromNws();
  const fetchedAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO warnings_cache (id, alerts_json, fetched_at, poll_interval_seconds)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       alerts_json = excluded.alerts_json,
       fetched_at = excluded.fetched_at,
       poll_interval_seconds = warnings_cache.poll_interval_seconds`,
  )
    .bind(WARNINGS_CACHE_ID, JSON.stringify(alerts), fetchedAt, row.poll_interval_seconds)
    .run();

  const updatedRow = await readWarningsCacheRow(env);

  return {
    alerts,
    fetched_at: fetchedAt,
    from_cache: false,
    settings: buildSettings(updatedRow),
  };
}

export async function getAlertsWithinRadius(
  env: Env,
  latitude: number,
  longitude: number,
  radiusMiles: number,
  options: { force?: boolean } = {},
): Promise<{
  alerts: NormalizedAlert[];
  fetched_at: string;
  from_cache: boolean;
  settings: WarningsSettings;
}> {
  const cached = await getOrRefreshCachedAlerts(env, options);
  const box = boundingBox(latitude, longitude, radiusMiles);

  const alerts = cached.alerts
    .filter((stored) => isAlertActive(stored))
    .map((stored) => {
      if (!stored.geometry || !geometryIntersectsBoundingBox(stored.geometry, box)) {
        return null;
      }

      const distanceMiles = distanceToGeometryMiles(latitude, longitude, stored.geometry);
      if (!Number.isFinite(distanceMiles) || distanceMiles > radiusMiles) {
        return null;
      }

      const alert: NormalizedAlert = {
        ...stored,
        distance_miles: Math.round(distanceMiles * 10) / 10,
        event_priority_rank: eventTypeRank(stored.event),
      };
      return alert;
    })
    .filter((alert): alert is NormalizedAlert => alert != null)
    .sort(compareAlerts);

  return {
    alerts,
    fetched_at: cached.fetched_at,
    from_cache: cached.from_cache,
    settings: cached.settings,
  };
}
