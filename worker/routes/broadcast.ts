import { getPlatformSource } from "../lib/gps-platform";
import { GPS_LIVE_THRESHOLD_MS } from "../lib/gps-status";
import { getAlertsWithinRadius } from "../lib/nws-alerts";
import { getWeatherForCoordinates } from "../lib/nws-weather";
import {
  getAgentObsConfig,
  getBroadcastSettingsPublic,
  listenerTokenMatches,
  updateBroadcastSettings,
  type BroadcastSettingsUpdate,
} from "../lib/broadcast-settings";
import {
  fetchListenerSnapshot,
  isObsListenerConfigured,
  proxyListenerAction,
} from "../lib/obs-listener-client";
import type { HealthCard, HealthTone } from "../lib/broadcast-types";
import { activateVdoNinjaLink, listVdoNinjaLinks } from "../lib/vdo-ninja-links";
import {
  cancelBroadcast,
  createScheduledBroadcast,
  deleteBroadcast,
  getActiveWorkflowBroadcast,
  getScheduledBroadcast,
  getSelectedBroadcast,
  listScheduledBroadcasts,
  selectBroadcast,
  updateScheduledBroadcast,
  type BroadcastInput,
} from "../lib/scheduled-broadcasts";
import {
  confirmIngest,
  endBroadcast,
  goLiveBroadcast,
  prepareBroadcast,
  startBroadcastOutput,
} from "../lib/broadcast-workflow";
import {
  beginYoutubeOAuth,
  completeYoutubeOAuth,
  disconnectYoutube,
  getYoutubeConnectionStatus,
} from "../lib/youtube-live";
import { extractBearerToken, findDeviceByToken } from "../lib/gps-auth";
import { getAuthUserFromRequest, userHasPermission } from "../lib/web-auth";
import { routeErrorResponse } from "../lib/db-errors";
import type { Env } from "../index";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

async function requireBroadcastControl(request: Request, env: Env): Promise<Response | null> {
  const user = await getAuthUserFromRequest(env, request);
  if (user) {
    if (
      user.roles.includes("admin") ||
      userHasPermission(user, "broadcast.control") ||
      userHasPermission(user, "site.access")
    ) {
      return null;
    }
    return errorResponse("Forbidden", 403);
  }

  // Paired GPS devices may create/manage scheduled broadcasts (phone create flow).
  const token = extractBearerToken(request);
  if (token) {
    const device = await findDeviceByToken(env, token);
    if (device && device.enabled === 1) {
      return null;
    }
  }

  return errorResponse("Authentication required", 401);
}

function toneFromGps(status: string | null | undefined): HealthTone {
  if (status === "LIVE") return "healthy";
  if (status === "STALE") return "stale";
  return "unavailable";
}

async function buildTelemetry(env: Env) {
  const platform = await getPlatformSource(env);
  let weather = null;
  let warnings: { watch: string | null; warning: string | null; fetched_at: string | null } = {
    watch: null,
    warning: null,
    fetched_at: null,
  };

  let targetCity: string | null = null;
  let targetState: string | null = null;
  try {
    const city = await env.DB.prepare(
      `SELECT value FROM overlay_settings WHERE key = 'overlay_target_city'`,
    ).first<{ value: string }>();
    const state = await env.DB.prepare(
      `SELECT value FROM overlay_settings WHERE key = 'overlay_target_state'`,
    ).first<{ value: string }>();
    targetCity = city?.value || null;
    targetState = state?.value || null;
  } catch {
    /* overlay settings table may be empty */
  }

  if (platform?.location) {
    try {
      weather = await getWeatherForCoordinates(env, platform.latitude, platform.longitude);
    } catch (error) {
      weather = {
        error: error instanceof Error ? error.message : "Weather unavailable",
      };
    }

    try {
      const alerts = await getAlertsWithinRadius(env, platform.latitude, platform.longitude, 700);
      const warning = alerts.alerts.find((a) => /warning/i.test(a.event || ""));
      const watch = alerts.alerts.find((a) => /watch/i.test(a.event || ""));
      warnings = {
        warning: warning?.event || null,
        watch: watch?.event || null,
        fetched_at: alerts.fetched_at,
      };
    } catch {
      /* keep nulls */
    }
  }

  return {
    gps: platform
      ? {
          device_id: platform.device_id,
          device_name: platform.device_name,
          status: platform.status,
          latitude: platform.location?.latitude ?? null,
          longitude: platform.location?.longitude ?? null,
          speed_mph: platform.location?.speed_mph ?? null,
          heading_degrees: platform.location?.heading_degrees ?? null,
          accuracy_meters: platform.location?.accuracy_meters ?? null,
          elevation_meters: null,
          timestamp_utc: platform.location?.timestamp_utc ?? null,
          received_at_utc: platform.location?.received_at_utc ?? null,
          city: weather && "location_city" in weather ? weather.location_city : null,
          state: weather && "location_state" in weather ? weather.location_state : null,
          live_threshold_ms: GPS_LIVE_THRESHOLD_MS,
        }
      : null,
    weather:
      weather && !("error" in weather)
        ? {
            temperature_f: weather.temperature_f,
            conditions: weather.conditions,
            dew_point_f: weather.dew_point_f,
            humidity_percent: weather.humidity_percent,
            wind_speed_mph: weather.wind_speed_mph,
            wind_gusts_mph: weather.wind_gusts_mph,
            wind_direction: weather.wind_direction,
            pressure_hpa: weather.pressure_hpa,
            visibility_miles: weather.visibility_miles,
            fetched_at: weather.fetched_at,
            stale: weather.stale,
            city: weather.location_city,
            state: weather.location_state,
          }
        : weather,
    target: {
      city: targetCity,
      state: targetState,
      distance_miles: null,
      eta: null,
    },
    warnings,
  };
}

function buildHealthCards(
  listenerConfigured: boolean,
  snapshot: Awaited<ReturnType<typeof fetchListenerSnapshot>>,
  telemetry: Awaited<ReturnType<typeof buildTelemetry>>,
): HealthCard[] {
  const now = new Date().toISOString();
  const gpsStatus = telemetry.gps?.status ?? null;
  const weatherPayload = telemetry.weather;
  const weatherOk =
    weatherPayload != null &&
    typeof weatherPayload === "object" &&
    !("error" in weatherPayload);
  const weatherData = weatherOk
    ? (weatherPayload as {
        stale?: boolean;
        fetched_at?: string | null;
      })
    : null;
  const weatherStale = Boolean(weatherData?.stale);

  const obsStatus: HealthTone = !listenerConfigured
    ? "unavailable"
    : !snapshot.listenerConnected
      ? "disconnected"
      : snapshot.obsConnecting
        ? "stale"
        : snapshot.obsConnected
          ? "healthy"
          : "disconnected";

  return [
    {
      id: "obs",
      name: "OBS",
      status: obsStatus,
      label: snapshot.obsConnected ? "Connected" : snapshot.obsConnecting ? "Reconnecting" : "Disconnected",
      lastUpdate: snapshot.obsConnectedAt || snapshot.listenerUpdatedAt,
      error: snapshot.obsLastError,
    },
    {
      id: "listener",
      name: "OBS Listener",
      status: !listenerConfigured
        ? "unavailable"
        : snapshot.listenerConnected
          ? "healthy"
          : "disconnected",
      label: !listenerConfigured
        ? "Not configured"
        : snapshot.listenerConnected
          ? "Online"
          : "Offline",
      lastUpdate: snapshot.listenerUpdatedAt,
      error: snapshot.error || null,
    },
    {
      id: "stream",
      name: "Stream",
      status: !snapshot.obsConnected
        ? "unavailable"
        : snapshot.streamingActive
          ? "healthy"
          : "unknown",
      label: snapshot.streamingActive ? "Live" : "Idle",
      lastUpdate: snapshot.listenerUpdatedAt,
      error: null,
    },
    {
      id: "recording",
      name: "Recording",
      status: !snapshot.obsConnected
        ? "unavailable"
        : snapshot.recordingActive
          ? "healthy"
          : "unknown",
      label: snapshot.recordingActive ? "Recording" : "Idle",
      lastUpdate: snapshot.listenerUpdatedAt,
      error: null,
    },
    {
      id: "gps",
      name: "GPS",
      status: toneFromGps(gpsStatus),
      label: gpsStatus || "Unavailable",
      lastUpdate: telemetry.gps?.received_at_utc || null,
      error: null,
    },
    {
      id: "weather",
      name: "Weather",
      status: !weatherOk ? "unavailable" : weatherStale ? "stale" : "healthy",
      label: !weatherOk ? "Unavailable" : weatherStale ? "Stale" : "Current",
      lastUpdate: weatherData?.fetched_at ?? null,
      error:
        weatherPayload && typeof weatherPayload === "object" && "error" in weatherPayload
          ? String((weatherPayload as { error: unknown }).error)
          : null,
    },
    {
      id: "overlays",
      name: "Overlays",
      status: "healthy",
      label: "Public endpoints",
      lastUpdate: now,
      error: null,
    },
    {
      id: "cameras",
      name: "Cameras",
      status: snapshot.obsConnected
        ? snapshot.sources.some((s) => s.visible)
          ? "unknown"
          : "stale"
        : "unavailable",
      label: snapshot.obsConnected
        ? `${snapshot.sources.filter((s) => s.visible).length} visible`
        : "Unavailable",
      lastUpdate: snapshot.listenerUpdatedAt,
      error: null,
    },
    {
      id: "network",
      name: "Network",
      status: snapshot.listenerConnected || telemetry.gps ? "healthy" : "stale",
      label: "Worker reachable",
      lastUpdate: now,
      error: null,
    },
  ];
}

async function handleStatus(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const configured = await isObsListenerConfigured(env);
  let vdoLinks: Awaited<ReturnType<typeof listVdoNinjaLinks>> = [];
  try {
    vdoLinks = await listVdoNinjaLinks(env);
  } catch {
    vdoLinks = [];
  }

  const [snapshot, telemetry, settings, selectedBroadcast, activeWorkflow, youtube] =
    await Promise.all([
      fetchListenerSnapshot(env, refresh),
      buildTelemetry(env),
      getBroadcastSettingsPublic(env),
      getSelectedBroadcast(env).catch(() => null),
      getActiveWorkflowBroadcast(env).catch(() => null),
      getYoutubeConnectionStatus(env, request.url).catch(() => ({
        clientConfigured: false,
        connected: false,
        channelTitle: null,
        redirectUri: "",
      })),
    ]);

  return json({
    ok: true,
    configured,
    updatedAt: new Date().toISOString(),
    listener: snapshot,
    telemetry,
    health: buildHealthCards(configured, snapshot, telemetry),
    settings,
    youtube,
    vdoLinks,
    selectedBroadcast,
    activeWorkflow,
  });
}

function parseSceneBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const sceneName = (body as { sceneName?: unknown }).sceneName;
  return typeof sceneName === "string" ? sceneName.trim() : null;
}

export async function handleBroadcast(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  try {
    if (pathname === "/api/broadcast/agent-config" && method === "GET") {
      const token = extractBearerToken(request);
      if (!(await listenerTokenMatches(env, token))) {
        return errorResponse("Unauthorized", 401);
      }
      const config = await getAgentObsConfig(env);
      return json({ ok: true, ...config });
    }

    if (pathname === "/api/broadcast/status" && method === "GET") {
      return handleStatus(request, env);
    }

    if (pathname === "/api/broadcast/settings" && method === "GET") {
      const user = await getAuthUserFromRequest(env, request);
      if (!user) {
        return errorResponse("Authentication required", 401);
      }
      const [settings, youtube] = await Promise.all([
        getBroadcastSettingsPublic(env),
        getYoutubeConnectionStatus(env, request.url),
      ]);
      return json({ ok: true, settings, youtube });
    }

    if (pathname === "/api/broadcast/youtube/status" && method === "GET") {
      const denied = await requireBroadcastControl(request, env);
      if (denied) return denied;
      const youtube = await getYoutubeConnectionStatus(env, request.url);
      return json({ ok: true, youtube });
    }

    if (pathname === "/api/broadcast/youtube/oauth/start" && method === "GET") {
      const denied = await requireBroadcastControl(request, env);
      if (denied) return denied;
      const authUrl = await beginYoutubeOAuth(env, request.url);
      return Response.redirect(authUrl, 302);
    }

    if (pathname === "/api/broadcast/youtube/oauth/callback" && method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const oauthError = url.searchParams.get("error");
      const controlUrl = new URL("/broadcast/control/", url.origin);
      if (oauthError) {
        controlUrl.searchParams.set("youtube", "error");
        controlUrl.searchParams.set("message", oauthError);
        return Response.redirect(controlUrl.toString(), 302);
      }
      if (!code || !state) {
        controlUrl.searchParams.set("youtube", "error");
        controlUrl.searchParams.set("message", "missing_code");
        return Response.redirect(controlUrl.toString(), 302);
      }
      try {
        await completeYoutubeOAuth(env, request.url, code, state);
        controlUrl.searchParams.set("youtube", "connected");
      } catch (error) {
        controlUrl.searchParams.set("youtube", "error");
        controlUrl.searchParams.set(
          "message",
          error instanceof Error ? error.message : "oauth_failed",
        );
      }
      return Response.redirect(controlUrl.toString(), 302);
    }

    if (pathname === "/api/broadcast/youtube/disconnect" && method === "POST") {
      const denied = await requireBroadcastControl(request, env);
      if (denied) return denied;
      await disconnectYoutube(env);
      const youtube = await getYoutubeConnectionStatus(env, request.url);
      return json({ ok: true, youtube });
    }

    if (pathname === "/api/broadcast/vdo-links" && method === "GET") {
      const links = await listVdoNinjaLinks(env);
      return json({ ok: true, links });
    }

    if (pathname === "/api/broadcast/scenes" && method === "GET") {
      const snapshot = await fetchListenerSnapshot(env, false);
      return json({
        ok: true,
        currentProgramScene: snapshot.currentProgramScene,
        scenes: snapshot.scenes,
        streamingActive: Boolean(snapshot.streamingActive),
        obsConnected: snapshot.obsConnected,
        listenerConnected: snapshot.listenerConnected,
        error: snapshot.error || null,
      });
    }

    if (pathname === "/api/broadcast/sources" && method === "GET") {
      const snapshot = await fetchListenerSnapshot(env, false);
      return json({
        ok: true,
        sources: snapshot.sources,
        currentProgramScene: snapshot.currentProgramScene,
        obsConnected: snapshot.obsConnected,
        error: snapshot.error || null,
      });
    }

    if (pathname === "/api/broadcast/stats" && method === "GET") {
      const snapshot = await fetchListenerSnapshot(env, true);
      return json({
        ok: true,
        stats: snapshot.stats,
        obsConnected: snapshot.obsConnected,
        error: snapshot.error || null,
      });
    }

    // Write operations
    const denied = await requireBroadcastControl(request, env);
    if (denied) {
      return denied;
    }

    if (pathname === "/api/broadcast/settings" && method === "PUT") {
      const body = (await request.json().catch(() => null)) as BroadcastSettingsUpdate | null;
      if (!body || typeof body !== "object") {
        return errorResponse("JSON body is required");
      }
      try {
        const settings = await updateBroadcastSettings(env, body);
        return json({ ok: true, settings });
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : "Invalid settings", 400);
      }
    }

    if (pathname === "/api/broadcast/vdo-links/activate" && method === "POST") {
      const body = (await request.json().catch(() => null)) as { linkKey?: unknown } | null;
      const linkKey = typeof body?.linkKey === "string" ? body.linkKey : "";
      try {
        const links = await activateVdoNinjaLink(env, linkKey);
        return json({ ok: true, links });
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : "Failed to activate link", 400);
      }
    }

    if (pathname === "/api/broadcast/scenes/activate" && method === "POST") {
      const body = await request.json().catch(() => null);
      const sceneName = parseSceneBody(body);
      if (!sceneName) {
        return errorResponse("sceneName is required");
      }
      return proxyListenerAction(env, "/scenes/activate", "POST", { sceneName });
    }

    if (pathname === "/api/broadcast/sources/visibility" && method === "POST") {
      const body = (await request.json().catch(() => null)) as {
        sourceName?: unknown;
        visible?: unknown;
      } | null;
      if (!body || typeof body.sourceName !== "string" || typeof body.visible !== "boolean") {
        return errorResponse("sourceName and visible are required");
      }
      return proxyListenerAction(env, "/sources/visibility", "POST", {
        sourceName: body.sourceName,
        visible: body.visible,
      });
    }

    if (pathname === "/api/broadcast/sources/mute" && method === "POST") {
      const body = (await request.json().catch(() => null)) as {
        sourceName?: unknown;
        muted?: unknown;
      } | null;
      if (!body || typeof body.sourceName !== "string" || typeof body.muted !== "boolean") {
        return errorResponse("sourceName and muted are required");
      }
      return proxyListenerAction(env, "/sources/mute", "POST", {
        sourceName: body.sourceName,
        muted: body.muted,
      });
    }

    if (pathname === "/api/broadcast/sources/refresh" && method === "POST") {
      const body = (await request.json().catch(() => null)) as {
        sourceName?: unknown;
        matchers?: unknown;
      } | null;
      const sourceName = typeof body?.sourceName === "string" ? body.sourceName.trim() : "";
      const matchers = Array.isArray(body?.matchers)
        ? body.matchers.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
      if (!sourceName && matchers.length === 0) {
        return errorResponse("sourceName or matchers is required");
      }
      return proxyListenerAction(env, "/sources/refresh", "POST", {
        ...(sourceName ? { sourceName } : {}),
        ...(matchers.length ? { matchers } : {}),
      });
    }

    if (pathname === "/api/broadcast/stream/start" && method === "POST") {
      return proxyListenerAction(env, "/stream/start", "POST");
    }
    if (pathname === "/api/broadcast/stream/stop" && method === "POST") {
      return proxyListenerAction(env, "/stream/stop", "POST");
    }
    if (pathname === "/api/broadcast/recording/start" && method === "POST") {
      return proxyListenerAction(env, "/recording/start", "POST");
    }
    if (pathname === "/api/broadcast/recording/stop" && method === "POST") {
      return proxyListenerAction(env, "/recording/stop", "POST");
    }
    if (pathname === "/api/broadcast/reconnect" && method === "POST") {
      return proxyListenerAction(env, "/reconnect", "POST");
    }

    // --- Scheduled broadcasts & start workflow ---
    if (pathname === "/api/broadcast/scheduled" && method === "GET") {
      const from = url.searchParams.get("from") || undefined;
      const to = url.searchParams.get("to") || undefined;
      const [items, selected, active] = await Promise.all([
        listScheduledBroadcasts(env, { from, to }),
        getSelectedBroadcast(env),
        getActiveWorkflowBroadcast(env),
      ]);
      return json({ ok: true, broadcasts: items, selectedBroadcast: selected, activeWorkflow: active });
    }

    if (pathname === "/api/broadcast/scheduled" && method === "POST") {
      const denied = await requireBroadcastControl(request, env);
      if (denied) return denied;
      const user = await getAuthUserFromRequest(env, request);
      const body = (await request.json().catch(() => null)) as BroadcastInput | null;
      if (!body) return errorResponse("JSON body required");
      const created = await createScheduledBroadcast(env, body, user?.id || null);
      return json({ ok: true, broadcast: created }, 201);
    }

    // Allow hyphens in actions (start-output, confirm-ingest, go-live, emergency-stop).
    const scheduledMatch = pathname.match(/^\/api\/broadcast\/scheduled\/([^/]+)(?:\/([a-z_-]+))?$/);
    if (scheduledMatch) {
      const broadcastId = decodeURIComponent(scheduledMatch[1]);
      const action = scheduledMatch[2] || null;

      if (!action && method === "GET") {
        const broadcast = await getScheduledBroadcast(env, broadcastId);
        if (!broadcast) return errorResponse("Broadcast not found", 404);
        return json({ ok: true, broadcast });
      }

      if (!action && method === "PUT") {
        const denied = await requireBroadcastControl(request, env);
        if (denied) return denied;
        const body = (await request.json().catch(() => null)) as BroadcastInput | null;
        if (!body) return errorResponse("JSON body required");
        const updated = await updateScheduledBroadcast(env, broadcastId, body);
        return json({ ok: true, broadcast: updated });
      }

      if (!action && method === "DELETE") {
        const denied = await requireBroadcastControl(request, env);
        if (denied) return denied;
        await deleteBroadcast(env, broadcastId);
        return json({ ok: true });
      }

      if (action === "select" && method === "POST") {
        const denied = await requireBroadcastControl(request, env);
        if (denied) return denied;
        const selected = await selectBroadcast(env, broadcastId);
        return json({ ok: true, broadcast: selected });
      }

      if (action === "cancel" && method === "POST") {
        const denied = await requireBroadcastControl(request, env);
        if (denied) return denied;
        const cancelled = await cancelBroadcast(env, broadcastId);
        return json({ ok: true, broadcast: cancelled });
      }

      if (action === "prepare" && method === "POST") {
        const denied = await requireBroadcastControl(request, env);
        if (denied) return denied;
        const user = await getAuthUserFromRequest(env, request);
        const result = await prepareBroadcast(env, user?.id || null, broadcastId);
        return json({ ok: result.ok, ...result }, result.ok ? 200 : 409);
      }

      if (action === "start-output" && method === "POST") {
        const denied = await requireBroadcastControl(request, env);
        if (denied) return denied;
        const user = await getAuthUserFromRequest(env, request);
        const body = (await request.json().catch(() => null)) as { idempotencyKey?: string } | null;
        const result = await startBroadcastOutput(
          env,
          user?.id || null,
          broadcastId,
          body?.idempotencyKey,
        );
        return json({ ok: result.ok, ...result }, result.ok ? 200 : 409);
      }

      if (action === "confirm-ingest" && method === "POST") {
        const denied = await requireBroadcastControl(request, env);
        if (denied) return denied;
        const result = await confirmIngest(env, broadcastId);
        return json({ ok: result.ok, ...result }, result.ok ? 200 : 202);
      }

      if (action === "go-live" && method === "POST") {
        const denied = await requireBroadcastControl(request, env);
        if (denied) return denied;
        const user = await getAuthUserFromRequest(env, request);
        const result = await goLiveBroadcast(env, user?.id || null, broadcastId);
        return json({ ok: result.ok, ...result }, result.ok ? 200 : 409);
      }

      if (action === "end" && method === "POST") {
        const denied = await requireBroadcastControl(request, env);
        if (denied) return denied;
        const user = await getAuthUserFromRequest(env, request);
        const result = await endBroadcast(env, user?.id || null, broadcastId, false);
        return json({ ok: result.ok, ...result }, result.ok ? 200 : 409);
      }

      if (action === "emergency-stop" && method === "POST") {
        const denied = await requireBroadcastControl(request, env);
        if (denied) return denied;
        const user = await getAuthUserFromRequest(env, request);
        const result = await endBroadcast(env, user?.id || null, broadcastId, true);
        return json({ ok: result.ok, ...result }, result.ok ? 200 : 409);
      }
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    return routeErrorResponse(error, "Broadcast API");
  }
}
