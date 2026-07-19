import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("configuration validation", () => {
  it("loads from env object", () => {
    const cfg = loadConfig({
      WEATHERFRONT_URL: "https://app.weatherfront.com",
      GPS_BRIDGE_LOCATION_URL: "http://127.0.0.1:10111/location",
      CONTROLLER_CONTROL_TOKEN: "test-token-value",
      CONTROLLER_STATUS_HOST: "127.0.0.1",
      WINDOW_TITLE: "Heartland WeatherFront OBS",
    });
    assert.equal(cfg.windowTitle, "Heartland WeatherFront OBS");
    assert.equal(cfg.statusPort, 10112);
    assert.equal(cfg.gpsPollIntervalMs, 10_000);
    assert.ok(cfg.runtimePaths.browserProfile.includes("WeatherFrontOBS"));
  });

  it("rejects non-loopback status host", () => {
    assert.throws(() =>
      loadConfig({
        WEATHERFRONT_URL: "https://app.weatherfront.com",
        GPS_BRIDGE_LOCATION_URL: "http://127.0.0.1:10111/location",
        CONTROLLER_CONTROL_TOKEN: "test-token-value",
        CONTROLLER_STATUS_HOST: "0.0.0.0",
      }),
    );
  });

  it(".env.example contains required keys", () => {
    const text = readFileSync(join(root, ".env.example"), "utf8");
    for (const key of [
      "WEATHERFRONT_URL",
      "GPS_BRIDGE_LOCATION_URL",
      "WINDOW_TITLE",
      "CONTROLLER_STATUS_PORT",
      "OBS_SOURCE_NAME",
    ]) {
      assert.ok(text.includes(key), `missing ${key}`);
    }
    assert.ok(text.includes("app.weatherfront.com"));
    assert.ok(!text.includes("apps.weatherfront.com/"));
  });
});
