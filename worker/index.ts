import { handleDbTest } from "./routes/db-test";
import { handleHealth } from "./routes/health";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ENVIRONMENT?: string;
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

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
