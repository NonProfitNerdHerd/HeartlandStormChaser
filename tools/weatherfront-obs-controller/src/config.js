import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveControllerPaths } from "./paths.js";
import { requireWeatherfrontAppUrl } from "./redaction.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(__dirname, "..");
export const VERSION = "1.0.0";

function parsePositiveInt(name, raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseIntOrZero(name, raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

function parseBool(raw, fallback = false) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function requireString(name, raw) {
  const value = raw?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertLoopback(name, host) {
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`${name} must be 127.0.0.1`);
  }
}

function applyEnvFile(path, env) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] == null || env[key] === "") env[key] = value;
  }
}

export function loadConfig(env = process.env) {
  const runtimePaths = resolveControllerPaths();

  // Prefer installed config, then local .env next to package
  const installedEnv = join(runtimePaths.config, ".env");
  const localEnv = join(PACKAGE_ROOT, ".env");
  if (!env.WEATHERFRONT_URL) {
    if (existsSync(installedEnv)) applyEnvFile(installedEnv, env);
    else if (existsSync(localEnv)) applyEnvFile(localEnv, env);
  }

  const weatherfrontUrl = requireWeatherfrontAppUrl(
    requireString("WEATHERFRONT_URL", env.WEATHERFRONT_URL || "https://app.weatherfront.com"),
  );

  const statusHost = (env.CONTROLLER_STATUS_HOST || "127.0.0.1").trim();
  assertLoopback("CONTROLLER_STATUS_HOST", statusHost);

  const gpsUrl = requireString(
    "GPS_BRIDGE_LOCATION_URL",
    env.GPS_BRIDGE_LOCATION_URL || "http://127.0.0.1:10111/location",
  );
  try {
    const u = new URL(gpsUrl);
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
      throw new Error("GPS_BRIDGE_LOCATION_URL must point at localhost");
    }
  } catch (error) {
    throw new Error(`Invalid GPS_BRIDGE_LOCATION_URL: ${error.message}`);
  }

  const logLevel = (env.LOG_LEVEL || "info").trim().toLowerCase();
  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    throw new Error("LOG_LEVEL must be debug|info|warn|error");
  }

  return {
    version: VERSION,
    packageRoot: PACKAGE_ROOT,
    runtimePaths,
    weatherfrontUrl,
    weatherfrontOrigin: new URL(weatherfrontUrl).origin,
    gpsBridgeLocationUrl: gpsUrl,
    gpsPollIntervalMs: parsePositiveInt("GPS_POLL_INTERVAL_MS", env.GPS_POLL_INTERVAL_MS, 10_000),
    gpsRequestTimeoutMs: parsePositiveInt(
      "GPS_REQUEST_TIMEOUT_MS",
      env.GPS_REQUEST_TIMEOUT_MS,
      5000,
    ),
    windowTitle: (env.WINDOW_TITLE || "Heartland WeatherFront OBS").trim(),
    windowWidth: parsePositiveInt("WINDOW_WIDTH", env.WINDOW_WIDTH, 1920),
    windowHeight: parsePositiveInt("WINDOW_HEIGHT", env.WINDOW_HEIGHT, 1080),
    windowX: parseIntOrZero("WINDOW_X", env.WINDOW_X, 0),
    windowY: parseIntOrZero("WINDOW_Y", env.WINDOW_Y, 0),
    statusHost,
    statusPort: parsePositiveInt("CONTROLLER_STATUS_PORT", env.CONTROLLER_STATUS_PORT, 10112),
    controlToken: requireString(
      "CONTROLLER_CONTROL_TOKEN",
      env.CONTROLLER_CONTROL_TOKEN || "change-me-local-only-control-token",
    ),
    watchdogIntervalMs: parsePositiveInt("WATCHDOG_INTERVAL_MS", env.WATCHDOG_INTERVAL_MS, 5000),
    pageUnhealthySeconds: parsePositiveInt(
      "PAGE_UNHEALTHY_SECONDS",
      env.PAGE_UNHEALTHY_SECONDS,
      30,
    ),
    maxReloadAttempts: parsePositiveInt("MAX_RELOAD_ATTEMPTS", env.MAX_RELOAD_ATTEMPTS, 3),
    maxRelaunchAttempts: parsePositiveInt("MAX_RELAUNCH_ATTEMPTS", env.MAX_RELAUNCH_ATTEMPTS, 3),
    recoveryCooldownSeconds: parsePositiveInt(
      "RECOVERY_COOLDOWN_SECONDS",
      env.RECOVERY_COOLDOWN_SECONDS,
      60,
    ),
    logLevel,
    obsWebsocketEnabled: parseBool(env.OBS_WEBSOCKET_ENABLED, false),
    obsWebsocketUrl: (env.OBS_WEBSOCKET_URL || "ws://127.0.0.1:4455").trim(),
    obsWebsocketPassword: env.OBS_WEBSOCKET_PASSWORD?.trim() || "",
    obsSceneName: env.OBS_SCENE_NAME?.trim() || "",
    obsSourceName: (env.OBS_SOURCE_NAME || "WeatherFront Radar").trim(),
    startObsIfMissing: parseBool(env.START_OBS_IF_MISSING, false),
    obsExecutablePath: env.OBS_EXECUTABLE_PATH?.trim() || "",
    followClickXyEnabled: parseBool(env.FOLLOW_CLICK_XY_ENABLED, false),
    followClickX:
      env.FOLLOW_CLICK_X != null && String(env.FOLLOW_CLICK_X).trim() !== ""
        ? Number(env.FOLLOW_CLICK_X)
        : null,
    followClickY:
      env.FOLLOW_CLICK_Y != null && String(env.FOLLOW_CLICK_Y).trim() !== ""
        ? Number(env.FOLLOW_CLICK_Y)
        : null,
  };
}
