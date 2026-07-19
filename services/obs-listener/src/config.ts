import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ListenerConfig } from "./types.js";

/** Load KEY=VALUE pairs from a local .env if present (does not override existing env). */
export function loadDotEnv(filePath = resolve(process.cwd(), ".env")): void {
  if (!existsSync(filePath)) {
    return;
  }

  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return trimmed;
}

function optionalInt(name: string, value: string | undefined, fallback: number): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer for ${name}: ${value}`);
  }
  return parsed;
}

function optionalNonNegativeInt(name: string, value: string | undefined, fallback: number): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid integer for ${name}: ${value}`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ListenerConfig {
  return {
    listenerHost: env.LISTENER_HOST?.trim() || "127.0.0.1",
    listenerPort: optionalInt("LISTENER_PORT", env.LISTENER_PORT, 8791),
    listenerAuthToken: required("LISTENER_AUTH_TOKEN", env.LISTENER_AUTH_TOKEN),
    obsHost: env.OBS_HOST?.trim() || "127.0.0.1",
    obsPort: optionalInt("OBS_PORT", env.OBS_PORT, 4455),
    obsPassword: env.OBS_PASSWORD?.trim() || "",
    obsReconnectMs: optionalInt("OBS_RECONNECT_MS", env.OBS_RECONNECT_MS, 3000),
    platformBaseUrl: (env.PLATFORM_BASE_URL || env.WORKER_BASE_URL || "").trim().replace(/\/$/, ""),
    overlayBrowserRefreshMs: optionalNonNegativeInt(
      "OVERLAY_BROWSER_REFRESH_MS",
      env.OVERLAY_BROWSER_REFRESH_MS,
      300_000,
    ),
  };
}
