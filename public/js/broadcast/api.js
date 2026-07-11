async function parseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const BroadcastApi = {
  async getStatus(refresh = false) {
    const query = refresh ? "?refresh=1" : "";
    const response = await fetch(`/api/broadcast/status${query}`, {
      credentials: "same-origin",
    });
    return parseJson(response);
  },

  async activateScene(sceneName) {
    const response = await fetch("/api/broadcast/scenes/activate", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneName }),
    });
    return parseJson(response);
  },

  async setSourceVisibility(sourceName, visible) {
    const response = await fetch("/api/broadcast/sources/visibility", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceName, visible }),
    });
    return parseJson(response);
  },

  async setSourceMute(sourceName, muted) {
    const response = await fetch("/api/broadcast/sources/mute", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceName, muted }),
    });
    return parseJson(response);
  },

  /**
   * @param {{ sourceName?: string, matchers?: string[] }} payload
   */
  async refreshSource(payload) {
    const response = await fetch("/api/broadcast/sources/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return parseJson(response);
  },

  async startStream() {
    return parseJson(
      await fetch("/api/broadcast/stream/start", { method: "POST", credentials: "same-origin" }),
    );
  },

  async stopStream() {
    return parseJson(
      await fetch("/api/broadcast/stream/stop", { method: "POST", credentials: "same-origin" }),
    );
  },

  async startRecording() {
    return parseJson(
      await fetch("/api/broadcast/recording/start", {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },

  async stopRecording() {
    return parseJson(
      await fetch("/api/broadcast/recording/stop", {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },

  async reconnect() {
    return parseJson(
      await fetch("/api/broadcast/reconnect", { method: "POST", credentials: "same-origin" }),
    );
  },

  async getSettings() {
    const response = await fetch("/api/broadcast/settings", {
      credentials: "same-origin",
    });
    return parseJson(response);
  },

  async saveSettings(payload) {
    const response = await fetch("/api/broadcast/settings", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return parseJson(response);
  },

  async activateVdoLink(linkKey) {
    const response = await fetch("/api/broadcast/vdo-links/activate", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkKey }),
    });
    return parseJson(response);
  },

  async listScheduled(from, to) {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const q = params.toString() ? `?${params}` : "";
    return parseJson(await fetch(`/api/broadcast/scheduled${q}`, { credentials: "same-origin" }));
  },

  async createScheduled(payload) {
    return parseJson(
      await fetch("/api/broadcast/scheduled", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  },

  async updateScheduled(id, payload) {
    return parseJson(
      await fetch(`/api/broadcast/scheduled/${encodeURIComponent(id)}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  },

  async deleteScheduled(id) {
    return parseJson(
      await fetch(`/api/broadcast/scheduled/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      }),
    );
  },

  async selectScheduled(id) {
    return parseJson(
      await fetch(`/api/broadcast/scheduled/${encodeURIComponent(id)}/select`, {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },

  async cancelScheduled(id) {
    return parseJson(
      await fetch(`/api/broadcast/scheduled/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },

  async prepareScheduled(id) {
    return parseJson(
      await fetch(`/api/broadcast/scheduled/${encodeURIComponent(id)}/prepare`, {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },

  async startScheduledOutput(id, idempotencyKey) {
    return parseJson(
      await fetch(`/api/broadcast/scheduled/${encodeURIComponent(id)}/start-output`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
      }),
    );
  },

  async confirmScheduledIngest(id) {
    const response = await fetch(`/api/broadcast/scheduled/${encodeURIComponent(id)}/confirm-ingest`, {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  },

  async goLiveScheduled(id) {
    return parseJson(
      await fetch(`/api/broadcast/scheduled/${encodeURIComponent(id)}/go-live`, {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },

  async endScheduled(id) {
    return parseJson(
      await fetch(`/api/broadcast/scheduled/${encodeURIComponent(id)}/end`, {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },

  async emergencyStopScheduled(id) {
    return parseJson(
      await fetch(`/api/broadcast/scheduled/${encodeURIComponent(id)}/emergency-stop`, {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },

  async disconnectYoutube() {
    return parseJson(
      await fetch("/api/broadcast/youtube/disconnect", {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },
};
