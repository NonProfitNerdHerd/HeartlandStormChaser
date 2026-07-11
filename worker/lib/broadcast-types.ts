export type HealthTone = "healthy" | "stale" | "disconnected" | "unavailable" | "unknown";

export interface HealthCard {
  id: string;
  name: string;
  status: HealthTone;
  label: string;
  lastUpdate: string | null;
  error: string | null;
}

export interface BroadcastListenerSnapshot {
  ok: boolean;
  listenerConnected: boolean;
  listenerUpdatedAt: string | null;
  obsConnected: boolean;
  obsConnecting: boolean;
  obsLastError: string | null;
  obsConnectedAt: string | null;
  currentProgramScene: string | null;
  streamingActive: boolean;
  recordingActive: boolean;
  scenes: Array<{ name: string; sceneIndex: number }>;
  sources: Array<{
    name: string;
    sceneName: string;
    sourceType: string;
    visible: boolean;
    muted: boolean | null;
    canMute: boolean;
    health: string;
    healthReason: string;
    lastUpdatedAt: string;
    width: number | null;
    height: number | null;
    fps: number | null;
    thumbnailDataUrl: string | null;
  }>;
  stats: Record<string, unknown>;
  events: Array<{
    id: string;
    timestamp: string;
    category: string;
    message: string;
    severity: string;
  }>;
  error?: string;
}

export function unavailableListenerSnapshot(error: string): BroadcastListenerSnapshot {
  return {
    ok: false,
    listenerConnected: false,
    listenerUpdatedAt: null,
    obsConnected: false,
    obsConnecting: false,
    obsLastError: error,
    obsConnectedAt: null,
    currentProgramScene: null,
    streamingActive: false,
    recordingActive: false,
    scenes: [],
    sources: [],
    stats: { available: false },
    events: [],
    error,
  };
}
