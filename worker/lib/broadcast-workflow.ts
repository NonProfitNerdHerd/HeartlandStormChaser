import type { Env } from "../index";
import { fetchListenerSnapshot, proxyListenerAction } from "./obs-listener-client";
import {
  createOperation,
  getActiveWorkflowBroadcast,
  getScheduledBroadcast,
  getSelectedBroadcast,
  setBroadcastStatus,
  setExternalPlatformId,
  updateOperation,
  type ScheduledBroadcast,
} from "./scheduled-broadcasts";
import {
  completeYoutubeBroadcast,
  getYoutubeStreamActive,
  goLiveOnYoutube,
  parseYoutubePlatformIds,
  prepareYoutubeLiveBroadcast,
  serializeYoutubePlatformIds,
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
  /** One-time OBS RTMP details for YouTube — never stored on the public broadcast list. */
  youtube_ingest?: {
    server_url: string;
    stream_key: string;
    watch_url: string;
  };
}

function requireSelected(broadcast: ScheduledBroadcast | null): ScheduledBroadcast {
  if (!broadcast) {
    throw new Error("No broadcast selected");
  }
  return broadcast;
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
      youtubeIngest = {
        server_url: prepared.ingest.ingestionAddress,
        stream_key: prepared.ingest.streamName,
        watch_url: prepared.watchUrl,
      };
      await mark(
        "destination",
        "ok",
        `YouTube broadcast ${prepared.ids.broadcastId} created and bound — paste the stream key into OBS (shown once in this workflow)`,
      );
    } else {
      await mark(
        "destination",
        "ok",
        "Using the stream service already configured in OBS (no credentials exposed to the browser)",
      );
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
    return {
      ok: true,
      broadcast,
      operation_id: broadcast.operation_id || idempotencyKey || "idempotent",
      steps: [{ key: "start", label: "Start OBS streaming", status: "ok", detail: "Already started" }],
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
    { key: "start", label: "Start OBS streaming", status: "pending" },
  ];
  const operationId = await createOperation(env, broadcast.id, "start_output", userId, steps);
  broadcast = await setBroadcastStatus(env, broadcast.id, "starting_output", {
    operation_id: operationId,
    workflow_step: "start",
    error_message: null,
  });

  try {
    steps[0].status = "running";
    await updateOperation(env, operationId, { steps });
    const res = await proxyListenerAction(env, "/stream/start", "POST");
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || "OBS StartStream failed");
    }
    steps[0].status = "ok";
    steps[0].detail = "StartStream requested";
    await updateOperation(env, operationId, { status: "succeeded", steps });
    broadcast = await setBroadcastStatus(env, broadcast.id, "waiting_for_ingest", {
      operation_id: operationId,
      workflow_step: "waiting_for_ingest",
      error_message: null,
    });
    return { ok: true, broadcast, operation_id: operationId, steps };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Start output failed";
    steps[0].status = "failed";
    steps[0].detail = message;
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
      youtubeReady = yt.active;
      steps.push({
        key: "youtube_ingest",
        label: "YouTube ingest",
        status: yt.active ? "ok" : "running",
        detail: yt.active
          ? "YouTube reports stream status active"
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
    if (broadcast.status === "waiting_for_ingest" || broadcast.status === "starting_output") {
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

export async function goLiveBroadcast(
  env: Env,
  userId: string | null,
  broadcastId: string,
): Promise<WorkflowResult> {
  let broadcast = await getScheduledBroadcast(env, broadcastId);
  broadcast = requireSelected(broadcast);

  if (broadcast.status === "live") {
    return {
      ok: true,
      broadcast,
      operation_id: broadcast.operation_id || "live",
      steps: [{ key: "live", label: "Go Live", status: "ok", detail: "Already live" }],
    };
  }

  if (broadcast.status !== "ready_to_go_live") {
    throw new Error("Broadcast is not ready to go live yet");
  }

  const snapshot = await fetchListenerSnapshot(env, true);
  if (!snapshot.streamingActive) {
    throw new Error("OBS is not streaming — cannot go live");
  }

  const steps: WorkflowStepResult[] = [
    { key: "platform", label: "Platform go-live", status: "pending" },
    { key: "scene", label: "Switch to main live scene", status: "pending" },
  ];
  const operationId = await createOperation(env, broadcast.id, "go_live", userId, steps);
  broadcast = await setBroadcastStatus(env, broadcast.id, "going_live", {
    operation_id: operationId,
    workflow_step: "going_live",
  });

  try {
    if (broadcast.platform === "youtube") {
      steps[0].status = "running";
      await updateOperation(env, operationId, { steps });
      const ids = parseYoutubePlatformIds(broadcast.external_platform_id);
      if (!ids) {
        throw new Error("Missing YouTube broadcast ids — re-run Prepare");
      }
      await goLiveOnYoutube(env, ids);
      steps[0].status = "ok";
      steps[0].detail = `YouTube broadcast ${ids.broadcastId} is live`;
    } else {
      steps[0].status = "ok";
      steps[0].detail = "OBS destination is the live platform";
    }
    await updateOperation(env, operationId, { steps });

    steps[1].status = "running";
    await updateOperation(env, operationId, { steps });
    if (broadcast.main_live_scene) {
      const sceneRes = await proxyListenerAction(env, "/scenes/activate", "POST", {
        sceneName: broadcast.main_live_scene,
      });
      if (!sceneRes.ok) {
        const body = (await sceneRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Failed to switch to main live scene");
      }
      steps[1].status = "ok";
      steps[1].detail = `Selected ${broadcast.main_live_scene}`;
    } else {
      steps[1].status = "skipped";
      steps[1].detail = "No main live scene configured";
    }

    await updateOperation(env, operationId, { status: "succeeded", steps });
    broadcast = await setBroadcastStatus(env, broadcast.id, "live", {
      operation_id: operationId,
      workflow_step: "live",
      actual_start_at: new Date().toISOString(),
      error_message: null,
    });
    return { ok: true, broadcast, operation_id: operationId, steps };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Go live failed";
    const running = steps.find((s) => s.status === "running");
    if (running) {
      running.status = "failed";
      running.detail = message;
    }
    await updateOperation(env, operationId, { status: "failed", steps, error_message: message });
    broadcast = await setBroadcastStatus(env, broadcast.id, "failed", {
      operation_id: operationId,
      error_message: message,
    });
    return { ok: false, broadcast, operation_id: operationId, steps, error: message };
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
