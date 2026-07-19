import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { describe, it } from "node:test";
import { createNmeaServer } from "../src/nmea-server.js";
import { createStatusServer, buildStatusPayload } from "../src/status-server.js";
import { createLogger } from "../src/logger.js";
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createPoller } from "../src/poller.js";

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  close: async () => {},
};

function listenPort(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(addr.port);
    });
    server.on("error", reject);
  });
}

describe("NMEA TCP bind", () => {
  it("binds only to 127.0.0.1", async () => {
    const probe = net.createServer();
    const port = await listenPort(probe);
    await new Promise((r) => probe.close(r));

    const nmea = createNmeaServer({
      host: "127.0.0.1",
      port,
      getSentences: () => ({
        combined: "$GPRMC,000000.00,V,,,,,,,,N*00\r\n",
        rmc: "",
        gga: "",
      }),
      logger: silentLogger,
    });
    await nmea.start();
    assert.equal(nmea.isListening(), true);
    assert.deepEqual(nmea.getAddress(), { host: "127.0.0.1", port });

    const ok = await new Promise((resolve) => {
      const c = net.connect({ host: "127.0.0.1", port }, () => {
        c.end();
        resolve(true);
      });
      c.on("error", () => resolve(false));
    });
    assert.equal(ok, true);
    await nmea.stop();
  });
});

describe("status server bind", () => {
  it("binds only to 127.0.0.1 and serves /status", async () => {
    const probe = http.createServer();
    const port = await new Promise((resolve, reject) => {
      probe.listen(0, "127.0.0.1", () => resolve(probe.address().port));
      probe.on("error", reject);
    });
    await new Promise((r) => probe.close(r));

    const status = createStatusServer({
      host: "127.0.0.1",
      port,
      getStatus: () => ({
        ok: true,
        running: true,
        version: "test",
        startedAt: new Date().toISOString(),
        uptimeSeconds: 1,
        backend: {
          connected: false,
          url: "https://example.com/api/gps/home-bridge",
          lastSuccessfulRequestAt: null,
          authentication: "unchecked",
        },
        gps: {
          state: "Unavailable",
          sourceId: null,
          sourceName: null,
          latestFixAt: null,
          ageSeconds: null,
        },
        nmea: {
          listening: true,
          host: "127.0.0.1",
          port: 10110,
          connectedClients: 0,
        },
        lastError: null,
      }),
      logger: silentLogger,
    });
    await status.start();

    const body = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/status?format=json`, (res) => {
          let data = "";
          res.on("data", (c) => {
            data += c;
          });
          res.on("end", () => resolve(data));
        })
        .on("error", reject);
    });
    const json = JSON.parse(body);
    assert.equal(json.running, true);
    assert.equal(json.nmea.host, "127.0.0.1");
    await status.stop();
  });
});

describe("auth failure logging", () => {
  it("does not leak the token into log output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hgb-log-"));
    const secret = "super-secret-bridge-token-do-not-leak";
    const logger = createLogger({ logDir: dir, level: "info", token: secret });

    const poller = createPoller({
      gpsApiUrl: "https://example.test/api/gps/home-bridge",
      gpsApiToken: secret,
      pollIntervalMs: 60_000,
      requestTimeoutMs: 1000,
      staleAfterSeconds: 30,
      logger,
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    });

    await poller.pollOnce();
    const snap = poller.getSnapshot();
    assert.equal(snap.authState, "unauthorized");
    assert.ok(!String(snap.lastError).includes(secret));

    await logger.close();
    const logText = readFileSync(join(dir, "bridge.log"), "utf8");
    assert.ok(!logText.includes(secret));
    assert.ok(!logText.toLowerCase().includes("bearer " + secret.toLowerCase()));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("buildStatusPayload redaction", () => {
  it("redacts sensitive query params from backend URL", () => {
    const payload = buildStatusPayload({
      config: {
        gpsApiUrl: "https://example.com/api/gps/home-bridge?token=abc123&ok=1",
        nmeaHost: "127.0.0.1",
        nmeaPort: 10110,
      },
      poller: {
        getSnapshot: () => ({
          backendConnected: true,
          lastSuccessfulRequestAt: null,
          authState: "ok",
          lastAccepted: null,
          ageSeconds: null,
          lastError: null,
          fixState: "Unavailable",
        }),
      },
      nmeaServer: {
        isListening: () => true,
        getClientCount: () => 0,
      },
      startedAt: new Date(),
      version: "1.0.0",
    });
    assert.ok(payload.backend.url.includes("REDACTED"));
    assert.ok(!payload.backend.url.includes("abc123"));
  });
});
