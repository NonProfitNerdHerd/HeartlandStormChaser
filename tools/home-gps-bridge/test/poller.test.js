import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FixState,
  classifyFix,
  parseLocationPayload,
  sentencesForState,
} from "../src/poller.js";

const goodBody = {
  ok: true,
  active: true,
  latitude: 35.4676,
  longitude: -97.5164,
  altitudeMeters: 360,
  accuracyMeters: 4,
  speedMps: 5,
  headingDegrees: 90,
  capturedAt: "2024-03-23T12:35:19.000Z",
  sourceId: "dev-1",
  sourceName: "Truck",
  valid: true,
  status: "LIVE",
};

describe("parseLocationPayload", () => {
  it("accepts a valid payload", () => {
    const r = parseLocationPayload(goodBody);
    assert.equal(r.ok, true);
    assert.equal(r.record.latitude, 35.4676);
    assert.equal(r.record.sourceId, "dev-1");
  });

  it("rejects invalid coordinates", () => {
    const r = parseLocationPayload({ ...goodBody, latitude: 120 });
    assert.equal(r.ok, false);
    assert.match(r.reason, /Invalid latitude/);
  });

  it("rejects missing capturedAt", () => {
    const r = parseLocationPayload({ ...goodBody, capturedAt: null });
    assert.equal(r.ok, false);
    assert.match(r.reason, /capturedAt/);
  });

  it("rejects out-of-order updates", () => {
    const first = parseLocationPayload(goodBody);
    const older = parseLocationPayload(
      { ...goodBody, capturedAt: "2024-03-23T12:30:00.000Z" },
      first.record.capturedAtMs,
    );
    assert.equal(older.ok, false);
    assert.match(older.reason, /Out-of-order/);
  });

  it("rejects malformed non-object", () => {
    const r = parseLocationPayload("not-json");
    assert.equal(r.ok, false);
  });
});

describe("stale handling", () => {
  it("classifies stale after threshold", () => {
    const parsed = parseLocationPayload(goodBody);
    const state = classifyFix({
      record: parsed.record,
      staleAfterSeconds: 30,
      nowMs: parsed.record.capturedAtMs + 45_000,
      authState: "ok",
    });
    assert.equal(state, FixState.STALE);
  });

  it("emits invalid NMEA when stale", () => {
    const parsed = parseLocationPayload(goodBody);
    const sentences = sentencesForState({
      record: parsed.record,
      fixState: FixState.STALE,
    });
    assert.match(sentences.rmc, /,V,/);
    assert.match(sentences.gga, /,0,00,/);
  });

  it("emits valid NMEA when fresh", () => {
    const parsed = parseLocationPayload(goodBody);
    const sentences = sentencesForState({
      record: parsed.record,
      fixState: FixState.FRESH,
    });
    assert.match(sentences.rmc, /,A,/);
    assert.match(sentences.gga, /,1,08,/);
  });

  it("classifies unauthorized", () => {
    assert.equal(
      classifyFix({
        record: null,
        staleAfterSeconds: 30,
        authState: "unauthorized",
      }),
      FixState.UNAUTHORIZED,
    );
  });
});
