import type { Env } from "../index";

export const BROADCAST_SETTING_KEYS = [
  "listener_url",
  "listener_token",
  "obs_host",
  "obs_port",
  "obs_password",
  "obs_reconnect_ms",
] as const;

export type BroadcastSettingKey = (typeof BROADCAST_SETTING_KEYS)[number];

export interface BroadcastSettingsPublic {
  listener_url: string;
  obs_host: string;
  obs_port: string;
  obs_reconnect_ms: string;
  listener_token_set: boolean;
  obs_password_set: boolean;
  updated_at: string | null;
  source: "database" | "environment" | "mixed" | "none";
}

export interface BroadcastConnectionConfig {
  listenerUrl: string;
  listenerToken: string;
  obsHost: string;
  obsPort: number;
  obsPassword: string;
  obsReconnectMs: number;
}

async function readAll(env: Env): Promise<Map<string, { value: string; updated_at: string }>> {
  const result = await env.DB.prepare(
    `SELECT key, value, updated_at FROM broadcast_settings`,
  ).all<{ key: string; value: string; updated_at: string }>();

  const map = new Map<string, { value: string; updated_at: string }>();
  for (const row of result.results ?? []) {
    map.set(row.key, { value: row.value, updated_at: row.updated_at });
  }
  return map;
}

async function writeSetting(env: Env, key: string, value: string, updatedAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO broadcast_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, updatedAt)
    .run();
}

function dbValue(map: Map<string, { value: string; updated_at: string }>, key: string): string {
  return map.get(key)?.value?.trim() || "";
}

export async function resolveBroadcastConnection(env: Env): Promise<BroadcastConnectionConfig> {
  const map = await readAll(env);

  const listenerUrl = dbValue(map, "listener_url") || env.OBS_LISTENER_URL?.trim() || "";
  const listenerToken = dbValue(map, "listener_token") || env.OBS_LISTENER_TOKEN?.trim() || "";
  const obsHost = dbValue(map, "obs_host") || "127.0.0.1";
  const obsPortRaw = dbValue(map, "obs_port") || "4455";
  const obsPassword = dbValue(map, "obs_password") || "";
  const reconnectRaw = dbValue(map, "obs_reconnect_ms") || "3000";

  const obsPort = Number.parseInt(obsPortRaw, 10);
  const obsReconnectMs = Number.parseInt(reconnectRaw, 10);

  return {
    listenerUrl,
    listenerToken,
    obsHost,
    obsPort: Number.isFinite(obsPort) && obsPort > 0 ? obsPort : 4455,
    obsPassword,
    obsReconnectMs:
      Number.isFinite(obsReconnectMs) && obsReconnectMs > 0 ? obsReconnectMs : 3000,
  };
}

export async function getBroadcastSettingsPublic(env: Env): Promise<BroadcastSettingsPublic> {
  const map = await readAll(env);
  const connection = await resolveBroadcastConnection(env);

  let latest: string | null = null;
  for (const row of map.values()) {
    if (!latest || row.updated_at > latest) {
      latest = row.updated_at;
    }
  }

  const hasDbUrl = Boolean(dbValue(map, "listener_url"));
  const hasDbToken = Boolean(dbValue(map, "listener_token"));
  const hasEnvUrl = Boolean(env.OBS_LISTENER_URL?.trim());
  const hasEnvToken = Boolean(env.OBS_LISTENER_TOKEN?.trim());

  let source: BroadcastSettingsPublic["source"] = "none";
  if ((hasDbUrl || hasDbToken) && (hasEnvUrl || hasEnvToken) && (!hasDbUrl || !hasDbToken)) {
    source = "mixed";
  } else if (hasDbUrl || hasDbToken) {
    source = "database";
  } else if (hasEnvUrl || hasEnvToken) {
    source = "environment";
  }

  return {
    listener_url: connection.listenerUrl,
    obs_host: connection.obsHost,
    obs_port: String(connection.obsPort),
    obs_reconnect_ms: String(connection.obsReconnectMs),
    listener_token_set: Boolean(connection.listenerToken),
    obs_password_set: Boolean(connection.obsPassword),
    updated_at: latest,
    source,
  };
}

export interface BroadcastSettingsUpdate {
  listener_url?: string;
  listener_token?: string;
  obs_host?: string;
  obs_port?: string;
  obs_password?: string;
  obs_reconnect_ms?: string;
}

function validateUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return trimmed.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function updateBroadcastSettings(
  env: Env,
  updates: BroadcastSettingsUpdate,
): Promise<BroadcastSettingsPublic> {
  const timestamp = new Date().toISOString();

  if ("listener_url" in updates && updates.listener_url !== undefined) {
    const validated = validateUrl(updates.listener_url);
    if (validated === null) {
      throw new Error("listener_url must be a valid http(s) URL");
    }
    await writeSetting(env, "listener_url", validated, timestamp);
  }

  if ("listener_token" in updates && typeof updates.listener_token === "string") {
    const token = updates.listener_token.trim();
    // Empty means leave unchanged (write-only field)
    if (token) {
      if (token.length < 8) {
        throw new Error("listener_token must be at least 8 characters");
      }
      await writeSetting(env, "listener_token", token, timestamp);
    }
  }

  if ("obs_host" in updates && updates.obs_host !== undefined) {
    const host = updates.obs_host.trim() || "127.0.0.1";
    if (host.length > 253 || /[\s\u0000-\u001f]/.test(host)) {
      throw new Error("obs_host is invalid");
    }
    await writeSetting(env, "obs_host", host, timestamp);
  }

  if ("obs_port" in updates && updates.obs_port !== undefined) {
    const port = Number.parseInt(String(updates.obs_port).trim(), 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error("obs_port must be between 1 and 65535");
    }
    await writeSetting(env, "obs_port", String(port), timestamp);
  }

  if ("obs_password" in updates && typeof updates.obs_password === "string") {
    // Empty means leave unchanged
    if (updates.obs_password.length > 0) {
      await writeSetting(env, "obs_password", updates.obs_password, timestamp);
    }
  }

  if ("obs_reconnect_ms" in updates && updates.obs_reconnect_ms !== undefined) {
    const ms = Number.parseInt(String(updates.obs_reconnect_ms).trim(), 10);
    if (!Number.isFinite(ms) || ms < 500 || ms > 120_000) {
      throw new Error("obs_reconnect_ms must be between 500 and 120000");
    }
    await writeSetting(env, "obs_reconnect_ms", String(ms), timestamp);
  }

  return getBroadcastSettingsPublic(env);
}

export async function getAgentObsConfig(env: Env): Promise<{
  obs_host: string;
  obs_port: number;
  obs_password: string;
  obs_reconnect_ms: number;
  updated_at: string | null;
}> {
  const publicSettings = await getBroadcastSettingsPublic(env);
  const connection = await resolveBroadcastConnection(env);
  return {
    obs_host: connection.obsHost,
    obs_port: connection.obsPort,
    obs_password: connection.obsPassword,
    obs_reconnect_ms: connection.obsReconnectMs,
    updated_at: publicSettings.updated_at,
  };
}

export async function listenerTokenMatches(env: Env, token: string | null): Promise<boolean> {
  if (!token) {
    return false;
  }
  const connection = await resolveBroadcastConnection(env);
  if (!connection.listenerToken) {
    return false;
  }
  return connection.listenerToken === token;
}
