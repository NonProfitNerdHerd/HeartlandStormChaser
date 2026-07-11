import { escapeHtml } from "./ui-utils.js";
import { scenesInObsUiOrder } from "./camera-dock-model.js";

export function renderSceneSwitcher(container, state, onActivate) {
  if (!container) return;
  const listener = state.data?.listener;
  const scenes = scenesInObsUiOrder(listener?.scenes || []);
  const current = listener?.currentProgramScene || null;
  const busy = Boolean(state.sceneBusy);
  const connected = Boolean(listener?.obsConnected);

  if (!connected) {
    container.innerHTML = `<p class="bcc-empty">Connect OBS to load scenes.</p>`;
    return;
  }

  if (!scenes.length) {
    container.innerHTML = `<p class="bcc-empty">No scenes returned from OBS.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="bcc-scene-grid" role="group" aria-label="Scenes" style="grid-template-columns: repeat(${scenes.length}, minmax(0, 1fr))">
      ${scenes
        .map((scene) => {
          const active = scene.name === current;
          return `
            <button
              type="button"
              class="bcc-scene-btn${active ? " bcc-scene-btn--active" : ""}"
              data-scene-name="${escapeHtml(scene.name)}"
              ${busy || active ? "disabled" : ""}
              aria-pressed="${active ? "true" : "false"}"
            >
              <span class="bcc-scene-btn__name">${escapeHtml(scene.name)}</span>
            </button>
          `;
        })
        .join("")}
    </div>
    <p class="bcc-inline-error" data-scene-error ${state.sceneError ? "" : "hidden"}>${escapeHtml(state.sceneError || "")}</p>
  `;

  container.querySelectorAll("[data-scene-name]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.getAttribute("data-scene-name");
      if (name) onActivate(name);
    });
  });
}

export function renderSources(container, state, handlers) {
  if (!container) return;
  const sources = state.data?.listener?.sources || [];
  const connected = Boolean(state.data?.listener?.obsConnected);

  if (!connected) {
    container.innerHTML = `<p class="bcc-empty">Source monitor unavailable while OBS is disconnected.</p>`;
    return;
  }

  if (!sources.length) {
    container.innerHTML = `<p class="bcc-empty">No sources in the active scene.</p>`;
    return;
  }

  container.innerHTML = sources
    .map((source) => {
      const health = source.health || "unknown";
      return `
        <article class="bcc-source-card bcc-source-card--${escapeHtml(health)}">
          <div class="bcc-source-card__header">
            <h3 class="bcc-source-card__name">${escapeHtml(source.name)}</h3>
            <span class="bcc-badge bcc-badge--${escapeHtml(health)}">${escapeHtml(health)}</span>
          </div>
          <dl class="bcc-source-card__meta">
            <div><dt>Type</dt><dd>${escapeHtml(source.sourceType || "Unavailable")}</dd></div>
            <div><dt>Scene</dt><dd>${escapeHtml(source.sceneName || "Unavailable")}</dd></div>
            <div><dt>Visible</dt><dd>${source.visible ? "Yes" : "No"}</dd></div>
            <div><dt>Muted</dt><dd>${source.canMute ? (source.muted ? "Yes" : "No") : "N/A"}</dd></div>
            <div><dt>Resolution</dt><dd>${source.width && source.height ? `${source.width}×${source.height}` : "Unavailable"}</dd></div>
            <div><dt>FPS</dt><dd>${source.fps == null ? "Unavailable" : escapeHtml(String(source.fps))}</dd></div>
          </dl>
          <p class="bcc-source-card__reason">${escapeHtml(source.healthReason || "")}</p>
          <div class="bcc-source-card__actions">
            <button type="button" class="btn btn--secondary" data-source-show="${escapeHtml(source.name)}" ${source.visible ? "disabled" : ""}>Show</button>
            <button type="button" class="btn btn--secondary" data-source-hide="${escapeHtml(source.name)}" ${source.visible ? "" : "disabled"}>Hide</button>
            ${
              source.canMute
                ? `
              <button type="button" class="btn btn--secondary" data-source-mute="${escapeHtml(source.name)}" ${source.muted ? "disabled" : ""}>Mute</button>
              <button type="button" class="btn btn--secondary" data-source-unmute="${escapeHtml(source.name)}" ${source.muted ? "" : "disabled"}>Unmute</button>
            `
                : ""
            }
            <button type="button" class="btn btn--secondary" data-source-refresh="${escapeHtml(source.name)}">Refresh</button>
          </div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll("[data-source-show]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.setVisibility(btn.getAttribute("data-source-show"), true));
  });
  container.querySelectorAll("[data-source-hide]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.setVisibility(btn.getAttribute("data-source-hide"), false));
  });
  container.querySelectorAll("[data-source-mute]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.setMute(btn.getAttribute("data-source-mute"), true));
  });
  container.querySelectorAll("[data-source-unmute]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.setMute(btn.getAttribute("data-source-unmute"), false));
  });
  container.querySelectorAll("[data-source-refresh]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.getAttribute("data-source-refresh");
      if (name && handlers.refreshSource) {
        handlers.refreshSource(name);
      } else if (handlers.refreshStatus) {
        handlers.refreshStatus();
      }
    });
  });
}
