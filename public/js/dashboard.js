(function () {
  var REFRESH_INTERVAL_MS = 15000;

  var refreshStatus = document.getElementById("dashboard-refresh-status");
  var refreshBtn = document.getElementById("dashboard-refresh-btn");
  var pollTimer = null;

  function formatTimestamp(value) {
    if (!value) return "—";
    var normalized = value.includes("T") ? value : value.replace(" ", "T");
    var withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : normalized + "Z";
    var date = new Date(withZone);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  function formatAge(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return "—";
    if (seconds < 60) return seconds + "s ago";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
    return Math.floor(seconds / 3600) + "h ago";
  }

  function updateCard(cardId, badgeText, badgeClass, message) {
    var card = document.getElementById(cardId);
    if (!card) return;

    var badge = card.querySelector("[data-badge]");
    var messageEl = card.querySelector("[data-message]");
    if (badge) {
      badge.textContent = badgeText;
      badge.className = "badge " + badgeClass;
    }
    if (messageEl) {
      messageEl.textContent = message;
    }
  }

  async function api(path) {
    var response = await fetch(path);
    var data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Request failed (" + response.status + ")");
    }
    return data;
  }

  function renderGps(gps) {
    var platform = gps.platform;

    if (!platform) {
      updateCard(
        "card-gps",
        "No source",
        "badge--muted",
        gps.device_count + " registered device(s). No platform GPS source selected.",
      );
      return;
    }

    if (!platform.received_at_utc) {
      updateCard(
        "card-gps",
        "Waiting",
        "badge--warning",
        platform.device_name + " is the platform source, but no location has been received yet.",
      );
      return;
    }

    var badgeClass =
      platform.status === "LIVE"
        ? "badge--success"
        : platform.status === "STALE"
          ? "badge--warning"
          : "badge--muted";
    var badgeText =
      platform.status === "LIVE" ? "Live" : platform.status === "STALE" ? "Stale" : "Unknown";

    updateCard(
      "card-gps",
      badgeText,
      badgeClass,
      platform.device_name +
        " · " +
        gps.located_device_count +
        "/" +
        gps.device_count +
        " devices located · Last fix " +
        formatTimestamp(platform.received_at_utc) +
        (platform.speed_mph != null ? " · " + Number(platform.speed_mph).toFixed(1) + " mph" : ""),
    );
  }

  function renderWarnings(warnings, gps) {
    if (!gps.platform?.received_at_utc) {
      updateCard(
        "card-warnings",
        "Unavailable",
        "badge--muted",
        "Warnings monitoring needs a platform GPS location.",
      );
      return;
    }

    if (!warnings) {
      updateCard(
        "card-warnings",
        "Unavailable",
        "badge--muted",
        "Warnings status is not available.",
      );
      return;
    }

    if (warnings.error) {
      updateCard("card-warnings", "Error", "badge--danger", warnings.error);
      return;
    }

    var count = warnings.alert_count || 0;
    var pollLabel = warnings.poll_interval_seconds === 60
      ? "1 min"
      : warnings.poll_interval_seconds === 300
        ? "5 min"
        : warnings.poll_interval_seconds === 600
          ? "10 min"
          : warnings.poll_interval_seconds === 1800
            ? "30 min"
            : warnings.poll_interval_seconds === 3600
              ? "1 hr"
              : (warnings.poll_interval_seconds || 3600) + "s";
    updateCard(
      "card-warnings",
      count > 0 ? count + " active" : "Clear",
      count > 0 ? "badge--danger" : "badge--success",
      count +
        " warning(s) within " +
        warnings.radius_miles +
        " mi · NWS " +
        formatTimestamp(warnings.fetched_at) +
        " · Server poll " +
        pollLabel +
        (warnings.next_refresh_at ? " · Next " + formatTimestamp(warnings.next_refresh_at) : "") +
        (warnings.from_cache ? " · cached feed" : ""),
    );
  }

  function renderWeather(weather, gps) {
    if (!gps.platform?.received_at_utc) {
      updateCard(
        "card-weather",
        "Unavailable",
        "badge--muted",
        "Platform weather needs a GPS location.",
      );
      return;
    }

    if (!weather) {
      updateCard("card-weather", "Unavailable", "badge--muted", "Weather status is not available.");
      return;
    }

    if (weather.error) {
      updateCard("card-weather", "Error", "badge--danger", weather.error);
      return;
    }

    var locationLabel = [weather.location_city, weather.location_state].filter(Boolean).join(", ");
    var temp =
      weather.temperature_f == null ? "—" : Number(weather.temperature_f).toFixed(1) + "°F";

    updateCard(
      "card-weather",
      weather.stale ? "Stale" : "Current",
      weather.stale ? "badge--warning" : "badge--success",
      (weather.conditions || "Unknown conditions") +
        " · " +
        temp +
        (locationLabel ? " · " + locationLabel : "") +
        " · Updated " +
        formatTimestamp(weather.fetched_at) +
        (weather.from_cache ? " · cached" : ""),
    );
  }

  function renderOverlays(overlays) {
    var hasTarget = overlays.target_city && overlays.target_state;
    var hasTicker = overlays.ticker_text && overlays.ticker_text.trim();

    if (!hasTarget && !hasTicker) {
      updateCard(
        "card-overlays",
        "Not set",
        "badge--muted",
        "No overlay target location or ticker text saved in D1 yet.",
      );
      return;
    }

    var parts = [];
    if (hasTarget) {
      parts.push("Target " + overlays.target_city + ", " + overlays.target_state);
    }
    if (hasTicker) {
      parts.push('Ticker "' + overlays.ticker_text.trim() + '"');
    }
    if (overlays.android_app_version_name) {
      parts.push("Android app v" + overlays.android_app_version_name);
    }

    updateCard(
      "card-overlays",
      "Configured",
      "badge--success",
      parts.join(" · ") + " · Updated " + formatTimestamp(overlays.updated_at),
    );
  }

  function renderChasers(chasers) {
    if (!chasers.source_count) {
      updateCard(
        "card-chasers",
        "No sources",
        "badge--muted",
        "No chaser stream sources configured yet.",
      );
      return;
    }

    var liveCount = chasers.live_count || 0;
    updateCard(
      "card-chasers",
      liveCount > 0 ? liveCount + " live" : "None live",
      liveCount > 0 ? "badge--success" : "badge--muted",
      chasers.enabled_count +
        " enabled source(s) · " +
        liveCount +
        " live now · Cache " +
        formatAge(chasers.cache_age_seconds) +
        " · Last refresh " +
        formatTimestamp(chasers.last_refreshed_at),
    );
  }

  function renderSystem(system, timestamp) {
    updateCard(
      "card-system",
      "Online",
      "badge--success",
      "Worker API responding · " +
        system.environment +
        " · Dashboard poll " +
        formatTimestamp(timestamp),
    );
  }

  async function refreshDashboard() {
    if (refreshStatus) {
      refreshStatus.textContent = "Refreshing service status…";
    }

    try {
      var data = await api("/api/dashboard/status");
      renderGps(data.gps);
      renderWarnings(data.warnings, data.gps);
      renderWeather(data.weather, data.gps);
      renderOverlays(data.overlays);
      renderChasers(data.chasers);
      renderSystem(data.system, data.timestamp);

      if (refreshStatus) {
        refreshStatus.textContent = "Last updated " + formatTimestamp(data.timestamp) + " · auto-refresh every 15s";
      }
    } catch (error) {
      updateCard("card-system", "Offline", "badge--danger", error.message || "Dashboard status unavailable.");
      if (refreshStatus) {
        refreshStatus.textContent = "Unable to load dashboard status: " + (error.message || "Unknown error");
      }
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", refreshDashboard);
  }

  refreshDashboard();
  pollTimer = setInterval(refreshDashboard, REFRESH_INTERVAL_MS);

  var healthOutput = document.getElementById("api-health-output");
  var healthBadge = document.getElementById("api-health-badge");

  function refreshBackendHealth() {
    if (!healthOutput || !healthBadge) return;

    healthOutput.textContent = "Checking backend…";
    healthOutput.classList.add("status-panel__body--loading");

    fetch("/api/health")
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        healthOutput.classList.remove("status-panel__body--loading");
        healthOutput.textContent = JSON.stringify(data, null, 2);

        if (data.ok) {
          healthBadge.textContent = "Online";
          healthBadge.className = "badge badge--success";
        } else {
          healthBadge.textContent = "Degraded";
          healthBadge.className = "badge badge--warning";
        }
      })
      .catch(function (error) {
        healthOutput.classList.remove("status-panel__body--loading");
        healthOutput.textContent = "Could not reach /api/health: " + error.message;
        healthBadge.textContent = "Offline";
        healthBadge.className = "badge badge--danger";
      });
  }

  refreshBackendHealth();

  function fetchEndpointStatus(url, outputId, badgeId) {
    var output = document.getElementById(outputId);
    var badge = document.getElementById(badgeId);
    if (!output || !badge) return;

    output.textContent = "Checking…";
    output.classList.add("status-panel__body--loading");

    fetch(url)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        output.classList.remove("status-panel__body--loading");
        output.textContent = JSON.stringify(data, null, 2);

        if (data.ok) {
          badge.textContent = "Connected";
          badge.className = "badge badge--success";
        } else {
          badge.textContent = "Error";
          badge.className = "badge badge--danger";
        }
      })
      .catch(function (error) {
        output.classList.remove("status-panel__body--loading");
        output.textContent = "Could not reach " + url + ": " + error.message;
        badge.textContent = "Offline";
        badge.className = "badge badge--danger";
      });
  }

  fetchEndpointStatus("/api/db-test", "db-output", "db-badge");
})();
