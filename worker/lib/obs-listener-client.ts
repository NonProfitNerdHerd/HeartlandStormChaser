import type { Env } from "../index";
import { resolveBroadcastConnection } from "./broadcast-settings";
import {
  unavailableListenerSnapshot,
  type BroadcastListenerSnapshot,
} from "./broadcast-types";

export async function isObsListenerConfigured(env: Env): Promise<boolean> {
  const connection = await resolveBroadcastConnection(env);
  return Boolean(connection.listenerUrl && connection.listenerToken);
}

export async function callObsListener(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response | null; snapshotError: string | null }> {
  const connection = await resolveBroadcastConnection(env);

  if (!connection.listenerUrl || !connection.listenerToken) {
    return {
      response: null,
      snapshotError:
        "OBS listener is not configured. Open Broadcast settings and enter the listener URL and token.",
    };
  }

  const base = connection.listenerUrl.replace(/\/$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${connection.listenerToken}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    return { response, snapshotError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OBS listener unreachable";
    return { response: null, snapshotError: message };
  }
}

export async function fetchListenerSnapshot(
  env: Env,
  refresh = false,
): Promise<BroadcastListenerSnapshot> {
  const path = refresh ? "/status?refresh=1" : "/status";
  const { response, snapshotError } = await callObsListener(env, path, { method: "GET" });

  if (!response) {
    return unavailableListenerSnapshot(snapshotError || "OBS listener unavailable");
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    return unavailableListenerSnapshot("OBS listener returned invalid JSON");
  }

  if (!response.ok || data.ok === false) {
    const error =
      typeof data.error === "string" ? data.error : `OBS listener HTTP ${response.status}`;
    return unavailableListenerSnapshot(error);
  }

  return {
    ok: true,
    listenerConnected: true,
    listenerUpdatedAt: typeof data.listenerUpdatedAt === "string" ? data.listenerUpdatedAt : null,
    obsConnected: Boolean(data.obsConnected),
    obsConnecting: Boolean(data.obsConnecting),
    obsLastError: typeof data.obsLastError === "string" ? data.obsLastError : null,
    obsConnectedAt: typeof data.obsConnectedAt === "string" ? data.obsConnectedAt : null,
    currentProgramScene:
      typeof data.currentProgramScene === "string" ? data.currentProgramScene : null,
    streamingActive: Boolean(data.streamingActive),
    recordingActive: Boolean(data.recordingActive),
    scenes: Array.isArray(data.scenes) ? (data.scenes as BroadcastListenerSnapshot["scenes"]) : [],
    sources: Array.isArray(data.sources)
      ? (data.sources as BroadcastListenerSnapshot["sources"])
      : [],
    stats:
      data.stats && typeof data.stats === "object"
        ? (data.stats as Record<string, unknown>)
        : { available: false },
    events: Array.isArray(data.events) ? (data.events as BroadcastListenerSnapshot["events"]) : [],
  };
}

export async function proxyListenerAction(
  env: Env,
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  const { response, snapshotError } = await callObsListener(env, path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response) {
    return Response.json(
      { ok: false, error: snapshotError || "OBS listener unavailable" },
      { status: 503 },
    );
  }

  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
