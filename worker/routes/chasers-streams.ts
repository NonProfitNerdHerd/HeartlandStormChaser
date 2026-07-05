import { fetchChannelLiveStatus } from "../lib/youtube-api";
import {
  buildChannelPageUrl,
  buildLiveVideoEmbedUrl,
  parseChannelId,
} from "../lib/youtube";
import type { Env } from "../index";

const JSON_HEADERS = { "Content-Type": "application/json" };

const SOURCE_SELECT = `SELECT id, display_name, channel_id, youtube_url, embed_url, notes, enabled,
  is_live, live_video_id, live_title, live_checked_at, created_at, updated_at
  FROM chasers_stream_sources`;

export interface StreamSourceRow {
  id: string;
  display_name: string;
  channel_id: string | null;
  youtube_url: string;
  embed_url: string;
  notes: string | null;
  enabled: number;
  is_live: number;
  live_video_id: string | null;
  live_title: string | null;
  live_checked_at: string | null;
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
    channel_id: row.channel_id ?? "",
    youtube_url: row.youtube_url,
    embed_url: row.embed_url || null,
    notes: row.notes ?? "",
    enabled: row.enabled === 1,
    is_live: row.is_live === 1,
    live_video_id: row.live_video_id,
    live_title: row.live_title,
    live_checked_at: row.live_checked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getCacheSettings(env: Env) {
  return env.DB.prepare(
    `SELECT last_refreshed_at, cache_ttl_seconds FROM chasers_live_cache WHERE id = 1`,
  ).first<{ last_refreshed_at: string | null; cache_ttl_seconds: number }>();
}

function cacheAgeSeconds(lastRefreshedAt: string | null): number | null {
  if (!lastRefreshedAt) return null;
  const parsed = Date.parse(lastRefreshedAt.replace(" ", "T") + "Z");
  if (Number.isNaN(parsed)) return null;
  return Math.floor((Date.now() - parsed) / 1000);
}

async function listSources(env: Env, extra: Record<string, unknown> = {}): Promise<Response> {
  const { results } = await env.DB.prepare(
    `${SOURCE_SELECT} ORDER BY display_name COLLATE NOCASE ASC`,
  ).all<StreamSourceRow>();

  const cache = await getCacheSettings(env);
  const cacheAge = cacheAgeSeconds(cache?.last_refreshed_at ?? null);

  return json({
    ok: true,
    sources: (results ?? []).map(rowToSource),
    cache: {
      last_refreshed_at: cache?.last_refreshed_at ?? null,
      cache_ttl_seconds: cache?.cache_ttl_seconds ?? 120,
      cache_age_seconds: cacheAge,
    },
    ...extra,
  });
}

async function createSource(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    display_name?: string;
    channel_id?: string;
    notes?: string;
    enabled?: boolean;
  };

  const displayName = body.display_name?.trim();
  if (!displayName) {
    return errorResponse("display_name is required.");
  }

  const parsed = parseChannelId(body.channel_id ?? "");
  if (!parsed.ok) {
    return errorResponse(parsed.error);
  }

  const id = crypto.randomUUID();
  const notes = body.notes?.trim() ?? "";
  const enabled = body.enabled === false ? 0 : 1;
  const channelPageUrl = buildChannelPageUrl(parsed.channelId);

  await env.DB.prepare(
    `INSERT INTO chasers_stream_sources
      (id, display_name, channel_id, youtube_url, embed_url, notes, enabled, is_live)
     VALUES (?, ?, ?, ?, '', ?, ?, 0)`,
  )
    .bind(id, displayName, parsed.channelId, channelPageUrl, notes, enabled)
    .run();

  const row = await env.DB.prepare(`${SOURCE_SELECT} WHERE id = ?`)
    .bind(id)
    .first<StreamSourceRow>();

  return json({ ok: true, source: row ? rowToSource(row) : null }, 201);
}

async function updateSource(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await env.DB.prepare(`SELECT id FROM chasers_stream_sources WHERE id = ?`)
    .bind(id)
    .first();

  if (!existing) {
    return errorResponse("Stream source not found.", 404);
  }

  const body = (await request.json()) as {
    display_name?: string;
    channel_id?: string;
    notes?: string;
    enabled?: boolean;
  };

  const displayName = body.display_name?.trim();
  if (!displayName) {
    return errorResponse("display_name is required.");
  }

  const parsed = parseChannelId(body.channel_id ?? "");
  if (!parsed.ok) {
    return errorResponse(parsed.error);
  }

  const notes = body.notes?.trim() ?? "";
  const enabled = body.enabled === false ? 0 : 1;
  const channelPageUrl = buildChannelPageUrl(parsed.channelId);

  await env.DB.prepare(
    `UPDATE chasers_stream_sources
     SET display_name = ?, channel_id = ?, youtube_url = ?, notes = ?, enabled = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(displayName, parsed.channelId, channelPageUrl, notes, enabled, id)
    .run();

  const row = await env.DB.prepare(`${SOURCE_SELECT} WHERE id = ?`)
    .bind(id)
    .first<StreamSourceRow>();

  return json({ ok: true, source: row ? rowToSource(row) : null });
}

async function deleteSource(env: Env, id: string): Promise<Response> {
  const existing = await env.DB.prepare(`SELECT id FROM chasers_stream_sources WHERE id = ?`)
    .bind(id)
    .first();

  if (!existing) {
    return errorResponse("Stream source not found.", 404);
  }

  await env.DB.prepare(`DELETE FROM chasers_stream_sources WHERE id = ?`).bind(id).run();

  return json({ ok: true });
}

async function refreshLiveStatus(request: Request, env: Env): Promise<Response> {
  let force = false;
  if (request.method === "POST") {
    try {
      const body = (await request.json()) as { force?: boolean };
      force = body.force === true;
    } catch {
      force = false;
    }
  } else {
    force = new URL(request.url).searchParams.get("force") === "true";
  }

  const cache = await getCacheSettings(env);
  const ttl = cache?.cache_ttl_seconds ?? 120;
  const cacheAge = cacheAgeSeconds(cache?.last_refreshed_at ?? null);

  if (!force && cacheAge !== null && cacheAge < ttl) {
    const { results } = await env.DB.prepare(
      `${SOURCE_SELECT} WHERE enabled = 1 ORDER BY display_name COLLATE NOCASE ASC`,
    ).all<StreamSourceRow>();

    const sources = results ?? [];
    return json({
      ok: true,
      cached: true,
      skipped_api: true,
      cache_age_seconds: cacheAge,
      cache_ttl_seconds: ttl,
      last_refreshed_at: cache?.last_refreshed_at ?? null,
      live_count: sources.filter((s) => s.is_live === 1).length,
      offline_count: sources.filter((s) => s.is_live !== 1).length,
      sources: sources.map(rowToSource),
    });
  }

  if (!env.YOUTUBE_API_KEY) {
    return errorResponse(
      "YOUTUBE_API_KEY is not configured. Run: npx wrangler secret put YOUTUBE_API_KEY",
      503,
    );
  }

  const { results } = await env.DB.prepare(
    `${SOURCE_SELECT} WHERE enabled = 1 AND channel_id IS NOT NULL`,
  ).all<StreamSourceRow>();

  const sources = results ?? [];
  let liveCount = 0;
  let offlineCount = 0;
  const now = new Date().toISOString();

  for (const source of sources) {
    if (!source.channel_id) {
      offlineCount += 1;
      continue;
    }

    try {
      const live = await fetchChannelLiveStatus(source.channel_id, env.YOUTUBE_API_KEY);
      const embedUrl = live.isLive && live.videoId ? buildLiveVideoEmbedUrl(live.videoId) : "";

      if (live.isLive) {
        liveCount += 1;
      } else {
        offlineCount += 1;
      }

      await env.DB.prepare(
        `UPDATE chasers_stream_sources
         SET is_live = ?, live_video_id = ?, live_title = ?, embed_url = ?,
             live_checked_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(
          live.isLive ? 1 : 0,
          live.videoId,
          live.title,
          embedUrl,
          now,
          source.id,
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : "YouTube API error";
      return errorResponse(message, 502);
    }
  }

  await env.DB.prepare(
    `UPDATE chasers_live_cache SET last_refreshed_at = ? WHERE id = 1`,
  )
    .bind(now)
    .run();

  return listSources(env, {
    cached: false,
    skipped_api: false,
    refreshed: true,
    live_count: liveCount,
    offline_count: offlineCount,
    last_refreshed_at: now,
  });
}

async function listSlots(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT
       s.slot_number,
       s.source_id,
       s.updated_at AS slot_updated_at,
       src.id AS src_id,
       src.display_name,
       src.channel_id,
       src.youtube_url,
       src.embed_url,
       src.notes,
       src.enabled,
       src.is_live,
       src.live_video_id,
       src.live_title,
       src.live_checked_at,
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
    channel_id: string | null;
    youtube_url: string | null;
    embed_url: string | null;
    notes: string | null;
    enabled: number | null;
    is_live: number | null;
    live_video_id: string | null;
    live_title: string | null;
    live_checked_at: string | null;
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
          channel_id: row.channel_id ?? "",
          youtube_url: row.youtube_url!,
          embed_url: row.embed_url || null,
          notes: row.notes ?? "",
          enabled: row.enabled === 1,
          is_live: row.is_live === 1,
          live_video_id: row.live_video_id,
          live_title: row.live_title,
          live_checked_at: row.live_checked_at,
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

  if (path === "/api/chasers-streams/refresh-live") {
    if (request.method === "POST" || request.method === "GET") {
      return refreshLiveStatus(request, env);
    }
  }

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
