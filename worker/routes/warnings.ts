import { routeErrorResponse } from "../lib/db-errors";
import { getPlatformSource } from "../lib/gps-platform";
import { getAlertsWithinRadius } from "../lib/nws-alerts";
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

async function handleCurrentWarnings(request: Request): Promise<Response> {
  const url = new URL(request.url);

  try {
    const latitude = parseCoordinate(url.searchParams.get("lat"), "lat");
    const longitude = parseCoordinate(url.searchParams.get("lon"), "lon");
    const radiusMiles = parseRadiusMiles(url.searchParams.get("radius_miles"));

    if (latitude == null || longitude == null) {
      return errorResponse("lat and lon query parameters are required");
    }
    if (latitude < -90 || latitude > 90) {
      return errorResponse("lat must be between -90 and 90");
    }
    if (longitude < -180 || longitude > 180) {
      return errorResponse("lon must be between -180 and 180");
    }

    const result = await getAlertsWithinRadius(latitude, longitude, radiusMiles);

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
    const platform = await getPlatformSource(env);

    if (!platform?.location) {
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
        message: platform
          ? "Platform GPS source has no location yet"
          : "No platform GPS source selected",
      });
    }

    const result = await getAlertsWithinRadius(
      platform.latitude,
      platform.longitude,
      radiusMiles,
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

    if (pathname === "/api/warnings/current" && method === "GET") {
      return handleCurrentWarnings(request);
    }

    if (pathname === "/api/warnings/platform" && method === "GET") {
      return handlePlatformWarnings(request, env);
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    return routeErrorResponse(error, "Warnings API");
  }
}
