import http from "node:http";
import type { ObsController } from "./obs-controller.js";
import type { ListenerConfig } from "./types.js";

type JsonBody = Record<string, unknown>;

function readJson(req: http.IncomingMessage): Promise<JsonBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunks.reduce((sum, part) => sum + part.length, 0) > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("JSON body must be an object"));
          return;
        }
        resolve(parsed as JsonBody);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function unauthorized(res: http.ServerResponse): void {
  sendJson(res, 401, { ok: false, error: "Unauthorized" });
}

function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  if (!header) {
    return false;
  }
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value === token;
}

export function createHttpServer(config: ListenerConfig, controller: ObsController): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${config.listenerHost}:${config.listenerPort}`);
      const method = req.method || "GET";

      if (url.pathname === "/health" && method === "GET") {
        const snapshot = controller.getSnapshot();
        sendJson(res, 200, {
          ok: true,
          listener: "online",
          obsConnected: snapshot.obsConnected,
          updatedAt: snapshot.listenerUpdatedAt,
        });
        return;
      }

      if (!isAuthorized(req, config.listenerAuthToken)) {
        unauthorized(res);
        return;
      }

      if (url.pathname === "/status" && method === "GET") {
        const refresh = url.searchParams.get("refresh") === "1";
        const snapshot = refresh ? await controller.refreshAll() : controller.getSnapshot();
        sendJson(res, 200, { ok: true, ...snapshot });
        return;
      }

      if (url.pathname === "/scenes" && method === "GET") {
        const snapshot = controller.getSnapshot();
        sendJson(res, 200, {
          ok: true,
          currentProgramScene: snapshot.currentProgramScene,
          scenes: snapshot.scenes,
          obsConnected: snapshot.obsConnected,
        });
        return;
      }

      if (url.pathname === "/scenes/activate" && method === "POST") {
        const body = await readJson(req);
        const sceneName = typeof body.sceneName === "string" ? body.sceneName : "";
        await controller.activateScene(sceneName);
        sendJson(res, 200, { ok: true, currentProgramScene: sceneName });
        return;
      }

      if (url.pathname === "/sources" && method === "GET") {
        const snapshot = controller.getSnapshot();
        sendJson(res, 200, {
          ok: true,
          sources: snapshot.sources,
          currentProgramScene: snapshot.currentProgramScene,
          obsConnected: snapshot.obsConnected,
        });
        return;
      }

      if (url.pathname === "/sources/visibility" && method === "POST") {
        const body = await readJson(req);
        const sourceName = typeof body.sourceName === "string" ? body.sourceName : "";
        if (typeof body.visible !== "boolean") {
          sendJson(res, 400, { ok: false, error: "visible must be a boolean" });
          return;
        }
        await controller.setSourceVisibility(sourceName, body.visible);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/sources/mute" && method === "POST") {
        const body = await readJson(req);
        const sourceName = typeof body.sourceName === "string" ? body.sourceName : "";
        if (typeof body.muted !== "boolean") {
          sendJson(res, 400, { ok: false, error: "muted must be a boolean" });
          return;
        }
        await controller.setSourceMute(sourceName, body.muted);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/sources/refresh" && method === "POST") {
        const body = await readJson(req);
        const sourceName = typeof body.sourceName === "string" ? body.sourceName.trim() : "";
        const matchers = Array.isArray(body.matchers)
          ? body.matchers.filter((item): item is string => typeof item === "string")
          : [];

        if (sourceName) {
          await controller.refreshBrowserSource(sourceName);
          sendJson(res, 200, { ok: true, refreshed: [sourceName] });
          return;
        }

        if (matchers.length) {
          const refreshed = await controller.refreshBrowserSourcesByMatchers(matchers);
          sendJson(res, 200, { ok: true, refreshed });
          return;
        }

        sendJson(res, 400, { ok: false, error: "sourceName or matchers is required" });
        return;
      }

      if (url.pathname.startsWith("/sources/") && url.pathname.endsWith("/thumbnail") && method === "GET") {
        const encoded = url.pathname.slice("/sources/".length, -"/thumbnail".length);
        const sourceName = decodeURIComponent(encoded);
        const thumbnail = await controller.getSourceThumbnail(sourceName);
        sendJson(res, 200, { ok: true, thumbnailDataUrl: thumbnail });
        return;
      }

      if (url.pathname === "/stats" && method === "GET") {
        const snapshot = await controller.refreshAll();
        sendJson(res, 200, { ok: true, stats: snapshot.stats, obsConnected: snapshot.obsConnected });
        return;
      }

      if (url.pathname === "/stream/settings" && method === "GET") {
        const info = await controller.getStreamServiceInfo();
        sendJson(res, 200, {
          ok: true,
          streamServiceType: info.streamServiceType,
          server: info.server,
          isCustomRtmp: info.isCustomRtmp,
        });
        return;
      }

      if (url.pathname === "/stream/settings" && method === "POST") {
        const body = await readJson(req);
        const server =
          typeof body.serverUrl === "string"
            ? body.serverUrl
            : typeof body.server === "string"
              ? body.server
              : "";
        const key =
          typeof body.streamKey === "string"
            ? body.streamKey
            : typeof body.key === "string"
              ? body.key
              : "";
        const applied = await controller.setCustomRtmpDestination(server, key);
        sendJson(res, 200, {
          ok: true,
          streamServiceType: applied.streamServiceType,
          server: applied.server,
          verified: applied.verified,
          isCustomRtmp: true,
          // Never echo the stream key back to the caller
        });
        return;
      }

      if (url.pathname === "/stream/start" && method === "POST") {
        const result = await controller.startStream();
        sendJson(res, 200, {
          ok: true,
          streamingActive: result.streamingActive,
          streamServiceType: result.streamServiceType,
        });
        return;
      }

      if (url.pathname === "/stream/stop" && method === "POST") {
        await controller.stopStream();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/recording/start" && method === "POST") {
        await controller.startRecord();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/recording/stop" && method === "POST") {
        await controller.stopRecord();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/reconnect" && method === "POST") {
        await controller.reconnect();
        sendJson(res, 200, { ok: true, ...controller.getSnapshot() });
        return;
      }

      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Listener request failed";
      console.error("[obs-listener] request error:", message);
      sendJson(res, 500, { ok: false, error: message });
    }
  });
}
