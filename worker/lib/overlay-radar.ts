import type { Env } from "../index";
import { getGpsConnectionStatus } from "./gps-status";
import { getPlatformSource } from "./gps-platform";
import { getWeatherForCoordinates } from "./nws-weather";

/** IEM CONUS NEXRAD Base Reflectivity — current mosaic (single frame). */
export const NEXRAD_BASE_REFLECTIVITY_WMS = {
  url: "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi",
  layers: "nexrad-n0q-900913",
  format: "image/png",
  transparent: true,
  version: "1.1.1",
  attribution: "Radar © Iowa Environmental Mesonet / NWS NEXRAD Base Reflectivity",
  product: "CONUS Base Reflectivity (NEXRAD n0q)",
} as const;

/** IEM time-enabled Base Reflectivity for frame loops (WMS-T). */
export const NEXRAD_BASE_REFLECTIVITY_WMST = {
  upstreamUrl: "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi",
  proxyPath: "/api/overlays/radar-wms",
  layers: "nexrad-n0q-wmst",
  format: "image/png",
  transparent: true,
  version: "1.1.1",
  attribution: "Radar © Iowa Environmental Mesonet / NWS NEXRAD Base Reflectivity",
  product: "CONUS Base Reflectivity loop (NEXRAD n0q)",
} as const;

export const RADAR_FRAME_COUNT = 24;
export const RADAR_FRAME_STEP_MS = 5 * 60 * 1000;
export const RADAR_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const FRAMES_KEY = "overlay_radar_frames_json";
const FRAMES_AT_KEY = "overlay_radar_frames_at";

export const RADAR_WRITABLE_KEYS = [
  "overlay_radar_polling_enabled",
  "overlay_radar_polling_interval_sec",
  "overlay_radar_zoom",
  "overlay_radar_opacity",
  "overlay_radar_map_style",
  "overlay_radar_show_city",
  "overlay_radar_show_coords",
  "overlay_radar_show_status",
  "overlay_radar_show_updated",
  "overlay_radar_show_speed",
  "overlay_radar_show_heading",
] as const;

const DEFAULTS: Record<(typeof RADAR_WRITABLE_KEYS)[number], string> = {
  overlay_radar_polling_enabled: "0",
  overlay_radar_polling_interval_sec: "300",
  overlay_radar_zoom: "8",
  overlay_radar_opacity: "0.65",
  overlay_radar_map_style: "dark",
  overlay_radar_show_city: "1",
  overlay_radar_show_coords: "1",
  overlay_radar_show_status: "1",
  overlay_radar_show_updated: "1",
  overlay_radar_show_speed: "1",
  overlay_radar_show_heading: "1",
};

async function readSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT value FROM overlay_settings WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  if (!row || row.value == null) return null;
  return String(row.value);
}

async function writeSetting(env: Env, key: string, value: string): Promise<void> {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO overlay_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, timestamp)
    .run();
}

async function deleteSetting(env: Env, key: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM overlay_settings WHERE key = ?`).bind(key).run();
}

function asBool(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function asNumber(value: string, fallback: number, min: number, max: number): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function headingToCardinal(degrees: number | null | undefined): string | null {
  if (degrees == null || Number.isNaN(Number(degrees))) return null;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round((((Number(degrees) % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

export interface RadarOverlaySettings {
  polling_enabled: boolean;
  polling_interval_sec: number;
  zoom: number;
  opacity: number;
  map_style: "dark" | "streets" | "satellite";
  show_city: boolean;
  show_coords: boolean;
  show_status: boolean;
  show_updated: boolean;
  show_speed: boolean;
  show_heading: boolean;
}

export interface RadarFrameCache {
  frames: string[];
  refreshed_at: string;
  expires_at: string;
}

/** Build last N five-minute Base Reflectivity timestamps (UTC, completed slots). */
export function buildRadarFrameTimes(
  count = RADAR_FRAME_COUNT,
  nowMs = Date.now(),
): string[] {
  const step = RADAR_FRAME_STEP_MS;
  // Skip the in-progress slot; IEM rasters land on 5-minute boundaries.
  const end = Math.floor(nowMs / step) * step - step;
  const frames: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    frames.push(new Date(end - i * step).toISOString().replace(/\.\d{3}Z$/, "Z"));
  }
  return frames;
}

export async function getRadarOverlaySettings(env: Env): Promise<RadarOverlaySettings> {
  const raw: Record<string, string> = {};
  for (const key of RADAR_WRITABLE_KEYS) {
    const stored = await readSetting(env, key);
    raw[key] = stored == null || stored === "" ? DEFAULTS[key] : stored.trim();
  }

  const styleRaw = raw.overlay_radar_map_style || DEFAULTS.overlay_radar_map_style;
  const map_style =
    styleRaw === "streets" || styleRaw === "satellite" ? styleRaw : "dark";

  return {
    polling_enabled: asBool(raw.overlay_radar_polling_enabled, false),
    polling_interval_sec: Math.round(
      asNumber(raw.overlay_radar_polling_interval_sec, 300, 60, 3600),
    ),
    zoom: Math.round(asNumber(raw.overlay_radar_zoom, 8, 3, 16)),
    opacity: asNumber(raw.overlay_radar_opacity, 0.65, 0.1, 1),
    map_style,
    show_city: asBool(raw.overlay_radar_show_city, true),
    show_coords: asBool(raw.overlay_radar_show_coords, true),
    show_status: asBool(raw.overlay_radar_show_status, true),
    show_updated: asBool(raw.overlay_radar_show_updated, true),
    show_speed: asBool(raw.overlay_radar_show_speed, true),
    show_heading: asBool(raw.overlay_radar_show_heading, true),
  };
}

export async function updateRadarOverlaySettings(
  env: Env,
  body: Record<string, unknown>,
): Promise<RadarOverlaySettings> {
  for (const key of RADAR_WRITABLE_KEYS) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();

    if (key === "overlay_radar_polling_enabled") {
      await writeSetting(env, key, asBool(value, false) ? "1" : "0");
      continue;
    }
    if (key === "overlay_radar_polling_interval_sec") {
      await writeSetting(env, key, String(Math.round(asNumber(value, 300, 60, 3600))));
      continue;
    }
    if (key === "overlay_radar_zoom") {
      await writeSetting(env, key, String(Math.round(asNumber(value, 8, 3, 16))));
      continue;
    }
    if (key === "overlay_radar_opacity") {
      await writeSetting(env, key, String(asNumber(value, 0.65, 0.1, 1)));
      continue;
    }
    if (key === "overlay_radar_map_style") {
      const style = value === "streets" || value === "satellite" ? value : "dark";
      await writeSetting(env, key, style);
      continue;
    }
    if (key.startsWith("overlay_radar_show_")) {
      await writeSetting(env, key, asBool(value, true) ? "1" : "0");
    }
  }

  return getRadarOverlaySettings(env);
}

async function readFrameCache(env: Env): Promise<RadarFrameCache | null> {
  const raw = await readSetting(env, FRAMES_KEY);
  const refreshedAt = await readSetting(env, FRAMES_AT_KEY);
  if (!raw || !refreshedAt) return null;
  try {
    const parsed = JSON.parse(raw) as { frames?: string[]; expires_at?: string };
    if (!Array.isArray(parsed.frames) || parsed.frames.length === 0) return null;
    return {
      frames: parsed.frames,
      refreshed_at: refreshedAt,
      expires_at: parsed.expires_at || new Date(Date.parse(refreshedAt) + RADAR_CACHE_TTL_MS).toISOString(),
    };
  } catch {
    return null;
  }
}

async function writeFrameCache(env: Env, frames: string[]): Promise<RadarFrameCache> {
  const refreshed_at = new Date().toISOString();
  const expires_at = new Date(Date.now() + RADAR_CACHE_TTL_MS).toISOString();
  const cache: RadarFrameCache = { frames, refreshed_at, expires_at };
  await writeSetting(env, FRAMES_KEY, JSON.stringify({ frames, expires_at }));
  await writeSetting(env, FRAMES_AT_KEY, refreshed_at);
  return cache;
}

export async function purgeExpiredRadarFrameCache(env: Env): Promise<boolean> {
  const cache = await readFrameCache(env);
  if (!cache) return false;
  if (Date.parse(cache.expires_at) > Date.now()) return false;
  await deleteSetting(env, FRAMES_KEY);
  await deleteSetting(env, FRAMES_AT_KEY);
  return true;
}

async function resolveFrameCache(
  env: Env,
  settings: RadarOverlaySettings,
): Promise<{ cache: RadarFrameCache | null; refreshed: boolean; purged: boolean }> {
  const purged = await purgeExpiredRadarFrameCache(env);
  let cache = purged ? null : await readFrameCache(env);

  if (!settings.polling_enabled) {
    return { cache, refreshed: false, purged };
  }

  const intervalMs = settings.polling_interval_sec * 1000;
  const ageMs = cache ? Date.now() - Date.parse(cache.refreshed_at) : Number.POSITIVE_INFINITY;
  const needsRefresh = !cache || !Number.isFinite(ageMs) || ageMs >= intervalMs;

  if (needsRefresh) {
    cache = await writeFrameCache(env, buildRadarFrameTimes(RADAR_FRAME_COUNT));
    return { cache, refreshed: true, purged };
  }

  return { cache, refreshed: false, purged };
}

export async function buildRadarOverlayData(env: Env) {
  const settings = await getRadarOverlaySettings(env);
  const platform = await getPlatformSource(env);
  const { cache, refreshed } = await resolveFrameCache(env, settings);

  const frames = cache?.frames || [];
  const nextRefreshAt =
    settings.polling_enabled && cache
      ? new Date(Date.parse(cache.refreshed_at) + settings.polling_interval_sec * 1000).toISOString()
      : null;

  const radarPayload = {
    polling_enabled: settings.polling_enabled,
    polling_active: settings.polling_enabled,
    paused: !settings.polling_enabled,
    status: settings.polling_enabled
      ? frames.length
        ? ("active" as const)
        : ("not_loaded" as const)
      : ("paused" as const),
    provider: "iem-nexrad-n0q-wmst",
    product: NEXRAD_BASE_REFLECTIVITY_WMST.product,
    frame_count: frames.length,
    frames,
    animation_enabled: settings.polling_enabled && frames.length > 1,
    wms: {
      url: NEXRAD_BASE_REFLECTIVITY_WMST.proxyPath,
      upstream: NEXRAD_BASE_REFLECTIVITY_WMST.upstreamUrl,
      layers: NEXRAD_BASE_REFLECTIVITY_WMST.layers,
      format: NEXRAD_BASE_REFLECTIVITY_WMST.format,
      transparent: NEXRAD_BASE_REFLECTIVITY_WMST.transparent,
      version: NEXRAD_BASE_REFLECTIVITY_WMST.version,
      attribution: NEXRAD_BASE_REFLECTIVITY_WMST.attribution,
      time_enabled: true,
    },
    last_refresh_at: cache?.refreshed_at || null,
    next_refresh_at: nextRefreshAt,
    cache_expires_at: cache?.expires_at || null,
    refreshed_this_request: refreshed,
    error: null as string | null,
  };

  if (!platform) {
    return {
      ok: true,
      has_platform_source: false,
      message: "No platform GPS source selected",
      platform: null,
      settings,
      radar: radarPayload,
      updated_at: new Date().toISOString(),
    };
  }

  const location = platform.location;
  const status = location
    ? getGpsConnectionStatus(location.received_at_utc)
    : platform.status || "UNKNOWN";

  let city: string | null = null;
  let state: string | null = null;
  if (location?.latitude != null && location?.longitude != null) {
    try {
      const weather = await getWeatherForCoordinates(env, location.latitude, location.longitude);
      city = weather.location_city;
      state = weather.location_state;
    } catch {
      /* optional */
    }
  }

  return {
    ok: true,
    has_platform_source: true,
    message: location ? null : "Platform GPS source has no location yet",
    platform: {
      device_id: platform.device_id,
      device_name: platform.device_name,
      status,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      speed_mph: location?.speed_mph ?? null,
      heading_degrees: location?.heading_degrees ?? null,
      heading_cardinal: headingToCardinal(location?.heading_degrees ?? null),
      accuracy_meters: location?.accuracy_meters ?? null,
      city,
      state,
      timestamp_utc: location?.timestamp_utc ?? null,
      received_at_utc: location?.received_at_utc ?? null,
    },
    settings,
    radar: radarPayload,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Proxy IEM WMS-T GetMap through the Worker and cache successful tiles for 3 days.
 * When polling is paused, only cache hits are served (no new upstream fetches).
 */
export async function proxyRadarWms(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const settings = await getRadarOverlaySettings(env);
  await purgeExpiredRadarFrameCache(env);

  const incoming = new URL(request.url);
  const upstream = new URL(NEXRAD_BASE_REFLECTIVITY_WMST.upstreamUrl);

  for (const [key, value] of incoming.searchParams.entries()) {
    if (key === "_") continue;
    upstream.searchParams.set(key, value);
  }

  if (!upstream.searchParams.get("LAYERS") && !upstream.searchParams.get("layers")) {
    upstream.searchParams.set("LAYERS", NEXRAD_BASE_REFLECTIVITY_WMST.layers);
  }
  if (!upstream.searchParams.get("FORMAT") && !upstream.searchParams.get("format")) {
    upstream.searchParams.set("FORMAT", NEXRAD_BASE_REFLECTIVITY_WMST.format);
  }
  if (!upstream.searchParams.get("TRANSPARENT") && !upstream.searchParams.get("transparent")) {
    upstream.searchParams.set("TRANSPARENT", "TRUE");
  }

  const cache = caches.default;
  const cacheKey = new Request(upstream.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const storedAt = Number.parseInt(cached.headers.get("X-Radar-Cached-At") || "", 10);
    const ageMs = Number.isFinite(storedAt) ? Date.now() - storedAt : Number.POSITIVE_INFINITY;
    if (ageMs <= RADAR_CACHE_TTL_MS) {
      const headers = new Headers(cached.headers);
      headers.set("X-Radar-Cache", "HIT");
      return new Response(cached.body, { status: cached.status, headers });
    }
    ctx.waitUntil(cache.delete(cacheKey));
  }

  if (!settings.polling_enabled) {
    return new Response("Radar polling paused — no uncached frame fetch", {
      status: 403,
      headers: { "Content-Type": "text/plain", "X-Radar-Cache": "MISS-PAUSED" },
    });
  }

  const upstreamResponse = await fetch(upstream.toString(), {
    headers: { Accept: "image/png,image/*;q=0.8,*/*;q=0.5" },
  });

  const headers = new Headers(upstreamResponse.headers);
  headers.set("Cache-Control", `public, max-age=${Math.floor(RADAR_CACHE_TTL_MS / 1000)}`);
  headers.set("X-Radar-Cache", "MISS");
  headers.set("X-Radar-Cached-At", String(Date.now()));
  headers.delete("set-cookie");

  const response = new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });

  if (upstreamResponse.ok) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}
