import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import {
  buildLocationPayload,
  createStatusServer,
} from "../src/status-server.js";
import { FixState } from "../src/poller.js";

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function mockPoller(overrides = {}) {
  const record = overrides.record ?? null;
  const fixState = overrides.fixState ?? FixState.UNAVAILABLE;
  return {
    getSnapshot() {
      return {
        lastAccepted: record,
        fixState,
        ageSeconds: record
          ? Math.max(0, (Date.now() - record.capturedAtMs) / 1000)
          : null,
        authState: "ok",
        backendConnected: true,
        lastError: null,
      };
    },
  };
}

describe("buildLocationPayload", () => {
  it("returns invalid without fabricating coords when unavailable", () => {
    const payload = buildLocationPayload({
      poller: mockPoller({ fixState: FixState.UNAVAILABLE }),
    });
    assert.equal(payload.valid, false);
    assert.equal(payload.state, FixState.UNAVAILABLE);
    assert.equal(payload.latitude, null);
    assert.equal(payload.longitude, null);
  });

  it("returns valid coords for Fresh state", () => {
    const record = {
      latitude: 35.1,
      longitude: -97.2,
      altitudeMeters: 300,
      accuracyMeters: 5,
      speedMps: 1.2,
      headingDegrees: 90,
      capturedAt: "2024-01-01T00:00:00.000Z",
      capturedAtMs: Date.now() - 1000,
      sourceId: "d1",
      sourceName: "Truck",
    };
    const payload = buildLocationPayload({
      poller: mockPoller({ record, fixState: FixState.FRESH }),
    });
    assert.equal(payload.valid, true);
    assert.equal(payload.latitude, 35.1);
    assert.equal(payload.sourceName, "Truck");
    assert.equal(payload.state, FixState.FRESH);
  });

  it("keeps stale last-known coords injectable until a newer reading arrives", () => {
    const record = {
      latitude: 35.1,
      longitude: -97.2,
      altitudeMeters: null,
      accuracyMeters: null,
      speedMps: null,
      headingDegrees: null,
      capturedAt: "2024-01-01T00:00:00.000Z",
      capturedAtMs: Date.now() - 60_000,
      sourceId: "d1",
      sourceName: "Truck",
    };
    const payload = buildLocationPayload({
      poller: mockPoller({ record, fixState: FixState.STALE }),
    });
    assert.equal(payload.valid, true);
    assert.equal(payload.held, true);
    assert.equal(payload.state, FixState.STALE);
    assert.equal(payload.latitude, 35.1);
  });
});

describe("/location HTTP", () => {
  it("binds on status server and returns Cache-Control no-store", async () => {
    const probe = http.createServer();
    const port = await new Promise((resolve, reject) => {
      probe.listen(0, "127.0.0.1", () => resolve(probe.address().port));
      probe.on("error", reject);
    });
    await new Promise((r) => probe.close(r));

    const server = createStatusServer({
      host: "127.0.0.1",
      port,
      getStatus: () => ({ ok: true }),
      getLocation: () =>
        buildLocationPayload({
          poller: mockPoller({ fixState: FixState.UNAVAILABLE }),
        }),
      logger: silentLogger,
    });
    await server.start();

    const { statusCode, headers, body } = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/location`, (res) => {
          let data = "";
          res.on("data", (c) => {
            data += c;
          });
          res.on("end", () =>
            resolve({ statusCode: res.statusCode, headers: res.headers, body: data }),
          );
        })
        .on("error", reject);
    });

    assert.equal(statusCode, 200);
    assert.equal(headers["cache-control"], "no-store");
    const json = JSON.parse(body);
    assert.equal(json.valid, false);
    assert.equal(json.latitude, null);
    await server.stop();
  });
});
