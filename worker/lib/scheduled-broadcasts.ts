import type { Env } from "../index";
import { youtubeWatchUrlFromExternalId } from "./youtube-live";

export const BROADCAST_STATUSES = [
  "draft",
  "scheduled",
  "selected",
  "preparing",
  "prepared",
  "starting_output",
  "waiting_for_ingest",
  "ready_to_go_live",
  "going_live",
  "live",
  "ending",
  "completed",
  "cancelled",
  "failed",
] as const;

export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export interface ScheduledBroadcast {
  id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  time_zone: string;
  platform: string;
  visibility: string;
  expected_duration_minutes: number | null;
  auto_start: boolean;
  auto_stop: boolean;
  starting_scene: string | null;
  main_live_scene: string | null;
  ending_scene: string | null;
  obs_profile: string | null;
  operator_notes: string | null;
  status: BroadcastStatus;
  is_selected: boolean;
  operation_id: string | null;
  workflow_step: string | null;
  external_platform_id: string | null;
  /** Derived when platform is youtube and Prepare stored YouTube ids. */
  watch_url: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  error_message: string | null;
  emergency_stopped: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BroadcastInput {
  title?: string;
  description?: string | null;
  scheduled_at?: string;
  time_zone?: string;
  platform?: string;
  visibility?: string;
  expected_duration_minutes?: number | null;
  auto_start?: boolean;
  auto_stop?: boolean;
  starting_scene?: string | null;
  main_live_scene?: string | null;
  ending_scene?: string | null;
  obs_profile?: string | null;
  operator_notes?: string | null;
  save_as_draft?: boolean;
}

interface Row {
  id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  time_zone: string;
  platform: string;
  visibility: string;
  expected_duration_minutes: number | null;
  auto_start: number;
  auto_stop: number;
  starting_scene: string | null;
  main_live_scene: string | null;
  ending_scene: string | null;
  obs_profile: string | null;
  operator_notes: string | null;
  status: string;
  is_selected: number;
  operation_id: string | null;
  workflow_step: string | null;
  external_platform_id: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  error_message: string | null;
  emergency_stopped: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function rowToBroadcast(row: Row): ScheduledBroadcast {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    scheduled_at: row.scheduled_at,
    time_zone: row.time_zone,
    platform: row.platform,
    visibility: row.visibility,
    expected_duration_minutes: row.expected_duration_minutes,
    auto_start: row.auto_start === 1,
    auto_stop: row.auto_stop === 1,
    starting_scene: row.starting_scene,
    main_live_scene: row.main_live_scene,
    ending_scene: row.ending_scene,
    obs_profile: row.obs_profile,
    operator_notes: row.operator_notes,
    status: row.status as BroadcastStatus,
    is_selected: row.is_selected === 1,
    operation_id: row.operation_id,
    workflow_step: row.workflow_step,
    external_platform_id: row.external_platform_id,
    watch_url:
      row.platform === "youtube"
        ? youtubeWatchUrlFromExternalId(row.external_platform_id)
        : null,
    actual_start_at: row.actual_start_at,
    actual_end_at: row.actual_end_at,
    error_message: row.error_message,
    emergency_stopped: row.emergency_stopped === 1,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

const ALLOWED_TRANSITIONS: Record<BroadcastStatus, BroadcastStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["selected", "cancelled", "draft"],
  selected: ["preparing", "scheduled", "cancelled"],
  preparing: ["prepared", "failed", "cancelled"],
  prepared: ["starting_output", "selected", "failed", "cancelled"],
  starting_output: ["waiting_for_ingest", "failed", "ready_to_go_live"],
  waiting_for_ingest: ["ready_to_go_live", "failed"],
  ready_to_go_live: ["going_live", "failed", "ending"],
  going_live: ["live", "failed", "ready_to_go_live"],
  live: ["ending", "failed"],
  ending: ["completed", "failed"],
  completed: [],
  cancelled: [],
  failed: ["scheduled", "selected", "cancelled", "waiting_for_ingest", "ready_to_go_live", "prepared", "going_live"],
};

export function canTransition(from: BroadcastStatus, to: BroadcastStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function listScheduledBroadcasts(
  env: Env,
  opts?: { from?: string; to?: string },
): Promise<ScheduledBroadcast[]> {
  let sql = `SELECT * FROM scheduled_broadcasts WHERE 1=1`;
  const binds: string[] = [];
  if (opts?.from) {
    sql += ` AND scheduled_at >= ?`;
    binds.push(opts.from);
  }
  if (opts?.to) {
    sql += ` AND scheduled_at <= ?`;
    binds.push(opts.to);
  }
  sql += ` ORDER BY scheduled_at ASC`;
  const stmt = env.DB.prepare(sql);
  const result = binds.length
    ? await stmt.bind(...binds).all<Row>()
    : await stmt.all<Row>();
  return (result.results ?? []).map(rowToBroadcast);
}

export async function getScheduledBroadcast(
  env: Env,
  id: string,
): Promise<ScheduledBroadcast | null> {
  const row = await env.DB.prepare(`SELECT * FROM scheduled_broadcasts WHERE id = ?`)
    .bind(id)
    .first<Row>();
  return row ? rowToBroadcast(row) : null;
}

export async function getSelectedBroadcast(env: Env): Promise<ScheduledBroadcast | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM scheduled_broadcasts WHERE is_selected = 1 ORDER BY updated_at DESC LIMIT 1`,
  ).first<Row>();
  return row ? rowToBroadcast(row) : null;
}

export async function getActiveWorkflowBroadcast(env: Env): Promise<ScheduledBroadcast | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM scheduled_broadcasts
     WHERE status IN (
       'preparing','prepared','starting_output','waiting_for_ingest',
       'ready_to_go_live','going_live','live','ending'
     )
     ORDER BY updated_at DESC LIMIT 1`,
  ).first<Row>();
  return row ? rowToBroadcast(row) : null;
}

function validateInput(input: BroadcastInput, partial = false): void {
  if (!partial || input.title !== undefined) {
    if (!input.title || !String(input.title).trim()) {
      throw new Error("Title is required");
    }
  }
  if (!partial || input.scheduled_at !== undefined) {
    if (!input.scheduled_at || Number.isNaN(Date.parse(input.scheduled_at))) {
      throw new Error("Valid scheduled_at is required");
    }
  }
  if (input.platform && !["obs", "youtube"].includes(input.platform)) {
    throw new Error("Unsupported platform");
  }
  if (input.visibility && !["private", "unlisted", "public"].includes(input.visibility)) {
    throw new Error("Invalid visibility");
  }
}

export async function createScheduledBroadcast(
  env: Env,
  input: BroadcastInput,
  createdBy: string | null,
): Promise<ScheduledBroadcast> {
  validateInput(input, false);
  const id = newId("sb");
  const now = nowIso();
  const status: BroadcastStatus = input.save_as_draft ? "draft" : "scheduled";
  await env.DB.prepare(
    `INSERT INTO scheduled_broadcasts (
      id, title, description, scheduled_at, time_zone, platform, visibility,
      expected_duration_minutes, auto_start, auto_stop,
      starting_scene, main_live_scene, ending_scene, obs_profile, operator_notes,
      status, is_selected, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  )
    .bind(
      id,
      String(input.title).trim(),
      input.description?.trim() || null,
      input.scheduled_at!,
      input.time_zone || "America/Chicago",
      input.platform || "youtube",
      input.visibility || "public",
      input.expected_duration_minutes ?? null,
      input.auto_start ? 1 : 0,
      input.auto_stop ? 1 : 0,
      input.starting_scene?.trim() || null,
      input.main_live_scene?.trim() || null,
      input.ending_scene?.trim() || null,
      input.obs_profile?.trim() || null,
      input.operator_notes?.trim() || null,
      status,
      createdBy,
      now,
      now,
    )
    .run();
  const created = await getScheduledBroadcast(env, id);
  if (!created) throw new Error("Failed to create broadcast");
  return created;
}

export async function updateScheduledBroadcast(
  env: Env,
  id: string,
  input: BroadcastInput,
): Promise<ScheduledBroadcast> {
  const existing = await getScheduledBroadcast(env, id);
  if (!existing) throw new Error("Broadcast not found");
  if (["live", "ending", "completed"].includes(existing.status)) {
    throw new Error("Cannot edit a live or completed broadcast");
  }
  validateInput(
    {
      title: input.title ?? existing.title,
      scheduled_at: input.scheduled_at ?? existing.scheduled_at,
      platform: input.platform ?? existing.platform,
      visibility: input.visibility ?? existing.visibility,
    },
    false,
  );

  let nextStatus = existing.status;
  if (input.save_as_draft === true) nextStatus = "draft";
  else if (input.save_as_draft === false && existing.status === "draft") nextStatus = "scheduled";

  const now = nowIso();
  await env.DB.prepare(
    `UPDATE scheduled_broadcasts SET
      title = ?, description = ?, scheduled_at = ?, time_zone = ?, platform = ?, visibility = ?,
      expected_duration_minutes = ?, auto_start = ?, auto_stop = ?,
      starting_scene = ?, main_live_scene = ?, ending_scene = ?, obs_profile = ?, operator_notes = ?,
      status = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      (input.title ?? existing.title).trim(),
      input.description !== undefined ? input.description?.trim() || null : existing.description,
      input.scheduled_at ?? existing.scheduled_at,
      input.time_zone ?? existing.time_zone,
      input.platform ?? existing.platform,
      input.visibility ?? existing.visibility,
      input.expected_duration_minutes !== undefined
        ? input.expected_duration_minutes
        : existing.expected_duration_minutes,
      (input.auto_start ?? existing.auto_start) ? 1 : 0,
      (input.auto_stop ?? existing.auto_stop) ? 1 : 0,
      input.starting_scene !== undefined
        ? input.starting_scene?.trim() || null
        : existing.starting_scene,
      input.main_live_scene !== undefined
        ? input.main_live_scene?.trim() || null
        : existing.main_live_scene,
      input.ending_scene !== undefined
        ? input.ending_scene?.trim() || null
        : existing.ending_scene,
      input.obs_profile !== undefined ? input.obs_profile?.trim() || null : existing.obs_profile,
      input.operator_notes !== undefined
        ? input.operator_notes?.trim() || null
        : existing.operator_notes,
      nextStatus,
      now,
      id,
    )
    .run();

  const updated = await getScheduledBroadcast(env, id);
  if (!updated) throw new Error("Broadcast not found after update");
  return updated;
}

export async function selectBroadcast(env: Env, id: string): Promise<ScheduledBroadcast> {
  const broadcast = await getScheduledBroadcast(env, id);
  if (!broadcast) throw new Error("Broadcast not found");
  if (["completed", "cancelled"].includes(broadcast.status)) {
    throw new Error("Cannot select a completed or cancelled broadcast");
  }
  if (["live", "ending", "going_live", "waiting_for_ingest", "starting_output", "preparing"].includes(broadcast.status)) {
    // already in workflow — keep selected
  }

  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE scheduled_broadcasts SET is_selected = 0, updated_at = ?`).bind(now),
    env.DB.prepare(
      `UPDATE scheduled_broadcasts SET is_selected = 1, status = CASE
         WHEN status IN ('draft','scheduled','failed') THEN 'selected'
         ELSE status
       END, updated_at = ?
       WHERE id = ?`,
    ).bind(now, id),
  ]);

  const selected = await getScheduledBroadcast(env, id);
  if (!selected) throw new Error("Broadcast not found");
  return selected;
}

export async function cancelBroadcast(env: Env, id: string): Promise<ScheduledBroadcast> {
  const broadcast = await getScheduledBroadcast(env, id);
  if (!broadcast) throw new Error("Broadcast not found");
  if (["live", "ending", "going_live"].includes(broadcast.status)) {
    throw new Error("Cannot cancel a live broadcast — use End Broadcast or Emergency Stop");
  }
  if (!canTransition(broadcast.status, "cancelled") && broadcast.status !== "cancelled") {
    if (!["draft", "scheduled", "selected", "prepared", "failed"].includes(broadcast.status)) {
      throw new Error(`Cannot cancel from status ${broadcast.status}`);
    }
  }
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE scheduled_broadcasts SET status = 'cancelled', is_selected = 0, updated_at = ? WHERE id = ?`,
  )
    .bind(now, id)
    .run();
  const updated = await getScheduledBroadcast(env, id);
  if (!updated) throw new Error("Broadcast not found");
  return updated;
}

export async function deleteBroadcast(env: Env, id: string): Promise<void> {
  const broadcast = await getScheduledBroadcast(env, id);
  if (!broadcast) throw new Error("Broadcast not found");
  if (!["draft", "cancelled", "completed", "failed"].includes(broadcast.status)) {
    throw new Error("Only draft, cancelled, completed, or failed broadcasts can be deleted");
  }
  await env.DB.prepare(`DELETE FROM scheduled_broadcasts WHERE id = ?`).bind(id).run();
}

export async function setBroadcastStatus(
  env: Env,
  id: string,
  status: BroadcastStatus,
  extra?: {
    workflow_step?: string | null;
    operation_id?: string | null;
    error_message?: string | null;
    actual_start_at?: string | null;
    actual_end_at?: string | null;
    emergency_stopped?: boolean;
  },
): Promise<ScheduledBroadcast> {
  const existing = await getScheduledBroadcast(env, id);
  if (!existing) throw new Error("Broadcast not found");
  if (existing.status !== status && !canTransition(existing.status, status)) {
    // allow same-status updates for step progress
    if (existing.status !== status) {
      throw new Error(`Invalid transition ${existing.status} → ${status}`);
    }
  }
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE scheduled_broadcasts SET
      status = ?,
      workflow_step = COALESCE(?, workflow_step),
      operation_id = COALESCE(?, operation_id),
      error_message = ?,
      actual_start_at = COALESCE(?, actual_start_at),
      actual_end_at = COALESCE(?, actual_end_at),
      emergency_stopped = CASE WHEN ? IS NULL THEN emergency_stopped ELSE ? END,
      updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      status,
      extra?.workflow_step ?? null,
      extra?.operation_id ?? null,
      extra?.error_message !== undefined ? extra.error_message : existing.error_message,
      extra?.actual_start_at ?? null,
      extra?.actual_end_at ?? null,
      extra?.emergency_stopped === undefined ? null : extra.emergency_stopped ? 1 : 0,
      extra?.emergency_stopped === undefined ? null : extra.emergency_stopped ? 1 : 0,
      now,
      id,
    )
    .run();

  return (await getScheduledBroadcast(env, id))!;
}

export async function setExternalPlatformId(
  env: Env,
  id: string,
  externalPlatformId: string | null,
): Promise<ScheduledBroadcast> {
  const existing = await getScheduledBroadcast(env, id);
  if (!existing) throw new Error("Broadcast not found");
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE scheduled_broadcasts SET external_platform_id = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(externalPlatformId, now, id)
    .run();
  return (await getScheduledBroadcast(env, id))!;
}

export async function createOperation(
  env: Env,
  broadcastId: string,
  operationType: string,
  createdBy: string | null,
  steps: Array<{ key: string; label: string; status: string; detail?: string }> = [],
): Promise<string> {
  const id = newId("op");
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO broadcast_operations
      (id, broadcast_id, operation_type, status, steps_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
  )
    .bind(id, broadcastId, operationType, JSON.stringify(steps), createdBy, now, now)
    .run();
  return id;
}

export async function updateOperation(
  env: Env,
  operationId: string,
  patch: {
    status?: string;
    steps?: Array<{ key: string; label: string; status: string; detail?: string }>;
    error_message?: string | null;
  },
): Promise<void> {
  const now = nowIso();
  const row = await env.DB.prepare(`SELECT steps_json FROM broadcast_operations WHERE id = ?`)
    .bind(operationId)
    .first<{ steps_json: string }>();
  if (!row) return;
  await env.DB.prepare(
    `UPDATE broadcast_operations SET
      status = COALESCE(?, status),
      steps_json = COALESCE(?, steps_json),
      error_message = COALESCE(?, error_message),
      updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      patch.status ?? null,
      patch.steps ? JSON.stringify(patch.steps) : null,
      patch.error_message ?? null,
      now,
      operationId,
    )
    .run();
}

export async function getOperation(env: Env, operationId: string) {
  return env.DB.prepare(`SELECT * FROM broadcast_operations WHERE id = ?`)
    .bind(operationId)
    .first();
}
