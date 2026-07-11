import { escapeHtml, formatRelative } from "./ui-utils.js";

/**
 * @param {HTMLElement | null} container
 * @param {object | null | undefined} settings
 * @param {{ saving: boolean, testing: boolean, error: string | null, message: string | null }} ui
 * @param {(payload: Record<string, string>) => void} onSave
 * @param {() => void} onTest
 * @param {object | null | undefined} youtube
 * @param {{ onConnect?: () => void, onDisconnect?: () => void }} youtubeHandlers
 */
export function renderSettings(container, settings, ui, onSave, onTest, youtube, youtubeHandlers = {}) {
  if (!container) return;

  const s = settings || {
    listener_url: "",
    obs_host: "127.0.0.1",
    obs_port: "4455",
    obs_reconnect_ms: "3000",
    listener_token_set: false,
    obs_password_set: false,
    updated_at: null,
    source: "none",
  };

  const yt = youtube || {
    clientConfigured: false,
    connected: false,
    channelTitle: null,
    redirectUri: "",
  };

  container.innerHTML = `
    <form class="bcc-settings" data-bcc-settings-form>
      <p class="bcc-settings__help">
        Run the OBS listener on the Desktop PC that hosts main OBS, then expose it with a Cloudflare tunnel
        (<code>services/obs-listener/scripts/install-listener-autostart.ps1</code> keeps listener + Quick Tunnel alive).
        Prefer a named tunnel with a fixed hostname for chase days. Passwords are write-only: leave blank to keep the current value.
      </p>
      <div class="bcc-settings__grid">
        <label class="bcc-settings__field">
          <span>Listener URL</span>
          <input type="url" name="listener_url" autocomplete="off" placeholder="https://….trycloudflare.com" value="${escapeHtml(s.listener_url || "")}" />
        </label>
        <label class="bcc-settings__field">
          <span>Listener auth token ${s.listener_token_set ? "(set)" : "(not set)"}</span>
          <input type="password" name="listener_token" autocomplete="new-password" placeholder="${s.listener_token_set ? "Leave blank to keep current token" : "Must match LISTENER_AUTH_TOKEN on Desktop"}" />
        </label>
        <label class="bcc-settings__field">
          <span>OBS WebSocket host</span>
          <input type="text" name="obs_host" autocomplete="off" value="${escapeHtml(s.obs_host || "127.0.0.1")}" />
        </label>
        <label class="bcc-settings__field">
          <span>OBS WebSocket port</span>
          <input type="number" name="obs_port" min="1" max="65535" value="${escapeHtml(s.obs_port || "4455")}" />
        </label>
        <label class="bcc-settings__field">
          <span>OBS WebSocket password ${s.obs_password_set ? "(set)" : "(not set)"}</span>
          <input type="password" name="obs_password" autocomplete="new-password" placeholder="${s.obs_password_set ? "Leave blank to keep current password" : "OBS Tools → WebSocket Server Settings"}" />
        </label>
        <label class="bcc-settings__field">
          <span>OBS reconnect interval (ms)</span>
          <input type="number" name="obs_reconnect_ms" min="500" max="120000" step="100" value="${escapeHtml(s.obs_reconnect_ms || "3000")}" />
        </label>
      </div>
      <div class="bcc-settings__actions">
        <button type="submit" class="btn btn--primary" ${ui.saving || ui.testing ? "disabled" : ""}>${ui.saving ? "Saving…" : "Save settings"}</button>
        <button type="button" class="btn btn--secondary" data-bcc-test-connection ${ui.saving || ui.testing ? "disabled" : ""}>${ui.testing ? "Testing…" : "Test connection"}</button>
        <p class="bcc-settings__meta">
          Source: ${escapeHtml(s.source || "none")}
          · Last saved: ${escapeHtml(s.updated_at ? formatRelative(s.updated_at) : "Never")}
        </p>
      </div>

      <section class="bcc-settings__youtube" aria-labelledby="bcc-youtube-heading">
        <h3 id="bcc-youtube-heading" class="bcc-settings__subtitle">YouTube Live</h3>
        <p class="bcc-settings__help">
          Connect the channel that will host scheduled broadcasts. Requires Worker secrets
          <code>YOUTUBE_CLIENT_ID</code> and <code>YOUTUBE_CLIENT_SECRET</code>, plus this redirect URI in Google Cloud:
          <code>${escapeHtml(yt.redirectUri || "(deploy first to see redirect URI)")}</code>
        </p>
        <p class="bcc-settings__meta">
          ${
            !yt.clientConfigured
              ? "Client credentials not configured on the Worker yet."
              : yt.connected
                ? `Connected${yt.channelTitle ? `: ${escapeHtml(yt.channelTitle)}` : ""}`
                : "Not connected"
          }
        </p>
        <div class="bcc-settings__actions">
          ${
            yt.connected
              ? `<button type="button" class="btn btn--secondary" data-bcc-youtube-disconnect ${ui.saving ? "disabled" : ""}>Disconnect YouTube</button>`
              : `<button type="button" class="btn btn--primary" data-bcc-youtube-connect ${!yt.clientConfigured || ui.saving ? "disabled" : ""}>Connect YouTube</button>`
          }
        </div>
      </section>

      <p class="bcc-inline-error" ${ui.error ? "" : "hidden"}>${escapeHtml(ui.error || "")}</p>
      <p class="bcc-settings__success" ${ui.message ? "" : "hidden"}>${escapeHtml(ui.message || "")}</p>
    </form>
  `;

  const form = container.querySelector("[data-bcc-settings-form]");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    /** @type {Record<string, string>} */
    const payload = {};
    for (const [key, value] of data.entries()) {
      payload[key] = String(value);
    }
    onSave(payload);
  });

  const testBtn = form.querySelector("[data-bcc-test-connection]");
  if (testBtn) {
    testBtn.addEventListener("click", () => onTest());
  }

  form.querySelector("[data-bcc-youtube-connect]")?.addEventListener("click", () => {
    youtubeHandlers.onConnect?.();
  });
  form.querySelector("[data-bcc-youtube-disconnect]")?.addEventListener("click", () => {
    youtubeHandlers.onDisconnect?.();
  });
}
