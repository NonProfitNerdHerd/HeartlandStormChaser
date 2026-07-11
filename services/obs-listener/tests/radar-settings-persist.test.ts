import { describe, expect, it } from "vitest";

/**
 * Regression: stored "0" must not be treated as missing (JS || default trap).
 */
function resolveStored(stored: string | null, fallback: string): string {
  return stored == null || stored === "" ? fallback : stored.trim();
}

function asBool(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
}

describe("radar overlay settings persistence", () => {
  it("keeps explicit false/'0' instead of falling back to default true", () => {
    const raw = resolveStored("0", "1");
    expect(raw).toBe("0");
    expect(asBool(raw, true)).toBe(false);
  });

  it("keeps map style streets", () => {
    expect(resolveStored("streets", "dark")).toBe("streets");
  });
});
