import { describe, expect, it } from "vitest";
import { sanitizeName } from "../src/obs-controller.js";
import { EventLog } from "../src/event-log.js";
import { loadConfig } from "../src/config.js";

describe("sanitizeName", () => {
  it("trims valid names", () => {
    expect(sanitizeName("  Front Camera  ", "scene")).toBe("Front Camera");
  });

  it("rejects empty names", () => {
    expect(() => sanitizeName("   ", "scene")).toThrow(/required/i);
  });

  it("rejects control characters", () => {
    expect(() => sanitizeName("bad\nname", "source")).toThrow(/invalid/i);
  });
});

describe("EventLog", () => {
  it("keeps a bounded number of events", () => {
    const log = new EventLog();
    for (let i = 0; i < 250; i += 1) {
      log.push("test", `event ${i}`, "information");
    }
    expect(log.list(300)).toHaveLength(200);
    expect(log.list(5)[0]?.message).toBe("event 249");
  });
});

describe("loadConfig", () => {
  it("loads required token and defaults", () => {
    const config = loadConfig({
      LISTENER_AUTH_TOKEN: "secret-token",
      OBS_PASSWORD: "obs-pass",
    });
    expect(config.listenerPort).toBe(8791);
    expect(config.obsPort).toBe(4455);
    expect(config.listenerAuthToken).toBe("secret-token");
  });

  it("fails without auth token", () => {
    expect(() => loadConfig({})).toThrow(/LISTENER_AUTH_TOKEN/);
  });
});
