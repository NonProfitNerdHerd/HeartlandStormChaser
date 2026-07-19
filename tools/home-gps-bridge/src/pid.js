import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquirePidFile(pidPath) {
  const dir = dirname(pidPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (existsSync(pidPath)) {
    const raw = readFileSync(pidPath, "utf8").trim();
    const existingPid = Number.parseInt(raw, 10);
    if (isProcessAlive(existingPid)) {
      const error = new Error(
        `Another Home GPS Bridge instance appears to be running (PID ${existingPid}). ` +
          `If this is wrong, delete ${pidPath} and retry.`,
      );
      error.code = "EALREADYRUNNING";
      throw error;
    }
    try {
      unlinkSync(pidPath);
    } catch {
      // continue and overwrite
    }
  }

  writeFileSync(pidPath, `${process.pid}\n`, { encoding: "utf8", flag: "wx" });
  return {
    pidPath,
    release() {
      try {
        if (existsSync(pidPath)) {
          const raw = readFileSync(pidPath, "utf8").trim();
          if (Number.parseInt(raw, 10) === process.pid) {
            unlinkSync(pidPath);
          }
        }
      } catch {
        // ignore
      }
    },
  };
}

export function readPidFile(pidPath) {
  if (!existsSync(pidPath)) {
    return null;
  }
  const raw = readFileSync(pidPath, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  return { pid, alive: isProcessAlive(pid) };
}

export function stopPidFromFile(pidPath) {
  const info = readPidFile(pidPath);
  if (!info) {
    return { stopped: false, reason: "no-pid-file" };
  }
  if (!info.alive) {
    try {
      unlinkSync(pidPath);
    } catch {
      // ignore
    }
    return { stopped: false, reason: "stale-pid", pid: info.pid };
  }
  try {
    process.kill(info.pid, "SIGTERM");
  } catch (error) {
    return { stopped: false, reason: "kill-failed", pid: info.pid, error: error.message };
  }
  return { stopped: true, pid: info.pid };
}
