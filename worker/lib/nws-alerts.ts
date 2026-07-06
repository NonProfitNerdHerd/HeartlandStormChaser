import {
  boundingBox,
  distanceToGeometryMiles,
  geometryIntersectsBoundingBox,
} from "./geo";

import type { GeoJsonGeometry } from "./geojson";

const NWS_USER_AGENT = "HeartlandStormChaser/1.0 (contact@heartlandstormchaser.local)";
const NWS_ALERTS_URL =
  "https://api.weather.gov/alerts/active?status=actual&message_type=alert";
const ALERTS_CACHE_TTL_MS = 60_000;

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
  sender_name: string;
  sent: string;
  effective: string;
  onset: string | null;
  expires: string;
  ends: string | null;
  distance_miles: number;
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

let alertsCache: {
  fetchedAt: number;
  features: NwsAlertFeature[];
} | null = null;

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

async function fetchActiveAlertFeatures(): Promise<NwsAlertFeature[]> {
  const now = Date.now();
  if (alertsCache && now - alertsCache.fetchedAt < ALERTS_CACHE_TTL_MS) {
    return alertsCache.features;
  }

  const response = await nwsFetch(NWS_ALERTS_URL);
  if (!response.ok) {
    throw new Error(`NWS alerts request failed (${response.status})`);
  }

  const payload = (await response.json()) as NwsAlertsResponse;
  const features = payload.features ?? [];
  alertsCache = { fetchedAt: now, features };
  return features;
}

export async function getAlertsWithinRadius(
  latitude: number,
  longitude: number,
  radiusMiles: number,
): Promise<{ alerts: NormalizedAlert[]; fetched_at: string; from_cache: boolean }> {
  const features = await fetchActiveAlertFeatures();
  const box = boundingBox(latitude, longitude, radiusMiles);
  const fetchedAt = new Date().toISOString();
  const fromCache = alertsCache ? Date.now() - alertsCache.fetchedAt > 0 : false;

  const alerts = features
    .map((feature) => {
      const properties = feature.properties ?? {};
      const geometry = feature.geometry ?? null;

      if (!geometryIntersectsBoundingBox(geometry, box)) {
        return null;
      }

      const distanceMiles = distanceToGeometryMiles(latitude, longitude, geometry);
      if (!Number.isFinite(distanceMiles) || distanceMiles > radiusMiles) {
        return null;
      }

      const event = readString(properties.event);
      const id =
        readString(properties.id) ||
        readString(feature.id) ||
        readString(properties["@id"]) ||
        `${event}-${readString(properties.sent)}`;

      const alert: NormalizedAlert = {
        id,
        event,
        severity: readString(properties.severity) || "Unknown",
        urgency: readString(properties.urgency) || "Unknown",
        certainty: readString(properties.certainty) || "Unknown",
        headline: readString(properties.headline),
        description: readString(properties.description),
        instruction: readNullableString(properties.instruction),
        area_desc: readString(properties.areaDesc),
        sender_name: readString(properties.senderName),
        sent: readString(properties.sent),
        effective: readString(properties.effective),
        onset: readNullableString(properties.onset),
        expires: readString(properties.expires),
        ends: readNullableString(properties.ends),
        distance_miles: Math.round(distanceMiles * 10) / 10,
        color: alertColor(event),
        geometry,
        source: "nws",
      };

      return alert;
    })
    .filter((alert): alert is NormalizedAlert => alert != null)
    .sort((a, b) => a.distance_miles - b.distance_miles);

  return { alerts, fetched_at: fetchedAt, from_cache: fromCache };
}
