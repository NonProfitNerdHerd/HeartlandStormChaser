import type { Env } from "../index";

export function handleHealth(_request: Request, env: Env): Response {
  return Response.json({
    ok: true,
    service: "HeartlandStormChaser",
    environment: env.ENVIRONMENT ?? "development",
    timestamp: new Date().toISOString(),
  });
}
