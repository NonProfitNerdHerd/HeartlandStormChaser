import { describe, expect, it } from "vitest";
import { isOverlayBrowserUrl } from "../src/obs-controller.js";

describe("isOverlayBrowserUrl", () => {
  it("matches overlay paths", () => {
    expect(
      isOverlayBrowserUrl(
        "https://heartlandstormchaser.ike-j-rebout.workers.dev/overlays/radar/",
      ),
    ).toBe(true);
    expect(
      isOverlayBrowserUrl(
        "https://example.com/overlays/gps-weather.html?preview=1",
      ),
    ).toBe(true);
  });

  it("ignores non-overlay browser urls", () => {
    expect(isOverlayBrowserUrl("https://vdo.ninja/?view=truck")).toBe(false);
    expect(isOverlayBrowserUrl("https://example.com/dashboard")).toBe(false);
    expect(isOverlayBrowserUrl("")).toBe(false);
  });
});
