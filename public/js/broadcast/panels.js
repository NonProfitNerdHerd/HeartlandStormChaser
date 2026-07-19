import { displayNumber, displayValue } from "./status-model.js";
import { confirmAction, escapeHtml, formatRelative } from "./ui-utils.js";

function statRow(label, value) {
  return `<div class="bcc-stat"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

export function renderStats(container, stats, connected) {
  if (!container) return;
  if (!connected) {
    container.innerHTML = `<p class="bcc-empty">OBS statistics unavailable.</p>`;
    return;
  }

  const s = stats || {};
  container.innerHTML = `
    <dl class="bcc-stats-grid">
      ${statRow("OBS version", displayValue(s.obsVersion))}
      ${statRow("WebSocket version", displayValue(s.obsWebSocketVersion))}
      ${statRow("Program scene", displayValue(s.currentProgramScene))}
      ${statRow("Streaming", s.streamingActive ? "Active" : "Inactive")}
      ${statRow("Recording", s.recordingActive ? "Active" : "Inactive")}
      ${statRow("CPU usage", s.cpuUsage == null ? "Unavailable" : `${displayNumber(s.cpuUsage, 1)}%`)}
      ${statRow("Memory usage", s.memoryUsage == null ? "Unavailable" : `${displayNumber(s.memoryUsage, 0)} MB`)}
      ${statRow("Active FPS", displayNumber(s.activeFps, 2))}
      ${statRow("Avg frame render", s.averageFrameTime == null ? "Unavailable" : `${displayNumber(s.averageFrameTime, 2)} ms`)}
      ${statRow("Rendered frames", displayValue(s.renderTotalFrames))}
      ${statRow("Missed render frames", displayValue(s.renderSkippedFrames))}
      ${statRow("Output skipped frames", displayValue(s.outputSkippedFrames))}
      ${statRow("Output total frames", displayValue(s.outputTotalFrames))}
      ${statRow("Stream duration", displayValue(s.streamTimecode))}
      ${statRow("Recording duration", displayValue(s.recordTimecode))}
    </dl>
  `;
}

export function renderStreamControls(container, state, handlers) {
  if (!container) return;
  const listener = state.data?.listener || {};
  const connected = Boolean(listener.obsConnected);
  const streaming = Boolean(listener.streamingActive);
  const recording = Boolean(listener.recordingActive);
  const busy = Boolean(state.controlBusy);

  container.innerHTML = `
    <div class="bcc-controls">
      ${
        streaming
          ? `<button type="button" class="btn btn--danger bcc-control-btn" data-action="stop-stream" ${!connected || busy ? "disabled" : ""}>Stop streaming</button>`
          : `<button type="button" class="btn btn--primary bcc-control-btn" data-action="start-stream" ${busy ? "disabled" : ""}>Start streaming</button>`
      }
      ${
        recording
          ? `<button type="button" class="btn btn--danger bcc-control-btn" data-action="stop-record" ${!connected || busy ? "disabled" : ""}>Stop recording</button>`
          : `<button type="button" class="btn btn--primary bcc-control-btn" data-action="start-record" ${!connected || busy ? "disabled" : ""}>Start recording</button>`
      }
      <button type="button" class="btn btn--secondary bcc-control-btn" data-action="schedule-broadcast" ${busy ? "disabled" : ""}>Schedule Broadcast</button>
      <button type="button" class="btn btn--secondary bcc-control-btn" data-action="allow-cameras">Allow / refresh cameras</button>
      <button type="button" class="btn btn--primary bcc-control-btn" data-action="open-publisher">Open camera monitor</button>
    </div>
    <p class="bcc-inline-error" data-control-error ${state.controlError ? "" : "hidden"}>${escapeHtml(state.controlError || "")}</p>
  `;

  const bind = (action, fn) => {
    const btn = container.querySelector(`[data-action="${action}"]`);
    if (btn) btn.addEventListener("click", fn);
  };

  bind("start-stream", () => handlers.startStream());
  bind("stop-stream", () => {
    if (handlers.hasActiveWorkflow?.()) {
      handlers.openStartWorkflow?.();
      return;
    }
    if (confirmAction("Stop the active stream?")) handlers.stopStream();
  });
  bind("start-record", () => handlers.startRecording());
  bind("stop-record", () => {
    if (confirmAction("Stop the active recording?")) handlers.stopRecording();
  });
  bind("schedule-broadcast", () => handlers.scheduleBroadcast?.());
  bind("allow-cameras", () => handlers.allowCameras?.());
  bind("open-publisher", () => handlers.openCameraMonitor?.());
}

export function renderTelemetry(container, telemetry) {
  if (!container) return;
  const gps = telemetry?.gps;
  const weather = telemetry?.weather && !telemetry.weather.error ? telemetry.weather : null;
  const target = telemetry?.target || {};
  const warnings = telemetry?.warnings || {};
  const gpsStale = gps?.status === "STALE";

  const rows = [
    ["Latitude", gps?.latitude == null ? null : displayNumber(gps.latitude, 5)],
    ["Longitude", gps?.longitude == null ? null : displayNumber(gps.longitude, 5)],
    ["City / State", gps?.city || weather?.city ? `${displayValue(gps?.city || weather?.city)}, ${displayValue(gps?.state || weather?.state)}` : null],
    ["Speed (mph)", gps?.speed_mph == null ? null : displayNumber(gps.speed_mph, 1)],
    ["Heading", gps?.heading_degrees == null ? null : `${displayNumber(gps.heading_degrees, 0)}°`],
    ["Elevation", null],
    ["GPS accuracy (m)", gps?.accuracy_meters == null ? null : displayNumber(gps.accuracy_meters, 1)],
    ["GPS device", gps?.device_name || null],
    ["GPS freshness", gps?.status || null],
    ["Target", target.city ? `${target.city}, ${target.state || ""}`.trim() : null],
    ["Distance to target", target.distance_miles == null ? null : displayNumber(target.distance_miles, 1)],
    ["ETA", target.eta || null],
    ["Temperature (°F)", weather?.temperature_f == null ? null : displayNumber(weather.temperature_f, 1)],
    ["Conditions", weather?.conditions || null],
    ["Dew point (°F)", weather?.dew_point_f == null ? null : displayNumber(weather.dew_point_f, 1)],
    ["Humidity (%)", weather?.humidity_percent == null ? null : displayNumber(weather.humidity_percent, 0)],
    ["Wind speed (mph)", weather?.wind_speed_mph == null ? null : displayNumber(weather.wind_speed_mph, 1)],
    ["Wind gust (mph)", weather?.wind_gusts_mph == null ? null : displayNumber(weather.wind_gusts_mph, 1)],
    ["Wind direction", weather?.wind_direction || null],
    ["Pressure (hPa)", weather?.pressure_hpa == null ? null : displayNumber(weather.pressure_hpa, 1)],
    ["Visibility (mi)", weather?.visibility_miles == null ? null : displayNumber(weather.visibility_miles, 1)],
    ["Warning", warnings.warning || null],
    ["Watch", warnings.watch || null],
    ["Weather updated", weather?.fetched_at ? formatRelative(weather.fetched_at) : null],
  ];

  container.innerHTML = `
    <div class="bcc-telemetry${gpsStale ? " bcc-telemetry--stale" : ""}">
      ${
        gpsStale
          ? `<p class="bcc-banner-warn">GPS data is stale (older than the platform live threshold).</p>`
          : ""
      }
      <dl class="bcc-telemetry-grid">
        ${rows
          .map(
            ([label, value]) => `
          <div class="bcc-telemetry-item">
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(displayValue(value))}</dd>
          </div>`,
          )
          .join("")}
      </dl>
    </div>
  `;
}

export function renderEventLog(container, events) {
  if (!container) return;
  if (!events?.length) {
    container.innerHTML = `<p class="bcc-empty">No events yet.</p>`;
    return;
  }

  container.innerHTML = `
    <ul class="bcc-event-log">
      ${events
        .map(
          (event) => `
        <li class="bcc-event bcc-event--${escapeHtml(event.severity || "information")}">
          <time datetime="${escapeHtml(event.timestamp)}">${escapeHtml(new Date(event.timestamp).toLocaleTimeString())}</time>
          <span class="bcc-event__category">${escapeHtml(event.category)}</span>
          <span class="bcc-event__message">${escapeHtml(event.message)}</span>
          <span class="bcc-event__severity">${escapeHtml(event.severity)}</span>
        </li>`,
        )
        .join("")}
    </ul>
  `;
}
