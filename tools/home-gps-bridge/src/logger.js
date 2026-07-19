import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_ROTATED = 3;

function sanitizeMessage(message, token) {
  let text = String(message);
  if (token && token.length >= 8) {
    text = text.split(token).join("[redacted-token]");
  }
  text = text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  text = text.replace(/Authorization:\s*\S+/gi, "Authorization: [redacted]");
  return text;
}

export function createLogger({ logDir, level = "info", token = "" }) {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const logPath = join(logDir, "bridge.log");
  let stream = createWriteStream(logPath, { flags: "a" });
  const minLevel = LEVELS[level] ?? LEVELS.info;

  function rotateIfNeeded() {
    try {
      if (!existsSync(logPath)) {
        return;
      }
      const size = statSync(logPath).size;
      if (size < MAX_LOG_BYTES) {
        return;
      }
      stream.end();
      for (let i = MAX_ROTATED - 1; i >= 1; i -= 1) {
        const from = join(logDir, `bridge.log.${i}`);
        const to = join(logDir, `bridge.log.${i + 1}`);
        if (existsSync(from)) {
          try {
            renameSync(from, to);
          } catch {
            // ignore rotation races
          }
        }
      }
      try {
        renameSync(logPath, join(logDir, "bridge.log.1"));
      } catch {
        // ignore
      }
      stream = createWriteStream(logPath, { flags: "a" });
    } catch {
      // logging must never crash the bridge
    }
  }

  function write(levelName, message, meta) {
    if ((LEVELS[levelName] ?? 99) < minLevel) {
      return;
    }
    rotateIfNeeded();
    const safe = sanitizeMessage(message, token);
    const metaText =
      meta && Object.keys(meta).length > 0
        ? ` ${sanitizeMessage(JSON.stringify(meta), token)}`
        : "";
    const line = `${new Date().toISOString()} [${levelName.toUpperCase()}] ${safe}${metaText}\n`;
    try {
      stream.write(line);
    } catch {
      // ignore
    }
    if (levelName === "error" || levelName === "warn") {
      process.stderr.write(line);
    } else if (levelName === "info") {
      process.stdout.write(line);
    }
  }

  return {
    debug: (msg, meta) => write("debug", msg, meta),
    info: (msg, meta) => write("info", msg, meta),
    warn: (msg, meta) => write("warn", msg, meta),
    error: (msg, meta) => write("error", msg, meta),
    close: () =>
      new Promise((resolve) => {
        stream.end(() => resolve());
      }),
  };
}
