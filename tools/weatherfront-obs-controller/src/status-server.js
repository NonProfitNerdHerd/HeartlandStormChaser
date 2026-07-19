import http from "node:http";
import { redactUrl } from "./redaction.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function validateLocalControlRequest(req, { host, port, controlToken }) {
  const method = req.method || "GET";
  if (method !== "POST") {
    return { ok: false, status: 405, error: "POST required" };
  }

  const hostHeader = (req.headers.host || "").split(":")[0];
  if (hostHeader && hostHeader !== "127.0.0.1" && hostHeader !== "localhost") {
    return { ok: false, status: 403, error: "Invalid Host" };
  }

  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.hostname !== "127.0.0.1" && o.hostname !== "localhost") {
        return { ok: false, status: 403, error: "Invalid Origin" };
      }
    } catch {
      return { ok: false, status: 403, error: "Invalid Origin" };
    }
  }

  const token =
    req.headers["x-controller-token"] ||
    (() => {
      const auth = req.headers.authorization || "";
      const m = /^Bearer\s+(.+)$/i.exec(auth);
      return m?.[1];
    })();

  if (!token || token !== controlToken) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}

export function buildControllerStatus({
  config,
  startedAt,
  gps,
  browser,
  watchdog,
  obs,
}) {
  const now = Date.now();
  return {
    ok: true,
    running: true,
    version: config.version,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.floor((now - startedAt.getTime()) / 1000),
    healthy: !browser.loginRequired && browser.browserRunning && browser.pageLoaded,
    gps: {
      bridgeReachable: gps.bridgeReachable,
      state: gps.state,
      sourceId: gps.lastAccepted?.sourceId ?? null,
      sourceName: gps.lastAccepted?.sourceName ?? null,
      ageSeconds: gps.ageSeconds,
      lastSuccessfulPollAt: gps.lastSuccessfulPollAt,
      lastError: gps.lastError,
      // coordinates omitted by default
    },
    weatherfront: {
      browserRunning: browser.browserRunning,
      pageLoaded: browser.pageLoaded,
      currentUrl: browser.currentUrl,
      loginState: browser.loginRequired ? "LOGIN_REQUIRED" : "OK",
      geolocationPermission: browser.geolocationPermission,
      lastGeolocationUpdateAt: browser.lastGeolocationAt,
      followFound: browser.followFound,
      followStrategy: browser.followStrategy,
      followActive: browser.followActive,
      windowTitle: browser.windowTitle,
      windowAvailable: browser.browserRunning,
      lastError: browser.lastError,
    },
    watchdog: {
      lastHealthCheckAt: watchdog.lastHealthCheckAt,
      lastSuccessfulHealth: watchdog.lastHealthyAt,
      lastReload: watchdog.recovery?.lastReloadAt ?? null,
      lastBrowserRelaunch: watchdog.recovery?.lastRelaunchAt ?? null,
      recoveryCount: watchdog.recovery?.recoveryCount ?? 0,
      degraded: watchdog.recovery?.degraded ?? false,
    },
    obs: obs || {
      enabled: false,
      connected: false,
      sceneOk: null,
      sourceOk: null,
      lastError: null,
    },
    lastError: browser.lastError || gps.lastError || null,
  };
}

function renderHtml(status) {
  const rows = Object.entries({
    Version: status.version,
    Uptime: status.uptimeSeconds,
    Healthy: status.healthy,
    "GPS bridge": status.gps.bridgeReachable,
    "GPS state": status.gps.state,
    "GPS source": status.gps.sourceName,
    "GPS age": status.gps.ageSeconds,
    Browser: status.weatherfront.browserRunning,
    "Page loaded": status.weatherfront.pageLoaded,
    URL: status.weatherfront.currentUrl,
    Login: status.weatherfront.loginState,
    Geolocation: status.weatherfront.geolocationPermission,
    "Last geo update": status.weatherfront.lastGeolocationUpdateAt,
    "Follow found": status.weatherfront.followFound,
    "Follow strategy": status.weatherfront.followStrategy,
    "Follow active": status.weatherfront.followActive,
    "Window title": status.weatherfront.windowTitle,
    "OBS connected": status.obs?.connected,
    "Last error": status.lastError,
  });
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v ?? "—")}</td></tr>`,
    )
    .join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta http-equiv="refresh" content="5"/><title>WeatherFront OBS Controller</title>
<style>body{font-family:Segoe UI,sans-serif;margin:2rem;background:#0f1419;color:#e7ecf1}table{border-collapse:collapse;width:min(800px,100%)}th,td{padding:.5rem .75rem;border-bottom:1px solid #2a3540;text-align:left}th{color:#9aa7b5;width:40%}button{margin:.25rem .5rem .25rem 0;padding:.4rem .8rem}</style>
</head><body>
<h1>WeatherFront OBS Controller</h1>
<p>Local diagnostics — 127.0.0.1 only. Coordinates and credentials are hidden.</p>
<p>Login: <strong>${escapeHtml(status.weatherfront.loginState)}</strong> · Follow: <strong>${escapeHtml(status.weatherfront.followActive)}</strong></p>
<table>${body}</table>
<p>
<button data-action="follow">Reactivate follow</button>
<button data-action="reload">Reload WeatherFront</button>
<button data-action="restart-browser">Restart browser</button>
</p>
<p><a href="/status?format=json" style="color:#7eb6ff">JSON</a></p>
<script>
const token = localStorage.getItem('wfObsControlToken') || prompt('Local control token (stored in localStorage)') || '';
if (token) localStorage.setItem('wfObsControlToken', token);
document.querySelectorAll('button[data-action]').forEach(btn => {
  btn.onclick = async () => {
    const action = btn.getAttribute('data-action');
    const res = await fetch('/control/' + action, {
      method: 'POST',
      headers: { 'X-Controller-Token': token, 'Content-Type': 'application/json' },
      body: '{}'
    });
    alert(action + ': ' + res.status + ' ' + await res.text());
  };
});
</script>
</body></html>`;
}

export function createStatusServer({
  host,
  port,
  controlToken,
  getStatus,
  controls,
  logger,
}) {
  let server = null;

  function start() {
    return new Promise((resolve, reject) => {
      server = http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://${host}:${port}`);

        if (url.pathname.startsWith("/control/")) {
          const check = validateLocalControlRequest(req, { host, port, controlToken });
          if (!check.ok) {
            res.writeHead(check.status, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: check.error }));
            return;
          }
          const action = url.pathname.replace("/control/", "");
          try {
            if (action === "follow") await controls.follow();
            else if (action === "reload") await controls.reload();
            else if (action === "restart-browser") await controls.restartBrowser();
            else {
              res.writeHead(404, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: "Unknown action" }));
              return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, action }));
          } catch (error) {
            logger?.error?.(`Control action failed: ${error.message}`);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: error.message }));
          }
          return;
        }

        if (url.pathname !== "/status" && url.pathname !== "/") {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found\n");
          return;
        }

        let status;
        try {
          status = getStatus();
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: error.message }));
          return;
        }

        const wantJson =
          url.searchParams.get("format") === "json" ||
          (req.headers.accept || "").includes("application/json");

        if (wantJson) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(`${JSON.stringify(status, null, 2)}\n`);
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderHtml(status));
      });

      server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
          reject(new Error(`Status port ${host}:${port} already in use`));
          return;
        }
        reject(error);
      });

      server.listen(port, host, () => {
        logger?.info?.(
          `Controller status listening on http://${host}:${port}/status`,
        );
        resolve();
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      server = null;
    });
  }

  return {
    start,
    stop,
    isListening: () => Boolean(server?.listening),
  };
}

export { redactUrl };
