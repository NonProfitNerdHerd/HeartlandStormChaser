(function () {
  var POLL_INTERVAL_MS = 8000;
  var API_PATH = "/api/overlays/gps-weather-data";

  var root = document.getElementById("overlay-root");
  var emptyState = document.getElementById("empty-state");
  var gpsStatusBadge = document.getElementById("gps-status-badge");
  var deviceName = document.getElementById("device-name");
  var locationLabel = document.getElementById("location-label");
  var latitudeEl = document.getElementById("latitude");
  var longitudeEl = document.getElementById("longitude");
  var speedEl = document.getElementById("speed");
  var headingEl = document.getElementById("heading");
  var temperatureEl = document.getElementById("temperature");
  var conditionsEl = document.getElementById("conditions");
  var dewPointEl = document.getElementById("dew-point");
  var humidityEl = document.getElementById("humidity");
  var windEl = document.getElementById("wind");
  var windGustsEl = document.getElementById("wind-gusts");
  var lastUpdateEl = document.getElementById("last-update");

  if (window.location.search.indexOf("preview=1") !== -1) {
    document.body.classList.add("overlay-body--preview");
  }

  function formatNumber(value, digits) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return Number(value).toFixed(digits);
  }

  function formatTimestamp(value) {
    if (!value) return "—";
    var normalized = value.includes("T") ? value : value.replace(" ", "T");
    var withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
      ? normalized
      : normalized + "Z";
    var date = new Date(withZone);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  function setBadge(status) {
    gpsStatusBadge.className = "overlay__badge";
    if (status === "LIVE") {
      gpsStatusBadge.className += " overlay__badge--live";
      gpsStatusBadge.textContent = "Live";
      return;
    }
    if (status === "STALE") {
      gpsStatusBadge.className += " overlay__badge--stale";
      gpsStatusBadge.textContent = "Stale";
      return;
    }
    gpsStatusBadge.className += " overlay__badge--muted";
    gpsStatusBadge.textContent = "Unknown";
  }

  function renderEmpty(message) {
    root.classList.add("overlay--empty");
    emptyState.classList.remove("overlay__empty--hidden");
    emptyState.textContent = message || "No Platform GPS Source Selected";
  }

  function renderData(data) {
    if (!data.has_platform_source || !data.platform) {
      renderEmpty(data.message || "No Platform GPS Source Selected");
      return;
    }

    root.classList.remove("overlay--empty");
    emptyState.classList.add("overlay__empty--hidden");

    var platform = data.platform;
    var weather = data.weather;
    var location = data.location || {};

    setBadge(platform.status);
    deviceName.textContent = platform.device_name || "Platform GPS";
    locationLabel.textContent = location.display || "Location unavailable";

    latitudeEl.textContent =
      platform.latitude != null ? formatNumber(platform.latitude, 4) : "—";
    longitudeEl.textContent =
      platform.longitude != null ? formatNumber(platform.longitude, 4) : "—";
    speedEl.textContent =
      platform.speed_mph != null ? formatNumber(platform.speed_mph, 1) + " mph" : "—";
    headingEl.textContent =
      platform.heading_degrees != null
        ? formatNumber(platform.heading_degrees, 0) + "°"
        : "—";

    if (weather) {
      temperatureEl.textContent =
        weather.temperature_f != null ? formatNumber(weather.temperature_f, 1) + "°F" : "—";
      conditionsEl.textContent = weather.conditions || "—";
      dewPointEl.textContent =
        weather.dew_point_f != null ? formatNumber(weather.dew_point_f, 1) + "°F" : "—";
      humidityEl.textContent =
        weather.humidity_percent != null
          ? formatNumber(weather.humidity_percent, 0) + "%"
          : "—";

      var windText = "—";
      if (weather.wind_speed_mph != null) {
        windText = formatNumber(weather.wind_speed_mph, 1) + " mph";
        if (weather.wind_direction) {
          windText += " " + weather.wind_direction;
        }
      }
      windEl.textContent = windText;
      windGustsEl.textContent =
        weather.wind_gusts_mph != null
          ? formatNumber(weather.wind_gusts_mph, 1) + " mph"
          : "—";
    } else {
      temperatureEl.textContent = "—";
      conditionsEl.textContent = "Weather unavailable";
      dewPointEl.textContent = "—";
      humidityEl.textContent = "—";
      windEl.textContent = "—";
      windGustsEl.textContent = "—";
    }

    var updateTime =
      (weather && (weather.observation_at || weather.fetched_at)) ||
      platform.received_at_utc ||
      data.updated_at;
    var staleNote =
      platform.status === "STALE" ? " · GPS data stale" : "";
    var weatherNote =
      weather && weather.stale ? " · weather cached" : "";
    lastUpdateEl.textContent =
      "Updated " + formatTimestamp(updateTime) + staleNote + weatherNote;
  }

  async function refreshOverlay() {
    try {
      var response = await fetch(API_PATH);
      var data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }
      renderData(data);
    } catch (error) {
      renderEmpty("Overlay unavailable");
      lastUpdateEl.textContent = "Error: " + error.message;
    }
  }

  refreshOverlay();
  setInterval(refreshOverlay, POLL_INTERVAL_MS);
})();
