import {
  extractBearerToken,
  findDeviceByToken,
  generateDeviceToken,
  hashToken,
  verifyPairingPin,
} from "../lib/gps-auth";
import { routeErrorResponse } from "../lib/db-errors";
import {
  getGpsConnectionStatus,
  GPS_HISTORY_INTERVAL_SECONDS,
} from "../lib/gps-status";
import type { Env } from "../index";

const JSON_HEADERS = { "Content-Type": "application/json" };

interface GpsDeviceRow {
  id: string;
  device_name: string;
  is_platform_source: number;
  enabled: number;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

interface GpsLatestLocationRow {
  device_id: string;
  latitude: number;
  longitude: number;
  speed_mph: number | null;
  heading_degrees: number | null;
  accuracy_meters: number | null;
  altitude_meters: number | null;
  battery_percent: number | null;
  timestamp_utc: string;
  received_at_utc: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

function nowUtc(): string {
  return new Date().toISOString();
}

function deviceToJson(
  device: GpsDeviceRow,
  location: GpsLatestLocationRow | null,
) {
  const status = getGpsConnectionStatus(location?.received_at_utc ?? device.last_seen_at);

  return {
    id: device.id,
    device_name: device.device_name,
    enabled: device.enabled === 1,
    is_platform_source: device.is_platform_source === 1,
    last_seen_at: device.last_seen_at,
    created_at: device.created_at,
    updated_at: device.updated_at,
    status,
    location: location
      ? {
          latitude: location.latitude,
          longitude: location.longitude,
          speed_mph: location.speed_mph,
          heading_degrees: location.heading_degrees,
          accuracy_meters: location.accuracy_meters,
          altitude_meters: location.altitude_meters,
          battery_percent: location.battery_percent,
          timestamp_utc: location.timestamp_utc,
          received_at_utc: location.received_at_utc,
          status,
        }
      : null,
  };
}

async function getLatestLocation(
  env: Env,
  deviceId: string,
): Promise<GpsLatestLocationRow | null> {
  return env.DB.prepare(
    `SELECT device_id, latitude, longitude, speed_mph, heading_degrees,
            accuracy_meters, altitude_meters, battery_percent,
            timestamp_utc, received_at_utc
     FROM gps_latest_location
     WHERE device_id = ?`,
  )
    .bind(deviceId)
    .first<GpsLatestLocationRow>();
}

async function handleGpsHealth(env: Env): Promise<Response> {
  const counts = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM gps_devices`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM gps_latest_location`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM gps_location_history`),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM gps_devices WHERE is_platform_source = 1`,
    ),
  ]);

  const readCount = (index: number) =>
    (counts[index].results?.[0] as { count: number } | undefined)?.count ?? 0;

  const downloadSetting = await env.DB.prepare(
    `SELECT value FROM overlay_settings WHERE key = ?`,
  )
    .bind("android_app_download_url")
    .first<{ value: string }>();

  return json({
    ok: true,
    service: "gps",
    pairing_configured:
      typeof env.GPS_PAIRING_PIN === "string" && env.GPS_PAIRING_PIN.trim().length > 0,
    android_app_download_url: downloadSetting?.value?.trim() || null,
    counts: {
      devices: readCount(0),
      latest_locations: readCount(1),
      history_points: readCount(2),
      platform_sources: readCount(3),
    },
    timestamp: nowUtc(),
  });
}

async function handlePair(request: Request, env: Env): Promise<Response> {
  if (!env.GPS_PAIRING_PIN?.trim()) {
    return errorResponse("GPS pairing PIN is not configured on the server", 503);
  }

  let body: { pin?: string; device_name?: string; device_id?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const pin = body.pin?.trim();
  const deviceName = body.device_name?.trim();
  const deviceId = body.device_id?.trim();

  if (!pin) {
    return errorResponse("pin is required");
  }
  if (!deviceName) {
    return errorResponse("device_name is required");
  }
  if (!verifyPairingPin(env, pin)) {
    return errorResponse("Invalid pairing PIN", 401);
  }

  const token = generateDeviceToken();
  const tokenHash = await hashToken(token);
  const timestamp = nowUtc();

  let resolvedDeviceId = deviceId ?? "";

  if (resolvedDeviceId) {
    const existingById = await env.DB.prepare(
      `SELECT id FROM gps_devices WHERE id = ?`,
    )
      .bind(resolvedDeviceId)
      .first<{ id: string }>();

    if (existingById) {
      await env.DB.prepare(
        `UPDATE gps_devices
         SET device_name = ?, device_token_hash = ?, enabled = 1, updated_at = ?
         WHERE id = ?`,
      )
        .bind(deviceName, tokenHash, timestamp, resolvedDeviceId)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO gps_devices
           (id, device_name, device_token_hash, enabled, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
        .bind(resolvedDeviceId, deviceName, tokenHash, timestamp, timestamp)
        .run();
    }
  } else {
    const existingByName = await env.DB.prepare(
      `SELECT id FROM gps_devices WHERE device_name = ? COLLATE NOCASE`,
    )
      .bind(deviceName)
      .first<{ id: string }>();

    if (existingByName) {
      resolvedDeviceId = existingByName.id;
      await env.DB.prepare(
        `UPDATE gps_devices
         SET device_token_hash = ?, enabled = 1, updated_at = ?
         WHERE id = ?`,
      )
        .bind(tokenHash, timestamp, resolvedDeviceId)
        .run();
    } else {
      resolvedDeviceId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO gps_devices
           (id, device_name, device_token_hash, enabled, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
        .bind(resolvedDeviceId, deviceName, tokenHash, timestamp, timestamp)
        .run();
    }
  }

  return json({
    ok: true,
    device_id: resolvedDeviceId,
    device_name: deviceName,
    device_token: token,
  });
}

async function handleUpdate(request: Request, env: Env): Promise<Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return errorResponse("Missing Bearer device token", 401);
  }

  const device = await findDeviceByToken(env, token);
  if (!device) {
    return errorResponse("Invalid device token", 401);
  }
  if (device.enabled !== 1) {
    return errorResponse("Device is disabled", 403);
  }

  let body: {
    latitude?: number;
    longitude?: number;
    speed_mph?: number | null;
    heading_degrees?: number | null;
    accuracy_meters?: number | null;
    altitude_meters?: number | null;
    battery_percent?: number | null;
    timestamp_utc?: string;
    device_name?: string;
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  if (typeof body.latitude !== "number" || typeof body.longitude !== "number") {
    return errorResponse("latitude and longitude are required numbers");
  }

  const timestampUtc = body.timestamp_utc?.trim() || nowUtc();
  const receivedAtUtc = nowUtc();
  const serverTimestamp = nowUtc();

  if (body.device_name?.trim()) {
    await env.DB.prepare(
      `UPDATE gps_devices SET device_name = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(body.device_name.trim(), serverTimestamp, device.id)
      .run();
  }

  await env.DB.prepare(
    `INSERT INTO gps_latest_location
       (device_id, latitude, longitude, speed_mph, heading_degrees,
        accuracy_meters, altitude_meters, battery_percent,
        timestamp_utc, received_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       latitude = excluded.latitude,
       longitude = excluded.longitude,
       speed_mph = excluded.speed_mph,
       heading_degrees = excluded.heading_degrees,
       accuracy_meters = excluded.accuracy_meters,
       altitude_meters = excluded.altitude_meters,
       battery_percent = excluded.battery_percent,
       timestamp_utc = excluded.timestamp_utc,
       received_at_utc = excluded.received_at_utc`,
  )
    .bind(
      device.id,
      body.latitude,
      body.longitude,
      body.speed_mph ?? null,
      body.heading_degrees ?? null,
      body.accuracy_meters ?? null,
      body.altitude_meters ?? null,
      body.battery_percent ?? null,
      timestampUtc,
      receivedAtUtc,
    )
    .run();

  await env.DB.prepare(
    `UPDATE gps_devices SET last_seen_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(receivedAtUtc, serverTimestamp, device.id)
    .run();

  const lastHistory = await env.DB.prepare(
    `SELECT received_at_utc
     FROM gps_location_history
     WHERE device_id = ?
     ORDER BY received_at_utc DESC
     LIMIT 1`,
  )
    .bind(device.id)
    .first<{ received_at_utc: string }>();

  const shouldInsertHistory =
    !lastHistory?.received_at_utc ||
    (Date.now() - Date.parse(lastHistory.received_at_utc.replace(" ", "T") + "Z")) /
      1000 >=
      GPS_HISTORY_INTERVAL_SECONDS;

  if (shouldInsertHistory) {
    await env.DB.prepare(
      `INSERT INTO gps_location_history
         (id, device_id, latitude, longitude, speed_mph, heading_degrees,
          accuracy_meters, altitude_meters, battery_percent,
          timestamp_utc, received_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        device.id,
        body.latitude,
        body.longitude,
        body.speed_mph ?? null,
        body.heading_degrees ?? null,
        body.accuracy_meters ?? null,
        body.altitude_meters ?? null,
        body.battery_percent ?? null,
        timestampUtc,
        receivedAtUtc,
      )
      .run();
  }

  return json({
    ok: true,
    device_id: device.id,
    received_at_utc: receivedAtUtc,
    history_inserted: shouldInsertHistory,
  });
}

async function handleListDevices(env: Env): Promise<Response> {
  const { results: devices } = await env.DB.prepare(
    `SELECT id, device_name, is_platform_source, enabled, last_seen_at,
            created_at, updated_at
     FROM gps_devices
     ORDER BY device_name COLLATE NOCASE ASC`,
  ).all<GpsDeviceRow>();

  const deviceList = await Promise.all(
    (devices ?? []).map(async (device) => {
      const location = await getLatestLocation(env, device.id);
      return deviceToJson(device, location);
    }),
  );

  return json({
    ok: true,
    devices: deviceList,
    live_threshold_seconds: 30,
  });
}

async function handleGetPlatform(env: Env): Promise<Response> {
  const device = await env.DB.prepare(
    `SELECT id, device_name, is_platform_source, enabled, last_seen_at,
            created_at, updated_at
     FROM gps_devices
     WHERE is_platform_source = 1
     LIMIT 1`,
  ).first<GpsDeviceRow>();

  if (!device) {
    return json({
      ok: true,
      platform_source: null,
      message: "No platform GPS source selected",
    });
  }

  const location = await getLatestLocation(env, device.id);

  return json({
    ok: true,
    platform_source: deviceToJson(device, location),
  });
}

async function handleSetPlatform(request: Request, env: Env): Promise<Response> {
  let body: { device_id?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const deviceId = body.device_id?.trim();
  if (!deviceId) {
    return errorResponse("device_id is required");
  }

  const device = await env.DB.prepare(
    `SELECT id, device_name, is_platform_source, enabled, last_seen_at,
            created_at, updated_at
     FROM gps_devices
     WHERE id = ?`,
  )
    .bind(deviceId)
    .first<GpsDeviceRow>();

  if (!device) {
    return errorResponse("Device not found", 404);
  }

  const timestamp = nowUtc();

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE gps_devices SET is_platform_source = 0, updated_at = ?`,
    ).bind(timestamp),
    env.DB.prepare(
      `UPDATE gps_devices
       SET is_platform_source = 1, updated_at = ?
       WHERE id = ?`,
    ).bind(timestamp, deviceId),
  ]);

  const updatedDevice = { ...device, is_platform_source: 1, updated_at: timestamp };
  const location = await getLatestLocation(env, deviceId);

  return json({
    ok: true,
    platform_source: deviceToJson(updatedDevice, location),
  });
}

export async function handleGps(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    if (pathname === "/api/gps/health" && method === "GET") {
      return handleGpsHealth(env);
    }

    if (pathname === "/api/gps/pair" && method === "POST") {
      return handlePair(request, env);
    }

    if (pathname === "/api/gps/update" && method === "POST") {
      return handleUpdate(request, env);
    }

    if (pathname === "/api/gps/devices" && method === "GET") {
      return handleListDevices(env);
    }

    if (pathname === "/api/gps/platform" && method === "GET") {
      return handleGetPlatform(env);
    }

    if (pathname === "/api/gps/platform" && method === "POST") {
      return handleSetPlatform(request, env);
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    return routeErrorResponse(error, "GPS API");
  }
}
