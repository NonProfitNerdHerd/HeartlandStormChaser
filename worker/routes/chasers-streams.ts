import { parseYouTubeUrl } from "../lib/youtube";
import type { Env } from "../index";

const JSON_HEADERS = { "Content-Type": "application/json" };

export interface StreamSourceRow {
  id: string;
  display_name: string;
  youtube_url: string;
  embed_url: string;
  notes: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

function rowToSource(row: StreamSourceRow) {
  return {
    id: row.id,
    display_name: row.display_name,
    youtube_url: row.youtube_url,
    embed_url: row.embed_url,
    notes: row.notes ?? "",
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listSources(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, display_name, youtube_url, embed_url, notes, enabled, created_at, updated_at
     FROM chasers_stream_sources
     ORDER BY display_name COLLATE NOCASE ASC`,
  ).all<StreamSourceRow>();

  return json({
    ok: true,
    sources: (results ?? []).map(rowToSource),
  });
}

async function createSource(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    display_name?: string;
    youtube_url?: string;
    notes?: string;
    enabled?: boolean;
  };

  const displayName = body.display_name?.trim();
  if (!displayName) {
    return errorResponse("display_name is required.");
  }

  const parsed = parseYouTubeUrl(body.youtube_url ?? "");
  if (!parsed.ok) {
    return errorResponse(parsed.error);
  }

  const id = crypto.randomUUID();
  const notes = body.notes?.trim() ?? "";
  const enabled = body.enabled === false ? 0 : 1;

  await env.DB.prepare(
    `INSERT INTO chasers_stream_sources
      (id, display_name, youtube_url, embed_url, notes, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, displayName, body.youtube_url!.trim(), parsed.embedUrl, notes, enabled)
    .run();

  const row = await env.DB.prepare(
    `SELECT id, display_name, youtube_url, embed_url, notes, enabled, created_at, updated_at
     FROM chasers_stream_sources WHERE id = ?`,
  )
    .bind(id)
    .first<StreamSourceRow>();

  return json({ ok: true, source: row ? rowToSource(row) : null }, 201);
}

async function updateSource(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await env.DB.prepare(
    `SELECT id FROM chasers_stream_sources WHERE id = ?`,
  )
    .bind(id)
    .first();

  if (!existing) {
    return errorResponse("Stream source not found.", 404);
  }

  const body = (await request.json()) as {
    display_name?: string;
    youtube_url?: string;
    notes?: string;
    enabled?: boolean;
  };

  const displayName = body.display_name?.trim();
  if (!displayName) {
    return errorResponse("display_name is required.");
  }

  const parsed = parseYouTubeUrl(body.youtube_url ?? "");
  if (!parsed.ok) {
    return errorResponse(parsed.error);
  }

  const notes = body.notes?.trim() ?? "";
  const enabled = body.enabled === false ? 0 : 1;

  await env.DB.prepare(
    `UPDATE chasers_stream_sources
     SET display_name = ?, youtube_url = ?, embed_url = ?, notes = ?, enabled = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(displayName, body.youtube_url!.trim(), parsed.embedUrl, notes, enabled, id)
    .run();

  const row = await env.DB.prepare(
    `SELECT id, display_name, youtube_url, embed_url, notes, enabled, created_at, updated_at
     FROM chasers_stream_sources WHERE id = ?`,
  )
    .bind(id)
    .first<StreamSourceRow>();

  return json({ ok: true, source: row ? rowToSource(row) : null });
}

async function deleteSource(env: Env, id: string): Promise<Response> {
  const existing = await env.DB.prepare(
    `SELECT id FROM chasers_stream_sources WHERE id = ?`,
  )
    .bind(id)
    .first();

  if (!existing) {
    return errorResponse("Stream source not found.", 404);
  }

  await env.DB.prepare(`DELETE FROM chasers_stream_sources WHERE id = ?`).bind(id).run();

  return json({ ok: true });
}

async function listSlots(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT
       s.slot_number,
       s.source_id,
       s.updated_at AS slot_updated_at,
       src.id AS src_id,
       src.display_name,
       src.youtube_url,
       src.embed_url,
       src.notes,
       src.enabled,
       src.created_at,
       src.updated_at AS src_updated_at
     FROM chasers_stream_slots s
     LEFT JOIN chasers_stream_sources src ON src.id = s.source_id
     ORDER BY s.slot_number ASC`,
  ).all<{
    slot_number: number;
    source_id: string | null;
    slot_updated_at: string;
    src_id: string | null;
    display_name: string | null;
    youtube_url: string | null;
    embed_url: string | null;
    notes: string | null;
    enabled: number | null;
    created_at: string | null;
    src_updated_at: string | null;
  }>();

  const slots = (results ?? []).map((row) => ({
    slot_number: row.slot_number,
    source_id: row.source_id,
    updated_at: row.slot_updated_at,
    source: row.src_id
      ? {
          id: row.src_id,
          display_name: row.display_name!,
          youtube_url: row.youtube_url!,
          embed_url: row.embed_url!,
          notes: row.notes ?? "",
          enabled: row.enabled === 1,
          created_at: row.created_at!,
          updated_at: row.src_updated_at!,
        }
      : null,
  }));

  return json({ ok: true, slots });
}

async function assignSlot(
  request: Request,
  env: Env,
  slotNumber: number,
): Promise<Response> {
  if (slotNumber < 1 || slotNumber > 4) {
    return errorResponse("slot_number must be between 1 and 4.");
  }

  const body = (await request.json()) as { source_id?: string | null };
  const sourceId = body.source_id ?? null;

  if (sourceId) {
    const source = await env.DB.prepare(
      `SELECT id FROM chasers_stream_sources WHERE id = ?`,
    )
      .bind(sourceId)
      .first();

    if (!source) {
      return errorResponse("Stream source not found.", 404);
    }
  }

  await env.DB.prepare(
    `UPDATE chasers_stream_slots
     SET source_id = ?, updated_at = datetime('now')
     WHERE slot_number = ?`,
  )
    .bind(sourceId, slotNumber)
    .run();

  return listSlots(env);
}

async function clearSlot(env: Env, slotNumber: number): Promise<Response> {
  if (slotNumber < 1 || slotNumber > 4) {
    return errorResponse("slot_number must be between 1 and 4.");
  }

  await env.DB.prepare(
    `UPDATE chasers_stream_slots
     SET source_id = NULL, updated_at = datetime('now')
     WHERE slot_number = ?`,
  )
    .bind(slotNumber)
    .run();

  return listSlots(env);
}

export async function handleChasersStreams(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.DB) {
    return errorResponse("D1 binding DB is not configured.", 503);
  }

  const url = new URL(request.url);
  const path = url.pathname;

  const sourcesMatch = path.match(/^\/api\/chasers-streams\/sources(?:\/([^/]+))?$/);
  if (sourcesMatch) {
    const sourceId = sourcesMatch[1];

    if (request.method === "GET" && !sourceId) {
      return listSources(env);
    }
    if (request.method === "POST" && !sourceId) {
      return createSource(request, env);
    }
    if (request.method === "PUT" && sourceId) {
      return updateSource(request, env, sourceId);
    }
    if (request.method === "DELETE" && sourceId) {
      return deleteSource(env, sourceId);
    }
  }

  const slotsMatch = path.match(/^\/api\/chasers-streams\/slots(?:\/(\d+))?$/);
  if (slotsMatch) {
    const slotPart = slotsMatch[1];

    if (request.method === "GET" && !slotPart) {
      return listSlots(env);
    }
    if (request.method === "PUT" && slotPart) {
      return assignSlot(request, env, Number(slotPart));
    }
    if (request.method === "DELETE" && slotPart) {
      return clearSlot(env, Number(slotPart));
    }
  }

  return errorResponse("Not found.", 404);
}
