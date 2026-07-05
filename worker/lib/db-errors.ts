const JSON_HEADERS = { "Content-Type": "application/json" };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: JSON_HEADERS });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isSchemaError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("no such table") ||
    lower.includes("no such column") ||
    lower.includes("d1_error")
  );
}

export function routeErrorResponse(error: unknown, context?: string): Response {
  const detail = errorMessage(error);
  const prefix = context ? `${context}: ` : "";

  if (isSchemaError(detail)) {
    return json(
      {
        ok: false,
        error: `${prefix}Database schema is not ready. Apply D1 migrations to the remote database.`,
        detail,
      },
      503,
    );
  }

  console.error(context ?? "Route error", error);

  return json(
    {
      ok: false,
      error: `${prefix}${detail}`,
    },
    500,
  );
}

export async function runRoute<T>(
  handler: () => Promise<T>,
  context: string,
): Promise<T | Response> {
  try {
    return await handler();
  } catch (error) {
    return routeErrorResponse(error, context);
  }
}
