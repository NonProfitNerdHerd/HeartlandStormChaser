import { routeErrorResponse } from "../lib/db-errors";
import { getActiveChaseForDevice, recordChasePoint } from "../lib/chase-points";
import { extractBearerToken, findDeviceByToken } from "../lib/gps-auth";
import type { Env } from "../index";

const JSON_HEADERS = { "Content-Type": "application/json" };
const EXPENSE_CATEGORIES = ["Gas", "Food", "Hotel", "Other"] as const;
type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

function nowUtc(): string {
  return new Date().toISOString();
}

function parseChaseId(pathname: string): string | null {
  const match = pathname.match(/^\/api\/chases\/([^/]+)/);
  return match?.[1] ?? null;
}

function parseExpenseId(pathname: string): string | null {
  const match = pathname.match(/\/expenses\/([^/]+)$/);
  return match?.[1] ?? null;
}

async function getChaseOr404(env: Env, chaseId: string) {
  return env.DB.prepare(`SELECT * FROM chases WHERE id = ?`).bind(chaseId).first<ChaseRow>();
}

interface ChaseRow {
  id: string;
  device_id: string;
  chase_name: string;
  status: string;
  start_time: string;
  end_time: string | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  total_distance_miles: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface ExpenseRow {
  id: string;
  chase_id: string;
  category: string;
  amount: number;
  description: string;
  expense_time: string;
  created_at: string;
  updated_at: string;
}

function mapChaseSummary(row: ChaseRow, expenseTotal: number) {
  return {
    id: row.id,
    device_id: row.device_id,
    chase_name: row.chase_name,
    status: row.status,
    start_time: row.start_time,
    end_time: row.end_time,
    start_lat: row.start_lat,
    start_lng: row.start_lng,
    end_lat: row.end_lat,
    end_lng: row.end_lng,
    total_distance_miles: row.total_distance_miles,
    total_expenses: expenseTotal,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getExpenseTotal(env: Env, chaseId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM chase_expenses WHERE chase_id = ?`,
  )
    .bind(chaseId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function getExpenseBreakdown(env: Env, chaseId: string) {
  const result = await env.DB.prepare(
    `SELECT category, COALESCE(SUM(amount), 0) AS total
     FROM chase_expenses
     WHERE chase_id = ?
     GROUP BY category`,
  )
    .bind(chaseId)
    .all<{ category: string; total: number }>();

  const breakdown: Record<string, number> = {
    Gas: 0,
    Food: 0,
    Hotel: 0,
    Other: 0,
  };

  for (const row of result.results ?? []) {
    breakdown[row.category] = row.total;
  }

  return breakdown;
}

type DeviceAuth =
  | { ok: true; device: { id: string; enabled: number } }
  | { ok: false; response: Response };

async function resolveDevice(request: Request, env: Env): Promise<DeviceAuth> {
  const token = extractBearerToken(request);
  if (!token) {
    return { ok: false, response: errorResponse("Missing Bearer device token", 401) };
  }

  const device = await findDeviceByToken(env, token);
  if (!device) {
    return { ok: false, response: errorResponse("Invalid device token", 401) };
  }
  if (device.enabled !== 1) {
    return { ok: false, response: errorResponse("Device is disabled", 403) };
  }

  return { ok: true, device };
}

async function handleListChases(env: Env): Promise<Response> {
  const chases = await env.DB.prepare(
    `SELECT * FROM chases ORDER BY start_time DESC`,
  ).all<ChaseRow>();

  const summaries = [];
  for (const row of chases.results ?? []) {
    const total = await getExpenseTotal(env, row.id);
    summaries.push(mapChaseSummary(row, total));
  }

  return json({ ok: true, chases: summaries });
}

async function handleGetActive(request: Request, env: Env): Promise<Response> {
  const auth = await resolveDevice(request, env);
  if (!auth.ok) {
    return auth.response;
  }

  const chase = await env.DB.prepare(
    `SELECT * FROM chases
     WHERE device_id = ? AND status IN ('active', 'paused')
     ORDER BY start_time DESC
     LIMIT 1`,
  )
    .bind(auth.device.id)
    .first<ChaseRow>();

  if (!chase) {
    return json({ ok: true, chase: null });
  }

  const total = await getExpenseTotal(env, chase.id);
  return json({ ok: true, chase: mapChaseSummary(chase, total) });
}

async function handleGetChase(env: Env, chaseId: string): Promise<Response> {
  const chase = await getChaseOr404(env, chaseId);
  if (!chase) {
    return errorResponse("Chase not found", 404);
  }

  const points = await env.DB.prepare(
    `SELECT id, lat, lng, accuracy, speed, heading, altitude, recorded_at, source_device_id
     FROM chase_gps_points
     WHERE chase_id = ?
     ORDER BY recorded_at ASC`,
  )
    .bind(chaseId)
    .all();

  const expenses = await env.DB.prepare(
    `SELECT * FROM chase_expenses WHERE chase_id = ? ORDER BY expense_time DESC`,
  )
    .bind(chaseId)
    .all<ExpenseRow>();

  const total = await getExpenseTotal(env, chaseId);
  const breakdown = await getExpenseBreakdown(env, chaseId);

  return json({
    ok: true,
    chase: mapChaseSummary(chase, total),
    points: points.results ?? [],
    expenses: expenses.results ?? [],
    expense_breakdown: breakdown,
  });
}

async function handleCreateChase(request: Request, env: Env): Promise<Response> {
  const auth = await resolveDevice(request, env);
  if (!auth.ok) {
    return auth.response;
  }

  let body: { chase_name?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const chaseName = body.chase_name?.trim();
  if (!chaseName) {
    return errorResponse("chase_name is required");
  }

  const existing = await getActiveChaseForDevice(env, auth.device.id);
  if (existing) {
    return errorResponse("An active or paused chase already exists for this device", 409);
  }

  const timestamp = nowUtc();
  const chaseId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO chases
       (id, device_id, chase_name, status, start_time, notes, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
  )
    .bind(
      chaseId,
      auth.device.id,
      chaseName,
      timestamp,
      body.notes?.trim() ?? "",
      timestamp,
      timestamp,
    )
    .run();

  const chase = await getChaseOr404(env, chaseId);
  return json({ ok: true, chase: mapChaseSummary(chase!, 0) }, 201);
}

async function handleUpdateChase(
  request: Request,
  env: Env,
  chaseId: string,
): Promise<Response> {
  const chase = await getChaseOr404(env, chaseId);
  if (!chase) {
    return errorResponse("Chase not found", 404);
  }

  let body: {
    chase_name?: string;
    notes?: string;
    status?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const updates: string[] = [];
  const bindings: unknown[] = [];

  if (body.chase_name != null) {
    const name = body.chase_name.trim();
    if (!name) {
      return errorResponse("chase_name cannot be empty");
    }
    updates.push("chase_name = ?");
    bindings.push(name);
  }

  if (body.notes != null) {
    updates.push("notes = ?");
    bindings.push(body.notes.trim());
  }

  if (body.status != null) {
    if (!["active", "paused", "completed"].includes(body.status)) {
      return errorResponse("status must be active, paused, or completed");
    }
    if (chase.status === "completed" && body.status !== "completed") {
      return errorResponse("Completed chases cannot be reopened");
    }
    updates.push("status = ?");
    bindings.push(body.status);
    if (body.status === "completed" && !chase.end_time) {
      updates.push("end_time = ?");
      bindings.push(nowUtc());
    }
  }

  if (updates.length === 0) {
    return errorResponse("No valid fields to update");
  }

  updates.push("updated_at = ?");
  bindings.push(nowUtc());
  bindings.push(chaseId);

  await env.DB.prepare(
    `UPDATE chases SET ${updates.join(", ")} WHERE id = ?`,
  )
    .bind(...bindings)
    .run();

  const updated = await getChaseOr404(env, chaseId);
  const total = await getExpenseTotal(env, chaseId);
  return json({ ok: true, chase: mapChaseSummary(updated!, total) });
}

async function handleCompleteChase(env: Env, chaseId: string): Promise<Response> {
  const chase = await getChaseOr404(env, chaseId);
  if (!chase) {
    return errorResponse("Chase not found", 404);
  }

  if (chase.status === "completed") {
    return errorResponse("Chase is already completed");
  }

  const timestamp = nowUtc();
  await env.DB.prepare(
    `UPDATE chases SET status = 'completed', end_time = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(timestamp, timestamp, chaseId)
    .run();

  const updated = await getChaseOr404(env, chaseId);
  const total = await getExpenseTotal(env, chaseId);
  return json({ ok: true, chase: mapChaseSummary(updated!, total) });
}

async function handleDeleteChase(env: Env, chaseId: string): Promise<Response> {
  const chase = await getChaseOr404(env, chaseId);
  if (!chase) {
    return errorResponse("Chase not found", 404);
  }

  await env.DB.prepare(`DELETE FROM chases WHERE id = ?`).bind(chaseId).run();
  return json({ ok: true });
}

async function handleAddPoint(
  request: Request,
  env: Env,
  chaseId: string,
): Promise<Response> {
  const auth = await resolveDevice(request, env);
  if (!auth.ok) {
    return auth.response;
  }

  let body: {
    lat?: number;
    lng?: number;
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
    altitude?: number | null;
    recorded_at?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  if (typeof body.lat !== "number" || typeof body.lng !== "number") {
    return errorResponse("lat and lng are required numbers");
  }

  const result = await recordChasePoint(env, {
    chaseId,
    sourceDeviceId: auth.device.id,
    lat: body.lat,
    lng: body.lng,
    accuracy: body.accuracy ?? null,
    speed: body.speed ?? null,
    heading: body.heading ?? null,
    altitude: body.altitude ?? null,
    recordedAt: body.recorded_at?.trim() || nowUtc(),
  });

  return json({ ok: true, recorded: result.recorded, point_id: result.pointId ?? null });
}

async function handleAddPointsBatch(
  request: Request,
  env: Env,
  chaseId: string,
): Promise<Response> {
  const auth = await resolveDevice(request, env);
  if (!auth.ok) {
    return auth.response;
  }

  let body: {
    points?: Array<{
      lat: number;
      lng: number;
      accuracy?: number | null;
      speed?: number | null;
      heading?: number | null;
      altitude?: number | null;
      recorded_at?: string;
    }>;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  if (!Array.isArray(body.points) || body.points.length === 0) {
    return errorResponse("points array is required");
  }

  let recorded = 0;
  for (const point of body.points) {
    const result = await recordChasePoint(env, {
      chaseId,
      sourceDeviceId: auth.device.id,
      lat: point.lat,
      lng: point.lng,
      accuracy: point.accuracy ?? null,
      speed: point.speed ?? null,
      heading: point.heading ?? null,
      altitude: point.altitude ?? null,
      recordedAt: point.recorded_at?.trim() || nowUtc(),
    });
    if (result.recorded) {
      recorded += 1;
    }
  }

  return json({ ok: true, recorded_count: recorded });
}

function parseExpenseCategory(value: string | undefined): ExpenseCategory | null {
  if (!value || !EXPENSE_CATEGORIES.includes(value as ExpenseCategory)) {
    return null;
  }
  return value as ExpenseCategory;
}

async function handleAddExpense(
  request: Request,
  env: Env,
  chaseId: string,
): Promise<Response> {
  const chase = await getChaseOr404(env, chaseId);
  if (!chase) {
    return errorResponse("Chase not found", 404);
  }

  let body: {
    category?: string;
    amount?: number;
    description?: string;
    expense_time?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const category = parseExpenseCategory(body.category);
  if (!category) {
    return errorResponse("category must be Gas, Food, Hotel, or Other");
  }

  if (typeof body.amount !== "number" || body.amount < 0) {
    return errorResponse("amount must be a non-negative number");
  }

  const timestamp = nowUtc();
  const expenseId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO chase_expenses
       (id, chase_id, category, amount, description, expense_time, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      expenseId,
      chaseId,
      category,
      body.amount,
      body.description?.trim() ?? "",
      body.expense_time?.trim() || timestamp,
      timestamp,
      timestamp,
    )
    .run();

  const expense = await env.DB.prepare(`SELECT * FROM chase_expenses WHERE id = ?`)
    .bind(expenseId)
    .first<ExpenseRow>();

  return json({ ok: true, expense }, 201);
}

async function handleUpdateExpense(
  request: Request,
  env: Env,
  chaseId: string,
  expenseId: string,
): Promise<Response> {
  const expense = await env.DB.prepare(
    `SELECT * FROM chase_expenses WHERE id = ? AND chase_id = ?`,
  )
    .bind(expenseId, chaseId)
    .first<ExpenseRow>();

  if (!expense) {
    return errorResponse("Expense not found", 404);
  }

  let body: {
    category?: string;
    amount?: number;
    description?: string;
    expense_time?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const updates: string[] = [];
  const bindings: unknown[] = [];

  if (body.category != null) {
    const category = parseExpenseCategory(body.category);
    if (!category) {
      return errorResponse("category must be Gas, Food, Hotel, or Other");
    }
    updates.push("category = ?");
    bindings.push(category);
  }

  if (body.amount != null) {
    if (typeof body.amount !== "number" || body.amount < 0) {
      return errorResponse("amount must be a non-negative number");
    }
    updates.push("amount = ?");
    bindings.push(body.amount);
  }

  if (body.description != null) {
    updates.push("description = ?");
    bindings.push(body.description.trim());
  }

  if (body.expense_time != null) {
    updates.push("expense_time = ?");
    bindings.push(body.expense_time.trim());
  }

  if (updates.length === 0) {
    return errorResponse("No valid fields to update");
  }

  updates.push("updated_at = ?");
  bindings.push(nowUtc());
  bindings.push(expenseId);

  await env.DB.prepare(
    `UPDATE chase_expenses SET ${updates.join(", ")} WHERE id = ?`,
  )
    .bind(...bindings)
    .run();

  const updated = await env.DB.prepare(`SELECT * FROM chase_expenses WHERE id = ?`)
    .bind(expenseId)
    .first<ExpenseRow>();

  return json({ ok: true, expense: updated });
}

async function handleDeleteExpense(
  env: Env,
  chaseId: string,
  expenseId: string,
): Promise<Response> {
  const expense = await env.DB.prepare(
    `SELECT id FROM chase_expenses WHERE id = ? AND chase_id = ?`,
  )
    .bind(expenseId, chaseId)
    .first();

  if (!expense) {
    return errorResponse("Expense not found", 404);
  }

  await env.DB.prepare(`DELETE FROM chase_expenses WHERE id = ?`).bind(expenseId).run();
  return json({ ok: true });
}

export async function handleChases(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  try {
    if (pathname === "/api/chases" && method === "GET") {
      return handleListChases(env);
    }

    if (pathname === "/api/chases" && method === "POST") {
      return handleCreateChase(request, env);
    }

    if (pathname === "/api/chases/active" && method === "GET") {
      return handleGetActive(request, env);
    }

    const chaseId = parseChaseId(pathname);
    if (!chaseId) {
      return errorResponse("Not found", 404);
    }

    if (pathname === `/api/chases/${chaseId}` && method === "GET") {
      return handleGetChase(env, chaseId);
    }

    if (pathname === `/api/chases/${chaseId}` && method === "PUT") {
      return handleUpdateChase(request, env, chaseId);
    }

    if (pathname === `/api/chases/${chaseId}` && method === "DELETE") {
      return handleDeleteChase(env, chaseId);
    }

    if (pathname === `/api/chases/${chaseId}/complete` && method === "POST") {
      return handleCompleteChase(env, chaseId);
    }

    if (pathname === `/api/chases/${chaseId}/points` && method === "POST") {
      return handleAddPoint(request, env, chaseId);
    }

    if (pathname === `/api/chases/${chaseId}/points/batch` && method === "POST") {
      return handleAddPointsBatch(request, env, chaseId);
    }

    if (pathname === `/api/chases/${chaseId}/expenses` && method === "POST") {
      return handleAddExpense(request, env, chaseId);
    }

    const expenseId = parseExpenseId(pathname);
    if (expenseId && pathname === `/api/chases/${chaseId}/expenses/${expenseId}`) {
      if (method === "PUT") {
        return handleUpdateExpense(request, env, chaseId, expenseId);
      }
      if (method === "DELETE") {
        return handleDeleteExpense(env, chaseId, expenseId);
      }
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
