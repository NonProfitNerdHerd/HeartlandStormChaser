import { routeErrorResponse } from "../lib/db-errors";
import { getPlatformSource } from "../lib/gps-platform";
import { getAlertsWithinRadius } from "../lib/nws-alerts";
import { getWeatherForCoordinates } from "../lib/nws-weather";
import type { Env } from "../index";

const JSON_HEADERS = { "Content-Type": "application/json" };
const WARNINGS_RADIUS_MILES = 700;

const OVERLAY_KEYS = [
  "overlay_target_city",
  "overlay_target_state",
  "overlay_ticker_text",
  "android_app_version_name",
] as const;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

function cacheAgeSeconds(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = Date.parse(withZone);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.floor((Date.now() - parsed) / 1000);
}

async function handleDashboardStatus(env: Env): Promise<Response> {
  const timestamp = new Date().toISOString();

  const counts = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM gps_devices`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM gps_latest_location`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM gps_devices WHERE is_platform_source = 1`),
  ]);

  const readCount = (index: number) =>
    (counts[index].results?.[0] as { count: number } | undefined)?.count ?? 0;

  const platform = await getPlatformSource(env);

  let warnings: Record<string, unknown> | null = null;
  if (platform?.location) {
    try {
      const result = await getAlertsWithinRadius(
        env,
        platform.latitude,
        platform.longitude,
        WARNINGS_RADIUS_MILES,
      );
      warnings = {
        alert_count: result.alerts.length,
        fetched_at: result.fetched_at,
        radius_miles: WARNINGS_RADIUS_MILES,
        from_cache: result.from_cache,
        poll_interval_seconds: result.settings.poll_interval_seconds,
        next_refresh_at: result.settings.next_refresh_at,
      };
    } catch (error) {
      warnings = {
        error: error instanceof Error ? error.message : "Warnings fetch failed",
      };
    }
  }

  let weather: Record<string, unknown> | null = null;
  if (platform?.location) {
    try {
      const current = await getWeatherForCoordinates(
        env,
        platform.latitude,
        platform.longitude,
      );
      weather = {
        conditions: current.conditions,
        temperature_f: current.temperature_f,
        location_city: current.location_city,
        location_state: current.location_state,
        fetched_at: current.fetched_at,
        stale: current.stale,
        from_cache: current.from_cache,
      };
    } catch (error) {
      weather = {
        error: error instanceof Error ? error.message : "Weather fetch failed",
      };
    }
  }

  const overlaySettings: Record<string, string> = {};
  for (const key of OVERLAY_KEYS) {
    const row = await env.DB.prepare(`SELECT value FROM overlay_settings WHERE key = ?`)
      .bind(key)
      .first<{ value: string }>();
    overlaySettings[key] = row?.value?.trim() ?? "";
  }

  const overlayUpdated = await env.DB.prepare(
    `SELECT MAX(updated_at) AS updated_at FROM overlay_settings
     WHERE key IN (${OVERLAY_KEYS.map(() => "?").join(", ")})`,
  )
    .bind(...OVERLAY_KEYS)
    .first<{ updated_at: string | null }>();

  const { results: chaserRows } = await env.DB.prepare(
    `SELECT enabled, is_live FROM chasers_stream_sources`,
  ).all<{ enabled: number; is_live: number }>();

  const chaserCache = await env.DB.prepare(
    `SELECT last_refreshed_at, cache_ttl_seconds FROM chasers_live_cache WHERE id = 1`,
  ).first<{ last_refreshed_at: string | null; cache_ttl_seconds: number }>();

  const chaserSources = chaserRows ?? [];
  const enabledSources = chaserSources.filter((row) => row.enabled === 1);

  return json({
    ok: true,
    timestamp,
    system: {
      ok: true,
      environment: env.ENVIRONMENT ?? "development",
    },
    gps: {
      device_count: readCount(0),
      located_device_count: readCount(1),
      platform_source_count: readCount(2),
      platform: platform
        ? {
            device_id: platform.device_id,
            device_name: platform.device_name,
            status: platform.status,
            latitude: platform.location?.latitude ?? null,
            longitude: platform.location?.longitude ?? null,
            received_at_utc: platform.location?.received_at_utc ?? null,
            speed_mph: platform.location?.speed_mph ?? null,
          }
        : null,
    },
    warnings,
    weather,
    overlays: {
      target_city: overlaySettings.overlay_target_city,
      target_state: overlaySettings.overlay_target_state,
      ticker_text: overlaySettings.overlay_ticker_text,
      android_app_version_name: overlaySettings.android_app_version_name,
      updated_at: overlayUpdated?.updated_at ?? null,
    },
    chasers: {
      source_count: chaserSources.length,
      enabled_count: enabledSources.length,
      live_count: enabledSources.filter((row) => row.is_live === 1).length,
      last_refreshed_at: chaserCache?.last_refreshed_at ?? null,
      cache_ttl_seconds: chaserCache?.cache_ttl_seconds ?? 120,
      cache_age_seconds: cacheAgeSeconds(chaserCache?.last_refreshed_at ?? null),
    },
  });
}

export async function handleDashboard(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    if (pathname === "/api/dashboard/status" && method === "GET") {
      return handleDashboardStatus(env);
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    return routeErrorResponse(error, "Dashboard API");
  }
}
