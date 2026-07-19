import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Runtime roots live under %LOCALAPPDATA%\Heartland\WeatherFrontOBS
 * (never under Git/OneDrive repo paths for production).
 */
export function getLocalAppDataRoot() {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.XDG_DATA_HOME ||
    join(homedir(), ".local", "share");
  return join(base, "Heartland", "WeatherFrontOBS");
}

export function getRuntimePaths(root = getLocalAppDataRoot()) {
  const paths = {
    root,
    app: join(root, "app"),
    config: join(root, "config"),
    browserProfile: join(root, "browser-profile"),
    logs: join(root, "logs"),
    state: join(root, "state"),
    screenshots: join(root, "screenshots"),
    pidFile: join(root, "state", "weatherfront-obs-controller.pid"),
  };
  return paths;
}

export function ensureRuntimeDirs(paths) {
  for (const key of [
    "root",
    "app",
    "config",
    "browserProfile",
    "logs",
    "state",
    "screenshots",
  ]) {
    if (!existsSync(paths[key])) {
      mkdirSync(paths[key], { recursive: true });
    }
  }
  return paths;
}

/** Dev mode: when running from the repo, still use LOCALAPPDATA for profile/logs. */
export function resolveControllerPaths() {
  return ensureRuntimeDirs(getRuntimePaths());
}
