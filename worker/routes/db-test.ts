import type { Env } from "../index";

const DATABASE_NAME = "heartland-storm-chaser-db";

const TABLE_NAMES = [
  "devices",
  "latest_location",
  "alert_layers",
  "system_settings",
] as const;

export async function handleDbTest(_request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return Response.json(
      {
        ok: false,
        error: "D1 binding DB is not configured",
        database: DATABASE_NAME,
      },
      { status: 503 },
    );
  }

  try {
    const tables: Record<string, number> = {};

    for (const tableName of TABLE_NAMES) {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM ${tableName}`,
      ).first<{ count: number }>();

      tables[tableName] = row?.count ?? 0;
    }

    return Response.json({
      ok: true,
      database: DATABASE_NAME,
      tables,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";

    return Response.json(
      {
        ok: false,
        error: message,
        database: DATABASE_NAME,
      },
      { status: 500 },
    );
  }
}
