import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createBoundedRetry,
  filterFollowCandidates,
  isFollowActiveFromAttrs,
  looksLikeFollowCandidate,
} from "../src/follow-control.js";
import { createRecoveryController } from "../src/recovery.js";
import { detectLoginRequired } from "../src/browser-manager.js";
import {
  isAllowedWeatherfrontUrl,
  redactUrl,
  requireWeatherfrontAppUrl,
  sanitizeLogMessage,
} from "../src/redaction.js";
import { validateLocalControlRequest } from "../src/status-server.js";
import { validateObsConfig } from "../src/obs-client.js";
import { getRuntimePaths } from "../src/paths.js";
import { acquirePidFile, readPidFile } from "../src/pid.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import { createStatusServer, buildControllerStatus } from "../src/status-server.js";

describe("URL / redaction", () => {
  it("rejects apps.weatherfront.com", () => {
    assert.throws(() => requireWeatherfrontAppUrl("https://apps.weatherfront.com"));
  });

  it("accepts app.weatherfront.com", () => {
    assert.equal(
      requireWeatherfrontAppUrl("https://app.weatherfront.com/"),
      "https://app.weatherfront.com",
    );
  });

  it("redacts sensitive query values", () => {
    const r = redactUrl("https://x.test/path?token=secret&ok=1");
    assert.ok(r.includes("REDACTED"));
    assert.ok(!r.includes("secret"));
  });

  it("allows weatherfront origins", () => {
    assert.equal(
      isAllowedWeatherfrontUrl("https://app.weatherfront.com/map", "https://app.weatherfront.com"),
      true,
    );
    assert.equal(
      isAllowedWeatherfrontUrl("https://evil.example/phish", "https://app.weatherfront.com"),
      false,
    );
  });

  it("redacts secrets from logs", () => {
    const msg = sanitizeLogMessage("Bearer abcdefghijklmnop failed", ["abcdefghijklmnop"]);
    assert.ok(!msg.includes("abcdefghijklmnop"));
  });
});

describe("follow control", () => {
  it("filters candidates and prevents arbitrary buttons", () => {
    const list = [
      { visible: true, enabled: true, name: "Layers", ariaLabel: "Layers" },
      { visible: true, enabled: true, name: "My location", ariaLabel: "My location" },
      { visible: true, enabled: true, name: "Settings" },
    ];
    const filtered = filterFollowCandidates(list);
    assert.equal(filtered.length, 1);
    assert.equal(looksLikeFollowCandidate(filtered[0]), true);
    assert.equal(looksLikeFollowCandidate({ name: "Zoom in" }), false);
  });

  it("detects active state from attrs", () => {
    assert.equal(isFollowActiveFromAttrs({ ariaPressed: "true" }), true);
    assert.equal(isFollowActiveFromAttrs({ className: "btn is-active" }), true);
    assert.equal(isFollowActiveFromAttrs({ className: "btn" }), false);
  });

  it("bounds retries with cooldown", () => {
    const retry = createBoundedRetry({ maxAttempts: 2, cooldownMs: 1000 });
    assert.equal(retry.canAttempt(0), true);
    retry.recordFailure(0);
    assert.equal(retry.canAttempt(1), true);
    const r = retry.recordFailure(1);
    assert.equal(r.cooledDown, true);
    assert.equal(retry.canAttempt(2), false);
    assert.equal(retry.canAttempt(2000), true);
  });
});

describe("recovery / login", () => {
  it("enforces recovery cooldown", () => {
    const rec = createRecoveryController({
      maxReloadAttempts: 2,
      maxRelaunchAttempts: 2,
      cooldownSeconds: 60,
    });
    assert.equal(rec.canReload(0), true);
    rec.recordReload(0);
    rec.recordReload(1);
    assert.equal(rec.getState(2).degraded, true);
    assert.equal(rec.canReload(2), false);
  });

  it("detects login-required", () => {
    assert.equal(detectLoginRequired("https://app.weatherfront.com/login", ""), true);
    assert.equal(detectLoginRequired("https://app.weatherfront.com/map", "Welcome back"), false);
    assert.equal(detectLoginRequired("https://app.weatherfront.com/", "Please sign in"), true);
  });
});

describe("control endpoint protection", () => {
  it("requires POST and local token", () => {
    const bad = validateLocalControlRequest(
      { method: "GET", headers: { host: "127.0.0.1" } },
      { controlToken: "tok" },
    );
    assert.equal(bad.ok, false);

    const unauth = validateLocalControlRequest(
      { method: "POST", headers: { host: "127.0.0.1" } },
      { controlToken: "tok" },
    );
    assert.equal(unauth.status, 401);

    const ok = validateLocalControlRequest(
      {
        method: "POST",
        headers: { host: "127.0.0.1", "x-controller-token": "tok" },
      },
      { controlToken: "tok" },
    );
    assert.equal(ok.ok, true);
  });
});

describe("OBS config / paths / pid", () => {
  it("validates OBS config", () => {
    const bad = validateObsConfig({
      obsWebsocketEnabled: true,
      obsWebsocketUrl: "not-a-url",
      obsSourceName: "",
    });
    assert.equal(bad.ok, false);

    const good = validateObsConfig({
      obsWebsocketEnabled: true,
      obsWebsocketUrl: "ws://127.0.0.1:4455",
      obsSourceName: "WeatherFront Radar",
    });
    assert.equal(good.ok, true);
  });

  it("builds LOCALAPPDATA runtime paths", () => {
    const p = getRuntimePaths("C:\\Temp\\Heartland\\WeatherFrontOBS");
    assert.ok(p.browserProfile.includes("browser-profile"));
    assert.ok(p.app.endsWith("app") || p.app.includes("\\app"));
  });

  it("prevents duplicate PID", () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-pid-"));
    const pidPath = join(dir, "t.pid");
    const a = acquirePidFile(pidPath);
    assert.throws(() => acquirePidFile(pidPath));
    a.release();
    const info = readPidFile(pidPath);
    assert.equal(info, null);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("status server bind", () => {
  it("binds only to 127.0.0.1", async () => {
    const probe = http.createServer();
    const port = await new Promise((resolve, reject) => {
      probe.listen(0, "127.0.0.1", () => resolve(probe.address().port));
      probe.on("error", reject);
    });
    await new Promise((r) => probe.close(r));

    const server = createStatusServer({
      host: "127.0.0.1",
      port,
      controlToken: "test-token",
      getStatus: () =>
        buildControllerStatus({
          config: { version: "1.0.0" },
          startedAt: new Date(),
          gps: {
            bridgeReachable: true,
            state: "Fresh",
            ageSeconds: 1,
            lastAccepted: { sourceName: "X" },
            lastSuccessfulPollAt: null,
            lastError: null,
          },
          browser: {
            browserRunning: true,
            pageLoaded: true,
            loginRequired: false,
            currentUrl: "https://app.weatherfront.com",
            geolocationPermission: "granted",
            lastGeolocationAt: null,
            followFound: false,
            followStrategy: null,
            followActive: false,
            windowTitle: "Heartland WeatherFront OBS",
            lastError: null,
          },
          watchdog: { lastHealthCheckAt: null, lastHealthyAt: null, recovery: {} },
          obs: { enabled: false, connected: false },
        }),
      controls: {
        follow: async () => {},
        reload: async () => {},
        restartBrowser: async () => {},
      },
    });
    await server.start();
    assert.equal(server.isListening(), true);
    await server.stop();
  });
});

describe("title restoration logic", () => {
  it("exports applyWindowTitle function", async () => {
    const mod = await import("../src/title-keeper.js");
    assert.equal(typeof mod.applyWindowTitle, "function");
    assert.equal(typeof mod.createTitleKeeper, "function");
  });
});
