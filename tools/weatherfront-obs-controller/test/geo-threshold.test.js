import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GEO_MOVE_THRESHOLD_METERS,
  GEO_UPDATE_MIN_INTERVAL_MS,
  distanceMeters,
} from "../src/browser-manager.js";

describe("geo move threshold", () => {
  it("treats tiny jitter as below threshold", () => {
    // ~1 meter north
    const d = distanceMeters(43.954, -90.796, 43.954009, -90.796);
    assert.ok(d < GEO_MOVE_THRESHOLD_METERS);
  });

  it("detects moves larger than threshold", () => {
    // ~100m
    const d = distanceMeters(43.954, -90.796, 43.955, -90.796);
    assert.ok(d > GEO_MOVE_THRESHOLD_METERS);
  });

  it("rate-limits geolocation remounts", () => {
    assert.ok(GEO_UPDATE_MIN_INTERVAL_MS >= 5_000);
  });
});
