import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createObsClient, validateObsConfig } from "./obs-client.js";

/**
 * Explicit OBS setup — creates/updates only the configured WeatherFront Radar source.
 * Never runs during normal npm start.
 */
async function main() {
  const config = loadConfig();
  const logger = createLogger({
    logDir: config.runtimePaths.logs,
    level: "info",
    secrets: [config.obsWebsocketPassword, config.controlToken],
  });

  const check = validateObsConfig({ ...config, obsWebsocketEnabled: true });
  if (!config.obsSceneName) {
    console.error("Set OBS_SCENE_NAME in .env before running obs:setup");
    process.exitCode = 1;
    return;
  }
  if (!check.ok && check.errors.length) {
    // force-enabled path may still be ok
  }

  console.log("Intended OBS configuration:");
  console.log(`  Scene:  ${config.obsSceneName}`);
  console.log(`  Source: ${config.obsSourceName}`);
  console.log(`  Type:   Window Capture`);
  console.log(`  Title:  ${config.windowTitle}`);
  console.log(`  Match:  Window title must match`);
  console.log(`  Cursor: Off`);
  console.log("");
  console.log("Proceeding to create/update via OBS WebSocket...");

  const client = createObsClient({
    config: { ...config, obsWebsocketEnabled: true },
    logger,
  });

  try {
    const snap = await client.setupWeatherfrontSource();
    console.log("Result:", JSON.stringify(snap, null, 2));
    console.log("");
    console.log("If the captured window is wrong, open OBS → source properties and select:");
    console.log(`  ${config.windowTitle}`);
    console.log("Window Match Priority: Window title must match");
  } catch (error) {
    console.error(`obs:setup failed: ${error.message}`);
    console.error("Configure the Window Capture source manually in OBS instead.");
    process.exitCode = 1;
  } finally {
    await client.disconnect();
    await logger.close();
  }
}

main();
