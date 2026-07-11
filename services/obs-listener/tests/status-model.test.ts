import { describe, expect, it } from "vitest";
import {
  displayNumber,
  displayValue,
  isGpsStale,
  mergeEventLog,
  nextPollDelay,
  statusPresentation,
} from "../../../public/js/broadcast/status-model.js";

describe("statusPresentation", () => {
  it("maps healthy and disconnected tones", () => {
    expect(statusPresentation("healthy").tone).toBe("healthy");
    expect(statusPresentation("disconnected").label).toBe("Disconnected");
  });
});

describe("display helpers", () => {
  it("shows Unavailable for empty values", () => {
    expect(displayValue(null)).toBe("Unavailable");
    expect(displayNumber(undefined)).toBe("Unavailable");
    expect(displayNumber(12.345, 1)).toBe("12.3");
  });
});

describe("mergeEventLog", () => {
  it("dedupes by id and caps length", () => {
    const existing = [{ id: "a", timestamp: "2026-01-01T00:00:00.000Z", category: "x", message: "old", severity: "information" }];
    const incoming = [
      { id: "a", timestamp: "2026-01-01T00:01:00.000Z", category: "x", message: "new", severity: "success" },
      { id: "b", timestamp: "2026-01-01T00:02:00.000Z", category: "y", message: "b", severity: "warning" },
    ];
    const merged = mergeEventLog(existing, incoming, 10);
    expect(merged[0].id).toBe("b");
    expect(merged.find((e) => e.id === "a")?.message).toBe("new");
  });
});

describe("polling and gps", () => {
  it("backs off when failing", () => {
    expect(nextPollDelay(true, 0, 3000, 15000)).toBe(3000);
    expect(nextPollDelay(false, 2, 3000, 15000)).toBe(12000);
    expect(nextPollDelay(false, 5, 3000, 15000)).toBe(15000);
  });

  it("detects stale gps", () => {
    expect(isGpsStale("STALE")).toBe(true);
    expect(isGpsStale("LIVE")).toBe(false);
  });
});
