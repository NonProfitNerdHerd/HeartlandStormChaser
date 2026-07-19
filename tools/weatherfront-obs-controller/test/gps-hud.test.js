import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHudModel } from "../src/gps-hud.js";

describe("GPS HUD", () => {
  it("shows LIVE for fresh fixes", () => {
    const m = buildHudModel({
      state: "Fresh",
      ageSeconds: 4,
      sourceName: "IkeE",
    });
    assert.equal(m.tone, "healthy");
    assert.match(m.label, /LIVE/);
    assert.match(m.label, /IkeE/);
    assert.ok(!m.label.includes("43."));
  });

  it("shows HELD for stale last-known", () => {
    const m = buildHudModel({
      state: "Stale",
      ageSeconds: 120,
      sourceName: "IkeE",
    });
    assert.equal(m.tone, "stale");
    assert.match(m.label, /HELD/);
  });

  it("shows unavailable without inventing a source", () => {
    const m = buildHudModel({ state: "Unavailable" });
    assert.equal(m.tone, "unavailable");
    assert.match(m.label, /unavailable/i);
  });
});
