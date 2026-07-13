(function () {
  var REFRESH_INTERVAL_MS = 10000;
  var SCALE_STORAGE_KEY = "weatherfront-scale";
  var WEATHERFRONT_URL = "https://app.weatherfront.com/";

  var scaleSelect = document.getElementById("scale-select");
  var copyGpsBtn = document.getElementById("copy-gps-btn");
  var gpsStatusBadge = document.getElementById("gps-status-badge");
  var gpsCoords = document.getElementById("gps-coords");
  var frameScaler = document.getElementById("frame-scaler");
  var frame = document.getElementById("weatherfront-frame");
  var errorEl = document.getElementById("weatherfront-error");
  var errorDetail = document.getElementById("weatherfront-error-detail");
  var retryBtn = document.getElementById("weatherfront-retry-btn");

  var pollTimer = null;
  var latestCoordsText = null;

  function statusBadgeClass(status) {
    if (status === "LIVE") return "badge badge--success";
    if (status === "STALE") return "badge badge--warning";
    return "badge badge--muted";
  }

  function statusBadgeLabel(status) {
    if (status === "LIVE") return "GPS Live";
    if (status === "STALE") return "GPS Stale";
    return "GPS Unknown";
  }

  function formatNumber(value, digits) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return Number(value).toFixed(digits);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setScale(percent) {
    var scale = Number(percent) / 100;
    frameScaler.style.setProperty("--wf-scale", String(scale));
    localStorage.setItem(SCALE_STORAGE_KEY, String(percent));
  }

  function loadScalePreference() {
    var stored = localStorage.getItem(SCALE_STORAGE_KEY) || "100";
    if (scaleSelect.querySelector('option[value="' + stored + '"]')) {
      scaleSelect.value = stored;
    }
    setScale(scaleSelect.value);
  }

  function setCopyEnabled(enabled) {
    copyGpsBtn.disabled = !enabled;
  }

  async function copyPlatformCoords() {
    if (!latestCoordsText) return;
    try {
      await navigator.clipboard.writeText(latestCoordsText);
      copyGpsBtn.textContent = "Copied";
      setTimeout(function () {
        copyGpsBtn.textContent = "Copy platform coords";
      }, 1500);
    } catch (_error) {
      window.prompt("Copy platform coordinates:", latestCoordsText);
    }
  }

  function hideError() {
    if (errorEl) errorEl.hidden = true;
    if (frameScaler) frameScaler.hidden = false;
  }

  function showError(message) {
    if (!errorEl) return;
    // Keep the iframe visible behind/under the message only if needed —
    // for a blocked embed, hide the empty frame.
    if (frameScaler) frameScaler.hidden = true;
    errorEl.hidden = false;
    if (errorDetail) errorDetail.textContent = message;
  }

  function reloadFrame() {
    if (!frame) return;
    hideError();
    frame.src = WEATHERFRONT_URL + "?_=" + Date.now();
  }

  function renderPlatformStatus(data) {
    var platform = data && data.platform_source;
    latestCoordsText = null;
    setCopyEnabled(false);

    if (!platform) {
      gpsStatusBadge.className = "badge badge--muted";
      gpsStatusBadge.textContent = "No platform GPS";
      gpsCoords.textContent =
        (data && data.message) || "Select a platform GPS source on the GPS page.";
      return;
    }

    var location = platform.location;
    var status = location ? location.status : platform.status;

    gpsStatusBadge.className = statusBadgeClass(status);
    gpsStatusBadge.textContent = statusBadgeLabel(status);

    if (!location) {
      gpsCoords.textContent =
        escapeHtml(platform.device_name) + " · waiting for first location fix";
      return;
    }

    latestCoordsText =
      formatNumber(location.latitude, 5) + ", " + formatNumber(location.longitude, 5);

    gpsCoords.textContent =
      escapeHtml(platform.device_name) +
      " · " +
      latestCoordsText +
      (location.speed_mph != null ? " · " + formatNumber(location.speed_mph, 1) + " mph" : "") +
      " · platform GPS (not injected into iframe yet)";

    setCopyEnabled(true);
  }

  async function refreshPlatformGps() {
    try {
      var response = await fetch("/api/gps/platform");
      var data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Request failed (" + response.status + ")");
      }
      renderPlatformStatus(data);
    } catch (error) {
      gpsStatusBadge.className = "badge badge--muted";
      gpsStatusBadge.textContent = "GPS error";
      gpsCoords.textContent = error.message || "Unable to load platform GPS.";
      latestCoordsText = null;
      setCopyEnabled(false);
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshPlatformGps, REFRESH_INTERVAL_MS);
  }

  scaleSelect.addEventListener("change", function () {
    setScale(scaleSelect.value);
  });

  copyGpsBtn.addEventListener("click", copyPlatformCoords);

  if (retryBtn) {
    retryBtn.addEventListener("click", reloadFrame);
  }

  if (frame) {
    hideError();
    frame.addEventListener("error", function () {
      showError(
        "The browser could not load https://app.weatherfront.com/ in this iframe. Try Retry or open it in a new tab.",
      );
    });
  }

  loadScalePreference();
  refreshPlatformGps();
  startPolling();
})();
