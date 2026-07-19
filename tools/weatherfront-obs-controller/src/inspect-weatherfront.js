import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { listToolbarCandidates, filterFollowCandidates } from "./follow-control.js";
import { applyWindowTitle } from "./title-keeper.js";

/**
 * Interactive helper: open WeatherFront, wait for login, list toolbar candidates.
 * Does not dump cookies, tokens, or full DOM.
 */
async function main() {
  const config = loadConfig();
  const logger = createLogger({
    logDir: config.runtimePaths.logs,
    level: "info",
    secrets: [config.controlToken],
  });

  logger.info("Opening WeatherFront for inspection. Log in if prompted, then press Enter in this terminal.");
  const context = await chromium.launchPersistentContext(config.runtimePaths.browserProfile, {
    headless: false,
    viewport: { width: config.windowWidth, height: config.windowHeight },
    args: [
      `--app=${config.weatherfrontUrl}`,
      `--window-size=${config.windowWidth},${config.windowHeight}`,
    ],
  });

  const page = context.pages()[0] || (await context.newPage());
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  } catch {
    await page.goto(config.weatherfrontUrl, { waitUntil: "domcontentloaded" });
  }
  await applyWindowTitle(page, config.windowTitle);

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdout.write("\n>>> Press Enter after WeatherFront is logged in and the map is visible...\n");
    process.stdin.once("data", () => resolve());
  });

  const candidates = await listToolbarCandidates(page);
  const followLike = filterFollowCandidates(
    candidates.map((c) => ({
      ...c,
      name: c.name || c.ariaLabel || c.title,
      ariaLabel: c.ariaLabel,
      title: c.title,
      testId: c.testId,
    })),
  );

  const out = {
    capturedAt: new Date().toISOString(),
    urlHost: (() => {
      try {
        return new URL(page.url()).host;
      } catch {
        return null;
      }
    })(),
    candidateCount: candidates.length,
    followLikeCount: followLike.length,
    followLike,
    candidates: candidates.slice(0, 40),
  };

  const jsonPath = join(config.runtimePaths.screenshots, "toolbar-candidates.json");
  writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  const shotPath = join(config.runtimePaths.screenshots, "weatherfront-inspect.png");
  await page.screenshot({ path: shotPath, fullPage: false });

  logger.info(`Saved candidates: ${jsonPath}`);
  logger.info(`Saved screenshot: ${shotPath}`);
  console.log(JSON.stringify({ followLike, candidateCount: candidates.length }, null, 2));

  await context.close();
  await logger.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
