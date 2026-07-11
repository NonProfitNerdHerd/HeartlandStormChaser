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

function rewriteRootRelativeUrls(html: string): string {
  return html
    .replace(/(\s(?:src|href)=["'])\/assets\//gi, `$1assets/`)
    .replace(/(\s(?:src|href)=["'])\/favicon\.png/gi, `$1favicon.png`)
    .replace(/(\s(?:src|href)=["'])\/overlay\//gi, `$1overlay/`);
}

function rewriteInlinePathChecks(html: string): string {
  return html
    .replace(
      /window\.location\.pathname\.startsWith\(['"]\/overlay\/storm-chaser\//g,
      'window.location.pathname.includes("/overlay/storm-chaser/',
    )
    .replace(/startsWith\(['"]\/overlay\/storm-chaser\//g, 'includes("/overlay/storm-chaser/');
}

function injectProxyBootstrap(html: string): string {
  const bootstrap =
    `<base href="${WEATHERFRONT_EMBED_PREFIX}/">` +
    '<script src="/js/weatherfront-geolocation-shim.js"></script>';
  return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${bootstrap}`);
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
        rewriteLocationHeader(location, WEATHERFRONT_APP_ORIGIN, WEATHERFRONT_EMBED_PREFIX),
        upstreamResponse.status,
      );
    }
  }

  const contentType = upstreamResponse.headers.get("Content-Type") ?? "";
  const requestOrigin = requestUrl.origin;

  if (contentType.includes("text/html")) {
    let html = await upstreamResponse.text();
    html = rewriteRootRelativeUrls(html);
    html = rewriteInlinePathChecks(html);
    html = injectProxyBootstrap(html);

    return new Response(html, {
      status: upstreamResponse.status,
      headers: buildProxyResponseHeaders(upstreamResponse, { contentType: "text/html; charset=UTF-8" }),
    });
  }

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
      locationRewrite: { upstreamOrigin: WEATHERFRONT_APP_ORIGIN, proxyPrefix: WEATHERFRONT_EMBED_PREFIX },
    }),
  });
}

export async function handleWeatherfrontAuthCallback(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL("/auth/callback", WEATHERFRONT_APP_ORIGIN);
  upstreamUrl.search = requestUrl.search;
  const method = request.method.toUpperCase();

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
        rewriteLocationHeader(location, WEATHERFRONT_APP_ORIGIN, WEATHERFRONT_EMBED_PREFIX),
        upstreamResponse.status,
      );
    }
  }

  let html = await upstreamResponse.text();
  html = rewriteRootRelativeUrls(html);
  html = rewriteInlinePathChecks(html);
  html = injectProxyBootstrap(html);

  return new Response(html, {
    status: upstreamResponse.status,
    headers: buildProxyResponseHeaders(upstreamResponse, { contentType: "text/html; charset=UTF-8" }),
  });
}
