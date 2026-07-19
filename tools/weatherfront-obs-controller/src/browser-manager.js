import { chromium } from "playwright";
import { applyWindowTitle } from "./title-keeper.js";
import { ensureFollowActive, createBoundedRetry } from "./follow-control.js";
import { isAllowedWeatherfrontUrl, redactUrl } from "./redaction.js";
import { buildHudModel, ensureGpsHud } from "./gps-hud.js";
import { ensureLocationMarkerStyle } from "./location-marker.js";

/** Ignore GPS jitter below this when updating Playwright geolocation. */
export const GEO_MOVE_THRESHOLD_METERS = 15;

/** Cap how often setGeolocation can remount Mapbox's user-location layer. */
export const GEO_UPDATE_MIN_INTERVAL_MS = 8_000;

/** Approximate distance in meters between two WGS84 points. */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return Infinity;
  }
  const toRad = (d) => (d * Math.PI) / 180;
  const r = 6371000;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

const LOGIN_HINTS = /sign in|log in|login|authenticate|sso|auth0/i;

export function detectLoginRequired(url, pageTextSample = "") {
  const hay = `${url}\n${pageTextSample}`.toLowerCase();
  if (LOGIN_HINTS.test(hay)) return true;
  try {
    const u = new URL(url);
    if (/login|signin|auth|oauth|sso/i.test(u.pathname + u.hostname)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function createBrowserManager({
  config,
  logger,
  onStateChange,
}) {
  let context = null;
  let page = null;
  let launched = false;
  let loginRequired = false;
  let pageLoaded = false;
  let lastUrl = "";
  let lastGeolocationAt = null;
  let lastGeoApplyAtMs = 0;
  let lastGeoRecord = null;
  let followFound = false;
  let followActive = false;
  let followStrategy = null;
  let geolocationPermission = "unknown";
  let lastError = null;
  let browserRunning = false;
  let lastHudModel = null;
  let lastFollowClickAt = 0;
  const FOLLOW_CLICK_MIN_INTERVAL_MS = 30_000;

  const followRetry = createBoundedRetry({
    maxAttempts: 5,
    cooldownMs: config.recoveryCooldownSeconds * 1000,
  });

  async function launch() {
    const profile = config.runtimePaths.browserProfile;
    logger.info(`Launching WeatherFront Chromium profile at ${profile}`);

    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      viewport: { width: config.windowWidth, height: config.windowHeight },
      args: [
        `--window-size=${config.windowWidth},${config.windowHeight}`,
        `--window-position=${config.windowX},${config.windowY}`,
        `--app=${config.weatherfrontUrl}`,
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=TranslateUI",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
      locale: "en-US",
      timezoneId: "America/Chicago",
      permissions: [],
    });

    await context.grantPermissions(["geolocation"], {
      origin: config.weatherfrontOrigin,
    });
    geolocationPermission = "granted";

    page = context.pages()[0] || (await context.newPage());
    browserRunning = true;
    launched = true;

    page.on("crash", () => {
      lastError = "Page crashed";
      pageLoaded = false;
      onStateChange?.("page-crash");
      logger.error("WeatherFront page crashed");
    });

    context.on("close", () => {
      browserRunning = false;
      pageLoaded = false;
      onStateChange?.("browser-closed");
      logger.warn("WeatherFront browser context closed");
    });

    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
    } catch {
      await page.goto(config.weatherfrontUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }

    if (!page.url() || page.url() === "about:blank") {
      await page.goto(config.weatherfrontUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }

    await afterNavigation();
    onStateChange?.("launched");
  }

  async function afterNavigation() {
    if (!page || page.isClosed()) return;
    lastUrl = page.url();
    pageLoaded = true;

    if (!isAllowedWeatherfrontUrl(lastUrl, config.weatherfrontOrigin)) {
      logger.warn(`Unexpected navigation to ${redactUrl(lastUrl)}; returning to app`);
      await page.goto(config.weatherfrontUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      lastUrl = page.url();
    }

    await applyWindowTitle(page, config.windowTitle);

    let sample = "";
    try {
      sample = await page.locator("body").innerText({ timeout: 2000 });
      sample = sample.slice(0, 500);
    } catch {
      /* ignore */
    }

    const wasLogin = loginRequired;
    loginRequired = detectLoginRequired(lastUrl, sample);
    if (loginRequired && !wasLogin) {
      logger.warn("WeatherFront login required — complete login in the open window");
      onStateChange?.("login-required");
    } else if (!loginRequired && wasLogin) {
      logger.info("WeatherFront login appears complete");
      onStateChange?.("login-ok");
    }

    if (!loginRequired && lastGeoRecord) {
      await applyGeolocation(lastGeoRecord, { force: true });
      await activateFollow();
    }
    if (lastHudModel) {
      await updateGpsHudFromModel(lastHudModel);
    }
    await ensureLocationMarkerEnhancement();
    // Late Mapbox mount: one delayed retry (still no-op if CSS already present)
    setTimeout(() => {
      void ensureLocationMarkerEnhancement();
    }, 2500);
  }

  async function ensureLocationMarkerEnhancement() {
    if (!page || page.isClosed() || loginRequired) return false;
    try {
      const result = await ensureLocationMarkerStyle(page);
      if (result?.injectedNow && result?.matchedSelector) {
        logger.info(`GPS marker style applied (${result.matchedSelector})`);
      } else if (result?.injectedNow) {
        logger.info("GPS marker style injected (waiting for Mapbox dot)");
      }
      return Boolean(result?.applied);
    } catch (error) {
      logger.debug(`GPS marker style skipped: ${error.message}`);
      return false;
    }
  }

  /**
   * Set Playwright geolocation from platform GPS.
   * Skips setGeolocation unless the fix moved ~15m+ (or force after navigation).
   * Never rewrites geo while bridge is holding a Stale fix — that remounts Mapbox.
   * Last known position stays in the browser context across Delayed/Stale/recover.
   */
  async function applyGeolocation(record, opts = {}) {
    if (!context || !record) return false;
    if (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)) {
      return false;
    }

    const force = opts.force === true;
    const held =
      record.held === true ||
      String(record.state || "").toLowerCase() === "stale";

    // Freeze Playwright geo during hold — sticky marker covers any Mapbox blink.
    if (!force && held && lastGeoRecord) {
      lastGeoRecord = {
        ...lastGeoRecord,
        ...record,
        latitude: lastGeoRecord.latitude,
        longitude: lastGeoRecord.longitude,
      };
      return false;
    }

    if (!force && lastGeoRecord) {
      const moved = distanceMeters(
        lastGeoRecord.latitude,
        lastGeoRecord.longitude,
        record.latitude,
        record.longitude,
      );
      if (moved < GEO_MOVE_THRESHOLD_METERS) {
        lastGeoRecord = {
          ...lastGeoRecord,
          ...record,
          latitude: lastGeoRecord.latitude,
          longitude: lastGeoRecord.longitude,
        };
        return false;
      }

      const sinceLast = Date.now() - lastGeoApplyAtMs;
      if (lastGeoApplyAtMs > 0 && sinceLast < GEO_UPDATE_MIN_INTERVAL_MS) {
        logger.debug(
          `Deferred geolocation update (${Math.round(moved)}m move, ${sinceLast}ms since last apply)`,
        );
        return false;
      }
    }

    try {
      await context.setGeolocation({
        latitude: record.latitude,
        longitude: record.longitude,
        accuracy: record.accuracyMeters ?? 10,
      });
      lastGeolocationAt = new Date().toISOString();
      lastGeoApplyAtMs = Date.now();
      lastGeoRecord = record;
      logger.debug("Updated WeatherFront geolocation (meaningful move or force)");
      return true;
    } catch (error) {
      lastError = error.message;
      logger.warn(`Geolocation update failed: ${error.message}`);
      return false;
    }
  }

  async function updateGpsHud(gpsSnapshot) {
    const model = buildHudModel(gpsSnapshot);
    lastHudModel = model;
    return updateGpsHudFromModel(model);
  }

  async function updateGpsHudFromModel(model) {
    if (!page || page.isClosed() || loginRequired) return false;
    try {
      await ensureGpsHud(page, model);
      return true;
    } catch (error) {
      logger.debug(`HUD update skipped: ${error.message}`);
      return false;
    }
  }

  /**
   * Activate follow only when needed.
   * - onlyIfInactive: skip entirely when we already think follow is on
   * - rate-limits actual clicks to once per 30s to avoid Mapbox marker remounts
   */
  async function activateFollow(opts = {}) {
    if (!page || page.isClosed() || loginRequired) return null;
    if (opts.onlyIfInactive && followActive) {
      return { ok: true, alreadyActive: true, skipped: true };
    }

    const now = Date.now();
    const minInterval = opts.minIntervalMs ?? FOLLOW_CLICK_MIN_INTERVAL_MS;
    if (
      !opts.force &&
      lastFollowClickAt > 0 &&
      now - lastFollowClickAt < minInterval
    ) {
      return { ok: followActive, skipped: true, reason: "follow-click-rate-limit" };
    }

    const result = await ensureFollowActive(page, {
      retry: followRetry,
      logger,
      clickXy: {
        enabled: config.followClickXyEnabled,
        x: config.followClickX,
        y: config.followClickY,
      },
    });
    followFound = Boolean(result.discovery?.found);
    followActive = Boolean(result.ok && (result.alreadyActive || result.discovery?.active));
    followStrategy = result.discovery?.strategy || null;
    if (!result.alreadyActive && !result.skipped) {
      // A click (or attempt) happened
      lastFollowClickAt = now;
    }
    if (result.ok) lastError = null;
    else if (result.reason) lastError = result.reason;
    return result;
  }

  async function reload() {
    if (!page || page.isClosed()) throw new Error("No page to reload");
    logger.info("Reloading WeatherFront page");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await afterNavigation();
  }

  async function close() {
    try {
      await context?.close();
    } catch {
      /* ignore */
    }
    context = null;
    page = null;
    browserRunning = false;
    pageLoaded = false;
  }

  async function relaunch() {
    await close();
    await launch();
  }

  function getPage() {
    return page;
  }

  function getSnapshot() {
    return {
      browserRunning,
      launched,
      pageLoaded,
      loginRequired,
      currentUrl: lastUrl ? redactUrl(lastUrl) : null,
      geolocationPermission,
      lastGeolocationAt,
      followFound,
      followActive,
      followStrategy,
      windowTitle: config.windowTitle,
      lastError,
      hasLastGeo: Boolean(lastGeoRecord),
      hudLabel: lastHudModel?.label ?? null,
    };
  }

  return {
    launch,
    close,
    relaunch,
    reload,
    applyGeolocation,
    activateFollow,
    afterNavigation,
    updateGpsHud,
    ensureLocationMarkerEnhancement,
    getPage,
    getSnapshot,
  };
}
