import { extractBearerToken, findDeviceByToken } from "./gps-auth";
import { getAuthUserFromRequest } from "./web-auth";
import type { Env } from "../index";

const PUBLIC_API_PREFIXES = [
  "/api/health",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/gps/pair",
  "/api/gps/health",
  "/api/overlay/",
  "/api/overlays/",
  "/api/broadcast/agent-config",
  "/api/broadcast/youtube/oauth/callback",
];

function isOverlayPagePath(pathname: string): boolean {
  return pathname === "/overlays.html" || pathname.startsWith("/overlays/");
}

function isLoginPagePath(pathname: string): boolean {
  return pathname === "/login.html";
}

function isStaticAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/css/") ||
    pathname.startsWith("/js/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/fonts/") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".map") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".woff") ||
    pathname.endsWith(".woff2")
  );
}

function isProtectedPagePath(pathname: string): boolean {
  if (isLoginPagePath(pathname) || isOverlayPagePath(pathname) || isStaticAssetPath(pathname)) {
    return false;
  }

  if (pathname === "/" || pathname.endsWith(".html") || pathname.endsWith("/")) {
    return true;
  }

  return false;
}

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

async function hasValidDeviceToken(request: Request, env: Env): Promise<boolean> {
  const token = extractBearerToken(request);
  if (!token) {
    return false;
  }

  const device = await findDeviceByToken(env, token);
  return Boolean(device && device.enabled === 1);
}

export async function enforceRequestAuth(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname.startsWith("/api/")) {
    if (isPublicApiPath(pathname)) {
      return null;
    }

    const sessionUser = await getAuthUserFromRequest(env, request);
    if (sessionUser || (await hasValidDeviceToken(request, env))) {
      return null;
    }

    return Response.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  if (!isProtectedPagePath(pathname)) {
    return null;
  }

  const sessionUser = await getAuthUserFromRequest(env, request);
  if (sessionUser) {
    return null;
  }

  const next = `${pathname}${url.search}`;
  const loginUrl = new URL("/login.html", url.origin);
  loginUrl.searchParams.set("next", next);
  return Response.redirect(loginUrl.toString(), 302);
}

export function isSecureRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (url.protocol === "https:") {
    return true;
  }

  return request.headers.get("X-Forwarded-Proto") === "https";
}
