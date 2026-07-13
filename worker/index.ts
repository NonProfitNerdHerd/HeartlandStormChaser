import { enforceRequestAuth } from "./lib/route-auth";
import { handleAuth } from "./routes/auth";
import { handleBroadcast } from "./routes/broadcast";
import { handleChases } from "./routes/chases";
import { handleChasersStreams } from "./routes/chasers-streams";
import { handleDashboard } from "./routes/dashboard";
import { handleDbTest } from "./routes/db-test";
import { handleGeocode } from "./routes/geocode";
import { handleGps } from "./routes/gps";
import { handleHealth } from "./routes/health";
import { handleOverlays } from "./routes/overlays";
import { handleWarnings } from "./routes/warnings";
import { handleWeather } from "./routes/weather";
import {
  handleWeatherfrontAuthCallback,
  handleWeatherfrontEmbed,
  handleWeatherfrontUpstreamRoute,
} from "./routes/weatherfront-proxy";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ENVIRONMENT?: string;
  YOUTUBE_API_KEY?: string;
  /** Google OAuth client for YouTube Live Streaming API (Broadcast Control). */
  YOUTUBE_CLIENT_ID?: string;
  YOUTUBE_CLIENT_SECRET?: string;
  /** Optional override; defaults to {origin}/api/broadcast/youtube/oauth/callback */
  YOUTUBE_REDIRECT_URI?: string;
  GPS_PAIRING_PIN?: string;
  WEB_AUTH_BOOTSTRAP_PASSWORD?: string;
  /** Base URL of the local OBS listener (e.g. Cloudflare Tunnel or LAN via tunnel). */
  OBS_LISTENER_URL?: string;
  /** Shared bearer token for Worker → OBS listener requests. */
  OBS_LISTENER_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const authGate = await enforceRequestAuth(request, env);
    if (authGate) {
      return authGate;
    }

    if (url.pathname.startsWith("/api/auth")) {
      return handleAuth(request, env);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return handleHealth(request, env);
    }

    if (url.pathname === "/api/db-test" && request.method === "GET") {
      return handleDbTest(request, env);
    }

    if (url.pathname.startsWith("/api/dashboard")) {
      return handleDashboard(request, env);
    }

    if (url.pathname.startsWith("/api/chasers-streams")) {
      return handleChasersStreams(request, env);
    }

    if (url.pathname.startsWith("/api/chases")) {
      return handleChases(request, env);
    }

    if (url.pathname.startsWith("/api/gps")) {
      return handleGps(request, env);
    }

    if (url.pathname.startsWith("/api/weather")) {
      return handleWeather(request, env);
    }

    if (url.pathname.startsWith("/api/warnings")) {
      return handleWarnings(request, env);
    }

    if (url.pathname.startsWith("/api/overlay") || url.pathname.startsWith("/api/overlays")) {
      return handleOverlays(request, env, ctx);
    }

    if (url.pathname.startsWith("/api/geocode")) {
      return handleGeocode(request);
    }

    if (url.pathname.startsWith("/api/broadcast")) {
      return handleBroadcast(request, env);
    }

    if (url.pathname === "/weatherfront" || url.pathname === "/weatherfront/") {
      return env.ASSETS.fetch(new URL("/weatherfront.html", request.url));
    }

    if (url.pathname === "/auth/callback") {
      return handleWeatherfrontAuthCallback(request);
    }

    if (url.pathname === "/weatherfront-embed" || url.pathname.startsWith("/weatherfront-embed/")) {
      return handleWeatherfrontEmbed(request);
    }

    const weatherfrontUpstream = await handleWeatherfrontUpstreamRoute(request);
    if (weatherfrontUpstream) {
      return weatherfrontUpstream;
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
