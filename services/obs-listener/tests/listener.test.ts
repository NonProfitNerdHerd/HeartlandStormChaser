import { describe, expect, it } from "vitest";
import { sanitizeName, parseCustomRtmpDestination } from "../src/obs-controller.js";
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

describe("parseCustomRtmpDestination", () => {
  it("accepts rtmp and rtmps YouTube ingest", () => {
    expect(
      parseCustomRtmpDestination("rtmp://a.rtmp.youtube.com/live2", "xxxx-yyyy"),
    ).toEqual({
      server: "rtmp://a.rtmp.youtube.com/live2",
      key: "xxxx-yyyy",
    });
    expect(
      parseCustomRtmpDestination("  rtmps://a.rtmp.youtube.com/live2  ", " key "),
    ).toEqual({
      server: "rtmps://a.rtmp.youtube.com/live2",
      key: "key",
    });
  });

  it("rejects missing or non-rtmp servers", () => {
    expect(() => parseCustomRtmpDestination("", "k")).toThrow(/server/i);
    expect(() => parseCustomRtmpDestination("https://example.com", "k")).toThrow(/rtmp/i);
    expect(() => parseCustomRtmpDestination("rtmp://ok", "")).toThrow(/key/i);
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
    expect(config.overlayBrowserRefreshMs).toBe(300_000);
  });

  it("allows disabling overlay refresh", () => {
    const config = loadConfig({
      LISTENER_AUTH_TOKEN: "secret-token",
      OVERLAY_BROWSER_REFRESH_MS: "0",
    });
    expect(config.overlayBrowserRefreshMs).toBe(0);
  });

  it("fails without auth token", () => {
    expect(() => loadConfig({})).toThrow(/LISTENER_AUTH_TOKEN/);
  });
});
