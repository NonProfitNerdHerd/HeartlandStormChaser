(function () {
  var POLL_INTERVAL_MS = 8000;
  var API_PATH = "/api/overlays/gps-weather-data";

  var root = document.getElementById("overlay-root");
  var overlayBar = document.getElementById("overlay-bar");
  var warningAccent = document.getElementById("warning-accent");
  var emptyState = document.getElementById("empty-state");
  var currentLocationEl = document.getElementById("current-location");
  var targetLocationEl = document.getElementById("target-location");
  var speedEl = document.getElementById("speed-value");
  var directionEl = document.getElementById("direction-value");
  var etaEl = document.getElementById("eta-value");
  var tempEl = document.getElementById("temp-value");
  var windEl = document.getElementById("wind-value");
  var dewPointEl = document.getElementById("dewpoint-value");
  var pressureEl = document.getElementById("pressure-value");
  var humidityEl = document.getElementById("humidity-value");

  if (window.location.search.indexOf("preview=1") !== -1) {
    document.body.classList.add("overlay-body--preview");
  }

  function formatTemp(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return Math.round(Number(value)) + "°";
  }

  function formatSpeedMph(value) {
    if (value == null || Number.isNaN(value)) return "0 MPH";
    return Math.round(Number(value)) + " MPH";
  }

  function formatDirection(platform) {
    if (platform.speed_mph != null && Number(platform.speed_mph) < 1) {
      return "--";
    }
    if (platform.heading_cardinal) {
      return platform.heading_cardinal;
    }
    if (platform.heading_degrees != null && !Number.isNaN(platform.heading_degrees)) {
      return Math.round(Number(platform.heading_degrees)) + "°";
    }
    return "--";
  }

  function formatWind(weather) {
    if (!weather) return "—";

    var speed =
      weather.wind_speed_mph != null ? Math.round(Number(weather.wind_speed_mph)) : 0;
    var direction = weather.wind_direction || "N";
    var gust =
      weather.wind_gusts_mph != null ? Math.round(Number(weather.wind_gusts_mph)) : 0;

    return speed + " " + direction + " G" + gust;
  }

  function formatTempLine(weather) {
    if (!weather || weather.temperature_f == null) return "—";

    var temp = Math.round(Number(weather.temperature_f));
    var feels =
      weather.feels_like_f != null
        ? Math.round(Number(weather.feels_like_f))
        : temp;

    return temp + "° / FL " + feels + "°";
  }

  function formatPressure(weather) {
    if (!weather) return "—";
    if (weather.pressure_inhg != null) {
      return Number(weather.pressure_inhg).toFixed(2);
    }
    if (weather.pressure_hpa != null) {
      return (Number(weather.pressure_hpa) * 0.02953).toFixed(2);
    }
    return "—";
  }

  function setWarningAccent(level) {
    warningAccent.classList.remove(
      "overlay-bar__accent--yellow",
      "overlay-bar__accent--red",
    );

    if (level === "yellow") {
      warningAccent.classList.add("overlay-bar__accent--yellow");
      return;
    }

    if (level === "red") {
      warningAccent.classList.add("overlay-bar__accent--red");
    }
  }

  function renderEmpty(message) {
    root.classList.add("overlay-stage--empty");
    emptyState.classList.remove("overlay-empty--hidden");
    emptyState.textContent = message || "No Platform GPS Source Selected";
  }

  function renderData(data) {
    if (!data.has_platform_source || !data.platform) {
      renderEmpty(data.message || "No Platform GPS Source Selected");
      return;
    }

    root.classList.remove("overlay-stage--empty");
    emptyState.classList.add("overlay-empty--hidden");

    var platform = data.platform;
    var weather = data.weather;

    setWarningAccent(data.warning_level || "green");

    currentLocationEl.textContent =
      (data.current_location && data.current_location.label) || "—";
    targetLocationEl.textContent =
      (data.target_location && data.target_location.label) || "—";

    speedEl.textContent = formatSpeedMph(platform.speed_mph);
    directionEl.textContent = formatDirection(platform);
    etaEl.textContent =
      (data.travel && data.travel.eta_display) || "--";

    if (weather) {
      tempEl.textContent = formatTempLine(weather);
      windEl.textContent = formatWind(weather);
      dewPointEl.textContent = formatTemp(weather.dew_point_f);
      pressureEl.textContent = formatPressure(weather);
      humidityEl.textContent =
        weather.humidity_percent != null
          ? Math.round(Number(weather.humidity_percent)) + "%"
          : "—";
    } else {
      tempEl.textContent = "—";
      windEl.textContent = "—";
      dewPointEl.textContent = "—";
      pressureEl.textContent = "—";
      humidityEl.textContent = "—";
    }
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
      emptyState.textContent = "Overlay unavailable";
    }
  }

  refreshOverlay();
  setInterval(refreshOverlay, POLL_INTERVAL_MS);
})();
