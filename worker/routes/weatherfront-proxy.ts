import {
  WEATHERFRONT_APP_ORIGIN,
  WEATHERFRONT_EMBED_PREFIX,
  buildForwardHeaders,
  buildProxyResponseHeaders,
  isJavaScriptContentType,
  matchWeatherfrontUpstream,
  proxyWeatherfrontUpstream,
  rewriteLocationHeader,
  rewriteWeatherfrontUrls,
} from "../lib/weatherfront-upstream";

function buildEmbedUpstreamUrl(requestUrl: URL): URL {
  const upstreamPath = requestUrl.pathname.replace(/^\/weatherfront-embed\/?/, "/") || "/";
  const upstream = new URL(upstreamPath, WEATHERFRONT_APP_ORIGIN);
  upstream.search = requestUrl.search;
  return upstream;
}

/**
 * Keep root-relative asset URLs working under <base href="/weatherfront-embed/">.
 * Do not rewrite inline JavaScript — previous quote-breaking rewrites caused SyntaxError.
 */
function rewriteRootRelativeUrls(html: string): string {
  return html
    .replace(/(\s(?:src|href)=["'])\/assets\//gi, `$1assets/`)
    .replace(/(\s(?:src|href)=["'])\/favicon\.png/gi, `$1favicon.png`)
    .replace(/(\s(?:src|href)=["'])\/overlay\//gi, `$1overlay/`)
    .replace(/(\s(?:src|href)=["'])\/mapbox-logo\.svg/gi, `$1mapbox-logo.svg`);
}

function injectProxyBootstrap(html: string): string {
  const bootstrap =
    `<base href="${WEATHERFRONT_EMBED_PREFIX}/">` +
    '<script src="/js/weatherfront-geolocation-shim.js?v=4"></script>';
  return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${bootstrap}`);
}

/** WeatherFront root paths that accidentally resolve outside /weatherfront-embed. */
export function isWeatherfrontRootAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/data/") ||
    pathname.startsWith("/overlay/") ||
    pathname === "/favicon.png" ||
    pathname === "/mapbox-logo.svg"
  );
}

/**
 * Serve WeatherFront root asset paths (/assets, /icons, /data, …) through the
 * embed proxy when a client still requests them at the site root.
 */
export async function handleWeatherfrontRootAssetFallback(request: Request): Promise<Response | null> {
  const requestUrl = new URL(request.url);
  if (!isWeatherfrontRootAssetPath(requestUrl.pathname)) {
    return null;
  }

  const rewrittenUrl = new URL(
    `${WEATHERFRONT_EMBED_PREFIX}${requestUrl.pathname}${requestUrl.search}`,
    requestUrl.origin,
  );
  return handleWeatherfrontEmbed(new Request(rewrittenUrl.toString(), request));
}

export async function handleWeatherfrontUpstreamRoute(request: Request): Promise<Response | null> {
  const match = matchWeatherfrontUpstream(new URL(request.url).pathname);
  if (!match) {
    return null;
  }

  return proxyWeatherfrontUpstream(request, match.origin, match.upstreamPath, match.prefix);
}

export async function handleWeatherfrontEmbed(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const upstreamUrl = buildEmbedUpstreamUrl(requestUrl);
  const method = request.method.toUpperCase();
  const requestOrigin = requestUrl.origin;

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method,
    headers: buildForwardHeaders(request, "app.weatherfront.com", WEATHERFRONT_APP_ORIGIN),
    body: method === "GET" || method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });

  if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
    const location = upstreamResponse.headers.get("Location");
    if (location) {
      return Response.redirect(
        rewriteLocationHeader(location, WEATHERFRONT_APP_ORIGIN, WEATHERFRONT_EMBED_PREFIX, requestOrigin),
        upstreamResponse.status,
      );
    }
  }

  const contentType = upstreamResponse.headers.get("Content-Type") ?? "";

  if (contentType.includes("text/html")) {
    let html = await upstreamResponse.text();
    html = rewriteRootRelativeUrls(html);
    // Proxy Mapbox CSS through our Worker so the embed does not depend on
    // cross-origin stylesheet loads from api.mapbox.com.
    html = html.replace(
      /https:\/\/api\.mapbox\.com\//g,
      `${requestOrigin}/weatherfront-mapbox/`,
    );
    html = injectProxyBootstrap(html);

    return new Response(html, {
      status: upstreamResponse.status,
      headers: buildProxyResponseHeaders(upstreamResponse, {
        contentType: "text/html; charset=UTF-8",
        noStore: true,
      }),
    });
  }

  if (isJavaScriptContentType(contentType)) {
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
        upstreamOrigin: WEATHERFRONT_APP_ORIGIN,
        proxyPrefix: WEATHERFRONT_EMBED_PREFIX,
        requestOrigin,
      },
    }),
  });
}

export async function handleWeatherfrontAuthCallback(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL("/auth/callback", WEATHERFRONT_APP_ORIGIN);
  upstreamUrl.search = requestUrl.search;
  const method = request.method.toUpperCase();
  const requestOrigin = requestUrl.origin;

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method,
    headers: buildForwardHeaders(request, "app.weatherfront.com", WEATHERFRONT_APP_ORIGIN),
    body: method === "GET" || method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });

  if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
    const location = upstreamResponse.headers.get("Location");
    if (location) {
      return Response.redirect(
        rewriteLocationHeader(location, WEATHERFRONT_APP_ORIGIN, WEATHERFRONT_EMBED_PREFIX, requestOrigin),
        upstreamResponse.status,
      );
    }
  }

  let html = await upstreamResponse.text();
  html = rewriteRootRelativeUrls(html);
  html = html.replace(
    /https:\/\/api\.mapbox\.com\//g,
    `${requestOrigin}/weatherfront-mapbox/`,
  );
  html = injectProxyBootstrap(html);

  return new Response(html, {
    status: upstreamResponse.status,
    headers: buildProxyResponseHeaders(upstreamResponse, {
      contentType: "text/html; charset=UTF-8",
      noStore: true,
    }),
  });
}
