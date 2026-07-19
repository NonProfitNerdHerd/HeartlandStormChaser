import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquirePidFile(pidPath) {
  const dir = dirname(pidPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(pidPath)) {
    const existingPid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
    if (isProcessAlive(existingPid)) {
      const error = new Error(
        `Another WeatherFront OBS Controller is running (PID ${existingPid}).`,
      );
      error.code = "EALREADYRUNNING";
      throw error;
    }
    try {
      unlinkSync(pidPath);
    } catch {
      /* continue */
    }
  }

  writeFileSync(pidPath, `${process.pid}\n`, { encoding: "utf8", flag: "wx" });
  return {
    pidPath,
    release() {
      try {
        if (existsSync(pidPath)) {
          const raw = readFileSync(pidPath, "utf8").trim();
          if (Number.parseInt(raw, 10) === process.pid) unlinkSync(pidPath);
        }
      } catch {
        /* ignore */
      }
    },
  };
}

export function readPidFile(pidPath) {
  if (!existsSync(pidPath)) return null;
  const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return { pid, alive: isProcessAlive(pid) };
}
