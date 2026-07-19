import OBSWebSocket from "obs-websocket-js";
import type { EventLog } from "./event-log.js";
import type {
  BroadcastSnapshot,
  HealthStatus,
  ListenerConfig,
  ObsStatsSnapshot,
  SceneInfo,
  SourceInfo,
} from "./types.js";

const AUDIO_INPUT_KINDS = new Set([
  "wasapi_input_capture",
  "wasapi_output_capture",
  "coreaudio_input_capture",
  "coreaudio_output_capture",
  "pulse_input_capture",
  "pulse_output_capture",
  "alsa_input_capture",
  "browser_source",
  "ffmpeg_source",
  "vlc_source",
]);

function isAudioCapable(inputKind: string): boolean {
  const kind = inputKind.toLowerCase();
  return (
    AUDIO_INPUT_KINDS.has(kind) ||
    kind.includes("audio") ||
    kind.includes("wasapi") ||
    kind.includes("coreaudio") ||
    kind.includes("pulse")
  );
}

function classifySourceHealth(inputKind: string, visible: boolean): {
  health: HealthStatus;
  healthReason: string;
} {
  if (!visible) {
    return { health: "disabled", healthReason: "Source is hidden in the active scene" };
  }

  const kind = inputKind.toLowerCase();
  if (
    kind.includes("dshow") ||
    kind.includes("av_capture") ||
    kind.includes("v4l2") ||
    kind.includes("game_capture") ||
    kind.includes("window_capture") ||
    kind.includes("monitor_capture")
  ) {
    return {
      health: "unknown",
      healthReason: "Capture device present in OBS; frame-level health unavailable via WebSocket",
    };
  }

  if (kind.includes("browser") || kind.includes("ffmpeg") || kind.includes("vlc") || kind.includes("media")) {
    return {
      health: "unknown",
      healthReason: "Media/browser source present; stream health not exposed by OBS WebSocket",
    };
  }

  return { health: "healthy", healthReason: "Source exists and is visible in the active scene" };
}

export class ObsController {
  private readonly obs = new OBSWebSocket();
  private connected = false;
  private connecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private lastError: string | null = null;
  private connectedAt: string | null = null;
  private updatedAt = new Date().toISOString();
  private currentProgramScene: string | null = null;
  private streamingActive = false;
  private recordingActive = false;
  private scenes: SceneInfo[] = [];
  private sources: SourceInfo[] = [];
  private stats: ObsStatsSnapshot = emptyStats();

  constructor(
    private config: ListenerConfig,
    private readonly events: EventLog,
  ) {
    this.obs.on("ConnectionClosed", () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.connecting = false;
      this.connectedAt = null;
      this.touch();
      if (wasConnected) {
        this.events.push("obs", "OBS disconnected", "warning");
      }
      this.scheduleReconnect();
    });

    this.obs.on("ConnectionError", (error) => {
      this.lastError = error instanceof Error ? error.message : "OBS connection error";
      this.events.push("obs", this.lastError, "error");
      this.touch();
    });

    this.obs.on("CurrentProgramSceneChanged", (event) => {
      this.currentProgramScene = event.sceneName;
      this.events.push("scene", `Program scene changed to ${event.sceneName}`, "information");
      void this.refreshSources().catch((error) => this.captureError("refreshSources", error));
      this.touch();
    });

    this.obs.on("SceneListChanged", () => {
      void this.refreshScenes().catch((error) => this.captureError("refreshScenes", error));
    });

    this.obs.on("StreamStateChanged", (event) => {
      this.streamingActive = Boolean(event.outputActive);
      this.events.push(
        "stream",
        event.outputActive ? "Streaming started" : "Streaming stopped",
        event.outputActive ? "success" : "information",
      );
      this.touch();
    });

    this.obs.on("RecordStateChanged", (event) => {
      this.recordingActive = Boolean(event.outputActive);
      this.events.push(
        "recording",
        event.outputActive ? "Recording started" : "Recording stopped",
        event.outputActive ? "success" : "information",
      );
      this.touch();
    });

    this.obs.on("SceneItemEnableStateChanged", () => {
      void this.refreshSources().catch((error) => this.captureError("refreshSources", error));
    });

    this.obs.on("InputMuteStateChanged", () => {
      void this.refreshSources().catch((error) => this.captureError("refreshSources", error));
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      await this.obs.disconnect();
    } catch {
      /* ignore */
    }
    this.connected = false;
    this.connecting = false;
  }

  async reconnect(): Promise<void> {
    this.events.push("listener", "Manual reconnect requested", "information");
    try {
      await this.obs.disconnect();
    } catch {
      /* ignore */
    }
    this.connected = false;
    await this.connect();
  }

  /**
   * Apply OBS endpoint settings from the platform (browser-saved settings).
   * Reconnects when host, port, password, or reconnect interval change.
   */
  async applyObsSettings(next: {
    obsHost: string;
    obsPort: number;
    obsPassword: string;
    obsReconnectMs: number;
  }): Promise<boolean> {
    const changed =
      this.config.obsHost !== next.obsHost ||
      this.config.obsPort !== next.obsPort ||
      this.config.obsPassword !== next.obsPassword ||
      this.config.obsReconnectMs !== next.obsReconnectMs;

    this.config = {
      ...this.config,
      obsHost: next.obsHost,
      obsPort: next.obsPort,
      obsPassword: next.obsPassword,
      obsReconnectMs: next.obsReconnectMs,
    };

    if (!changed) {
      return false;
    }

    this.events.push("listener", "OBS settings updated from platform", "information");
    await this.reconnect();
    return true;
  }

  getSnapshot(): BroadcastSnapshot {
    return {
      listenerConnected: true,
      listenerUpdatedAt: this.updatedAt,
      obsConnected: this.connected,
      obsConnecting: this.connecting,
      obsLastError: this.lastError,
      obsConnectedAt: this.connectedAt,
      currentProgramScene: this.currentProgramScene,
      streamingActive: this.streamingActive,
      recordingActive: this.recordingActive,
      scenes: [...this.scenes],
      sources: this.sources.map((source) => ({ ...source })),
      stats: { ...this.stats },
      events: this.events.list(50),
    };
  }

  async refreshAll(): Promise<BroadcastSnapshot> {
    if (!this.connected) {
      return this.getSnapshot();
    }
    await Promise.all([
      this.refreshScenes(),
      this.refreshStreamRecord(),
      this.refreshStats(),
    ]);
    await this.refreshSources();
    this.touch();
    return this.getSnapshot();
  }

  async activateScene(sceneName: string): Promise<void> {
    this.assertConnected();
    const name = sanitizeName(sceneName, "scene");
    await this.obs.call("SetCurrentProgramScene", { sceneName: name });
    this.currentProgramScene = name;
    this.events.push("scene", `Activated scene ${name}`, "success");
    await this.refreshSources();
    this.touch();
  }

  async setSourceVisibility(sourceName: string, visible: boolean): Promise<void> {
    this.assertConnected();
    const name = sanitizeName(sourceName, "source");
    const sceneName = this.currentProgramScene;
    if (!sceneName) {
      throw new Error("No active program scene");
    }

    const item = await this.findSceneItem(sceneName, name);
    if (!item) {
      throw new Error(`Source not found in active scene: ${name}`);
    }

    await this.obs.call("SetSceneItemEnabled", {
      sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemEnabled: visible,
    });
    this.events.push(
      "source",
      `${visible ? "Showed" : "Hid"} source ${name}`,
      "information",
    );
    await this.refreshSources();
    this.touch();
  }

  async setSourceMute(sourceName: string, muted: boolean): Promise<void> {
    this.assertConnected();
    const name = sanitizeName(sourceName, "source");
    await this.obs.call("SetInputMute", { inputName: name, inputMuted: muted });
    this.events.push(
      "audio",
      `${muted ? "Muted" : "Unmuted"} source ${name}`,
      "information",
    );
    await this.refreshSources();
    this.touch();
  }

  /**
   * Force an OBS Browser Source to reload (fixes black VDO.Ninja viewers after publisher reconnect).
   */
  async refreshBrowserSource(sourceName: string): Promise<void> {
    this.assertConnected();
    const name = sanitizeName(sourceName, "source");

    try {
      await this.obs.call("PressInputPropertiesButton", {
        inputName: name,
        propertyName: "refreshnocache",
      });
      this.events.push("source", `Refreshed browser source ${name}`, "success");
      this.touch();
      return;
    } catch {
      /* fall through to URL cache-bust */
    }

    const current = await this.obs.call("GetInputSettings", { inputName: name });
    const settings = (current.inputSettings || {}) as Record<string, unknown>;
    const url = typeof settings.url === "string" ? settings.url : "";
    if (!url) {
      throw new Error(`Source is not a refreshable browser source: ${name}`);
    }

    const next = new URL(url);
    next.searchParams.set("_hsc_refresh", String(Date.now()));
    await this.obs.call("SetInputSettings", {
      inputName: name,
      inputSettings: { url: next.toString() },
      overlay: true,
    });
    this.events.push("source", `Cache-busted browser source URL for ${name}`, "success");
    this.touch();
  }

  /**
   * Refresh every visible browser source whose name matches any of the given substrings.
   */
  async refreshBrowserSourcesByMatchers(matchers: string[]): Promise<string[]> {
    this.assertConnected();
    const needles = matchers.map((m) => m.trim().toLowerCase()).filter(Boolean);
    if (!needles.length) {
      return [];
    }

    await this.refreshSources();
    const refreshed: string[] = [];
    for (const source of this.sources) {
      const nameLower = source.name.toLowerCase();
      if (!needles.some((needle) => nameLower.includes(needle))) {
        continue;
      }
      const kind = String(source.sourceType || "").toLowerCase();
      if (kind && !kind.includes("browser") && !kind.includes("unknown")) {
        // Still try — naming is more reliable than kind in some OBS builds.
      }
      try {
        await this.refreshBrowserSource(source.name);
        refreshed.push(source.name);
      } catch (error) {
        this.captureError(`refreshBrowserSource(${source.name})`, error);
      }
    }
    return refreshed;
  }

  /**
   * Hard-reload every OBS Browser Source whose URL points at an /overlays/ page.
   * Scans all inputs (not only the active scene) so nested/global overlays stay fresh.
   */
  async refreshOverlayBrowserSources(): Promise<string[]> {
    this.assertConnected();
    const list = await this.obs.call("GetInputList");
    const refreshed: string[] = [];
    const seen = new Set<string>();

    for (const input of list.inputs ?? []) {
      const name = String(input.inputName ?? "").trim();
      const kind = String(input.inputKind ?? "").toLowerCase();
      if (!name || seen.has(name)) {
        continue;
      }
      if (kind && !kind.includes("browser")) {
        continue;
      }

      let url = "";
      try {
        const current = await this.obs.call("GetInputSettings", { inputName: name });
        const settings = (current.inputSettings || {}) as Record<string, unknown>;
        url = typeof settings.url === "string" ? settings.url : "";
      } catch {
        continue;
      }

      if (!isOverlayBrowserUrl(url)) {
        continue;
      }

      seen.add(name);
      try {
        await this.refreshBrowserSource(name);
        refreshed.push(name);
      } catch (error) {
        this.captureError(`refreshOverlayBrowserSources(${name})`, error);
      }
    }

    return refreshed;
  }

  /**
   * Read current OBS stream service (never returns the stream key).
   */
  async getStreamServiceInfo(): Promise<{
    streamServiceType: string;
    server: string | null;
    isCustomRtmp: boolean;
  }> {
    this.assertConnected();
    const current = await this.obs.call("GetStreamServiceSettings");
    const type = String(current.streamServiceType || "");
    const settings =
      current.streamServiceSettings && typeof current.streamServiceSettings === "object"
        ? (current.streamServiceSettings as Record<string, unknown>)
        : {};
    const server = typeof settings.server === "string" ? settings.server : null;
    return {
      streamServiceType: type,
      server,
      isCustomRtmp: type === "rtmp_custom",
    };
  }

  /**
   * Point OBS at a custom RTMP destination (e.g. YouTube Live ingest).
   * Must be called while not actively streaming.
   * Throws if OBS does not report rtmp_custom afterward (YouTube service would open Manage Broadcast).
   */
  async setCustomRtmpDestination(server: string, key: string): Promise<{
    streamServiceType: string;
    server: string;
    verified: true;
  }> {
    this.assertConnected();
    const parsed = parseCustomRtmpDestination(server, key);
    await this.refreshStreamRecord();
    if (this.streamingActive) {
      // Stop first so we can safely switch off YouTube service → Custom.
      try {
        await this.obs.call("StopStream");
        await this.refreshStreamRecord();
      } catch {
        /* may already be stopped */
      }
      if (this.streamingActive) {
        throw new Error("Cannot change OBS stream destination while streaming is active");
      }
    }

    await this.obs.call("SetStreamServiceSettings", {
      streamServiceType: "rtmp_custom",
      streamServiceSettings: {
        server: parsed.server,
        key: parsed.key,
        use_auth: false,
      },
    });

    // Small settle — OBS sometimes reports the previous service type immediately.
    await new Promise((r) => setTimeout(r, 400));

    const info = await this.getStreamServiceInfo();
    if (!info.isCustomRtmp) {
      throw new Error(
        `OBS stream service is "${info.streamServiceType || "unknown"}" after set — expected Custom RTMP (rtmp_custom). ` +
          "Close any YouTube Manage Broadcast dialog, set Settings → Stream → Custom, then retry.",
      );
    }

    const appliedServer = info.server || parsed.server;
    this.events.push(
      "stream",
      `OBS stream destination verified custom RTMP (${appliedServer})`,
      "success",
    );
    this.touch();
    return {
      streamServiceType: info.streamServiceType,
      server: appliedServer,
      verified: true,
    };
  }

  /**
   * Start streaming only when OBS is on Custom RTMP — avoids YouTube Manage Broadcast spam.
   */
  async startStream(): Promise<{ streamingActive: boolean; streamServiceType: string }> {
    this.assertConnected();
    await this.refreshStreamRecord();
    if (this.streamingActive) {
      const info = await this.getStreamServiceInfo();
      return { streamingActive: true, streamServiceType: info.streamServiceType };
    }

    const info = await this.getStreamServiceInfo();
    if (!info.isCustomRtmp) {
      throw new Error(
        `Refusing StartStream: OBS service is "${info.streamServiceType || "unknown"}" (not Custom RTMP). ` +
          "That opens Manage Broadcast. Apply YouTube RTMP via the platform first.",
      );
    }

    await this.obs.call("StartStream");
    this.events.push("stream", "Start stream requested (custom RTMP verified)", "information");

    // Poll briefly for outputActive — do not call StartStream again here.
    for (let i = 0; i < 8; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      await this.refreshStreamRecord();
      if (this.streamingActive) break;
    }

    this.touch();
    if (!this.streamingActive) {
      throw new Error(
        "OBS StartStream was sent (Custom RTMP) but streaming did not become active. " +
          "Dismiss any OBS dialogs on the home PC and retry Go Live once.",
      );
    }

    return { streamingActive: true, streamServiceType: info.streamServiceType };
  }

  async stopStream(): Promise<void> {
    this.assertConnected();
    await this.obs.call("StopStream");
    this.events.push("stream", "Stop stream requested", "warning");
    await this.refreshStreamRecord();
    this.touch();
  }
  async startRecord(): Promise<void> {
    this.assertConnected();
    await this.obs.call("StartRecord");
    this.events.push("recording", "Start recording requested", "information");
    await this.refreshStreamRecord();
    this.touch();
  }

  async stopRecord(): Promise<void> {
    this.assertConnected();
    await this.obs.call("StopRecord");
    this.events.push("recording", "Stop recording requested", "warning");
    await this.refreshStreamRecord();
    this.touch();
  }

  async getSourceThumbnail(sourceName: string): Promise<string | null> {
    this.assertConnected();
    const name = sanitizeName(sourceName, "source");
    try {
      const result = await this.obs.call("GetSourceScreenshot", {
        sourceName: name,
        imageFormat: "jpg",
        imageWidth: 320,
        imageHeight: 180,
        imageCompressionQuality: 60,
      });
      return result.imageData ?? null;
    } catch (error) {
      this.captureError("getSourceThumbnail", error);
      return null;
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting || this.connected) {
      return;
    }

    this.connecting = true;
    this.events.push("listener", "Connecting to OBS…", "information");
    this.touch();

    const url = `ws://${this.config.obsHost}:${this.config.obsPort}`;
    try {
      await this.obs.connect(url, this.config.obsPassword || undefined);
      this.connected = true;
      this.connecting = false;
      this.lastError = null;
      this.connectedAt = new Date().toISOString();
      this.events.push("obs", "OBS connected", "success");
      await this.refreshAll();
    } catch (error) {
      this.connected = false;
      this.connecting = false;
      this.lastError = error instanceof Error ? error.message : "Failed to connect to OBS";
      this.events.push("obs", this.lastError, "error");
      this.touch();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    this.events.push("listener", "Scheduling OBS reconnect", "warning");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.config.obsReconnectMs);
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error(this.lastError || "OBS is not connected");
    }
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }

  private captureError(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[obs-listener] ${context}:`, message);
    this.lastError = message;
    this.events.push("listener", `${context}: ${message}`, "error");
  }

  private async refreshScenes(): Promise<void> {
    const result = await this.obs.call("GetSceneList");
    this.currentProgramScene = result.currentProgramSceneName;
    this.scenes = (result.scenes ?? [])
      .map((scene, index) => ({
        name: String(scene.sceneName ?? ""),
        sceneIndex: typeof scene.sceneIndex === "number" ? scene.sceneIndex : index,
      }))
      .filter((scene) => scene.name.length > 0)
      // OBS WebSocket lists sceneIndex 0 at the bottom of the UI list.
      // Sort descending so buttons match top-to-bottom OBS order.
      .sort((a, b) => b.sceneIndex - a.sceneIndex);
  }

  private async refreshStreamRecord(): Promise<void> {
    const [stream, record] = await Promise.all([
      this.obs.call("GetStreamStatus"),
      this.obs.call("GetRecordStatus"),
    ]);
    this.streamingActive = Boolean(stream.outputActive);
    this.recordingActive = Boolean(record.outputActive);
    this.stats.streamTimecode = stream.outputTimecode ?? null;
    this.stats.recordTimecode = record.outputTimecode ?? null;
    this.stats.streamingActive = this.streamingActive;
    this.stats.recordingActive = this.recordingActive;
  }

  private async refreshStats(): Promise<void> {
    try {
      const [version, stats] = await Promise.all([
        this.obs.call("GetVersion"),
        this.obs.call("GetStats"),
      ]);

      this.stats = {
        obsVersion: version.obsVersion ?? null,
        obsWebSocketVersion: version.obsWebSocketVersion ?? null,
        currentProgramScene: this.currentProgramScene,
        streamingActive: this.streamingActive,
        recordingActive: this.recordingActive,
        cpuUsage: numberOrNull(stats.cpuUsage),
        memoryUsage: numberOrNull(stats.memoryUsage),
        activeFps: numberOrNull(stats.activeFps),
        averageFrameTime: numberOrNull(stats.averageFrameRenderTime),
        renderTotalFrames: numberOrNull(stats.renderTotalFrames),
        renderSkippedFrames: numberOrNull(stats.renderSkippedFrames),
        outputSkippedFrames: numberOrNull(stats.outputSkippedFrames),
        outputTotalFrames: numberOrNull(stats.outputTotalFrames),
        streamTimecode: this.stats.streamTimecode,
        recordTimecode: this.stats.recordTimecode,
        available: true,
      };
    } catch (error) {
      this.captureError("refreshStats", error);
      this.stats = { ...emptyStats(), currentProgramScene: this.currentProgramScene };
    }
  }

  private async refreshSources(): Promise<void> {
    const sceneName = this.currentProgramScene;
    if (!sceneName) {
      this.sources = [];
      return;
    }

    const list = await this.obs.call("GetSceneItemList", { sceneName });
    const now = new Date().toISOString();
    const sources: SourceInfo[] = [];

    for (const item of list.sceneItems ?? []) {
      const name = String(item.sourceName ?? "");
      if (!name) {
        continue;
      }

      const sourceType = String(item.inputKind ?? item.sourceType ?? "unknown");
      const visible = Boolean(item.sceneItemEnabled);
      let muted: boolean | null = null;
      let canMute = false;

      if (isAudioCapable(sourceType) || item.inputKind) {
        try {
          const mute = await this.obs.call("GetInputMute", { inputName: name });
          muted = Boolean(mute.inputMuted);
          canMute = true;
        } catch {
          canMute = false;
          muted = null;
        }
      }

      const { health, healthReason } = classifySourceHealth(sourceType, visible);

      sources.push({
        name,
        sceneName,
        sourceType,
        visible,
        muted,
        canMute,
        health,
        healthReason,
        lastUpdatedAt: now,
        width: null,
        height: null,
        fps: null,
        thumbnailDataUrl: null,
      });
    }

    this.sources = sources;
  }

  private async findSceneItem(
    sceneName: string,
    sourceName: string,
  ): Promise<{ sceneItemId: number } | null> {
    const list = await this.obs.call("GetSceneItemList", { sceneName });
    for (const item of list.sceneItems ?? []) {
      if (String(item.sourceName) === sourceName && typeof item.sceneItemId === "number") {
        return { sceneItemId: item.sceneItemId };
      }
    }
    return null;
  }
}

function emptyStats(): ObsStatsSnapshot {
  return {
    obsVersion: null,
    obsWebSocketVersion: null,
    currentProgramScene: null,
    streamingActive: false,
    recordingActive: false,
    cpuUsage: null,
    memoryUsage: null,
    activeFps: null,
    averageFrameTime: null,
    renderTotalFrames: null,
    renderSkippedFrames: null,
    outputSkippedFrames: null,
    outputTotalFrames: null,
    streamTimecode: null,
    recordTimecode: null,
    available: false,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isOverlayBrowserUrl(url: string): boolean {
  const raw = String(url || "").trim();
  if (!raw) {
    return false;
  }
  try {
    return new URL(raw).pathname.toLowerCase().includes("/overlays/");
  } catch {
    return raw.toLowerCase().includes("/overlays/");
  }
}

/** Validate custom RTMP server URL + stream key for SetStreamServiceSettings. */
export function parseCustomRtmpDestination(server: string, key: string): {
  server: string;
  key: string;
} {
  const normalizedServer = String(server || "").trim();
  const normalizedKey = String(key || "").trim();
  if (!normalizedServer) {
    throw new Error("RTMP server URL is required");
  }
  if (!/^rtmps?:\/\//i.test(normalizedServer)) {
    throw new Error("RTMP server URL must start with rtmp:// or rtmps://");
  }
  if (!normalizedKey) {
    throw new Error("RTMP stream key is required");
  }
  if (normalizedKey.length > 512) {
    throw new Error("RTMP stream key is too long");
  }
  return { server: normalizedServer, key: normalizedKey };
}

export function sanitizeName(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} name is required`);
  }
  if (trimmed.length > 256) {
    throw new Error(`${label} name is too long`);
  }
  if (/[\u0000-\u001f]/.test(trimmed)) {
    throw new Error(`${label} name contains invalid characters`);
  }
  return trimmed;
}
