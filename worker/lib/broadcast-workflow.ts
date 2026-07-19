import type { Env } from "../index";
import { fetchListenerSnapshot, proxyListenerAction } from "./obs-listener-client";
import {
  cancelBroadcast,
  createOperation,
  getActiveWorkflowBroadcast,
  getScheduledBroadcast,
  getSelectedBroadcast,
  setBroadcastStatus,
  setExternalPlatformId,
  updateOperation,
  type BroadcastStatus,
  type ScheduledBroadcast,
} from "./scheduled-broadcasts";
import {
  completeYoutubeBroadcast,
  getYoutubeStreamActive,
  goLiveOnYoutube,
  parseYoutubePlatformIds,
  prepareYoutubeLiveBroadcast,
  readYoutubeIngest,
  serializeYoutubePlatformIds,
  youtubeWatchUrlFromExternalId,
} from "./youtube-live";

export interface WorkflowStepResult {
  key: string;
  label: string;
  status: "pending" | "running" | "ok" | "failed" | "skipped";
  detail?: string;
}

export interface WorkflowResult {
  ok: boolean;
  broadcast: ScheduledBroadcast;
  operation_id: string;
  steps: WorkflowStepResult[];
  error?: string;
  /**
   * YouTube destination metadata for the operator UI.
   * Stream key is never returned — it is pushed to Desktop OBS via the listener.
   */
  youtube_ingest?: {
    server_url: string;
    watch_url: string;
    applied_to_obs: boolean;
  };
}

function requireSelected(broadcast: ScheduledBroadcast | null): ScheduledBroadcast {
  if (!broadcast) {
    throw new Error("No broadcast selected");
  }
  return broadcast;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Push YouTube RTMP ingest into Desktop OBS via the listener (never to the browser). */
async function applyYoutubeIngestToObs(
  env: Env,
  ingest: { ingestionAddress: string; streamName: string },
): Promise<{ server: string; streamServiceType: string }> {
  const res = await proxyListenerAction(env, "/stream/settings", "POST", {
    serverUrl: ingest.ingestionAddress,
    streamKey: ingest.streamName,
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    server?: string;
    streamServiceType?: string;
    verified?: boolean;
    isCustomRtmp?: boolean;
  };
  if (!res.ok) {
    throw new Error(body.error || "Failed to apply YouTube RTMP settings to OBS");
  }
  if (body.isCustomRtmp === false || (body.streamServiceType && body.streamServiceType !== "rtmp_custom")) {
    throw new Error(
      `OBS did not switch to Custom RTMP (got ${body.streamServiceType || "unknown"}). ` +
        "Close Manage Broadcast on the home PC and retry Go Live.",
    );
  }
  return {
    server: body.server || ingest.ingestionAddress,
    streamServiceType: body.streamServiceType || "rtmp_custom",
  };
}

/**
 * Start OBS once after Custom RTMP is verified. Never spam StartStream
 * (that opens YouTube Manage Broadcast when service is wrong).
 */
async function ensureObsStreaming(
  env: Env,
  ingest?: { ingestionAddress: string; streamName: string } | null,
): Promise<void> {
  const snap = await fetchListenerSnapshot(env, true);
  if (!snap.listenerConnected) {
    throw new Error(snap.obsLastError || "OBS listener unreachable — check tunnel on home PC");
  }
  if (!snap.obsConnected) {
    throw new Error("OBS is disconnected — open OBS WebSocket on the home PC");
  }
  if (snap.streamingActive) return;

  if (ingest) {
    await applyYoutubeIngestToObs(env, ingest);
  } else {
    const settingsRes = await proxyListenerAction(env, "/stream/settings", "GET");
    const settings = (await settingsRes.json().catch(() => ({}))) as {
      error?: string;
      isCustomRtmp?: boolean;
      streamServiceType?: string;
    };
    if (!settingsRes.ok) {
      throw new Error(settings.error || "Could not read OBS stream settings");
    }
    if (!settings.isCustomRtmp) {
      throw new Error(
        `OBS stream service is "${settings.streamServiceType || "unknown"}" — not Custom RTMP. ` +
          "Go Live must apply the YouTube key first. Retry Go Live.",
      );
    }
  }

  const startRes = await proxyListenerAction(env, "/stream/start", "POST");
  const startBody = (await startRes.json().catch(() => ({}))) as {
    error?: string;
    streamingActive?: boolean;
    streamServiceType?: string;
  };
  if (!startRes.ok) {
    throw new Error(startBody.error || "OBS StartStream failed");
  }
  if (startBody.streamingActive) return;

  // One short poll only — no second StartStream (avoids Manage Broadcast spam).
  for (let i = 0; i < 6; i += 1) {
    await sleep(1000);
    const again = await fetchListenerSnapshot(env, true);
    if (again.streamingActive) return;
  }

  throw new Error(
    "OBS did not report streaming active after a verified Custom RTMP StartStream. " +
      "On the home PC: dismiss any Manage Broadcast dialogs, confirm Settings → Stream is Custom, then tap Go Live once more.",
  );
}

/**
 * On failure, keep a retryable status when a YouTube event already exists.
 * Never force the operator back through a full Prepare for a transient Go Live miss.
 */
async function softFailBroadcast(
  env: Env,
  broadcast: ScheduledBroadcast,
  message: string,
  operationId: string,
  steps: WorkflowStepResult[],
): Promise<ScheduledBroadcast> {
  await updateOperation(env, operationId, { status: "failed", steps, error_message: message });
  const hasYt = Boolean(parseYoutubePlatformIds(broadcast.external_platform_id));
  const targets: BroadcastStatus[] = hasYt
    ? ["ready_to_go_live", "prepared", "failed"]
    : ["failed"];
  for (const target of targets) {
    try {
      return await setBroadcastStatus(env, broadcast.id, target, {
        operation_id: operationId,
        workflow_step: target === "failed" ? "failed" : "retry_go_live",
        error_message: message,
      });
    } catch {
      /* try next */
    }
  }
  return (await getScheduledBroadcast(env, broadcast.id)) || broadcast;
}


export async function prepareBroadcast(
  env: Env,
  userId: string | null,
  broadcastId?: string,
): Promise<WorkflowResult> {
  let broadcast = broadcastId
    ? await getScheduledBroadcast(env, broadcastId)
    : await getSelectedBroadcast(env);
  broadcast = requireSelected(broadcast);

  if (["completed", "cancelled"].includes(broadcast.status)) {
    throw new Error("Broadcast is no longer eligible to start");
  }

  const conflicting = await getActiveWorkflowBroadcast(env);
  if (conflicting && conflicting.id !== broadcast.id) {
    throw new Error(`Conflicting active broadcast: ${conflicting.title}`);
  }

  const steps: WorkflowStepResult[] = [
    { key: "validate", label: "Validating broadcast", status: "pending" },
    { key: "obs", label: "Connecting to OBS", status: "pending" },
    { key: "destination", label: "Preparing stream destination", status: "pending" },
    { key: "obs_ingest", label: "Applying destination to OBS", status: "pending" },
    { key: "scenes", label: "Confirming scenes", status: "pending" },
    { key: "starting_scene", label: "Selecting starting scene", status: "pending" },
    { key: "ready", label: "Ready", status: "pending" },
  ];

  const operationId = await createOperation(env, broadcast.id, "prepare", userId, steps);
  broadcast = await setBroadcastStatus(env, broadcast.id, "preparing", {
    operation_id: operationId,
    workflow_step: "validate",
    error_message: null,
  });

  const mark = async (key: string, status: WorkflowStepResult["status"], detail?: string) => {
    const step = steps.find((s) => s.key === key);
    if (step) {
      step.status = status;
      step.detail = detail;
    }
    await updateOperation(env, operationId, { steps });
  };

  try {
    await mark("validate", "running");
    if (!broadcast.title?.trim()) throw new Error("Broadcast title is missing");
    if (broadcast.platform === "youtube") {
      await mark(
        "validate",
        "ok",
        "YouTube Live API will create/bind the broadcast during prepare",
      );
    } else {
      await mark("validate", "ok", "Broadcast record is valid");
    }

    await mark("obs", "running");
    const snapshot = await fetchListenerSnapshot(env, true);
    if (!snapshot.listenerConnected) {
      throw new Error(snapshot.error || "OBS listener is unreachable");
    }
    if (!snapshot.obsConnected) {
      throw new Error("OBS is disconnected from the listener");
    }
    await mark("obs", "ok", "Listener online and OBS connected");

    await mark("destination", "running");
    let youtubeIngest: WorkflowResult["youtube_ingest"];
    if (broadcast.platform === "youtube") {
      const prepared = await prepareYoutubeLiveBroadcast(env, broadcast);
      broadcast = await setExternalPlatformId(
        env,
        broadcast.id,
        serializeYoutubePlatformIds(prepared.ids),
      );
      await mark(
        "destination",
        "ok",
        `YouTube broadcast ${prepared.ids.broadcastId} created and bound`,
      );

      await mark("obs_ingest", "running");
      const applied = await applyYoutubeIngestToObs(env, prepared.ingest);
      youtubeIngest = {
        server_url: applied.server,
        watch_url: prepared.watchUrl,
        applied_to_obs: true,
      };
      await mark(
        "obs_ingest",
        "ok",
        `YouTube RTMP applied to Desktop OBS (${applied.server})`,
      );
    } else {
      await mark(
        "destination",
        "ok",
        "Using the stream service already configured in OBS (no credentials exposed to the browser)",
      );
      await mark("obs_ingest", "skipped", "OBS platform uses existing OBS stream settings");
    }

    await mark("scenes", "running");
    const sceneNames = new Set((snapshot.scenes || []).map((s) => s.name));
    const missing: string[] = [];
    for (const scene of [broadcast.starting_scene, broadcast.main_live_scene, broadcast.ending_scene]) {
      if (scene && !sceneNames.has(scene)) missing.push(scene);
    }
    if (missing.length) {
      throw new Error(`Scene not found in OBS: ${missing.join(", ")}`);
    }
    await mark(
      "scenes",
      "ok",
      sceneNames.size ? `${sceneNames.size} scenes available` : "No scene list returned",
    );

    await mark("starting_scene", "running");
    if (broadcast.starting_scene) {
      const sceneRes = await proxyListenerAction(env, "/scenes/activate", "POST", {
        sceneName: broadcast.starting_scene,
      });
      if (!sceneRes.ok) {
        const body = (await sceneRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Failed to select starting scene");
      }
      await mark("starting_scene", "ok", `Selected ${broadcast.starting_scene}`);
    } else {
      await mark("starting_scene", "skipped", "No starting scene configured");
    }

    await mark("ready", "ok", "OBS is prepared for this broadcast");
    await updateOperation(env, operationId, { status: "succeeded", steps });
    broadcast = await setBroadcastStatus(env, broadcast.id, "prepared", {
      operation_id: operationId,
      workflow_step: "ready",
      error_message: null,
    });

    return {
      ok: true,
      broadcast,
      operation_id: operationId,
      steps,
      youtube_ingest: youtubeIngest,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prepare failed";
    await mark(
      steps.find((s) => s.status === "running")?.key || "validate",
      "failed",
      message,
    );
    await updateOperation(env, operationId, {
      status: "failed",
      steps,
      error_message: message,
    });
    broadcast = await setBroadcastStatus(env, broadcast.id, "failed", {
      operation_id: operationId,
      workflow_step: "failed",
      error_message: message,
    });
    return { ok: false, broadcast, operation_id: operationId, steps, error: message };
  }
}

export async function startBroadcastOutput(
  env: Env,
  userId: string | null,
  broadcastId: string,
  idempotencyKey?: string,
): Promise<WorkflowResult> {
  let broadcast = await getScheduledBroadcast(env, broadcastId);
  broadcast = requireSelected(broadcast);

  if (broadcast.status === "waiting_for_ingest" || broadcast.status === "ready_to_go_live" || broadcast.status === "live") {
    // Idempotent path — but still nudge OBS StartStream if it is not actually streaming.
    const snap = await fetchListenerSnapshot(env, true);
    if (snap.streamingActive || broadcast.status === "live") {
      return {
        ok: true,
        broadcast,
        operation_id: broadcast.operation_id || idempotencyKey || "idempotent",
        steps: [{ key: "start", label: "Start OBS streaming", status: "ok", detail: "Already streaming" }],
      };
    }
    const res = await proxyListenerAction(env, "/stream/start", "POST");
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || "OBS StartStream failed");
    }
    if (broadcast.status === "ready_to_go_live" || broadcast.status === "waiting_for_ingest") {
      // stay on current status
    }
    return {
      ok: true,
      broadcast,
      operation_id: broadcast.operation_id || idempotencyKey || "idempotent",
      steps: [{ key: "start", label: "Start OBS streaming", status: "ok", detail: "StartStream requested" }],
    };
  }

  if (broadcast.status === "starting_output") {
    const res = await proxyListenerAction(env, "/stream/start", "POST");
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || "OBS StartStream failed");
    }
    broadcast = await setBroadcastStatus(env, broadcast.id, "waiting_for_ingest", {
      workflow_step: "waiting_for_ingest",
      error_message: null,
    });
    return {
      ok: true,
      broadcast,
      operation_id: broadcast.operation_id || idempotencyKey || "retry-start",
      steps: [{ key: "start", label: "Start OBS streaming", status: "ok", detail: "StartStream requested" }],
    };
  }

  if (broadcast.status !== "prepared" && broadcast.status !== "failed") {
    throw new Error(`Broadcast must be prepared before starting (status: ${broadcast.status})`);
  }

  // Re-prepare if recovering from failed start
  if (broadcast.status === "failed") {
    const prep = await prepareBroadcast(env, userId, broadcastId);
    if (!prep.ok) return prep;
    broadcast = prep.broadcast;
  }

  const steps: WorkflowStepResult[] = [
    { key: "obs_ingest", label: "Confirming OBS stream destination", status: "pending" },
    { key: "start", label: "Start OBS streaming", status: "pending" },
  ];
  const operationId = await createOperation(env, broadcast.id, "start_output", userId, steps);
  broadcast = await setBroadcastStatus(env, broadcast.id, "starting_output", {
    operation_id: operationId,
    workflow_step: "start",
    error_message: null,
  });

  try {
    if (broadcast.platform === "youtube") {
      steps[0].status = "running";
      await updateOperation(env, operationId, { steps });
      const ingest = await readYoutubeIngest(env, broadcast.id);
      if (!ingest) {
        throw new Error("Missing stored YouTube ingest — re-run Prepare");
      }
      const applied = await applyYoutubeIngestToObs(env, ingest);
      steps[0].status = "ok";
      steps[0].detail = `YouTube RTMP confirmed on OBS (${applied.server})`;
      await updateOperation(env, operationId, { steps });
    } else {
      steps[0].status = "skipped";
      steps[0].detail = "Using existing OBS stream settings";
      await updateOperation(env, operationId, { steps });
    }

    steps[1].status = "running";
    await updateOperation(env, operationId, { steps });
    const res = await proxyListenerAction(env, "/stream/start", "POST");
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || "OBS StartStream failed");
    }
    steps[1].status = "ok";
    steps[1].detail = "StartStream requested";
    await updateOperation(env, operationId, { status: "succeeded", steps });
    broadcast = await setBroadcastStatus(env, broadcast.id, "waiting_for_ingest", {
      operation_id: operationId,
      workflow_step: "waiting_for_ingest",
      error_message: null,
    });
    return { ok: true, broadcast, operation_id: operationId, steps };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Start output failed";
    const running = steps.find((s) => s.status === "running");
    if (running) {
      running.status = "failed";
      running.detail = message;
    } else {
      steps[steps.length - 1].status = "failed";
      steps[steps.length - 1].detail = message;
    }
    await updateOperation(env, operationId, { status: "failed", steps, error_message: message });
    broadcast = await setBroadcastStatus(env, broadcast.id, "failed", {
      operation_id: operationId,
      workflow_step: "start_failed",
      error_message: message,
    });
    return { ok: false, broadcast, operation_id: operationId, steps, error: message };
  }
}

export async function confirmIngest(env: Env, broadcastId: string): Promise<WorkflowResult> {
  let broadcast = await getScheduledBroadcast(env, broadcastId);
  broadcast = requireSelected(broadcast);

  const snapshot = await fetchListenerSnapshot(env, true);
  const streaming = Boolean(snapshot.streamingActive);
  const steps: WorkflowStepResult[] = [
    {
      key: "obs_output",
      label: "OBS streaming output",
      status: streaming ? "ok" : "running",
      detail: streaming
        ? "OBS reports streaming active"
        : "OBS has not reported streamingActive yet",
    },
  ];

  let youtubeReady = true;
  if (broadcast.platform === "youtube") {
    const ids = parseYoutubePlatformIds(broadcast.external_platform_id);
    if (!ids) {
      steps.push({
        key: "youtube_ingest",
        label: "YouTube ingest",
        status: "failed",
        detail: "Missing YouTube broadcast/stream ids — re-run Prepare",
      });
      return {
        ok: false,
        broadcast,
        operation_id: broadcast.operation_id || "ingest",
        steps,
        error: "YouTube platform ids missing",
      };
    }
    try {
      const yt = await getYoutubeStreamActive(env, ids.streamId);
      // Prefer active; accept ready when OBS is already pushing (common YouTube lag).
      youtubeReady = yt.active || (streaming && yt.ingestOk);
      steps.push({
        key: "youtube_ingest",
        label: "YouTube ingest",
        status: youtubeReady ? "ok" : "running",
        detail: yt.active
          ? "YouTube reports stream status active"
          : youtubeReady
            ? `YouTube stream status: ${yt.status} (OBS streaming — treating as ready)`
            : `YouTube stream status: ${yt.status}`,
      });
    } catch (error) {
      youtubeReady = false;
      steps.push({
        key: "youtube_ingest",
        label: "YouTube ingest",
        status: "failed",
        detail: error instanceof Error ? error.message : "YouTube ingest check failed",
      });
    }
  }

  const ready = streaming && youtubeReady;
  if (ready) {
    // Promote through the start→ingest→ready chain when OBS was started outside the workflow.
    if (broadcast.status === "prepared") {
      broadcast = await setBroadcastStatus(env, broadcast.id, "starting_output", {
        workflow_step: "start",
        error_message: null,
      });
    }
    if (broadcast.status === "starting_output") {
      broadcast = await setBroadcastStatus(env, broadcast.id, "waiting_for_ingest", {
        workflow_step: "waiting_for_ingest",
        error_message: null,
      });
    }
    if (broadcast.status === "waiting_for_ingest") {
      broadcast = await setBroadcastStatus(env, broadcast.id, "ready_to_go_live", {
        workflow_step: "ready_to_go_live",
        error_message: null,
      });
    }
    if (broadcast.status === "failed") {
      broadcast = await setBroadcastStatus(env, broadcast.id, "ready_to_go_live", {
        workflow_step: "ready_to_go_live",
        error_message: null,
      });
    }
    return {
      ok: true,
      broadcast,
      operation_id: broadcast.operation_id || "ingest",
      steps,
    };
  }

  return {
    ok: false,
    broadcast,
    operation_id: broadcast.operation_id || "ingest",
    steps,
    error: "Ingest not detected yet",
  };
}

/**
 * Chase-day one-shot: select broadcast → Go Live.
 * Ensures YouTube event (reuse if present), pushes RTMP to OBS, starts stream,
 * waits for ingest, then transitions YouTube to live.
 */
export async function goLiveBroadcast(
  env: Env,
  userId: string | null,
  broadcastId: string,
): Promise<WorkflowResult> {
  let broadcast = await getScheduledBroadcast(env, broadcastId);
  broadcast = requireSelected(broadcast);

  if (["completed", "cancelled"].includes(broadcast.status)) {
    throw new Error("Broadcast is no longer eligible to go live");
  }

  if (broadcast.status === "live") {
    return {
      ok: true,
      broadcast,
      operation_id: broadcast.operation_id || "live",
      steps: [{ key: "live", label: "Go Live", status: "ok", detail: "Already live" }],
      youtube_ingest: broadcast.watch_url
        ? { server_url: "", watch_url: broadcast.watch_url, applied_to_obs: true }
        : undefined,
    };
  }

  // Clear stale non-live workflow locks from prior tests / failed attempts.
  const conflicting = await getActiveWorkflowBroadcast(env);
  if (conflicting && conflicting.id !== broadcast.id) {
    if (["live", "going_live", "ending"].includes(conflicting.status)) {
      throw new Error(
        `Another broadcast is live: ${conflicting.title}. End it before going live with this one.`,
      );
    }
    await cancelBroadcast(env, conflicting.id);
  }

  const steps: WorkflowStepResult[] = [
    { key: "obs", label: "Home OBS connection", status: "pending" },
    { key: "destination", label: "YouTube / stream destination", status: "pending" },
    { key: "obs_ingest", label: "Apply RTMP to OBS", status: "pending" },
    { key: "start", label: "Start OBS streaming", status: "pending" },
    { key: "ingest", label: "Wait for ingest", status: "pending" },
    { key: "platform", label: "YouTube Go Live", status: "pending" },
    { key: "scene", label: "Main live scene", status: "pending" },
  ];
  const operationId = await createOperation(env, broadcast.id, "go_live", userId, steps);

  const mark = async (key: string, status: WorkflowStepResult["status"], detail?: string) => {
    const step = steps.find((s) => s.key === key);
    if (step) {
      step.status = status;
      step.detail = detail;
    }
    await updateOperation(env, operationId, { steps });
  };

  let youtubeIngest: WorkflowResult["youtube_ingest"];

  try {
    await mark("obs", "running");
    const snap = await fetchListenerSnapshot(env, true);
    if (!snap.listenerConnected) {
      throw new Error(snap.obsLastError || "OBS listener unreachable — check home tunnel");
    }
    if (!snap.obsConnected) {
      throw new Error("OBS is disconnected — open OBS WebSocket on the home PC");
    }
    await mark("obs", "ok", "Listener online and OBS connected");

    await mark("destination", "running");
    let liveIngest: { ingestionAddress: string; streamName: string } | null = null;
    if (broadcast.platform === "youtube") {
      let ids = parseYoutubePlatformIds(broadcast.external_platform_id);
      let ingest = ids ? await readYoutubeIngest(env, broadcast.id) : null;
      if (!ids || !ingest) {
        const prepared = await prepareYoutubeLiveBroadcast(env, broadcast);
        broadcast = await setExternalPlatformId(
          env,
          broadcast.id,
          serializeYoutubePlatformIds(prepared.ids),
        );
        ids = prepared.ids;
        ingest = prepared.ingest;
        await mark("destination", "ok", `YouTube broadcast ${ids.broadcastId} ready`);
      } else {
        await mark(
          "destination",
          "ok",
          `Reusing YouTube broadcast ${ids.broadcastId} (already prepared)`,
        );
      }
      liveIngest = ingest;

      await mark("obs_ingest", "running");
      const applied = await applyYoutubeIngestToObs(env, ingest);
      youtubeIngest = {
        server_url: applied.server,
        watch_url:
          youtubeWatchUrlFromExternalId(broadcast.external_platform_id) ||
          `https://www.youtube.com/watch?v=${ids.broadcastId}`,
        applied_to_obs: true,
      };
      await mark("obs_ingest", "ok", `Custom RTMP verified (${applied.server})`);
    } else {
      await mark("destination", "ok", "Using OBS stream settings already configured");
      await mark("obs_ingest", "skipped", "OBS platform — no YouTube RTMP push");
    }

    // Move into a retryable mid-workflow status without requiring Prepare UI.
    if (["draft", "scheduled", "selected", "failed", "prepared"].includes(broadcast.status)) {
      try {
        if (broadcast.status === "failed" || broadcast.status === "draft" || broadcast.status === "scheduled") {
          broadcast = await setBroadcastStatus(env, broadcast.id, "selected", {
            operation_id: operationId,
            error_message: null,
          });
        }
      } catch {
        /* keep going */
      }
      try {
        if (["selected", "failed", "prepared"].includes(broadcast.status) || broadcast.status === "selected") {
          if (broadcast.status !== "prepared" && broadcast.status !== "starting_output") {
            // selected → preparing not needed; jump via prepared if allowed
          }
        }
      } catch {
        /* ignore */
      }
    }
    try {
      if (broadcast.status === "selected") {
        // selected cannot go directly to prepared; use preparing then prepared lightly
        broadcast = await setBroadcastStatus(env, broadcast.id, "preparing", {
          operation_id: operationId,
          workflow_step: "go_live",
          error_message: null,
        });
        broadcast = await setBroadcastStatus(env, broadcast.id, "prepared", {
          operation_id: operationId,
          workflow_step: "go_live",
          error_message: null,
        });
      } else if (broadcast.status === "failed") {
        broadcast = await setBroadcastStatus(env, broadcast.id, "prepared", {
          operation_id: operationId,
          workflow_step: "go_live",
          error_message: null,
        });
      }
    } catch {
      /* status may already be prepared / waiting / ready */
      broadcast = (await getScheduledBroadcast(env, broadcast.id)) || broadcast;
    }

    await mark("start", "running");
    try {
      if (broadcast.status === "prepared") {
        broadcast = await setBroadcastStatus(env, broadcast.id, "starting_output", {
          operation_id: operationId,
          workflow_step: "start",
          error_message: null,
        });
      }
    } catch {
      broadcast = (await getScheduledBroadcast(env, broadcast.id)) || broadcast;
    }
    // Re-apply + verify Custom RTMP, then StartStream exactly once (no spam).
    await ensureObsStreaming(env, liveIngest);
    try {
      if (broadcast.status === "starting_output" || broadcast.status === "prepared") {
        broadcast = await setBroadcastStatus(env, broadcast.id, "waiting_for_ingest", {
          operation_id: operationId,
          workflow_step: "waiting_for_ingest",
          error_message: null,
        });
      }
    } catch {
      broadcast = (await getScheduledBroadcast(env, broadcast.id)) || broadcast;
    }
    await mark("start", "ok", "OBS streaming active (Custom RTMP)");

    await mark("ingest", "running");
    let ingestReady = false;
    let lastIngestDetail = "Waiting for YouTube ingest";
    for (let i = 0; i < 10; i += 1) {
      const promoted = await confirmIngest(env, broadcast.id);
      broadcast = promoted.broadcast;
      steps[4].detail = promoted.steps.map((s) => s.detail).filter(Boolean).join(" · ") || lastIngestDetail;
      lastIngestDetail = steps[4].detail || lastIngestDetail;
      await updateOperation(env, operationId, { steps });
      if (promoted.ok && broadcast.status === "ready_to_go_live") {
        ingestReady = true;
        break;
      }
      await sleep(2000);
    }
    if (!ingestReady) {
      throw new Error(
        lastIngestDetail ||
          "Ingest not ready yet — keep OBS streaming and tap Go Live again in a few seconds",
      );
    }
    await mark("ingest", "ok", "Ingest ready");

    broadcast = await setBroadcastStatus(env, broadcast.id, "going_live", {
      operation_id: operationId,
      workflow_step: "going_live",
      error_message: null,
    });

    await mark("platform", "running");
    if (broadcast.platform === "youtube") {
      const ids = parseYoutubePlatformIds(broadcast.external_platform_id);
      if (!ids) throw new Error("Missing YouTube broadcast ids");
      let lastYtError: string | null = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const yt = await getYoutubeStreamActive(env, ids.streamId);
        if (yt.active || yt.ingestOk) {
          try {
            await goLiveOnYoutube(env, ids);
            lastYtError = null;
            break;
          } catch (error) {
            lastYtError = error instanceof Error ? error.message : "YouTube go-live failed";
          }
        } else {
          lastYtError = `YouTube stream status is ${yt.status}`;
        }
        await sleep(2000);
      }
      if (lastYtError) throw new Error(lastYtError);
      await mark("platform", "ok", `YouTube ${ids.broadcastId} is live`);
    } else {
      await mark("platform", "ok", "OBS destination is the live platform");
    }

    await mark("scene", "running");
    if (broadcast.main_live_scene) {
      const sceneRes = await proxyListenerAction(env, "/scenes/activate", "POST", {
        sceneName: broadcast.main_live_scene,
      });
      if (!sceneRes.ok) {
        const body = (await sceneRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Failed to switch to main live scene");
      }
      await mark("scene", "ok", `Selected ${broadcast.main_live_scene}`);
    } else {
      await mark("scene", "skipped", "No main live scene configured");
    }

    await updateOperation(env, operationId, { status: "succeeded", steps });
    broadcast = await setBroadcastStatus(env, broadcast.id, "live", {
      operation_id: operationId,
      workflow_step: "live",
      actual_start_at: new Date().toISOString(),
      error_message: null,
    });

    return {
      ok: true,
      broadcast,
      operation_id: operationId,
      steps,
      youtube_ingest: youtubeIngest,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Go live failed";
    const running = steps.find((s) => s.status === "running");
    if (running) {
      running.status = "failed";
      running.detail = message;
    }
    broadcast = await softFailBroadcast(env, broadcast, message, operationId, steps);
    return {
      ok: false,
      broadcast,
      operation_id: operationId,
      steps,
      error: message,
      youtube_ingest: youtubeIngest,
    };
  }
}

export async function endBroadcast(
  env: Env,
  userId: string | null,
  broadcastId: string,
  emergency = false,
): Promise<WorkflowResult> {
  let broadcast = await getScheduledBroadcast(env, broadcastId);
  broadcast = requireSelected(broadcast);

  const steps: WorkflowStepResult[] = [
    { key: "ending_scene", label: "Switch to ending scene", status: "pending" },
    { key: "platform_end", label: "Complete platform broadcast", status: "pending" },
    { key: "stop", label: "Stop OBS streaming", status: "pending" },
  ];
  const operationId = await createOperation(
    env,
    broadcast.id,
    emergency ? "emergency_stop" : "end",
    userId,
    steps,
  );

  if (!emergency) {
    broadcast = await setBroadcastStatus(env, broadcast.id, "ending", {
      operation_id: operationId,
      workflow_step: "ending",
    });
  }

  try {
    if (!emergency && broadcast.ending_scene) {
      steps[0].status = "running";
      await updateOperation(env, operationId, { steps });
      const sceneRes = await proxyListenerAction(env, "/scenes/activate", "POST", {
        sceneName: broadcast.ending_scene,
      });
      if (!sceneRes.ok) {
        const body = (await sceneRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Failed to switch to ending scene");
      }
      steps[0].status = "ok";
      steps[0].detail = `Selected ${broadcast.ending_scene}`;
    } else {
      steps[0].status = emergency ? "skipped" : "skipped";
      steps[0].detail = emergency ? "Skipped for emergency stop" : "No ending scene configured";
    }

    steps[1].status = "running";
    await updateOperation(env, operationId, { steps });
    if (broadcast.platform === "youtube") {
      const ids = parseYoutubePlatformIds(broadcast.external_platform_id);
      if (ids) {
        try {
          await completeYoutubeBroadcast(env, ids);
          steps[1].status = "ok";
          steps[1].detail = `YouTube broadcast ${ids.broadcastId} completed`;
        } catch (error) {
          if (emergency) {
            steps[1].status = "failed";
            steps[1].detail =
              error instanceof Error
                ? `Emergency stop: YouTube end failed (${error.message})`
                : "Emergency stop: YouTube end failed";
          } else {
            throw error;
          }
        }
      } else {
        steps[1].status = "skipped";
        steps[1].detail = "No YouTube broadcast id on record";
      }
    } else {
      steps[1].status = "skipped";
      steps[1].detail = "No separate platform end step for OBS destination";
    }

    steps[2].status = "running";
    await updateOperation(env, operationId, { steps });
    const stopRes = await proxyListenerAction(env, "/stream/stop", "POST");
    if (!stopRes.ok) {
      const body = (await stopRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || "OBS StopStream failed");
    }
    steps[2].status = "ok";
    steps[2].detail = "StopStream requested";

    await updateOperation(env, operationId, { status: "succeeded", steps });
    broadcast = await setBroadcastStatus(env, broadcast.id, emergency ? "failed" : "completed", {
      operation_id: operationId,
      workflow_step: emergency ? "emergency_stopped" : "completed",
      actual_end_at: new Date().toISOString(),
      emergency_stopped: emergency,
      error_message: emergency ? "Emergency stop used" : null,
    });

    return { ok: true, broadcast, operation_id: operationId, steps };
  } catch (error) {
    const message = error instanceof Error ? error.message : "End broadcast failed";
    const running = steps.find((s) => s.status === "running");
    if (running) {
      running.status = "failed";
      running.detail = message;
    }
    await updateOperation(env, operationId, { status: "failed", steps, error_message: message });
    broadcast = await setBroadcastStatus(env, broadcast.id, "failed", {
      operation_id: operationId,
      error_message: message,
      emergency_stopped: emergency,
      actual_end_at: new Date().toISOString(),
    });
    return { ok: false, broadcast, operation_id: operationId, steps, error: message };
  }
}
