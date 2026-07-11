(function () {
  var REFRESH_INTERVAL_MS = 10000;
  var LOAD_TIMEOUT_MS = 25000;
  var SCALE_STORAGE_KEY = "weatherfront-scale";
  var WEATHERFRONT_URL = "https://app.weatherfront.com";
  var IS_DEV =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    (window.location.hostname || "").includes("workers.dev");

  var scaleSelect = document.getElementById("scale-select");
  var copyGpsBtn = document.getElementById("copy-gps-btn");
  var gpsStatusBadge = document.getElementById("gps-status-badge");
  var gpsCoords = document.getElementById("gps-coords");
  var frameScaler = document.getElementById("frame-scaler");
  var frame = document.getElementById("weatherfront-frame");
  var errorEl = document.getElementById("weatherfront-error");
  var errorDetail = document.getElementById("weatherfront-error-detail");
  var errorDiag = document.getElementById("weatherfront-error-diag");
  var retryBtn = document.getElementById("weatherfront-retry-btn");

  var pollTimer = null;
  var loadTimer = null;
  var latestCoordsText = null;
  var frameLoaded = false;

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

  function showError(message, diagnostic) {
    if (!errorEl) return;
    frameLoaded = false;
    if (frameScaler) frameScaler.hidden = true;
    errorEl.hidden = false;
    if (errorDetail) errorDetail.textContent = message;
    if (errorDiag) {
      if (IS_DEV && diagnostic) {
        errorDiag.hidden = false;
        errorDiag.textContent = diagnostic;
      } else {
        errorDiag.hidden = true;
        errorDiag.textContent = "";
      }
    }
  }

  function clearLoadTimer() {
    if (loadTimer) {
      clearTimeout(loadTimer);
      loadTimer = null;
    }
  }

  function armLoadWatch() {
    clearLoadTimer();
    frameLoaded = false;
    hideError();
    loadTimer = setTimeout(function () {
      if (frameLoaded) return;
      showError(
        "WeatherFront did not finish loading. It may be blocked from embedding, or the network request failed.",
        [
          "mode=direct-iframe",
          "src=" + WEATHERFRONT_URL,
          "timeout_ms=" + LOAD_TIMEOUT_MS,
          "note=Cross-origin iframe; parent cannot read WF DOM, Mapbox, or cookies.",
          "note=Previous reverse-proxy mode broke Mapbox tiles (token/origin) and login assets.",
        ].join("\n"),
      );
    }, LOAD_TIMEOUT_MS);
  }

  function reloadFrame() {
    if (!frame) return;
    hideError();
    armLoadWatch();
    frame.src = WEATHERFRONT_URL + (WEATHERFRONT_URL.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
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
      " · platform GPS active";

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
    frame.addEventListener("load", function () {
      frameLoaded = true;
      clearLoadTimer();
      hideError();
    });
    frame.addEventListener("error", function () {
      clearLoadTimer();
      showError(
        "The browser reported an error loading WeatherFront.",
        "mode=direct-iframe\nsrc=" + WEATHERFRONT_URL + "\nevent=iframe.error",
      );
    });
    armLoadWatch();
  }

  loadScalePreference();
  refreshPlatformGps();
  startPolling();
})();
