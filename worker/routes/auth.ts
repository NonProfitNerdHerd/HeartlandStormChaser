import {
  authenticateUser,
  buildClearSessionCookie,
  buildSessionCookie,
  createSession,
  deleteSessionByToken,
  ensureBootstrapUser,
  getAuthUserFromRequest,
  getSessionTokenFromRequest,
} from "../lib/web-auth";
import { isSecureRequest } from "../lib/route-auth";
import type { Env } from "../index";

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(data, {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function errorResponse(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

export async function handleAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const secure = isSecureRequest(request);

  try {
    if (pathname === "/api/auth/login" && method === "POST") {
      await ensureBootstrapUser(env);

      let body: { username?: string; password?: string };
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON body");
      }

      const username = body.username?.trim();
      const password = body.password ?? "";
      if (!username || !password) {
        return errorResponse("username and password are required");
      }

      const user = await authenticateUser(env, username, password);
      if (!user) {
        return errorResponse("Invalid username or password", 401);
      }

      const session = await createSession(env, user.id);
      const expiresAt = new Date(session.expiresAt);
      return json(
        { ok: true, user },
        200,
        { "Set-Cookie": buildSessionCookie(session.token, expiresAt, secure) },
      );
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      const token = getSessionTokenFromRequest(request);
      if (token) {
        await deleteSessionByToken(env, token);
      }

      return json(
        { ok: true },
        200,
        { "Set-Cookie": buildClearSessionCookie(secure) },
      );
    }

    if (pathname === "/api/auth/me" && method === "GET") {
      const user = await getAuthUserFromRequest(env, request);
      if (!user) {
        return json({ ok: true, authenticated: false, user: null });
      }

      return json({ ok: true, authenticated: true, user });
    }

    return errorResponse("Not found", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth request failed";
    return errorResponse(message, 500);
  }
}
