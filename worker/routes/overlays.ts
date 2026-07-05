import { routeErrorResponse } from "../lib/db-errors";
import { getGpsConnectionStatus } from "../lib/gps-status";
import { getWeatherForCoordinates } from "../lib/nws-weather";
import type { Env } from "../index";

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

async function readOverlaySetting(env: Env, key: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT value FROM overlay_settings WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value?.trim() ?? "";
}

function formatLocationLabel(city: string, state: string): string | null {
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  if (state) return state;
  return null;
}

function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

async function handleGpsWeatherData(env: Env): Promise<Response> {
  const platformRow = await env.DB.prepare(
    `SELECT d.id, d.device_name, d.last_seen_at,
            l.latitude, l.longitude, l.speed_mph, l.heading_degrees,
            l.accuracy_meters, l.battery_percent, l.timestamp_utc, l.received_at_utc
     FROM gps_devices d
     LEFT JOIN gps_latest_location l ON l.device_id = d.id
     WHERE d.is_platform_source = 1
     LIMIT 1`,
  ).first<{
    id: string;
    device_name: string;
    last_seen_at: string | null;
    latitude: number | null;
    longitude: number | null;
    speed_mph: number | null;
    heading_degrees: number | null;
    accuracy_meters: number | null;
    battery_percent: number | null;
    timestamp_utc: string | null;
    received_at_utc: string | null;
  }>();

  const overlayCity = await readOverlaySetting(env, "overlay_target_city");
  const overlayState = await readOverlaySetting(env, "overlay_target_state");
  const overlayLocationLabel = formatLocationLabel(overlayCity, overlayState);

  if (!platformRow) {
    return json({
      ok: true,
      has_platform_source: false,
      message: "No Platform GPS Source Selected",
      platform: null,
      location: {
        display: overlayLocationLabel,
        overlay_city: overlayCity || null,
        overlay_state: overlayState || null,
        nearest_city: null,
        nearest_state: null,
      },
      weather: null,
      updated_at: new Date().toISOString(),
    });
  }

  const gpsStatus = getGpsConnectionStatus(
    platformRow.received_at_utc ?? platformRow.last_seen_at,
  );

  const hasLocation =
    platformRow.latitude != null && platformRow.longitude != null;

  let weather = null;
  let nearestCity: string | null = null;
  let nearestState: string | null = null;

  if (hasLocation) {
    try {
      weather = await getWeatherForCoordinates(
        env,
        platformRow.latitude as number,
        platformRow.longitude as number,
      );
      nearestCity = weather.location_city;
      nearestState = weather.location_state;
    } catch {
      weather = null;
    }
  }

  const nearestLocationLabel = formatLocationLabel(
    nearestCity ?? "",
    nearestState ?? "",
  );

  const displayLocation =
    overlayLocationLabel ||
    nearestLocationLabel ||
    (hasLocation
      ? formatCoordinates(platformRow.latitude as number, platformRow.longitude as number)
      : null);

  return json({
    ok: true,
    has_platform_source: true,
    message: null,
    platform: {
      device_id: platformRow.id,
      device_name: platformRow.device_name,
      status: gpsStatus,
      latitude: platformRow.latitude,
      longitude: platformRow.longitude,
      speed_mph: platformRow.speed_mph,
      heading_degrees: platformRow.heading_degrees,
      accuracy_meters: platformRow.accuracy_meters,
      battery_percent: platformRow.battery_percent,
      timestamp_utc: platformRow.timestamp_utc,
      received_at_utc: platformRow.received_at_utc,
    },
    location: {
      display: displayLocation,
      overlay_city: overlayCity || null,
      overlay_state: overlayState || null,
      nearest_city: nearestCity,
      nearest_state: nearestState,
    },
    weather,
    updated_at: new Date().toISOString(),
  });
}

export async function handleOverlays(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    if (pathname === "/api/overlays/gps-weather-data" && method === "GET") {
      return handleGpsWeatherData(env);
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    return routeErrorResponse(error, "Overlays API");
  }
}
