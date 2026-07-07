(function () {
  var REFRESH_INTERVAL_MS = 10000;
  var COORD_SYNC_THRESHOLD = 0.01;
  var SCALE_STORAGE_KEY = "weatherfront-scale";
  var AUTO_SYNC_STORAGE_KEY = "weatherfront-auto-sync";
  var WEATHERFRONT_BASE = "https://app.weatherfront.com/";

  var scaleSelect = document.getElementById("scale-select");
  var autoSyncCheckbox = document.getElementById("auto-sync-checkbox");
  var syncGpsBtn = document.getElementById("sync-gps-btn");
  var gpsStatusBadge = document.getElementById("gps-status-badge");
  var gpsCoords = document.getElementById("gps-coords");
  var frameScaler = document.getElementById("frame-scaler");
  var weatherfrontFrame = document.getElementById("weatherfront-frame");

  var pollTimer = null;
  var lastSyncedLat = null;
  var lastSyncedLon = null;
  var latestPlatform = null;

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

  function buildWeatherFrontUrl(latitude, longitude) {
    var url = new URL(WEATHERFRONT_BASE);
    if (latitude != null && longitude != null) {
      url.searchParams.set("lat", formatNumber(latitude, 5));
      url.searchParams.set("lon", formatNumber(longitude, 5));
    }
    return url.toString();
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

  function loadAutoSyncPreference() {
    var stored = localStorage.getItem(AUTO_SYNC_STORAGE_KEY);
    autoSyncCheckbox.checked = stored !== "false";
  }

  function saveAutoSyncPreference() {
    localStorage.setItem(AUTO_SYNC_STORAGE_KEY, autoSyncCheckbox.checked ? "true" : "false");
  }

  function coordsChanged(latitude, longitude) {
    if (lastSyncedLat == null || lastSyncedLon == null) return true;
    return (
      Math.abs(latitude - lastSyncedLat) >= COORD_SYNC_THRESHOLD ||
      Math.abs(longitude - lastSyncedLon) >= COORD_SYNC_THRESHOLD
    );
  }

  function syncIframeToCoords(latitude, longitude, force) {
    if (latitude == null || longitude == null) return false;
    if (!force && !coordsChanged(latitude, longitude)) return false;

    var nextUrl = buildWeatherFrontUrl(latitude, longitude);
    if (weatherfrontFrame.src !== nextUrl) {
      weatherfrontFrame.src = nextUrl;
    }

    lastSyncedLat = latitude;
    lastSyncedLon = longitude;
    return true;
  }

  function renderPlatformStatus(data) {
    var platform = data && data.platform_source;

    if (!platform) {
      gpsStatusBadge.className = "badge badge--muted";
      gpsStatusBadge.textContent = "No platform GPS";
      gpsCoords.textContent =
        (data && data.message) || "Select a platform GPS source on the GPS page.";
      latestPlatform = null;
      return;
    }

    latestPlatform = platform;
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
      (location.speed_mph != null ? " · " + formatNumber(location.speed_mph, 1) + " mph" : "");

    if (autoSyncCheckbox.checked) {
      syncIframeToCoords(location.latitude, location.longitude, false);
    }
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

  scaleSelect.addEventListener("change", function () {
    setScale(scaleSelect.value);
  });

  autoSyncCheckbox.addEventListener("change", function () {
    saveAutoSyncPreference();
    if (autoSyncCheckbox.checked && latestPlatform && latestPlatform.location) {
      syncIframeToCoords(
        latestPlatform.location.latitude,
        latestPlatform.location.longitude,
        true,
      );
    }
  });

  syncGpsBtn.addEventListener("click", function () {
    if (latestPlatform && latestPlatform.location) {
      syncIframeToCoords(
        latestPlatform.location.latitude,
        latestPlatform.location.longitude,
        true,
      );
      return;
    }
    refreshPlatformGps();
  });

  loadScalePreference();
  loadAutoSyncPreference();
  refreshPlatformGps();
  startPolling();
})();
