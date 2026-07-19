import { loadConfig, loadDotEnv } from "./config.js";
import { EventLog } from "./event-log.js";
import { createHttpServer } from "./http-server.js";
import { ObsController } from "./obs-controller.js";
import { startOverlayBrowserRefresh } from "./overlay-refresh.js";
import { startPlatformConfigSync } from "./platform-sync.js";

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const events = new EventLog();
  events.push("listener", "OBS listener starting", "information");

  const controller = new ObsController(config, events);
  const server = createHttpServer(config, controller);
  const stopSync = startPlatformConfigSync(config, controller, events);
  const stopOverlayRefresh = startOverlayBrowserRefresh(config, controller, events);

  server.listen(config.listenerPort, config.listenerHost, () => {
    console.log(
      `[obs-listener] listening on http://${config.listenerHost}:${config.listenerPort}`,
    );
  });

  await controller.start();

  const shutdown = async () => {
    console.log("[obs-listener] shutting down…");
    stopOverlayRefresh();
    stopSync();
    await controller.stop();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error) => {
  console.error("[obs-listener] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
