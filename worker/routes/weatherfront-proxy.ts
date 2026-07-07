const WEATHERFRONT_ORIGIN = "https://app.weatherfront.com";
const PROXY_PREFIX = "/weatherfront-embed";

const HOP_BY_HOP_HEADERS = new Set([
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

const STRIP_RESPONSE_HEADERS = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "strict-transport-security",
]);

function buildUpstreamUrl(requestUrl: URL): URL {
  const upstreamPath = requestUrl.pathname.replace(/^\/weatherfront-embed\/?/, "/") || "/";
  const upstream = new URL(upstreamPath, WEATHERFRONT_ORIGIN);
  upstream.search = requestUrl.search;
  return upstream;
}

function buildForwardHeaders(request: Request): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  headers.set("Host", "app.weatherfront.com");
  headers.set("Origin", WEATHERFRONT_ORIGIN);
  headers.set("Referer", `${WEATHERFRONT_ORIGIN}/`);
  return headers;
}

function buildResponseHeaders(upstream: Response, contentType?: string): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || STRIP_RESPONSE_HEADERS.has(lower)) {
      return;
    }

    if (lower === "location") {
      headers.set(key, rewriteLocationHeader(value));
      return;
    }

    headers.set(key, value);
  });

  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  return headers;
}

function rewriteLocationHeader(location: string): string {
  try {
    const parsed = new URL(location, WEATHERFRONT_ORIGIN);
    if (parsed.origin !== WEATHERFRONT_ORIGIN) {
      return location;
    }
    return `${PROXY_PREFIX}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return location;
  }
}

function rewriteRootRelativeUrls(html: string): string {
  return html
    .replace(/(\s(?:src|href)=["'])\/assets\//gi, `$1assets/`)
    .replace(/(\s(?:src|href)=["'])\/favicon\.png/gi, `$1favicon.png`)
    .replace(/(\s(?:src|href)=["'])\/overlay\//gi, `$1overlay/`);
}

function injectProxyBootstrap(html: string): string {
  const bootstrap =
    '<base href="/weatherfront-embed/">' +
    '<script src="/js/weatherfront-geolocation-shim.js"></script>';
  return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${bootstrap}`);
}

export async function handleWeatherfrontProxy(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const upstreamUrl = buildUpstreamUrl(requestUrl);
  const method = request.method.toUpperCase();

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method,
    headers: buildForwardHeaders(request),
    body: method === "GET" || method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });

  if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
    const location = upstreamResponse.headers.get("Location");
    if (location) {
      return Response.redirect(rewriteLocationHeader(location), upstreamResponse.status);
    }
  }

  const contentType = upstreamResponse.headers.get("Content-Type") ?? "";
  if (contentType.includes("text/html")) {
    let html = await upstreamResponse.text();
    html = rewriteRootRelativeUrls(html);
    html = injectProxyBootstrap(html);

    return new Response(html, {
      status: upstreamResponse.status,
      headers: buildResponseHeaders(upstreamResponse, "text/html; charset=UTF-8"),
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: buildResponseHeaders(upstreamResponse),
  });
}
