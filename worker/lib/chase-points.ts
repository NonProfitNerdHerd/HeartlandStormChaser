import {
  calculateTotalDistanceMiles,
  shouldAcceptPoint,
  type ChasePointInput,
  type ChasePointRow,
} from "./chase-distance";
import type { Env } from "../index";

function nowUtc(): string {
  return new Date().toISOString();
}

function mapPointRow(row: Record<string, unknown>): ChasePointRow {
  return {
    id: String(row.id),
    lat: Number(row.lat),
    lng: Number(row.lng),
    accuracy: row.accuracy == null ? null : Number(row.accuracy),
    speed: row.speed == null ? null : Number(row.speed),
    heading: row.heading == null ? null : Number(row.heading),
    altitude: row.altitude == null ? null : Number(row.altitude),
    recordedAt: String(row.recorded_at),
  };
}

export async function getActiveChaseForDevice(
  env: Env,
  deviceId: string,
): Promise<{ id: string; status: string } | null> {
  const row = await env.DB.prepare(
    `SELECT id, status
     FROM chases
     WHERE device_id = ? AND status IN ('active', 'paused')
     ORDER BY start_time DESC
     LIMIT 1`,
  )
    .bind(deviceId)
    .first<{ id: string; status: string }>();

  return row ?? null;
}

async function getLastChasePoint(env: Env, chaseId: string): Promise<ChasePointRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, lat, lng, accuracy, speed, heading, altitude, recorded_at
     FROM chase_gps_points
     WHERE chase_id = ?
     ORDER BY recorded_at DESC
     LIMIT 1`,
  )
    .bind(chaseId)
    .first<Record<string, unknown>>();

  return row ? mapPointRow(row) : null;
}

async function getAllChasePoints(env: Env, chaseId: string): Promise<ChasePointRow[]> {
  const result = await env.DB.prepare(
    `SELECT id, lat, lng, accuracy, speed, heading, altitude, recorded_at
     FROM chase_gps_points
     WHERE chase_id = ?
     ORDER BY recorded_at ASC`,
  )
    .bind(chaseId)
    .all<Record<string, unknown>>();

  return (result.results ?? []).map(mapPointRow);
}

async function updateChaseDistance(env: Env, chaseId: string): Promise<void> {
  const points = await getAllChasePoints(env, chaseId);
  const total = calculateTotalDistanceMiles(points);
  await env.DB.prepare(
    `UPDATE chases SET total_distance_miles = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(total, nowUtc(), chaseId)
    .run();
}

export interface RecordChasePointInput extends ChasePointInput {
  chaseId: string;
  sourceDeviceId: string;
}

export async function recordChasePoint(
  env: Env,
  input: RecordChasePointInput,
): Promise<{ recorded: boolean; pointId?: string }> {
  const chase = await env.DB.prepare(
    `SELECT id, status, device_id FROM chases WHERE id = ?`,
  )
    .bind(input.chaseId)
    .first<{ id: string; status: string; device_id: string }>();

  if (!chase) {
    return { recorded: false };
  }

  if (chase.status !== "active") {
    return { recorded: false };
  }

  if (chase.device_id !== input.sourceDeviceId) {
    return { recorded: false };
  }

  const previous = await getLastChasePoint(env, input.chaseId);
  if (!shouldAcceptPoint(previous, input)) {
    return { recorded: false };
  }

  const pointId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO chase_gps_points
       (id, chase_id, lat, lng, accuracy, speed, heading, altitude, recorded_at, source_device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      pointId,
      input.chaseId,
      input.lat,
      input.lng,
      input.accuracy,
      input.speed,
      input.heading,
      input.altitude,
      input.recordedAt,
      input.sourceDeviceId,
    )
    .run();

  const updates: string[] = ["updated_at = ?"];
  const bindings: unknown[] = [nowUtc()];

  if (!previous) {
    updates.push("start_lat = ?", "start_lng = ?");
    bindings.push(input.lat, input.lng);
  }

  updates.push("end_lat = ?", "end_lng = ?");
  bindings.push(input.lat, input.lng);
  bindings.push(input.chaseId);

  await env.DB.prepare(
    `UPDATE chases SET ${updates.join(", ")} WHERE id = ?`,
  )
    .bind(...bindings)
    .run();

  await updateChaseDistance(env, input.chaseId);

  return { recorded: true, pointId };
}

export async function maybeRecordChasePointFromGpsUpdate(
  env: Env,
  deviceId: string,
  point: ChasePointInput,
): Promise<void> {
  const active = await getActiveChaseForDevice(env, deviceId);
  if (!active || active.status !== "active") {
    return;
  }

  await recordChasePoint(env, {
    chaseId: active.id,
    sourceDeviceId: deviceId,
    ...point,
  });
}
