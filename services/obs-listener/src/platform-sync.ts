import type { ObsController } from "./obs-controller.js";
import type { EventLog } from "./event-log.js";
import type { ListenerConfig } from "./types.js";

const SYNC_INTERVAL_MS = 15_000;

export function startPlatformConfigSync(
  config: ListenerConfig,
  controller: ObsController,
  events: EventLog,
): () => void {
  if (!config.platformBaseUrl) {
    events.push(
      "listener",
      "PLATFORM_BASE_URL not set; using local OBS host/port/password only",
      "information",
    );
    return () => undefined;
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastUpdatedAt: string | null = null;

  const tick = async () => {
    if (stopped) {
      return;
    }

    try {
      const response = await fetch(`${config.platformBaseUrl}/api/broadcast/agent-config`, {
        headers: {
          Authorization: `Bearer ${config.listenerAuthToken}`,
        },
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`agent-config HTTP ${response.status}: ${text.slice(0, 160)}`);
      }

      const data = (await response.json()) as {
        ok?: boolean;
        obs_host?: string;
        obs_port?: number;
        obs_password?: string;
        obs_reconnect_ms?: number;
        updated_at?: string | null;
        error?: string;
      };

      if (!data.ok) {
        throw new Error(data.error || "agent-config failed");
      }

      // No browser-saved settings yet — keep local .env OBS values.
      if (!data.updated_at) {
        return;
      }

      if (data.updated_at === lastUpdatedAt) {
        return;
      }

      const applied = await controller.applyObsSettings({
        obsHost: (data.obs_host || "127.0.0.1").trim(),
        obsPort: typeof data.obs_port === "number" ? data.obs_port : 4455,
        obsPassword: typeof data.obs_password === "string" ? data.obs_password : "",
        obsReconnectMs:
          typeof data.obs_reconnect_ms === "number" ? data.obs_reconnect_ms : 3000,
      });

      lastUpdatedAt = data.updated_at || new Date().toISOString();
      if (applied) {
        events.push("listener", "Applied OBS settings from Broadcast Control Center", "success");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[obs-listener] platform sync:", message);
      events.push("listener", `Platform settings sync failed: ${message}`, "warning");
    }
  };

  const schedule = () => {
    timer = setTimeout(() => {
      void tick().finally(() => {
        if (!stopped) {
          schedule();
        }
      });
    }, SYNC_INTERVAL_MS);
  };

  void tick().finally(schedule);

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
