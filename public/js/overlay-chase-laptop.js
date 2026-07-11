(function () {
  var POLL_INTERVAL_MS = 8000;
  var API_PATH = "/api/overlays/gps-weather-data";

  var root = document.getElementById("chase-laptop-root");
  var currentLocationEl = document.getElementById("current-location");
  var currentDatetimeEl = document.getElementById("current-datetime");
  var directionEl = document.getElementById("direction-value");
  var targetLocationEl = document.getElementById("target-location");
  var etaEl = document.getElementById("eta-value");
  var ceilingEl = document.getElementById("ceiling-value");
  var dewHumidityEl = document.getElementById("dew-humidity-value");
  var tempFeelsEl = document.getElementById("temp-feels-value");
  var windGustsEl = document.getElementById("wind-gusts-value");
  var pressureTrendEl = document.getElementById("pressure-trend-value");
  var emptyState = document.getElementById("empty-state");

  var lastPressureInHg = null;
  var clockTimer = null;

  if (window.location.search.indexOf("preview=1") !== -1) {
    document.body.classList.add("overlay-body--preview");
  }

  function formatClock() {
    return new Date().toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function updateClock() {
    if (currentDatetimeEl) {
      currentDatetimeEl.textContent = formatClock();
    }
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

  function formatTemp(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return Math.round(Number(value)) + "°";
  }

  function formatCeiling(weather) {
    if (!weather) return "Ceiling —";
    if (weather.ceiling_ft != null && !Number.isNaN(weather.ceiling_ft)) {
      return "Ceiling " + Math.round(Number(weather.ceiling_ft)) + " ft";
    }
    if (weather.conditions) {
      return "Ceiling " + weather.conditions;
    }
    return "Ceiling —";
  }

  function formatDewHumidity(weather) {
    if (!weather) return "DP — · RH —";
    var dew = formatTemp(weather.dew_point_f);
    var rh =
      weather.humidity_percent != null
        ? Math.round(Number(weather.humidity_percent)) + "% RH"
        : "— RH";
    return "DP " + dew + " · " + rh;
  }

  function formatTempFeels(weather) {
    if (!weather || weather.temperature_f == null) return "—";
    var temp = Math.round(Number(weather.temperature_f));
    var feels =
      weather.feels_like_f != null
        ? Math.round(Number(weather.feels_like_f))
        : temp;
    return temp + "° / FL " + feels + "°";
  }

  function formatWindGusts(weather) {
    if (!weather) return "—";
    var speed =
      weather.wind_speed_mph != null ? Math.round(Number(weather.wind_speed_mph)) : 0;
    var direction = weather.wind_direction || "N";
    var gust =
      weather.wind_gusts_mph != null ? Math.round(Number(weather.wind_gusts_mph)) : 0;
    return speed + " " + direction + " G" + gust;
  }

  function formatPressureInHg(weather) {
    if (!weather) return null;
    if (weather.pressure_inhg != null) {
      return Number(weather.pressure_inhg);
    }
    if (weather.pressure_hpa != null) {
      return Number(weather.pressure_hpa) * 0.02953;
    }
    return null;
  }

  function formatPressureLine(weather) {
    var pressure = formatPressureInHg(weather);
    if (pressure == null || Number.isNaN(pressure)) {
      return "Pressure —";
    }

    var trend = "Steady";
    if (lastPressureInHg != null) {
      var diff = pressure - lastPressureInHg;
      if (diff > 0.02) {
        trend = "Rising";
      } else if (diff < -0.02) {
        trend = "Falling";
      }
    }
    lastPressureInHg = pressure;

    return "Pressure " + pressure.toFixed(2) + " in · " + trend;
  }

  function renderEmpty(message) {
    root.classList.add("chase-laptop--empty");
    emptyState.textContent = message || "No Platform GPS Source Selected";
    emptyState.classList.remove("chase-laptop__empty--hidden");
  }

  function renderData(data) {
    if (!data.has_platform_source || !data.platform) {
      renderEmpty(data.message || "No Platform GPS Source Selected");
      return;
    }

    root.classList.remove("chase-laptop--empty");
    emptyState.classList.add("chase-laptop__empty--hidden");

    var platform = data.platform;
    var weather = data.weather;

    currentLocationEl.textContent =
      (data.current_location && data.current_location.label) || "—";
    targetLocationEl.textContent =
      (data.target_location && data.target_location.label) || "—";
    directionEl.textContent = formatDirection(platform);
    etaEl.textContent = "ETA " + ((data.travel && data.travel.eta_display) || "--");

    if (weather) {
      tempFeelsEl.textContent = formatTempFeels(weather);
      ceilingEl.textContent = formatCeiling(weather);
      pressureTrendEl.textContent = formatPressureLine(weather);
      windGustsEl.textContent = formatWindGusts(weather);
      dewHumidityEl.textContent = formatDewHumidity(weather);
    } else {
      tempFeelsEl.textContent = "—";
      ceilingEl.textContent = "Ceiling —";
      pressureTrendEl.textContent = "Pressure —";
      windGustsEl.textContent = "—";
      dewHumidityEl.textContent = "DP — · RH —";
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
    }
  }

  updateClock();
  clockTimer = setInterval(updateClock, 1000);
  refreshOverlay();
  setInterval(refreshOverlay, POLL_INTERVAL_MS);
})();
