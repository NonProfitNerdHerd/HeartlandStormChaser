import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isValidCoordinate,
  parseUtcTimestamp,
  validateBridgeLocation,
} from "../src/gps-client.js";

describe("GPS validation", () => {
  it("rejects invalid latitude/longitude", () => {
    assert.equal(isValidCoordinate(91, 0), false);
    assert.equal(isValidCoordinate(0, -181), false);
    const r = validateBridgeLocation({
      valid: true,
      state: "Fresh",
      latitude: 120,
      longitude: 0,
      capturedAt: "2024-01-01T00:00:00Z",
    });
    assert.equal(r.ok, false);
    assert.equal(r.kind, "malformed");
  });

  it("rejects missing timestamp", () => {
    const r = validateBridgeLocation({
      valid: true,
      state: "Fresh",
      latitude: 35,
      longitude: -97,
      capturedAt: null,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /capturedAt|missing/);
  });

  it("rejects out-of-order updates", () => {
    const first = validateBridgeLocation({
      valid: true,
      state: "Fresh",
      latitude: 35,
      longitude: -97,
      capturedAt: "2024-01-01T12:00:00Z",
    });
    const second = validateBridgeLocation(
      {
        valid: true,
        state: "Fresh",
        latitude: 35.1,
        longitude: -97.1,
        capturedAt: "2024-01-01T11:00:00Z",
      },
      first.record.capturedAtMs,
    );
    assert.equal(second.ok, false);
    assert.equal(second.kind, "out-of-order");
  });

  it("handles fresh delayed stale unavailable", () => {
    const fresh = validateBridgeLocation({
      valid: true,
      state: "Fresh",
      latitude: 35,
      longitude: -97,
      capturedAt: "2024-01-01T12:00:00Z",
      sourceName: "Truck",
    });
    assert.equal(fresh.ok, true);
    assert.equal(fresh.record.state, "Fresh");

    const stale = validateBridgeLocation({
      valid: true,
      held: true,
      state: "Stale",
      latitude: 35,
      longitude: -97,
      capturedAt: "2024-01-01T12:00:00Z",
    });
    assert.equal(stale.ok, true);
    assert.equal(stale.record.held, true);
    assert.equal(stale.record.state, "Stale");

    const unavailable = validateBridgeLocation({
      valid: false,
      state: "Unavailable",
      latitude: null,
      longitude: null,
    });
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.kind, "unavailable");
  });

  it("accepts held stale coords even if valid flag false", () => {
    const r = validateBridgeLocation({
      valid: false,
      held: true,
      state: "Stale",
      latitude: 35.1,
      longitude: -97.2,
      capturedAt: "2024-01-01T12:00:00Z",
    });
    assert.equal(r.ok, true);
    assert.equal(r.record.latitude, 35.1);
  });

  it("never invents home-computer location on invalid", () => {
    const r = validateBridgeLocation({ valid: false, state: "Unavailable" });
    assert.equal(r.ok, false);
    assert.equal(r.diagnostic, null);
  });

  it("parses UTC timestamps", () => {
    assert.ok(parseUtcTimestamp("2024-01-01T00:00:00Z") > 0);
    assert.equal(parseUtcTimestamp(""), null);
  });
});
