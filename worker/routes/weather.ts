import { routeErrorResponse } from "../lib/db-errors";
import { getWeatherForCoordinates } from "../lib/nws-weather";
import type { Env } from "../index";

const JSON_HEADERS = { "Content-Type": "application/json" };

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

async function getPlatformCoordinates(
  env: Env,
): Promise<{ latitude: number; longitude: number; device_id: string; device_name: string } | null> {
  const row = await env.DB.prepare(
    `SELECT d.id AS device_id, d.device_name, l.latitude, l.longitude
     FROM gps_devices d
     INNER JOIN gps_latest_location l ON l.device_id = d.id
     WHERE d.is_platform_source = 1
     LIMIT 1`,
  ).first<{
    device_id: string;
    device_name: string;
    latitude: number;
    longitude: number;
  }>();

  if (!row) {
    return null;
  }

  return {
    device_id: row.device_id,
    device_name: row.device_name,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

async function handleCurrentWeather(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  try {
    const latitude = parseCoordinate(url.searchParams.get("lat"), "lat");
    const longitude = parseCoordinate(url.searchParams.get("lon"), "lon");

    if (latitude == null || longitude == null) {
      return errorResponse("lat and lon query parameters are required");
    }
    if (latitude < -90 || latitude > 90) {
      return errorResponse("lat must be between -90 and 90");
    }
    if (longitude < -180 || longitude > 180) {
      return errorResponse("lon must be between -180 and 180");
    }

    const weather = await getWeatherForCoordinates(env, latitude, longitude);
    return json({ ok: true, weather });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Weather fetch failed";
    return errorResponse(message, 502);
  }
}

async function handlePlatformWeather(env: Env): Promise<Response> {
  try {
    const platform = await getPlatformCoordinates(env);

    if (!platform) {
      return json({
        ok: true,
        weather: null,
        message: "No platform GPS source with a known location",
      });
    }

    const weather = await getWeatherForCoordinates(
      env,
      platform.latitude,
      platform.longitude,
    );

    return json({
      ok: true,
      weather,
      platform: {
        device_id: platform.device_id,
        device_name: platform.device_name,
        latitude: platform.latitude,
        longitude: platform.longitude,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Weather fetch failed";
    if (message.includes("no such table") || message.includes("D1_ERROR")) {
      return routeErrorResponse(error, "Weather API");
    }
    return errorResponse(message, 502);
  }
}

export async function handleWeather(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    if (pathname === "/api/weather/current" && method === "GET") {
      return handleCurrentWeather(request, env);
    }

    if (pathname === "/api/weather/platform" && method === "GET") {
      return handlePlatformWeather(env);
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    return routeErrorResponse(error, "Weather API");
  }
}
