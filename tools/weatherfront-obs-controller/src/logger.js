import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { sanitizeLogMessage } from "./redaction.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_ROTATED = 3;

export function createLogger({ logDir, level = "info", secrets = [] }) {
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "controller.log");
  let stream = createWriteStream(logPath, { flags: "a" });
  const minLevel = LEVELS[level] ?? LEVELS.info;

  function rotateIfNeeded() {
    try {
      if (!existsSync(logPath)) return;
      if (statSync(logPath).size < MAX_LOG_BYTES) return;
      stream.end();
      for (let i = MAX_ROTATED - 1; i >= 1; i -= 1) {
        const from = join(logDir, `controller.log.${i}`);
        const to = join(logDir, `controller.log.${i + 1}`);
        if (existsSync(from)) {
          try {
            renameSync(from, to);
          } catch {
            /* ignore */
          }
        }
      }
      try {
        renameSync(logPath, join(logDir, "controller.log.1"));
      } catch {
        /* ignore */
      }
      stream = createWriteStream(logPath, { flags: "a" });
    } catch {
      /* ignore */
    }
  }

  function write(levelName, message, meta) {
    if ((LEVELS[levelName] ?? 99) < minLevel) return;
    rotateIfNeeded();
    const safe = sanitizeLogMessage(message, secrets);
    const metaText =
      meta && Object.keys(meta).length
        ? ` ${sanitizeLogMessage(JSON.stringify(meta), secrets)}`
        : "";
    const line = `${new Date().toISOString()} [${levelName.toUpperCase()}] ${safe}${metaText}\n`;
    try {
      stream.write(line);
    } catch {
      /* ignore */
    }
    if (levelName === "error" || levelName === "warn") process.stderr.write(line);
    else if (levelName === "info") process.stdout.write(line);
  }

  return {
    debug: (m, meta) => write("debug", m, meta),
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
    close: () =>
      new Promise((resolve) => {
        stream.end(() => resolve());
      }),
  };
}
