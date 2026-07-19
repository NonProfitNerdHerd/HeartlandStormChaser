import { loadConfig, VERSION } from "./config.js";
import { createLogger } from "./logger.js";
import { acquirePidFile } from "./pid.js";
import { createGpsClient } from "./gps-client.js";
import { createBrowserManager } from "./browser-manager.js";
import { createTitleKeeper } from "./title-keeper.js";
import { createRecoveryController } from "./recovery.js";
import { createWatchdog } from "./watchdog.js";
import {
  buildControllerStatus,
  createStatusServer,
} from "./status-server.js";
import { createObsClient, validateObsConfig } from "./obs-client.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`WeatherFront OBS Controller config error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const obsCheck = validateObsConfig(config);
  if (!obsCheck.ok) {
    console.error(`OBS config invalid: ${obsCheck.errors.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({
    logDir: config.runtimePaths.logs,
    level: config.logLevel,
    secrets: [config.controlToken, config.obsWebsocketPassword].filter(Boolean),
  });

  let pidHandle;
  try {
    pidHandle = acquirePidFile(config.runtimePaths.pidFile);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const startedAt = new Date();
  const recovery = createRecoveryController({
    maxReloadAttempts: config.maxReloadAttempts,
    maxRelaunchAttempts: config.maxRelaunchAttempts,
    cooldownSeconds: config.recoveryCooldownSeconds,
    logger,
  });

  const browser = createBrowserManager({
    config,
    logger,
    onStateChange: (s) => logger.debug(`Browser state: ${s}`),
  });

  const gps = createGpsClient({
    url: config.gpsBridgeLocationUrl,
    pollIntervalMs: config.gpsPollIntervalMs,
    requestTimeoutMs: config.gpsRequestTimeoutMs,
    logger,
    onStateChange: (state) => logger.info(`Platform GPS state: ${state}`),
    onAccepted: async (record, meta = {}) => {
      if (meta.coordinatesChanged) {
        logger.info("Platform GPS coordinates changed (coords omitted)");
      } else if (meta.stateChanged) {
        logger.info(`Platform GPS hold/state update: ${record.state}`);
      }
      // setGeolocation only on meaningful moves (~15m+); never on Stale holds; 10s poll.
      const geoUpdated = await browser.applyGeolocation(record);
      await browser.updateGpsHud(gps.getSnapshot());
      await browser.ensureLocationMarkerEnhancement();
      const snap = browser.getSnapshot();
      if (snap.loginRequired) return;
      // Never click-thrash on timestamp polls. Only nudge follow if inactive or after a real geo move.
      if (!snap.followActive || geoUpdated) {
        await browser.activateFollow({ onlyIfInactive: true });
      }
    },
  });

  const titleKeeper = createTitleKeeper({
    getPage: () => browser.getPage(),
    title: config.windowTitle,
    logger,
  });

  const obs = createObsClient({ config, logger });

  const watchdog = createWatchdog({
    intervalMs: config.watchdogIntervalMs,
    pageUnhealthySeconds: config.pageUnhealthySeconds,
    getBrowser: () => browser,
    getGps: () => gps,
    recovery,
    logger,
  });

  const statusServer = createStatusServer({
    host: config.statusHost,
    port: config.statusPort,
    controlToken: config.controlToken,
    getStatus: () =>
      buildControllerStatus({
        config,
        startedAt,
        gps: gps.getSnapshot(),
        browser: browser.getSnapshot(),
        watchdog: watchdog.getSnapshot(),
        obs: obs.getSnapshot(),
      }),
    controls: {
      follow: () => browser.activateFollow(),
      reload: async () => {
        recovery.recordReload();
        await browser.reload();
      },
      restartBrowser: async () => {
        recovery.recordRelaunch();
        await browser.relaunch();
      },
    },
    logger,
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Shutting down (${signal})`);
    watchdog.stop();
    titleKeeper.stop();
    gps.stop();
    await Promise.allSettled([statusServer.stop(), browser.close(), obs.disconnect()]);
    pidHandle.release();
    await logger.close();
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await statusServer.start();
    if (config.startObsIfMissing) {
      await obs.ensureObsRunning();
    } else if (config.obsWebsocketEnabled) {
      await obs.connect();
    }

    await browser.launch();
    titleKeeper.start();
    gps.start();
    watchdog.start();
    logger.info(`WeatherFront OBS Controller ${VERSION} started`);
    logger.info(`Status: http://${config.statusHost}:${config.statusPort}/status`);
    logger.info(`OBS window title: ${config.windowTitle}`);
  } catch (error) {
    logger.error(`Startup failed: ${error.message}`);
    gps.stop();
    watchdog.stop();
    titleKeeper.stop();
    await Promise.allSettled([statusServer.stop(), browser.close()]);
    pidHandle.release();
    await logger.close();
    process.exitCode = 1;
  }
}

main();
