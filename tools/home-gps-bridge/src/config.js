import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BRIDGE_ROOT = join(__dirname, "..");
export const VERSION = "1.0.0";

function parsePositiveInt(name, raw, fallback) {
  if (raw == null || String(raw).trim() === "") {
    return fallback;
  }
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got ${JSON.stringify(raw)})`);
  }
  return value;
}

function requireString(name, raw) {
  const value = raw?.trim();
  if (!value) {
    throw new Error(`${name} is required. Copy .env.example to .env and set ${name}.`);
  }
  return value;
}

function assertLoopback(name, host) {
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`${name} must be 127.0.0.1 (got ${JSON.stringify(host)})`);
  }
}

/**
 * Load configuration from process.env (populated via node --env-file=.env).
 * Also supports reading .env manually when --env-file was not used.
 */
export function loadConfig(env = process.env) {
  // Allow start without --env-file if .env exists next to package.json
  if (!env.GPS_API_URL && existsSync(join(BRIDGE_ROOT, ".env"))) {
    applyEnvFile(join(BRIDGE_ROOT, ".env"), env);
  }

  const gpsApiUrl = requireString("GPS_API_URL", env.GPS_API_URL);
  try {
    const parsed = new URL(gpsApiUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("GPS_API_URL must use http or https");
    }
  } catch (error) {
    throw new Error(`GPS_API_URL is not a valid URL: ${error.message}`);
  }

  const nmeaHost = (env.NMEA_HOST || "127.0.0.1").trim();
  const statusHost = (env.STATUS_HOST || "127.0.0.1").trim();
  assertLoopback("NMEA_HOST", nmeaHost);
  assertLoopback("STATUS_HOST", statusHost);

  const logLevel = (env.LOG_LEVEL || "info").trim().toLowerCase();
  const allowedLevels = new Set(["debug", "info", "warn", "error"]);
  if (!allowedLevels.has(logLevel)) {
    throw new Error(`LOG_LEVEL must be one of: debug, info, warn, error`);
  }

  return {
    gpsApiUrl,
    gpsApiToken: requireString("GPS_API_TOKEN", env.GPS_API_TOKEN),
    pollIntervalMs: parsePositiveInt("GPS_POLL_INTERVAL_MS", env.GPS_POLL_INTERVAL_MS, 2000),
    requestTimeoutMs: parsePositiveInt(
      "GPS_REQUEST_TIMEOUT_MS",
      env.GPS_REQUEST_TIMEOUT_MS,
      10000,
    ),
    nmeaHost,
    nmeaPort: parsePositiveInt("NMEA_PORT", env.NMEA_PORT, 10110),
    statusHost,
    statusPort: parsePositiveInt("STATUS_PORT", env.STATUS_PORT, 10111),
    staleAfterSeconds: parsePositiveInt("STALE_AFTER_SECONDS", env.STALE_AFTER_SECONDS, 30),
    logLevel,
    bridgeRoot: BRIDGE_ROOT,
    version: VERSION,
  };
}

function applyEnvFile(path, env) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] == null || env[key] === "") {
      env[key] = value;
    }
  }
}

/** Redact sensitive query params from a URL for status/logging. */
export function redactUrl(urlString) {
  try {
    const url = new URL(urlString);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|password|auth/i.test(key)) {
        url.searchParams.set(key, "REDACTED");
      }
    }
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}
