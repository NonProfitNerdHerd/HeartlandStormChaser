import { routeErrorResponse } from "../lib/db-errors";
import { getPlatformSource } from "../lib/gps-platform";
import {
  getAlertsWithinRadius,
  getWarningsSettings,
  updateWarningsPollInterval,
  WARNINGS_POLL_INTERVALS_SECONDS,
} from "../lib/nws-alerts";
import type { Env } from "../index";

const JSON_HEADERS = { "Content-Type": "application/json" };
const DEFAULT_RADIUS_MILES = 700;
const MIN_RADIUS_MILES = 5;
const MAX_RADIUS_MILES = 1000;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

function parseCoordinate(value: string | null, name: string): number | null {
  if (value == null || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a valid number`);
  }
  return parsed;
}

function parseRadiusMiles(value: string | null): number {
  if (value == null || value.trim() === "") {
    return DEFAULT_RADIUS_MILES;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error("radius_miles must be a valid number");
  }

  return Math.min(MAX_RADIUS_MILES, Math.max(MIN_RADIUS_MILES, parsed));
}

function parseForceRefresh(value: string | null): boolean {
  return value === "1" || value === "true";
}

async function handleGetSettings(env: Env): Promise<Response> {
  const settings = await getWarningsSettings(env);
  return json({
    ok: true,
    settings,
    allowed_poll_intervals_seconds: [...WARNINGS_POLL_INTERVALS_SECONDS],
  });
}

async function handlePutSettings(request: Request, env: Env): Promise<Response> {
  let body: { poll_interval_seconds?: number };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const pollIntervalSeconds = body.poll_interval_seconds;
  if (pollIntervalSeconds == null || Number.isNaN(Number(pollIntervalSeconds))) {
    return errorResponse("poll_interval_seconds is required");
  }

  const settings = await updateWarningsPollInterval(env, Number(pollIntervalSeconds));
  return json({
    ok: true,
    settings,
    allowed_poll_intervals_seconds: [...WARNINGS_POLL_INTERVALS_SECONDS],
  });
}

async function handleCurrentWarnings(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  try {
    const latitude = parseCoordinate(url.searchParams.get("lat"), "lat");
    const longitude = parseCoordinate(url.searchParams.get("lon"), "lon");
    const radiusMiles = parseRadiusMiles(url.searchParams.get("radius_miles"));
    const force = parseForceRefresh(url.searchParams.get("force"));

    if (latitude == null || longitude == null) {
      return errorResponse("lat and lon query parameters are required");
    }
    if (latitude < -90 || latitude > 90) {
      return errorResponse("lat must be between -90 and 90");
    }
    if (longitude < -180 || longitude > 180) {
      return errorResponse("lon must be between -180 and 180");
    }

    const result = await getAlertsWithinRadius(env, latitude, longitude, radiusMiles, { force });

    return json({
      ok: true,
      query: {
        latitude,
        longitude,
        radius_miles: radiusMiles,
      },
      alerts: result.alerts,
      alert_count: result.alerts.length,
      fetched_at: result.fetched_at,
      from_cache: result.from_cache,
      settings: result.settings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Warnings fetch failed";
    return errorResponse(message, 502);
  }
}

async function handlePlatformWarnings(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  try {
    const radiusMiles = parseRadiusMiles(url.searchParams.get("radius_miles"));
    const force = parseForceRefresh(url.searchParams.get("force"));
    const platform = await getPlatformSource(env);

    if (!platform?.location) {
      const settings = await getWarningsSettings(env);
      return json({
        ok: true,
        platform: platform
          ? {
              device_id: platform.device_id,
              device_name: platform.device_name,
              status: platform.status,
              location: null,
            }
          : null,
        query: null,
        alerts: [],
        alert_count: 0,
        settings,
        message: platform
          ? "Platform GPS source has no location yet"
          : "No platform GPS source selected",
      });
    }

    const result = await getAlertsWithinRadius(
      env,
      platform.latitude,
      platform.longitude,
      radiusMiles,
      { force },
    );

    return json({
      ok: true,
      platform: {
        device_id: platform.device_id,
        device_name: platform.device_name,
        status: platform.status,
        location: platform.location,
      },
      query: {
        latitude: platform.latitude,
        longitude: platform.longitude,
        radius_miles: radiusMiles,
      },
      alerts: result.alerts,
      alert_count: result.alerts.length,
      fetched_at: result.fetched_at,
      from_cache: result.from_cache,
      settings: result.settings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Warnings fetch failed";
    if (message.includes("no such table") || message.includes("D1_ERROR")) {
      return routeErrorResponse(error, "Warnings API");
    }
    return errorResponse(message, 502);
  }
}

export async function handleWarnings(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    if (pathname === "/api/warnings/settings" && method === "GET") {
      return handleGetSettings(env);
    }

    if (pathname === "/api/warnings/settings" && method === "PUT") {
      return handlePutSettings(request, env);
    }

    if (pathname === "/api/warnings/current" && method === "GET") {
      return handleCurrentWarnings(request, env);
    }

    if (pathname === "/api/warnings/platform" && method === "GET") {
      return handlePlatformWarnings(request, env);
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    return routeErrorResponse(error, "Warnings API");
  }
}
