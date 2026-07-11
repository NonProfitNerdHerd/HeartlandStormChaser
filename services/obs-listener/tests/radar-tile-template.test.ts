import { describe, expect, it } from "vitest";

/**
 * Mirrors worker/lib/overlay-radar.ts tile URL helper for regression coverage
 * without pulling Workers Env into the obs-listener vitest project.
 */
function tileUrlTemplate(path: string | null): string | null {
  if (!path) return null;
  return `https://tilecache.rainviewer.com${path}/256/{z}/{x}/{y}/2/1_1.png`;
}

describe("radar overlay tile templates", () => {
  it("builds a RainViewer tile URL from a frame path", () => {
    expect(tileUrlTemplate("/v2/radar/1710000000")).toBe(
      "https://tilecache.rainviewer.com/v2/radar/1710000000/256/{z}/{x}/{y}/2/1_1.png",
    );
  });

  it("returns null when no frame path is cached", () => {
    expect(tileUrlTemplate(null)).toBeNull();
  });
});
