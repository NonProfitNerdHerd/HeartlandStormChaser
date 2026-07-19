export function createWatchdog({
  intervalMs,
  pageUnhealthySeconds,
  getBrowser,
  getGps,
  recovery,
  logger,
  onTick,
}) {
  let timer = null;
  let lastHealthyAt = Date.now();
  let lastHealthCheckAt = null;

  async function tick() {
    lastHealthCheckAt = new Date().toISOString();
    const browser = getBrowser().getSnapshot();
    const gps = getGps().getSnapshot();

    if (browser.loginRequired) {
      // Do not thrash reloads while waiting for login
      onTick?.({ browser, gps, action: "wait-login" });
      return;
    }

    if (!browser.browserRunning) {
      if (recovery.canRelaunch()) {
        logger.warn("Browser not running — relaunching");
        recovery.recordRelaunch();
        try {
          await getBrowser().relaunch();
          recovery.recordSuccess();
          lastHealthyAt = Date.now();
        } catch (error) {
          logger.error(`Relaunch failed: ${error.message}`);
        }
      }
      onTick?.({ browser, gps, action: "relaunch" });
      return;
    }

    if (!browser.pageLoaded) {
      const age = (Date.now() - lastHealthyAt) / 1000;
      if (age > pageUnhealthySeconds && recovery.canReload()) {
        logger.warn("Page unhealthy — reloading");
        recovery.recordReload();
        try {
          await getBrowser().reload();
          lastHealthyAt = Date.now();
        } catch (error) {
          logger.error(`Reload failed: ${error.message}`);
        }
      }
      onTick?.({ browser, gps, action: "reload-check" });
      return;
    }

    lastHealthyAt = Date.now();

    // Keep follow mode active — but never click if we already believe follow is on
    if (!browser.loginRequired) {
      try {
        await getBrowser().activateFollow({ onlyIfInactive: true });
      } catch {
        /* ignore */
      }
      try {
        await getBrowser().ensureLocationMarkerEnhancement?.();
      } catch {
        /* ignore */
      }
    }

    // GPS soft health — do not reload WeatherFront solely for stale GPS
    if (!gps.bridgeReachable) {
      logger.debug("GPS bridge unreachable (watchdog)");
    }

    onTick?.({ browser, gps, action: "ok" });
  }

  function start() {
    timer = setInterval(() => void tick(), intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function getSnapshot() {
    return {
      lastHealthCheckAt,
      lastHealthyAt: new Date(lastHealthyAt).toISOString(),
      recovery: recovery.getState(),
    };
  }

  return { start, stop, tick, getSnapshot };
}
