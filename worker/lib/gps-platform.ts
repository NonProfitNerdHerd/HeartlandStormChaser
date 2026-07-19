import type { Env } from "../index";
import { getGpsConnectionStatus } from "./gps-status";

export interface PlatformLocation {
  latitude: number;
  longitude: number;
  speed_mph: number | null;
  heading_degrees: number | null;
  accuracy_meters: number | null;
  altitude_meters: number | null;
  battery_percent: number | null;
  timestamp_utc: string;
  received_at_utc: string;
  status: "LIVE" | "STALE" | "UNKNOWN";
}

export interface PlatformSource {
  device_id: string;
  device_name: string;
  latitude: number;
  longitude: number;
  status: "LIVE" | "STALE" | "UNKNOWN";
  location: PlatformLocation | null;
}

export async function getPlatformSource(env: Env): Promise<PlatformSource | null> {
  const device = await env.DB.prepare(
    `SELECT id, device_name
     FROM gps_devices
     WHERE is_platform_source = 1
     LIMIT 1`,
  ).first<{ id: string; device_name: string }>();

  if (!device) {
    return null;
  }

  const location = await env.DB.prepare(
    `SELECT latitude, longitude, speed_mph, heading_degrees, accuracy_meters,
            altitude_meters, battery_percent, timestamp_utc, received_at_utc
     FROM gps_latest_location
     WHERE device_id = ?`,
  )
    .bind(device.id)
    .first<{
      latitude: number;
      longitude: number;
      speed_mph: number | null;
      heading_degrees: number | null;
      accuracy_meters: number | null;
      altitude_meters: number | null;
      battery_percent: number | null;
      timestamp_utc: string;
      received_at_utc: string;
    }>();

  if (!location) {
    return {
      device_id: device.id,
      device_name: device.device_name,
      latitude: 0,
      longitude: 0,
      status: "UNKNOWN",
      location: null,
    };
  }

  const status = getGpsConnectionStatus(location.received_at_utc);

  return {
    device_id: device.id,
    device_name: device.device_name,
    latitude: location.latitude,
    longitude: location.longitude,
    status,
    location: {
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
    },
  };
}
