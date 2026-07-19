import http from "node:http";
import { redactUrl } from "./config.js";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildStatusPayload({
  config,
  poller,
  nmeaServer,
  startedAt,
  version,
}) {
  const now = Date.now();
  const snap = poller.getSnapshot(now);
  const uptimeSeconds = Math.floor((now - startedAt.getTime()) / 1000);

  let authStatus = "unknown";
  if (snap.authState === "unauthorized") {
    authStatus = "unauthorized";
  } else if (snap.authState === "ok") {
    authStatus = "authenticated";
  } else if (!snap.backendConnected && snap.lastError) {
    authStatus = "unchecked";
  }

  return {
    ok: true,
    running: true,
    version,
    startedAt: startedAt.toISOString(),
    uptimeSeconds,
    backend: {
      connected: snap.backendConnected,
      url: redactUrl(config.gpsApiUrl),
      lastSuccessfulRequestAt: snap.lastSuccessfulRequestAt,
      authentication: authStatus,
    },
    gps: {
      state: snap.fixState,
      sourceId: snap.lastAccepted?.sourceId ?? null,
      sourceName: snap.lastAccepted?.sourceName ?? null,
      latestFixAt: snap.lastAccepted?.capturedAt ?? null,
      ageSeconds: snap.ageSeconds,
      // Coordinates intentionally omitted from default status for safety
    },
    nmea: {
      listening: nmeaServer.isListening(),
      host: config.nmeaHost,
      port: config.nmeaPort,
      connectedClients: nmeaServer.getClientCount(),
    },
    lastError: snap.lastError,
  };
}

function renderHtml(status) {
  const rows = [
    ["Bridge running", status.running ? "Yes" : "No"],
    ["Version", status.version],
    ["Started at", status.startedAt],
    ["Uptime (seconds)", status.uptimeSeconds],
    ["Backend connected", status.backend.connected ? "Yes" : "No"],
    ["Authentication", status.backend.authentication],
    ["Backend URL", status.backend.url],
    ["Last successful backend request", status.backend.lastSuccessfulRequestAt ?? "—"],
    ["GPS state", status.gps.state],
    ["Source ID", status.gps.sourceId ?? "—"],
    ["Source name", status.gps.sourceName ?? "—"],
    ["Latest fix at", status.gps.latestFixAt ?? "—"],
    ["Fix age (seconds)", status.gps.ageSeconds ?? "—"],
    ["NMEA listening", status.nmea.listening ? "Yes" : "No"],
    ["NMEA address", `${status.nmea.host}:${status.nmea.port}`],
    ["NMEA clients", status.nmea.connectedClients],
    ["Last error", status.lastError ?? "—"],
  ];

  const body = rows
    .map(
      ([k, v]) =>
        `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="5" />
  <title>Heartland Home GPS Bridge</title>
  <style>
    body { font-family: Segoe UI, sans-serif; margin: 2rem; background: #0f1419; color: #e7ecf1; }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
    p { color: #9aa7b5; }
    table { border-collapse: collapse; width: min(720px, 100%); margin-top: 1rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #2a3540; vertical-align: top; }
    th { width: 42%; color: #9aa7b5; font-weight: 600; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; background: #1e2a36; }
  </style>
</head>
<body>
  <h1>Heartland Home GPS Bridge</h1>
  <p>Local diagnostics only — bound to 127.0.0.1. Token and coordinates are not shown.</p>
  <p>GPS state: <span class="badge">${escapeHtml(status.gps.state)}</span></p>
  <table>${body}</table>
  <p><a href="/status?format=json" style="color:#7eb6ff">JSON</a></p>
</body>
</html>`;
}

/**
 * Local-only normalized location for consumers (e.g. WeatherFront OBS controller).
 * Uses in-memory poller data only — never fabricates coordinates.
 *
 * `valid` is true whenever a last-accepted fix exists so WeatherFront can keep
 * injecting the last known lat/lon indefinitely until a newer reading arrives.
 * `state` still reports Fresh / Delayed / Stale for HUD / diagnostics.
 * NMEA validity is unchanged (still uses Fresh/Delayed only).
 */
export function buildLocationPayload({ poller, nowMs = Date.now() }) {
  const snap = poller.getSnapshot(nowMs);
  const record = snap.lastAccepted;

  if (!record) {
    return {
      ok: true,
      valid: false,
      held: false,
      state: snap.fixState,
      latitude: null,
      longitude: null,
      altitudeMeters: null,
      accuracyMeters: null,
      speedMps: null,
      headingDegrees: null,
      capturedAt: null,
      sourceId: null,
      sourceName: null,
      ageSeconds: snap.ageSeconds,
    };
  }

  const held = snap.fixState === "Stale";

  return {
    ok: true,
    valid: true,
    held,
    state: snap.fixState,
    latitude: record.latitude,
    longitude: record.longitude,
    altitudeMeters: record.altitudeMeters,
    accuracyMeters: record.accuracyMeters,
    speedMps: record.speedMps,
    headingDegrees: record.headingDegrees,
    capturedAt: record.capturedAt,
    sourceId: record.sourceId,
    sourceName: record.sourceName,
    ageSeconds: snap.ageSeconds,
  };
}

export function createStatusServer({
  host,
  port,
  getStatus,
  getLocation,
  logger,
}) {
  let server = null;

  function start() {
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", `http://${host}:${port}`);

        if (url.pathname === "/location") {
          if (!getLocation) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found\n");
            return;
          }
          try {
            const location = getLocation();
            res.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(`${JSON.stringify(location)}\n`);
          } catch (error) {
            res.writeHead(500, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            });
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
          reject(
            new Error(
              `Status port ${host}:${port} is already in use. Another bridge instance may be running.`,
            ),
          );
          return;
        }
        reject(error);
      });

      server.listen(port, host, () => {
        logger.info(`Status server listening on http://${host}:${port}/status`);
        resolve();
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!server) {
        resolve();
        return;
      }
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

export { buildStatusPayload };
