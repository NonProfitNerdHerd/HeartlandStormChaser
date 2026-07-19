import { join } from "node:path";
import { loadConfig, VERSION } from "./config.js";
import { createLogger } from "./logger.js";
import { createNmeaServer } from "./nmea-server.js";
import { createPoller, FixState } from "./poller.js";
import { acquirePidFile } from "./pid.js";
import {
  buildLocationPayload,
  buildStatusPayload,
  createStatusServer,
} from "./status-server.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`Home GPS Bridge configuration error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const logDir = join(config.bridgeRoot, "logs");
  const runtimeDir = join(config.bridgeRoot, "runtime");
  const logger = createLogger({
    logDir,
    level: config.logLevel,
    token: config.gpsApiToken,
  });

  let pidHandle;
  try {
    pidHandle = acquirePidFile(join(runtimeDir, "home-gps-bridge.pid"));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const startedAt = new Date();
  let lastLoggedFixState = null;

  const poller = createPoller({
    gpsApiUrl: config.gpsApiUrl,
    gpsApiToken: config.gpsApiToken,
    pollIntervalMs: config.pollIntervalMs,
    requestTimeoutMs: config.requestTimeoutMs,
    staleAfterSeconds: config.staleAfterSeconds,
    logger,
  });

  const nmeaServer = createNmeaServer({
    host: config.nmeaHost,
    port: config.nmeaPort,
    getSentences: () => poller.getNmeaSentences(),
    logger,
  });

  const statusServer = createStatusServer({
    host: config.statusHost,
    port: config.statusPort,
    getStatus: () =>
      buildStatusPayload({
        config,
        poller,
        nmeaServer,
        startedAt,
        version: VERSION,
      }),
    getLocation: () => buildLocationPayload({ poller }),
    logger,
  });

  const stateWatch = setInterval(() => {
    const snap = poller.getSnapshot();
    if (snap.fixState !== lastLoggedFixState) {
      if (snap.fixState === FixState.STALE) {
        logger.warn("Platform GPS fix is stale; emitting invalid NMEA");
      } else if (
        lastLoggedFixState === FixState.STALE &&
        (snap.fixState === FixState.FRESH || snap.fixState === FixState.DELAYED)
      ) {
        logger.info("Platform GPS fix is fresh again");
      } else if (snap.fixState === FixState.UNAUTHORIZED) {
        logger.error("Unauthorized — check GPS_API_TOKEN matches HOME_GPS_BRIDGE_TOKEN");
      }
      lastLoggedFixState = snap.fixState;
    }
  }, 2000);
  if (typeof stateWatch.unref === "function") {
    stateWatch.unref();
  }

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Shutting down (${signal})`);
    clearInterval(stateWatch);
    poller.stop();
    await Promise.allSettled([nmeaServer.stop(), statusServer.stop()]);
    pidHandle.release();
    await logger.close();
    process.exit(0);
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  try {
    await nmeaServer.start();
    await statusServer.start();
    poller.start();
    logger.info(`Home GPS Bridge ${VERSION} started`);
  } catch (error) {
    logger.error(`Startup failed: ${error.message}`);
    poller.stop();
    await Promise.allSettled([nmeaServer.stop(), statusServer.stop()]);
    pidHandle.release();
    await logger.close();
    process.exitCode = 1;
  }
}

main();
