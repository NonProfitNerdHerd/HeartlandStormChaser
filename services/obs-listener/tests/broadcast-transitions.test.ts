import { describe, expect, it } from "vitest";
import { canTransition } from "../../../worker/lib/scheduled-broadcasts.ts";

describe("scheduled broadcast transitions", () => {
  it("allows draft → scheduled and rejects draft → live", () => {
    expect(canTransition("draft", "scheduled")).toBe(true);
    expect(canTransition("draft", "live")).toBe(false);
  });

  it("allows scheduled → selected and prepare chain", () => {
    expect(canTransition("scheduled", "selected")).toBe(true);
    expect(canTransition("selected", "preparing")).toBe(true);
    expect(canTransition("preparing", "prepared")).toBe(true);
  });

  it("allows go-live path and blocks reverse from completed", () => {
    expect(canTransition("ready_to_go_live", "going_live")).toBe(true);
    expect(canTransition("going_live", "live")).toBe(true);
    expect(canTransition("live", "ending")).toBe(true);
    expect(canTransition("ending", "completed")).toBe(true);
    expect(canTransition("completed", "live")).toBe(false);
  });

  it("allows cancel from scheduled but not from live", () => {
    expect(canTransition("scheduled", "cancelled")).toBe(true);
    expect(canTransition("live", "cancelled")).toBe(false);
  });
});
