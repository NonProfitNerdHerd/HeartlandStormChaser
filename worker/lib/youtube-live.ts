import type { Env } from "../index";
import type { ScheduledBroadcast } from "./scheduled-broadcasts";

const YT_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const YT_TOKEN = "https://oauth2.googleapis.com/token";
const YT_API = "https://www.googleapis.com/youtube/v3";
const SCOPE = "https://www.googleapis.com/auth/youtube";

const KEY_REFRESH = "youtube_refresh_token";
const KEY_ACCESS = "youtube_access_token";
const KEY_EXPIRES = "youtube_access_expires_at";
const KEY_STATE = "youtube_oauth_state";
const KEY_CHANNEL = "youtube_channel_title";

export interface YoutubeConnectionStatus {
  clientConfigured: boolean;
  connected: boolean;
  channelTitle: string | null;
  redirectUri: string;
}

export interface YoutubePlatformIds {
  broadcastId: string;
  streamId: string;
}

export interface YoutubeIngestInfo {
  ingestionAddress: string;
  streamName: string;
}

export interface YoutubePrepareResult {
  ids: YoutubePlatformIds;
  ingest: YoutubeIngestInfo;
  watchUrl: string;
}

async function readSetting(env: Env, key: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT value FROM broadcast_settings WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value?.trim() || "";
}

async function writeSetting(env: Env, key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO broadcast_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, now)
    .run();
}

async function deleteSetting(env: Env, key: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM broadcast_settings WHERE key = ?`).bind(key).run();
}

export function youtubeRedirectUri(env: Env, requestUrl: string): string {
  if (env.YOUTUBE_REDIRECT_URI?.trim()) {
    return env.YOUTUBE_REDIRECT_URI.trim().replace(/\/$/, "");
  }
  const origin = new URL(requestUrl).origin;
  return `${origin}/api/broadcast/youtube/oauth/callback`;
}

export function isYoutubeClientConfigured(env: Env): boolean {
  return Boolean(env.YOUTUBE_CLIENT_ID?.trim() && env.YOUTUBE_CLIENT_SECRET?.trim());
}

export async function getYoutubeConnectionStatus(
  env: Env,
  requestUrl: string,
): Promise<YoutubeConnectionStatus> {
  const refresh = await readSetting(env, KEY_REFRESH);
  const channelTitle = (await readSetting(env, KEY_CHANNEL)) || null;
  return {
    clientConfigured: isYoutubeClientConfigured(env),
    connected: Boolean(refresh),
    channelTitle,
    redirectUri: youtubeRedirectUri(env, requestUrl),
  };
}

export async function beginYoutubeOAuth(env: Env, requestUrl: string): Promise<string> {
  if (!isYoutubeClientConfigured(env)) {
    throw new Error("YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are not configured");
  }
  const state = crypto.randomUUID();
  await writeSetting(env, KEY_STATE, state);
  const params = new URLSearchParams({
    client_id: env.YOUTUBE_CLIENT_ID!.trim(),
    redirect_uri: youtubeRedirectUri(env, requestUrl),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${YT_AUTH}?${params.toString()}`;
}

export async function completeYoutubeOAuth(
  env: Env,
  requestUrl: string,
  code: string,
  state: string,
): Promise<void> {
  const expected = await readSetting(env, KEY_STATE);
  if (!expected || expected !== state) {
    throw new Error("Invalid OAuth state — restart Connect YouTube from Broadcast Settings");
  }
  await deleteSetting(env, KEY_STATE);

  if (!isYoutubeClientConfigured(env)) {
    throw new Error("YouTube client credentials are not configured");
  }

  const body = new URLSearchParams({
    code,
    client_id: env.YOUTUBE_CLIENT_ID!.trim(),
    client_secret: env.YOUTUBE_CLIENT_SECRET!.trim(),
    redirect_uri: youtubeRedirectUri(env, requestUrl),
    grant_type: "authorization_code",
  });

  const response = await fetch(YT_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "YouTube token exchange failed");
  }

  if (data.refresh_token) {
    await writeSetting(env, KEY_REFRESH, data.refresh_token);
  } else {
    const existing = await readSetting(env, KEY_REFRESH);
    if (!existing) {
      throw new Error(
        "Google did not return a refresh token. Revoke app access at myaccount.google.com/permissions and connect again.",
      );
    }
  }

  const expiresAt = Date.now() + Math.max(60, (data.expires_in || 3600) - 60) * 1000;
  await writeSetting(env, KEY_ACCESS, data.access_token);
  await writeSetting(env, KEY_EXPIRES, String(expiresAt));

  const channelTitle = await fetchChannelTitle(data.access_token);
  if (channelTitle) {
    await writeSetting(env, KEY_CHANNEL, channelTitle);
  }
}

export async function disconnectYoutube(env: Env): Promise<void> {
  await deleteSetting(env, KEY_REFRESH);
  await deleteSetting(env, KEY_ACCESS);
  await deleteSetting(env, KEY_EXPIRES);
  await deleteSetting(env, KEY_CHANNEL);
  await deleteSetting(env, KEY_STATE);
}

async function fetchChannelTitle(accessToken: string): Promise<string | null> {
  const response = await fetch(`${YT_API}/channels?part=snippet&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await response.json()) as {
    items?: Array<{ snippet?: { title?: string } }>;
  };
  return data.items?.[0]?.snippet?.title || null;
}

async function getAccessToken(env: Env): Promise<string> {
  const refresh = await readSetting(env, KEY_REFRESH);
  if (!refresh) {
    throw new Error("YouTube is not connected — use Connect YouTube in Broadcast Settings");
  }

  const access = await readSetting(env, KEY_ACCESS);
  const expiresAt = Number.parseInt(await readSetting(env, KEY_EXPIRES), 10);
  if (access && Number.isFinite(expiresAt) && Date.now() < expiresAt) {
    return access;
  }

  if (!isYoutubeClientConfigured(env)) {
    throw new Error("YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are not configured");
  }

  const body = new URLSearchParams({
    client_id: env.YOUTUBE_CLIENT_ID!.trim(),
    client_secret: env.YOUTUBE_CLIENT_SECRET!.trim(),
    refresh_token: refresh,
    grant_type: "refresh_token",
  });

  const response = await fetch(YT_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description ||
        data.error ||
        "YouTube authorization expired — reconnect YouTube in Broadcast Settings",
    );
  }

  const nextExpiry = Date.now() + Math.max(60, (data.expires_in || 3600) - 60) * 1000;
  await writeSetting(env, KEY_ACCESS, data.access_token);
  await writeSetting(env, KEY_EXPIRES, String(nextExpiry));
  return data.access_token;
}

async function youtubeFetch(
  env: Env,
  path: string,
  init?: RequestInit & { query?: Record<string, string> },
): Promise<unknown> {
  const token = await getAccessToken(env);
  const url = new URL(`${YT_API}${path}`);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      url.searchParams.set(k, v);
    }
  }
  const { query: _q, ...rest } = init || {};
  const response = await fetch(url.toString(), {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(rest.headers || {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> };
  };
  if (!response.ok) {
    const detail =
      data.error?.message ||
      data.error?.errors?.[0]?.message ||
      `YouTube API error (${response.status})`;
    throw new Error(detail);
  }
  return data;
}

function mapPrivacy(visibility: string): "private" | "public" | "unlisted" {
  if (visibility === "public" || visibility === "unlisted") return visibility;
  return "private";
}

export function parseYoutubePlatformIds(raw: string | null): YoutubePlatformIds | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<YoutubePlatformIds>;
    if (parsed.broadcastId && parsed.streamId) {
      return { broadcastId: parsed.broadcastId, streamId: parsed.streamId };
    }
  } catch {
    /* legacy plain id */
  }
  if (raw.startsWith("yt:")) {
    const [, broadcastId, streamId] = raw.split(":");
    if (broadcastId && streamId) return { broadcastId, streamId };
  }
  return null;
}

export function serializeYoutubePlatformIds(ids: YoutubePlatformIds): string {
  return JSON.stringify(ids);
}

function ingestSettingKey(broadcastId: string): string {
  return `youtube_ingest_${broadcastId}`;
}

export async function storeYoutubeIngest(
  env: Env,
  broadcastId: string,
  ingest: YoutubeIngestInfo,
): Promise<void> {
  await writeSetting(env, ingestSettingKey(broadcastId), JSON.stringify(ingest));
}

export async function readYoutubeIngest(
  env: Env,
  broadcastId: string,
): Promise<YoutubeIngestInfo | null> {
  const raw = await readSetting(env, ingestSettingKey(broadcastId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as YoutubeIngestInfo;
  } catch {
    return null;
  }
}

export async function prepareYoutubeLiveBroadcast(
  env: Env,
  broadcast: ScheduledBroadcast,
): Promise<YoutubePrepareResult> {
  const existing = parseYoutubePlatformIds(broadcast.external_platform_id);
  if (existing) {
    const ingest = await readYoutubeIngest(env, broadcast.id);
    if (ingest) {
      return {
        ids: existing,
        ingest,
        watchUrl: `https://www.youtube.com/watch?v=${existing.broadcastId}`,
      };
    }
  }

  const privacyStatus = mapPrivacy(broadcast.visibility);
  const scheduledStartTime = new Date(broadcast.scheduled_at).toISOString();
  const description = [broadcast.description, broadcast.operator_notes]
    .filter(Boolean)
    .join("\n\n");

  const createdBroadcast = (await youtubeFetch(env, "/liveBroadcasts", {
    method: "POST",
    query: { part: "snippet,status,contentDetails" },
    body: JSON.stringify({
      snippet: {
        title: broadcast.title.slice(0, 100),
        description: description.slice(0, 5000),
        scheduledStartTime,
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      },
      contentDetails: {
        enableAutoStart: Boolean(broadcast.auto_start),
        enableAutoStop: Boolean(broadcast.auto_stop),
        monitorStream: { enableMonitorStream: true },
      },
    }),
  })) as { id?: string };

  if (!createdBroadcast.id) {
    throw new Error("YouTube did not return a broadcast id");
  }

  const createdStream = (await youtubeFetch(env, "/liveStreams", {
    method: "POST",
    query: { part: "snippet,cdn,status" },
    body: JSON.stringify({
      snippet: {
        title: `${broadcast.title.slice(0, 80)} ingest`.slice(0, 100),
      },
      cdn: {
        frameRate: "variable",
        ingestionType: "rtmp",
        resolution: "variable",
      },
    }),
  })) as {
    id?: string;
    cdn?: { ingestionInfo?: { ingestionAddress?: string; streamName?: string } };
  };

  if (!createdStream.id) {
    throw new Error("YouTube did not return a stream id");
  }

  const ingestionAddress = createdStream.cdn?.ingestionInfo?.ingestionAddress;
  const streamName = createdStream.cdn?.ingestionInfo?.streamName;
  if (!ingestionAddress || !streamName) {
    throw new Error("YouTube did not return RTMP ingest details");
  }

  await youtubeFetch(env, "/liveBroadcasts/bind", {
    method: "POST",
    query: {
      id: createdBroadcast.id,
      part: "id,contentDetails,status",
      streamId: createdStream.id,
    },
  });

  const ids = { broadcastId: createdBroadcast.id, streamId: createdStream.id };
  const ingest = { ingestionAddress, streamName };
  await storeYoutubeIngest(env, broadcast.id, ingest);

  return {
    ids,
    ingest,
    watchUrl: `https://www.youtube.com/watch?v=${createdBroadcast.id}`,
  };
}

export async function getYoutubeStreamActive(
  env: Env,
  streamId: string,
): Promise<{ active: boolean; status: string }> {
  const data = (await youtubeFetch(env, "/liveStreams", {
    method: "GET",
    query: { part: "status", id: streamId },
  })) as {
    items?: Array<{ status?: { streamStatus?: string } }>;
  };
  const status = data.items?.[0]?.status?.streamStatus || "unknown";
  return {
    active: status === "active",
    status,
  };
}

export async function transitionYoutubeBroadcast(
  env: Env,
  broadcastId: string,
  status: "testing" | "live" | "complete",
): Promise<void> {
  await youtubeFetch(env, "/liveBroadcasts/transition", {
    method: "POST",
    query: {
      id: broadcastId,
      broadcastStatus: status,
      part: "id,status",
    },
  });
}

export async function goLiveOnYoutube(env: Env, ids: YoutubePlatformIds): Promise<void> {
  try {
    await transitionYoutubeBroadcast(env, ids.broadcastId, "testing");
  } catch {
    // Optional: some life-cycles skip testing; continue to live.
  }
  await transitionYoutubeBroadcast(env, ids.broadcastId, "live");
}

export async function completeYoutubeBroadcast(
  env: Env,
  ids: YoutubePlatformIds,
): Promise<void> {
  await transitionYoutubeBroadcast(env, ids.broadcastId, "complete");
}
