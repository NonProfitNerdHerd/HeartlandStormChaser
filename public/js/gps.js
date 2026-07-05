(function () {
  var REFRESH_INTERVAL_MS = 10000;

  var refreshStatus = document.getElementById("refresh-status");
  var refreshBtn = document.getElementById("refresh-btn");
  var platformStatusBadge = document.getElementById("platform-status-badge");
  var platformBody = document.getElementById("platform-body");
  var androidSection = document.getElementById("android-section");
  var devicesBody = document.getElementById("devices-body");
  var deviceCount = document.getElementById("device-count");
  var weatherBody = document.getElementById("weather-body");
  var weatherStatusBadge = document.getElementById("weather-status-badge");

  var pollTimer = null;
  var settingPlatform = false;

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

  function formatNumber(value, digits) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return Number(value).toFixed(digits);
  }

  function statusBadgeClass(status) {
    if (status === "LIVE") return "badge badge--success";
    if (status === "STALE") return "badge badge--warning";
    return "badge badge--muted";
  }

  function statusBadgeLabel(status) {
    if (status === "LIVE") return "Live";
    if (status === "STALE") return "Stale";
    return "Unknown";
  }

  async function api(path, options) {
    var response = await fetch(path, options);
    var data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Request failed (" + response.status + ")");
    }
    return data;
  }

  function renderStat(label, value, className) {
    return (
      '<div class="gps-stat">' +
      '<span class="gps-stat__label">' +
      label +
      "</span>" +
      '<span class="gps-stat__value' +
      (className ? " " + className : "") +
      '">' +
      value +
      "</span>" +
      "</div>"
    );
  }

  function renderPlatform(platform) {
    if (!platform) {
      platformStatusBadge.className = "badge badge--muted";
      platformStatusBadge.textContent = "None";
      platformBody.innerHTML =
        '<p class="gps-empty">No platform GPS source selected. Choose a device below.</p>';
      return;
    }

    var location = platform.location;
    var status = location ? location.status : platform.status;

    platformStatusBadge.className = statusBadgeClass(status);
    platformStatusBadge.textContent = statusBadgeLabel(status);

    if (!location) {
      platformBody.innerHTML =
        '<p class="gps-empty"><strong>' +
        escapeHtml(platform.device_name) +
        "</strong> is the platform source, but no location has been received yet.</p>";
      return;
    }

    platformBody.innerHTML =
      renderStat("Device", escapeHtml(platform.device_name), "gps-stat__value--name") +
      renderStat("Latitude", formatNumber(location.latitude, 5)) +
      renderStat("Longitude", formatNumber(location.longitude, 5)) +
      renderStat("Speed", formatNumber(location.speed_mph, 1) + " mph") +
      renderStat("Heading", formatNumber(location.heading_degrees, 0) + "°") +
      renderStat("Accuracy", formatNumber(location.accuracy_meters, 0) + " m") +
      renderStat(
        "Battery",
        location.battery_percent != null ? location.battery_percent + "%" : "—",
      ) +
      renderStat("Last update", formatTimestamp(location.received_at_utc));
  }

  function renderWeather(weatherData) {
    if (!weatherData || !weatherData.weather) {
      weatherStatusBadge.className = "badge badge--muted";
      weatherStatusBadge.textContent = "None";
      weatherBody.innerHTML =
        '<p class="gps-empty">' +
        escapeHtml(
          (weatherData && weatherData.message) ||
            "No platform GPS source with a known location.",
        ) +
        "</p>";
      return;
    }

    var weather = weatherData.weather;
    weatherStatusBadge.className = weather.stale
      ? "badge badge--warning"
      : "badge badge--success";
    weatherStatusBadge.textContent = weather.stale ? "Cached" : "Current";

    weatherBody.innerHTML =
      renderStat("Temperature", formatWeatherValue(weather.temperature_f, "°F")) +
      renderStat("Conditions", escapeHtml(weather.conditions || "—")) +
      renderStat("Dew point", formatWeatherValue(weather.dew_point_f, "°F")) +
      renderStat("Humidity", formatWeatherValue(weather.humidity_percent, "%")) +
      renderStat("Wind speed", formatWeatherValue(weather.wind_speed_mph, " mph")) +
      renderStat("Wind direction", escapeHtml(weather.wind_direction || "—")) +
      renderStat("Wind gusts", formatWeatherValue(weather.wind_gusts_mph, " mph")) +
      renderStat("Pressure", formatWeatherValue(weather.pressure_hpa, " hPa")) +
      renderStat("Visibility", formatWeatherValue(weather.visibility_miles, " mi")) +
      renderStat(
        "Observation time",
        formatTimestamp(weather.observation_at || weather.fetched_at),
      ) +
      renderStat("Fetched", formatTimestamp(weather.fetched_at)) +
      '<p class="gps-weather-note">Source: National Weather Service · cached up to 3 minutes' +
      (weather.from_cache ? " · served from cache" : "") +
      (weather.stale ? " · showing last cached weather after fetch failure" : "") +
      "</p>";
  }

  function formatWeatherValue(value, suffix) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return formatNumber(value, suffix === "%" ? 0 : 1) + suffix;
  }

  async function fetchWeatherSafe() {
    try {
      return await api("/api/weather/platform");
    } catch (error) {
      return {
        weather: null,
        message: error.message,
      };
    }
  }

  function renderAndroidSection(downloadUrl) {
    if (!downloadUrl) {
      androidSection.innerHTML =
        '<p class="gps-message gps-message--info">Android APK download URL is not configured yet. Set <code>android_app_download_url</code> in overlay settings (Phase 4) or directly in the <code>overlay_settings</code> table for now.</p>';
      return;
    }

    var encoded = encodeURIComponent(downloadUrl);
    androidSection.innerHTML =
      '<img class="gps-android__qr" id="android-qr" width="160" height="160" alt="QR code for Android app download" src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' +
      encoded +
      '" />' +
      '<a class="gps-android__link" href="' +
      escapeHtml(downloadUrl) +
      '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(downloadUrl) +
      "</a>" +
      '<p class="gps-android__hint">Scan the QR code or open the link on your Android device to install the GPS sender app.</p>';
  }

  function renderDevices(devices) {
    deviceCount.textContent =
      devices.length + " device" + (devices.length === 1 ? "" : "s");

    if (!devices.length) {
      devicesBody.innerHTML =
        '<tr><td colspan="10" class="gps-table__empty">No GPS devices registered yet. Pair the Android app to get started.</td></tr>';
      return;
    }

    devicesBody.innerHTML = devices
      .map(function (device) {
        var location = device.location;
        var status = location ? location.status : device.status;
        var isPlatform = device.is_platform_source;

        return (
          "<tr>" +
          '<td class="gps-table__device">' +
          escapeHtml(device.device_name) +
          "</td>" +
          "<td><span class=\"" +
          statusBadgeClass(status) +
          '">' +
          statusBadgeLabel(status) +
          "</span></td>" +
          "<td>" +
          (location ? formatNumber(location.latitude, 5) : "—") +
          "</td>" +
          "<td>" +
          (location ? formatNumber(location.longitude, 5) : "—") +
          "</td>" +
          "<td>" +
          (location && location.speed_mph != null
            ? formatNumber(location.speed_mph, 1) + " mph"
            : "—") +
          "</td>" +
          "<td>" +
          (location && location.heading_degrees != null
            ? formatNumber(location.heading_degrees, 0) + "°"
            : "—") +
          "</td>" +
          "<td>" +
          (location && location.accuracy_meters != null
            ? formatNumber(location.accuracy_meters, 0) + " m"
            : "—") +
          "</td>" +
          "<td>" +
          (location && location.battery_percent != null
            ? location.battery_percent + "%"
            : "—") +
          "</td>" +
          "<td>" +
          formatTimestamp(location ? location.received_at_utc : device.last_seen_at) +
          "</td>" +
          '<td class="gps-table__actions">' +
          (isPlatform
            ? '<span class="gps-platform-tag">Platform</span>'
            : '<button type="button" class="btn btn--secondary gps-btn--sm" data-set-platform="' +
              escapeHtml(device.id) +
              '">Set platform</button>') +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function setPlatformSource(deviceId, button) {
    if (settingPlatform) return;
    settingPlatform = true;
    if (button) {
      button.disabled = true;
      button.textContent = "Setting…";
    }

    try {
      await api("/api/gps/platform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId }),
      });
      await refreshData(false);
    } catch (error) {
      refreshStatus.textContent = "Failed to set platform source: " + error.message;
    } finally {
      settingPlatform = false;
    }
  }

  async function refreshData(showLoading) {
    if (showLoading) {
      refreshStatus.textContent = "Refreshing GPS data…";
    }

    try {
      var results = await Promise.all([
        api("/api/gps/devices"),
        api("/api/gps/platform"),
        api("/api/gps/health"),
        fetchWeatherSafe(),
      ]);

      var devicesData = results[0];
      var platformData = results[1];
      var healthData = results[2];
      var weatherData = results[3];

      renderPlatform(platformData.platform_source);
      renderDevices(devicesData.devices || []);
      renderAndroidSection(healthData.android_app_download_url);
      renderWeather(weatherData);

      refreshStatus.textContent =
        "Last updated " +
        new Date().toLocaleTimeString() +
        " · Live if updated within " +
        (devicesData.live_threshold_seconds || 30) +
        " seconds";
    } catch (error) {
      refreshStatus.textContent = "Error loading GPS data: " + error.message;
      platformBody.innerHTML =
        '<p class="gps-message gps-message--error">' + escapeHtml(error.message) + "</p>";
    }
  }

  function startPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    pollTimer = setInterval(function () {
      refreshData(false);
    }, REFRESH_INTERVAL_MS);
  }

  refreshBtn.addEventListener("click", function () {
    refreshData(true);
  });

  devicesBody.addEventListener("click", function (event) {
    var button = event.target.closest("[data-set-platform]");
    if (!button) return;
    setPlatformSource(button.getAttribute("data-set-platform"), button);
  });

  refreshData(true);
  startPolling();
})();
