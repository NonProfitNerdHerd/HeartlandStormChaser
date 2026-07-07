export const WEATHERFRONT_EMBED_PREFIX = "/weatherfront-embed";
export const WEATHERFRONT_APP_ORIGIN = "https://app.weatherfront.com";

export const WEATHERFRONT_UPSTREAM_PREFIXES: Record<string, string> = {
  "/weatherfront-api": "https://platform.weatherfront.com",
  "/weatherfront-cdn": "https://cdn.wxfront.com",
  "/weatherfront-static": "https://static.wxfront.com",
  "/weatherfront-wx-api": "https://api.wxfront.com",
};

export const WEATHERFRONT_URL_REWRITES: [string, string][] = [
  ["https://platform.weatherfront.com", "/weatherfront-api"],
  ["https://cdn.wxfront.com", "/weatherfront-cdn"],
  ["https://static.wxfront.com", "/weatherfront-static"],
  ["https://api.wxfront.com", "/weatherfront-wx-api"],
];

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
]);

export function rewriteWeatherfrontUrls(content: string, requestOrigin?: string): string {
  let rewritten = content;
  for (const [from, to] of WEATHERFRONT_URL_REWRITES) {
    rewritten = rewritten.split(from).join(to);
  }

  if (requestOrigin) {
    rewritten = rewritten.split('"static.wxfront.com"').join(`"${requestOrigin}/weatherfront-static"`);
    rewritten = rewritten.split("'static.wxfront.com'").join(`'${requestOrigin}/weatherfront-static'`);
  }

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
): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) {
      return;
    }
    headers.set(key, value);
  });

  headers.set("Host", upstreamHost);
  headers.set("Origin", upstreamOrigin);
  headers.set("Referer", `${upstreamOrigin}/`);

  if (!headers.has("User-Agent")) {
    headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
  }

  return headers;
}

export function rewriteLocationHeader(
  location: string,
  upstreamOrigin: string,
  proxyPrefix: string,
): string {
  try {
    const parsed = new URL(location, upstreamOrigin);
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
  options?: { contentType?: string; locationRewrite?: { upstreamOrigin: string; proxyPrefix: string } },
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
        rewriteLocationHeader(value, options.locationRewrite.upstreamOrigin, options.locationRewrite.proxyPrefix),
      );
      return;
    }

    headers.set(key, value);
  });

  if (options?.contentType) {
    headers.set("Content-Type", options.contentType);
  }

  return headers;
}

export function isJavaScriptContentType(contentType: string): boolean {
  return (
    contentType.includes("javascript") ||
    contentType.includes("ecmascript") ||
    contentType.includes("typescript")
  );
}

export async function proxyWeatherfrontUpstream(
  request: Request,
  upstreamOrigin: string,
  upstreamPath: string,
  proxyPrefix: string,
): Promise<Response> {
  const requestOrigin = new URL(request.url).origin;
  const upstreamHost = new URL(upstreamOrigin).host;
  const upstreamUrl = new URL(upstreamPath, upstreamOrigin);
  upstreamUrl.search = new URL(request.url).search;
  const method = request.method.toUpperCase();

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method,
    headers: buildForwardHeaders(request, upstreamHost, upstreamOrigin),
    body: method === "GET" || method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });

  if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
    const location = upstreamResponse.headers.get("Location");
    if (location) {
      return Response.redirect(
        rewriteLocationHeader(location, upstreamOrigin, proxyPrefix),
        upstreamResponse.status,
      );
    }
  }

  const contentType = upstreamResponse.headers.get("Content-Type") ?? "";
  if (isJavaScriptContentType(contentType)) {
    const body = rewriteWeatherfrontUrls(await upstreamResponse.text(), requestOrigin);
    return new Response(body, {
      status: upstreamResponse.status,
      headers: buildProxyResponseHeaders(upstreamResponse, { contentType }),
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: buildProxyResponseHeaders(upstreamResponse, {
      locationRewrite: { upstreamOrigin, proxyPrefix },
    }),
  });
}
