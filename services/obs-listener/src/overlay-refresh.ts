import type { ObsController } from "./obs-controller.js";
import type { EventLog } from "./event-log.js";
import type { ListenerConfig } from "./types.js";

/** Periodic hard-reload of OBS Browser Sources that point at /overlays/ pages. */
export function startOverlayBrowserRefresh(
  config: ListenerConfig,
  controller: ObsController,
  events: EventLog,
): () => void {
  const intervalMs = config.overlayBrowserRefreshMs;
  if (intervalMs <= 0) {
    events.push(
      "listener",
      "Overlay browser refresh disabled (OVERLAY_BROWSER_REFRESH_MS=0)",
      "information",
    );
    return () => undefined;
  }

  events.push(
    "listener",
    `Overlay browser sources will refresh every ${Math.round(intervalMs / 1000)}s`,
    "information",
  );

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) {
      return;
    }
    if (!controller.getSnapshot().obsConnected) {
      return;
    }

    inFlight = true;
    try {
      const refreshed = await controller.refreshOverlayBrowserSources();
      if (refreshed.length) {
        events.push(
          "source",
          `Scheduled overlay refresh: ${refreshed.join(", ")}`,
          "information",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[obs-listener] overlay refresh:", message);
      events.push("source", `Scheduled overlay refresh failed: ${message}`, "warning");
    } finally {
      inFlight = false;
    }
  };

  const schedule = () => {
    timer = setTimeout(() => {
      void tick().finally(() => {
        if (!stopped) {
          schedule();
        }
      });
    }, intervalMs);
  };

  // Wait one full interval before the first reload to avoid a startup flash.
  schedule();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
