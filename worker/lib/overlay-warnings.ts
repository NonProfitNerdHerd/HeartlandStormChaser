import { distanceToGeometryMiles } from "./geo";
import { getOrRefreshCachedAlerts } from "./nws-alerts";
import type { Env } from "../index";

export type OverlayWarningLevel = "green" | "yellow" | "red";

function eventLevel(event: string): OverlayWarningLevel | null {
  const normalized = event.toLowerCase();

  if (normalized.includes("tornado")) {
    return "red";
  }

  if (normalized.includes("severe thunderstorm")) {
    return "yellow";
  }

  return null;
}

function maxLevel(
  current: OverlayWarningLevel,
  next: OverlayWarningLevel,
): OverlayWarningLevel {
  if (current === "red" || next === "red") return "red";
  if (current === "yellow" || next === "yellow") return "yellow";
  return "green";
}

export async function getOverlayWarningLevel(
  env: Env,
  latitude: number,
  longitude: number,
): Promise<OverlayWarningLevel> {
  try {
    const cached = await getOrRefreshCachedAlerts(env);
    let level: OverlayWarningLevel = "green";

    for (const alert of cached.alerts) {
      if (!alert.geometry) {
        continue;
      }

      const distanceMiles = distanceToGeometryMiles(latitude, longitude, alert.geometry);
      if (!Number.isFinite(distanceMiles) || distanceMiles > 0) {
        continue;
      }

      const alertLevel = eventLevel(alert.event);
      if (alertLevel) {
        level = maxLevel(level, alertLevel);
        if (level === "red") {
          return level;
        }
      }
    }

    return level;
  } catch {
    return "green";
  }
}
