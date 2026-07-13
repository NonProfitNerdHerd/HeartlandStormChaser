(function () {
  var REFRESH_INTERVAL_MS = 10000;
  var SCALE_STORAGE_KEY = "weatherfront-scale";
  var WEATHERFRONT_URL = "/weatherfront-embed/";
  var VALID_SCALES = { "90": true, "100": true, "110": true, "125": true };

  var scaleButtons = document.querySelectorAll(".weatherfront-scale__btn");
  var iframeGpsBug = document.getElementById("iframe-gps-bug");
  var gpsStatusBadge = document.getElementById("gps-status-badge");
  var gpsCoords = document.getElementById("gps-coords");
  var frameScaler = document.getElementById("frame-scaler");
  var frame = document.getElementById("weatherfront-frame");
  var errorEl = document.getElementById("weatherfront-error");
  var errorDetail = document.getElementById("weatherfront-error-detail");
  var retryBtn = document.getElementById("weatherfront-retry-btn");

  var pollTimer = null;

  function setIframeGpsBug(captured) {
    if (!iframeGpsBug) return;
    if (captured === true) {
      iframeGpsBug.dataset.state = "ok";
      iframeGpsBug.textContent = "GPS";
      iframeGpsBug.title = "Iframe captured platform GPS";
      return;
    }
    if (captured === false) {
      iframeGpsBug.dataset.state = "miss";
      iframeGpsBug.textContent = "GPS";
      iframeGpsBug.title = "Iframe did not capture platform GPS";
      return;
    }
    iframeGpsBug.dataset.state = "unknown";
    iframeGpsBug.textContent = "GPS?";
    iframeGpsBug.title = "Waiting for iframe GPS capture status";
  }

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
    var value = String(percent);
    if (!VALID_SCALES[value]) value = "100";

    frameScaler.style.setProperty("--wf-scale", String(Number(value) / 100));
    localStorage.setItem(SCALE_STORAGE_KEY, value);

    scaleButtons.forEach(function (button) {
      var active = button.getAttribute("data-scale") === value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function loadScalePreference() {
    var stored = localStorage.getItem(SCALE_STORAGE_KEY) || "100";
    setScale(stored);
  }

  function hideError() {
    if (errorEl) errorEl.hidden = true;
    if (frameScaler) frameScaler.hidden = false;
  }

  /**
   * Only use the full-page overlay for hard failures.
   * Never cover a partially-loading WeatherFront embed with a timeout overlay.
   */
  function showError(message) {
    if (!errorEl) return;
    if (frameScaler) frameScaler.hidden = true;
    errorEl.hidden = false;
    if (errorDetail) errorDetail.textContent = message;
  }

  function reloadFrame() {
    if (!frame) return;
    hideError();
    setIframeGpsBug(null);
    frame.src = WEATHERFRONT_URL + "?_=" + Date.now();
  }

  function renderPlatformStatus(data) {
    var platform = data && data.platform_source;

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

    gpsCoords.textContent =
      escapeHtml(platform.device_name) +
      " · " +
      formatNumber(location.latitude, 5) +
      ", " +
      formatNumber(location.longitude, 5) +
      (location.speed_mph != null ? " · " + formatNumber(location.speed_mph, 1) + " mph" : "") +
      " · fed into WeatherFront";
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
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshPlatformGps, REFRESH_INTERVAL_MS);
  }

  scaleButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      setScale(button.getAttribute("data-scale"));
    });
  });

  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || data.source !== "weatherfront-geolocation-shim") return;
    if (data.type !== "gps-capture") return;
    setIframeGpsBug(Boolean(data.captured));
  });

  if (retryBtn) {
    retryBtn.addEventListener("click", reloadFrame);
  }

  if (frame) {
    hideError();
    setIframeGpsBug(null);
    frame.addEventListener("error", function () {
      setIframeGpsBug(false);
      showError(
        "The browser could not load the WeatherFront proxy embed. Try Retry, or open WeatherFront in a new tab.",
      );
    });
  }

  loadScalePreference();
  refreshPlatformGps();
  startPolling();
})();
