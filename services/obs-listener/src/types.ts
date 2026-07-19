export type HealthStatus =
  | "healthy"
  | "stale"
  | "disconnected"
  | "disabled"
  | "unknown"
  | "reconnecting"
  | "unavailable";

export type EventSeverity = "information" | "success" | "warning" | "error";

export interface ListenerEvent {
  id: string;
  timestamp: string;
  category: string;
  message: string;
  severity: EventSeverity;
}

export interface SceneInfo {
  name: string;
  sceneIndex: number;
}

export interface SourceInfo {
  name: string;
  sceneName: string;
  sourceType: string;
  visible: boolean;
  muted: boolean | null;
  canMute: boolean;
  health: HealthStatus;
  healthReason: string;
  lastUpdatedAt: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  thumbnailDataUrl: string | null;
}

export interface ObsStatsSnapshot {
  obsVersion: string | null;
  obsWebSocketVersion: string | null;
  currentProgramScene: string | null;
  streamingActive: boolean;
  recordingActive: boolean;
  cpuUsage: number | null;
  memoryUsage: number | null;
  activeFps: number | null;
  averageFrameTime: number | null;
  renderTotalFrames: number | null;
  renderSkippedFrames: number | null;
  outputSkippedFrames: number | null;
  outputTotalFrames: number | null;
  streamTimecode: string | null;
  recordTimecode: string | null;
  available: boolean;
}

export interface BroadcastSnapshot {
  listenerConnected: true;
  listenerUpdatedAt: string;
  obsConnected: boolean;
  obsConnecting: boolean;
  obsLastError: string | null;
  obsConnectedAt: string | null;
  currentProgramScene: string | null;
  streamingActive: boolean;
  recordingActive: boolean;
  scenes: SceneInfo[];
  sources: SourceInfo[];
  stats: ObsStatsSnapshot;
  events: ListenerEvent[];
}

export interface ListenerConfig {
  listenerHost: string;
  listenerPort: number;
  listenerAuthToken: string;
  obsHost: string;
  obsPort: number;
  obsPassword: string;
  obsReconnectMs: number;
  /** Cloudflare Worker origin used to pull OBS settings saved in the browser. */
  platformBaseUrl: string;
  /**
   * How often to hard-reload OBS Browser Sources that load /overlays/ URLs.
   * Set to 0 to disable. Default 300000 (5 minutes).
   */
  overlayBrowserRefreshMs: number;
}
