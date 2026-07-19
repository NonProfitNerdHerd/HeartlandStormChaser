import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOCATION_MARKER_SCALE,
  STICKY_MARKER_ID,
  buildLocationMarkerCss,
} from "../src/location-marker.js";

describe("location marker style", () => {
  it("sizes via width/height at 2.5x without host transform scale", () => {
    assert.equal(LOCATION_MARKER_SCALE, 2.5);
    const css = buildLocationMarkerCss();
    assert.match(css, /width:\s*35px/);
    assert.match(css, /transform:\s*none/);
    assert.match(css, /heartland-gps-pulse/);
    assert.match(css, /pointer-events:\s*none/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /#facc15/);
    assert.match(css, /accuracy-circle/);
    assert.match(css, new RegExp(`#${STICKY_MARKER_ID}`));
    // Must not scale the host element (causes offset pulse)
    assert.ok(!/user-location-dot\][^{]*\{[^}]*transform:\s*scale\(2\.5\)/s.test(css));
  });

  it("allows custom scale via pixel size", () => {
    const css = buildLocationMarkerCss({ scale: 3, basePx: 10 });
    assert.match(css, /width:\s*30px/);
  });

  it("does not force transform:none on sticky hold marker", () => {
    const css = buildLocationMarkerCss();
    const stickyBlock = css.slice(css.indexOf(`#${STICKY_MARKER_ID}`));
    const stickyRule = stickyBlock.slice(0, stickyBlock.indexOf("}") + 1);
    assert.ok(!/transform:\s*none/.test(stickyRule));
  });
});
