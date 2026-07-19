import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import OBSWebSocket from "obs-websocket-js";

export function parseObsWebsocketUrl(urlString) {
  const u = new URL(urlString);
  return {
    address: u.hostname,
    port: Number(u.port || 4455),
    protocol: u.protocol,
  };
}

export function validateObsConfig(config) {
  const errors = [];
  if (config.obsWebsocketEnabled) {
    try {
      parseObsWebsocketUrl(config.obsWebsocketUrl);
    } catch {
      errors.push("Invalid OBS_WEBSOCKET_URL");
    }
    if (!config.obsSourceName) errors.push("OBS_SOURCE_NAME required when OBS enabled");
  }
  return { ok: errors.length === 0, errors };
}

export function createObsClient({ config, logger }) {
  const obs = new OBSWebSocket();
  let connected = false;
  let lastError = null;
  let sceneOk = null;
  let sourceOk = null;
  let sourceVisible = null;

  async function connect() {
    if (!config.obsWebsocketEnabled) return false;
    const { address, port } = parseObsWebsocketUrl(config.obsWebsocketUrl);
    try {
      await obs.connect(`ws://${address}:${port}`, config.obsWebsocketPassword || undefined);
      connected = true;
      lastError = null;
      logger?.info?.("Connected to OBS WebSocket");
      await refresh();
      return true;
    } catch (error) {
      connected = false;
      lastError = error.message;
      logger?.warn?.(`OBS WebSocket connect failed: ${error.message}`);
      return false;
    }
  }

  async function refresh() {
    if (!connected) return;
    try {
      if (config.obsSceneName) {
        const { scenes } = await obs.call("GetSceneList");
        sceneOk = scenes.some((s) => s.sceneName === config.obsSceneName);
      } else {
        sceneOk = null;
      }

      const { inputs } = await obs.call("GetInputList");
      const match = inputs.find((i) => i.inputName === config.obsSourceName);
      sourceOk = Boolean(match);

      if (match && config.obsSceneName) {
        try {
          const item = await obs.call("GetSceneItemId", {
            sceneName: config.obsSceneName,
            sourceName: config.obsSourceName,
          });
          const enabled = await obs.call("GetSceneItemEnabled", {
            sceneName: config.obsSceneName,
            sceneItemId: item.sceneItemId,
          });
          sourceVisible = enabled.sceneItemEnabled;
        } catch {
          sourceVisible = null;
        }
      }
      lastError = null;
    } catch (error) {
      lastError = error.message;
    }
  }

  async function ensureObsRunning() {
    if (!config.startObsIfMissing) return false;
    if (connected) return true;
    const exe = config.obsExecutablePath;
    if (!exe || !existsSync(exe)) {
      lastError = "OBS executable not found for START_OBS_IF_MISSING";
      return false;
    }
    // Avoid duplicate: try connect first
    const ok = await connect();
    if (ok) return true;
    logger?.info?.("Starting OBS process");
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    await new Promise((r) => setTimeout(r, 5000));
    return connect();
  }

  /**
   * Create/update Window Capture input — best-effort via OBS WS.
   * Window Capture settings are platform-specific; may require manual finish.
   */
  async function setupWeatherfrontSource() {
    if (!connected) await connect();
    if (!connected) throw new Error("OBS not connected");

    const sceneName = config.obsSceneName;
    if (!sceneName) throw new Error("OBS_SCENE_NAME is required for obs:setup");

    const { inputs } = await obs.call("GetInputList");
    const exists = inputs.some((i) => i.inputName === config.obsSourceName);

    if (!exists) {
      await obs.call("CreateInput", {
        sceneName,
        inputName: config.obsSourceName,
        inputKind: "window_capture",
        inputSettings: {
          window: `${config.windowTitle}:Chrome_WidgetWin_1:chrome.exe`,
          capture_cursor: false,
        },
        sceneItemEnabled: true,
      });
      logger?.info?.(`Created OBS source ${config.obsSourceName} (verify window match in OBS)`);
    } else {
      try {
        await obs.call("SetInputSettings", {
          inputName: config.obsSourceName,
          inputSettings: {
            window: `${config.windowTitle}:Chrome_WidgetWin_1:chrome.exe`,
            capture_cursor: false,
          },
          overlay: true,
        });
        logger?.info?.(`Updated OBS source ${config.obsSourceName} settings (verify in OBS)`);
      } catch (error) {
        logger?.warn?.(
          `Could not update Window Capture settings automatically: ${error.message}. Configure manually.`,
        );
      }
    }
    await refresh();
    return getSnapshot();
  }

  async function disconnect() {
    try {
      await obs.disconnect();
    } catch {
      /* ignore */
    }
    connected = false;
  }

  function getSnapshot() {
    return {
      enabled: config.obsWebsocketEnabled,
      connected,
      sceneName: config.obsSceneName || null,
      sourceName: config.obsSourceName,
      sceneOk,
      sourceOk,
      sourceVisible,
      lastError,
    };
  }

  return {
    connect,
    disconnect,
    refresh,
    ensureObsRunning,
    setupWeatherfrontSource,
    getSnapshot,
  };
}
