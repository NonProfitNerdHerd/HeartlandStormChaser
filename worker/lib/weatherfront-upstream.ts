export const WEATHERFRONT_EMBED_PREFIX = "/weatherfront-embed";
export const WEATHERFRONT_APP_ORIGIN = "https://app.weatherfront.com";

export const WEATHERFRONT_UPSTREAM_PREFIXES: Record<string, string> = {
  "/weatherfront-api": "https://platform.weatherfront.com",
  "/weatherfront-cdn": "https://cdn.wxfront.com",
  "/weatherfront-static": "https://static.wxfront.com",
  "/weatherfront-wx-api": "https://api.wxfront.com",
  "/weatherfront-events": "https://events.wxfront.com",
  "/weatherfront-mapbox": "https://api.mapbox.com",
  "/weatherfront-mapbox-tiles": "https://a.tiles.mapbox.com",
};

/**
 * Upstream hosts that must be rewritten to absolute same-origin proxy URLs.
 * Absolute URLs are required because WeatherFront calls `new URL(cdnBase)` which
 * throws on relative paths like `/weatherfront-cdn`.
 */
export const WEATHERFRONT_HOST_REWRITES: [string, string][] = [
  ["https://platform.weatherfront.com", "/weatherfront-api"],
  ["https://cdn.wxfront.com", "/weatherfront-cdn"],
  ["https://static.wxfront.com", "/weatherfront-static"],
  ["https://api.wxfront.com", "/weatherfront-wx-api"],
  ["https://events.wxfront.com", "/weatherfront-events"],
  ["https://api.mapbox.com", "/weatherfront-mapbox"],
  ["https://a.tiles.mapbox.com", "/weatherfront-mapbox-tiles"],
  ["https://b.tiles.mapbox.com", "/weatherfront-mapbox-tiles"],
  ["https://c.tiles.mapbox.com", "/weatherfront-mapbox-tiles"],
  ["https://d.tiles.mapbox.com", "/weatherfront-mapbox-tiles"],
];

const CDN_LIKE_PREFIXES = new Set([
  "/weatherfront-cdn",
  "/weatherfront-static",
  "/weatherfront-mapbox",
  "/weatherfront-mapbox-tiles",
  "/weatherfront-events",
]);

export const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "content-encoding",
]);

export const STRIP_RESPONSE_HEADERS = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "strict-transport-security",
  // WeatherFront HTML/JS is published with long s-maxage; that caches broken proxy
  // rewrites in browsers/CDNs. Always set our own cache policy below when needed.
  "cache-control",
  "expires",
  "etag",
  "last-modified",
  "age",
]);

const STRIP_REQUEST_HEADERS_FOR_CDN = new Set([
  "cookie",
  "authorization",
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "cf-ray",
  "cf-visitor",
  "cf-ipcountry",
  "true-client-ip",
]);

/**
 * Rewrite absolute WeatherFront/Mapbox hosts to absolute same-origin proxy URLs.
 * `requestOrigin` is required (e.g. https://heartlandstormchaser….workers.dev).
 */
export function rewriteWeatherfrontUrls(content: string, requestOrigin: string): string {
  const origin = requestOrigin.replace(/\/+$/, "");
  let rewritten = content;

  for (const [from, pathPrefix] of WEATHERFRONT_HOST_REWRITES) {
    const to = `${origin}${pathPrefix}`;
    rewritten = rewritten.split(from).join(to);
  }

  // Soften strict pathname checks for auth/overlay when served under /weatherfront-embed.
  rewritten = rewritten
    .split('pathname==="/auth/callback"')
    .join('pathname.endsWith("/auth/callback")')
    .split("pathname==='/auth/callback'")
    .join("pathname.endsWith('/auth/callback')")
    .split('pathname.startsWith("/overlay/storm-chaser/")')
    .join('pathname.includes("/overlay/storm-chaser/")')
    .split("pathname.startsWith('/overlay/storm-chaser/')")
    .join("pathname.includes('/overlay/storm-chaser/')");

  return rewritten;
}

export function matchWeatherfrontUpstream(pathname: string): {
  prefix: string;
  origin: string;
  upstreamPath: string;
} | null {
  for (const [prefix, origin] of Object.entries(WEATHERFRONT_UPSTREAM_PREFIXES)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      const upstreamPath = pathname.slice(prefix.length) || "/";
      return { prefix, origin, upstreamPath };
    }
  }
  return null;
}

export function buildForwardHeaders(
  request: Request,
  upstreamHost: string,
  upstreamOrigin: string,
  options?: { cdnMode?: boolean },
): Headers {
  const headers = new Headers();
  const cdnMode = options?.cdnMode === true;

  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) {
      return;
    }
    if (cdnMode && STRIP_REQUEST_HEADERS_FOR_CDN.has(lower)) {
      return;
    }
    if (lower === "origin" || lower === "referer") {
      return;
    }
    headers.set(key, value);
  });

  headers.set("Host", upstreamHost);
  headers.set("Origin", upstreamOrigin);
  headers.set("Referer", `${upstreamOrigin}/`);

  if (!headers.has("User-Agent") || cdnMode) {
    headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
  }

  if (cdnMode) {
    headers.set("Accept", "*/*");
    headers.set("Accept-Language", "en-US,en;q=0.9");
  }

  return headers;
}

export function rewriteLocationHeader(
  location: string,
  upstreamOrigin: string,
  proxyPrefix: string,
  requestOrigin?: string,
): string {
  try {
    const parsed = new URL(location, upstreamOrigin);
    for (const [from, pathPrefix] of WEATHERFRONT_HOST_REWRITES) {
      if (parsed.href.startsWith(from)) {
        const origin = (requestOrigin || "").replace(/\/+$/, "");
        if (origin) {
          return origin + pathPrefix + parsed.href.slice(from.length);
        }
        return pathPrefix + parsed.href.slice(from.length);
      }
    }
    if (parsed.origin !== upstreamOrigin) {
      return location;
    }
    return `${proxyPrefix}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return location;
  }
}

export function buildProxyResponseHeaders(
  upstream: Response,
  options?: {
    contentType?: string;
    locationRewrite?: { upstreamOrigin: string; proxyPrefix: string; requestOrigin?: string };
    /** Force browsers not to reuse a previous broken proxy rewrite. */
    noStore?: boolean;
  },
): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || STRIP_RESPONSE_HEADERS.has(lower)) {
      return;
    }

    if (lower === "location" && options?.locationRewrite) {
      headers.set(
        key,
        rewriteLocationHeader(
          value,
          options.locationRewrite.upstreamOrigin,
          options.locationRewrite.proxyPrefix,
          options.locationRewrite.requestOrigin,
        ),
      );
      return;
    }

    headers.set(key, value);
  });

  if (options?.contentType) {
    headers.set("Content-Type", options.contentType);
  }

  if (options?.noStore) {
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
  }

  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");

  return headers;
}

export function isJavaScriptContentType(contentType: string): boolean {
  return (
    contentType.includes("javascript") ||
    contentType.includes("ecmascript") ||
    contentType.includes("typescript")
  );
}

export function isJsonContentType(contentType: string): boolean {
  return contentType.includes("application/json") || contentType.includes("+json");
}

export async function proxyWeatherfrontUpstream(
  request: Request,
  upstreamOrigin: string,
  upstreamPath: string,
  proxyPrefix: string,
): Promise<Response> {
  const requestOrigin = new URL(request.url).origin;
  const upstreamHost = new URL(upstreamOrigin).host;
  const method = request.method.toUpperCase();
  const cdnMode = CDN_LIKE_PREFIXES.has(proxyPrefix);

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  let fetchOrigin = upstreamOrigin;
  let fetchHost = upstreamHost;
  if (proxyPrefix === "/weatherfront-mapbox-tiles") {
    fetchOrigin = "https://a.tiles.mapbox.com";
    fetchHost = "a.tiles.mapbox.com";
  }

  const upstreamUrl = new URL(upstreamPath || "/", fetchOrigin);
  upstreamUrl.search = new URL(request.url).search;

  const forwardHeaders = buildForwardHeaders(request, fetchHost, WEATHERFRONT_APP_ORIGIN, {
    cdnMode,
  });

  if (proxyPrefix === "/weatherfront-mapbox" || proxyPrefix === "/weatherfront-mapbox-tiles") {
    forwardHeaders.set("Referer", `${WEATHERFRONT_APP_ORIGIN}/`);
    forwardHeaders.set("Origin", WEATHERFRONT_APP_ORIGIN);
  }

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method,
    headers: forwardHeaders,
    body: method === "GET" || method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });

  if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
    const location = upstreamResponse.headers.get("Location");
    if (location) {
      const rewritten = rewriteLocationHeader(location, fetchOrigin, proxyPrefix, requestOrigin);
      return Response.redirect(rewritten, upstreamResponse.status);
    }
  }

  const contentType = upstreamResponse.headers.get("Content-Type") ?? "";
  if (isJavaScriptContentType(contentType) || isJsonContentType(contentType)) {
    const body = rewriteWeatherfrontUrls(await upstreamResponse.text(), requestOrigin);
    return new Response(body, {
      status: upstreamResponse.status,
      headers: buildProxyResponseHeaders(upstreamResponse, {
        contentType,
        noStore: true,
      }),
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: buildProxyResponseHeaders(upstreamResponse, {
      locationRewrite: {
        upstreamOrigin: fetchOrigin,
        proxyPrefix,
        requestOrigin,
      },
      // Allow short caching of tiles/binaries; HTML/JS handled above with noStore.
      noStore: false,
    }),
  });
}
