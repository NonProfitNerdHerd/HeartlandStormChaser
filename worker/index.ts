import { handleChasersStreams } from "./routes/chasers-streams";
import { handleDashboard } from "./routes/dashboard";
import { handleDbTest } from "./routes/db-test";
import { handleGps } from "./routes/gps";
import { handleHealth } from "./routes/health";
import { handleOverlays } from "./routes/overlays";
import { handleWarnings } from "./routes/warnings";
import { handleWeather } from "./routes/weather";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ENVIRONMENT?: string;
  YOUTUBE_API_KEY?: string;
  GPS_PAIRING_PIN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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
      return handleOverlays(request, env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
