/**
 * Enlarge + pulse WeatherFront / Mapbox user-location marker (OBS Chromium only).
 * Styles the map-owned marker in-place so pan/zoom/GPS stay geographically correct.
 *
 * Also installs a sticky hold: when Mapbox remounts/removes the native dot
 * (geolocation refresh, follow click, stale recover), a yellow twin keeps the
 * last known map transform until the native marker returns — no blank gaps.
 *
 * Important: do NOT use transform:scale() on the host dot — that fights Mapbox's
 * own ::before pulse and causes an offset ring + flicker. Size via width/height.
 * Inject the stylesheet once; Mapbox keeps moving the marker on GPS updates.
 */

export const LOCATION_MARKER_SCALE = 2.5;
export const LOCATION_MARKER_PULSE_SECONDS = 1.5;
export const LOCATION_MARKER_BASE_PX = 14;
export const STICKY_MARKER_ID = "heartland-sticky-gps-dot";

export const LOCATION_MARKER_SELECTORS = [
  ".mapboxgl-user-location-dot",
  ".maplibregl-user-location-dot",
  ".mapboxgl-user-location .mapboxgl-user-location-dot",
  "[class*='user-location-dot']",
];

/** CSS injected into the WeatherFront document (no coords). */
export function buildLocationMarkerCss({
  scale = LOCATION_MARKER_SCALE,
  pulseSeconds = LOCATION_MARKER_PULSE_SECONDS,
  basePx = LOCATION_MARKER_BASE_PX,
} = {}) {
  const sizePx = Math.round(basePx * scale * 10) / 10;
  return `
/* Heartland: enlarge + pulse WeatherFront GPS marker (inject once) */
.mapboxgl-user-location,
.maplibregl-user-location {
  pointer-events: none !important;
}

/* Hide Mapbox accuracy halo — causes a large pale ring */
.mapboxgl-user-location-accuracy-circle,
.maplibregl-user-location-accuracy-circle {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
}

.mapboxgl-user-location-dot,
.maplibregl-user-location-dot,
[class*="user-location-dot"] {
  position: relative !important;
  box-sizing: border-box !important;
  width: ${sizePx}px !important;
  height: ${sizePx}px !important;
  min-width: ${sizePx}px !important;
  min-height: ${sizePx}px !important;
  margin: 0 !important;
  padding: 0 !important;
  background-color: #facc15 !important;
  background-image: none !important;
  border: 3px solid #ffffff !important;
  border-radius: 50% !important;
  box-shadow: 0 0 0 1px rgba(113, 63, 18, 0.45) !important;
  /* no transform on host — keeps geo anchor + pulse ring centered */
  transform: none !important;
  pointer-events: none !important;
  z-index: 2 !important;
}

/* Sticky twin: same look, but MUST keep Mapbox translate transform from JS */
#${STICKY_MARKER_ID} {
  position: absolute !important;
  box-sizing: border-box !important;
  width: ${sizePx}px !important;
  height: ${sizePx}px !important;
  margin: 0 !important;
  padding: 0 !important;
  background-color: #facc15 !important;
  border: 3px solid #ffffff !important;
  border-radius: 50% !important;
  box-shadow: 0 0 0 1px rgba(113, 63, 18, 0.45) !important;
  pointer-events: none !important;
  z-index: 6 !important;
}

.mapboxgl-user-location-dot::before,
.maplibregl-user-location-dot::before,
[class*="user-location-dot"]::before,
.mapboxgl-user-location-dot::after,
.maplibregl-user-location-dot::after,
[class*="user-location-dot"]::after,
#${STICKY_MARKER_ID}::before,
#${STICKY_MARKER_ID}::after {
  content: "" !important;
  display: block !important;
  position: absolute !important;
  left: 0 !important;
  top: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  border-radius: 50% !important;
  box-sizing: border-box !important;
  background: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
  pointer-events: none !important;
}

.mapboxgl-user-location-dot::after,
.maplibregl-user-location-dot::after,
[class*="user-location-dot"]::after,
#${STICKY_MARKER_ID}::after {
  content: none !important;
  display: none !important;
  animation: none !important;
}

.mapboxgl-user-location-dot::before,
.maplibregl-user-location-dot::before,
[class*="user-location-dot"]::before,
#${STICKY_MARKER_ID}::before {
  border: 2px solid rgba(250, 204, 21, 0.95) !important;
  transform: scale(1) !important;
  transform-origin: center center !important;
  opacity: 0.75 !important;
  z-index: -1 !important;
  animation: heartland-gps-pulse ${pulseSeconds}s ease-out infinite !important;
}

@keyframes heartland-gps-pulse {
  0% {
    transform: scale(1);
    opacity: 0.75;
  }
  100% {
    transform: scale(2.25);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mapboxgl-user-location-dot::before,
  .maplibregl-user-location-dot::before,
  [class*="user-location-dot"]::before,
  #${STICKY_MARKER_ID}::before {
    animation: none !important;
    content: none !important;
    display: none !important;
  }
}
`.trim();
}

/**
 * Page-side sticky hold installer (stringified into page.evaluate).
 * Keeps last Mapbox user-location transform visible while the native marker is absent.
 */
export function installStickyMarkerHoldInPage(stickyId = STICKY_MARKER_ID) {
  if (window.__heartlandStickyGpsInstalled) {
    return { installed: true, alreadyPresent: true };
  }
  window.__heartlandStickyGpsInstalled = true;

  const NATIVE_HOST =
    ".mapboxgl-user-location, .maplibregl-user-location, [class*='user-location']:not(#" +
    stickyId +
    ")";

  /** @type {HTMLElement|null} */
  let lastParent = null;
  let lastTransform = "";
  let lastLeft = "";
  let lastTop = "";
  let lastMarginLeft = "";
  let lastMarginTop = "";

  function ensureSticky(parent) {
    let el = document.getElementById(stickyId);
    if (!el) {
      el = document.createElement("div");
      el.id = stickyId;
      el.setAttribute("data-heartland-sticky-gps", "1");
      el.setAttribute("aria-hidden", "true");
    }
    if (parent && el.parentElement !== parent) {
      parent.appendChild(el);
    }
    return el;
  }

  function findNativeHost() {
    const nodes = document.querySelectorAll(NATIVE_HOST);
    for (const node of nodes) {
      if (node.id === stickyId) continue;
      if (node.querySelector?.("[class*='user-location-dot'], [class*='user-location']")) {
        return node;
      }
      if (
        node.classList?.contains("mapboxgl-user-location") ||
        node.classList?.contains("maplibregl-user-location")
      ) {
        return node;
      }
    }
    // Fallback: any user-location-dot's positioned ancestor marker
    const dot = document.querySelector(
      ".mapboxgl-user-location-dot, .maplibregl-user-location-dot, [class*='user-location-dot']",
    );
    if (dot && dot.id !== stickyId) {
      return dot.closest(".mapboxgl-user-location, .maplibregl-user-location, .mapboxgl-marker") || dot.parentElement;
    }
    return null;
  }

  function tick() {
    try {
      const native = findNativeHost();
      const sticky = document.getElementById(stickyId);

      if (native && native.isConnected) {
        lastParent = native.parentElement;
        lastTransform = native.style.transform || "";
        lastLeft = native.style.left || "";
        lastTop = native.style.top || "";
        lastMarginLeft = native.style.marginLeft || "";
        lastMarginTop = native.style.marginTop || "";
        // Native is visible — hide twin so we don't double-draw
        if (sticky) {
          sticky.style.display = "none";
        }
      } else if (lastParent && lastParent.isConnected && (lastTransform || lastLeft || lastTop)) {
        const el = ensureSticky(lastParent);
        el.style.display = "block";
        el.style.pointerEvents = "none";
        if (lastTransform) el.style.transform = lastTransform;
        if (lastLeft) el.style.left = lastLeft;
        if (lastTop) el.style.top = lastTop;
        if (lastMarginLeft) el.style.marginLeft = lastMarginLeft;
        if (lastMarginTop) el.style.marginTop = lastMarginTop;
      }
    } catch {
      /* ignore page churn */
    }
    window.__heartlandStickyGpsRaf = requestAnimationFrame(tick);
  }

  window.__heartlandStickyGpsRaf = requestAnimationFrame(tick);
  return { installed: true, alreadyPresent: false };
}

/**
 * Inject marker styles + sticky hold once into the WeatherFront page.
 * Safe to call repeatedly — subsequent calls are no-ops unless force=true.
 */
export async function ensureLocationMarkerStyle(page, options = {}) {
  if (!page || page.isClosed()) return { applied: false, matchedSelector: null, skipped: true };

  const scale = options.scale ?? LOCATION_MARKER_SCALE;
  const pulseSeconds = options.pulseSeconds ?? LOCATION_MARKER_PULSE_SECONDS;
  const force = options.force === true;
  const css = buildLocationMarkerCss({ scale, pulseSeconds });
  const selectors = LOCATION_MARKER_SELECTORS;
  const stickyId = STICKY_MARKER_ID;

  const styleResult = await page.evaluate(
    ({ cssText, selectorList, forceRewrite }) => {
      const STYLE_ID = "heartland-gps-marker-style";
      let styleEl = document.getElementById(STYLE_ID);
      let injectedNow = false;

      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = STYLE_ID;
        styleEl.setAttribute("data-heartland-gps-marker", "1");
        styleEl.textContent = cssText;
        (document.head || document.documentElement).appendChild(styleEl);
        injectedNow = true;
      } else if (forceRewrite) {
        styleEl.textContent = cssText;
        injectedNow = true;
      }

      let matchedSelector = null;
      for (const sel of selectorList) {
        try {
          if (document.querySelector(sel)) {
            matchedSelector = sel;
            break;
          }
        } catch {
          /* ignore */
        }
      }

      return {
        applied: true,
        injectedNow,
        matchedSelector,
        alreadyPresent: !injectedNow,
      };
    },
    { cssText: css, selectorList: selectors, forceRewrite: force },
  );

  const stickyResult = await page.evaluate(installStickyMarkerHoldInPage, stickyId);

  return {
    ...styleResult,
    stickyInstalled: Boolean(stickyResult?.installed),
    stickyAlreadyPresent: Boolean(stickyResult?.alreadyPresent),
  };
}
