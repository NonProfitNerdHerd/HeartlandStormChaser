(function () {
  var POLL_INTERVAL_MS = 60000;
  var DEFAULT_RADIUS = 700;

  var workspace = document.getElementById("warnings-workspace");
  var gpsStatusBadge = document.getElementById("gps-status-badge");
  var monitorStatusBadge = document.getElementById("monitor-status-badge");
  var monitorMeta = document.getElementById("monitor-meta");
  var radiusSelect = document.getElementById("radius-select");
  var refreshBtn = document.getElementById("refresh-btn");
  var pollingToggle = document.getElementById("polling-toggle");
  var warningsCount = document.getElementById("warnings-count");
  var warningsList = document.getElementById("warnings-list");
  var detailPanel = document.getElementById("warnings-detail-panel");
  var detailBody = document.getElementById("warnings-detail-body");
  var detailCloseBtn = document.getElementById("detail-close-btn");
  var fitWarningsBtn = document.getElementById("fit-warnings-btn");
  var layerButtons = document.querySelectorAll(".warnings-layer-btn");

  var map = null;
  var baseLayers = {};
  var currentLayer = "satellite";
  var radiusCircle = null;
  var platformMarker = null;
  var alertLayers = {};
  var pollTimer = null;
  var pollingEnabled = true;
  var selectedAlertId = null;
  var latestData = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTimestamp(value) {
    if (!value) return "—";
    var normalized = value.includes("T") ? value : value.replace(" ", "T");
    var withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : normalized + "Z";
    var date = new Date(withZone);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  async function api(path) {
    var response = await fetch(path);
    var data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Request failed (" + response.status + ")");
    }
    return data;
  }

  function getRadiusMiles() {
    return Number(radiusSelect.value) || DEFAULT_RADIUS;
  }

  function setGpsBadge(status) {
    if (status === "LIVE") {
      gpsStatusBadge.className = "badge badge--success";
      gpsStatusBadge.textContent = "GPS LIVE";
      return;
    }
    if (status === "STALE") {
      gpsStatusBadge.className = "badge badge--warning";
      gpsStatusBadge.textContent = "GPS STALE";
      return;
    }
    gpsStatusBadge.className = "badge badge--danger";
    gpsStatusBadge.textContent = "GPS SIGNAL LOST";
  }

  function setMonitorBadge(active, alertCount) {
    if (!pollingEnabled) {
      monitorStatusBadge.className = "badge badge--muted";
      monitorStatusBadge.textContent = "MONITOR PAUSED";
      return;
    }
    if (!active) {
      monitorStatusBadge.className = "badge badge--warning";
      monitorStatusBadge.textContent = "MONITOR ERROR";
      return;
    }
    monitorStatusBadge.className = alertCount > 0 ? "badge badge--danger" : "badge badge--success";
    monitorStatusBadge.textContent = alertCount > 0 ? "WARNINGS ACTIVE" : "MONITORING";
  }

  function initMap() {
    if (map) return;

    map = L.map("warnings-map", {
      zoomControl: true,
      attributionControl: true,
    }).setView([39.8283, -98.5795], 5);

    baseLayers.street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    });

    baseLayers.dark = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      },
    );

    baseLayers.satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri",
      },
    );

    baseLayers[currentLayer].addTo(map);
  }

  function setMapLayer(layerName) {
    if (!map || !baseLayers[layerName]) return;
    if (baseLayers[currentLayer]) {
      map.removeLayer(baseLayers[currentLayer]);
    }
    currentLayer = layerName;
    baseLayers[currentLayer].addTo(map);
    layerButtons.forEach(function (button) {
      button.classList.toggle(
        "warnings-layer-btn--active",
        button.getAttribute("data-layer") === layerName,
      );
    });
  }

  function clearAlertLayers() {
    Object.keys(alertLayers).forEach(function (alertId) {
      map.removeLayer(alertLayers[alertId]);
      delete alertLayers[alertId];
    });
  }

  function renderPlatformOnMap(query, platform) {
    if (!map || !query) return;

    var center = [query.latitude, query.longitude];

    if (radiusCircle) {
      map.removeLayer(radiusCircle);
    }

    radiusCircle = L.circle(center, {
      radius: query.radius_miles * 1609.34,
      color: "#38bdf8",
      weight: 2,
      fillColor: "#38bdf8",
      fillOpacity: 0.08,
    }).addTo(map);

    if (platformMarker) {
      map.removeLayer(platformMarker);
    }

    platformMarker = L.circleMarker(center, {
      radius: 8,
      color: "#ffffff",
      weight: 2,
      fillColor: "#2563eb",
      fillOpacity: 1,
    })
      .bindTooltip(
        escapeHtml(platform?.device_name || "Platform GPS") +
          "<br>" +
          query.latitude.toFixed(5) +
          ", " +
          query.longitude.toFixed(5),
        { direction: "top" },
      )
      .addTo(map);
  }

  function renderAlertsOnMap(alerts) {
    clearAlertLayers();

    alerts.forEach(function (alert) {
      if (!alert.geometry) return;

      var layer = L.geoJSON(
        {
          type: "Feature",
          geometry: alert.geometry,
          properties: {},
        },
        {
          style: function () {
            return {
              color: alert.color,
              weight: selectedAlertId === alert.id ? 3 : 2,
              fillColor: alert.color,
              fillOpacity: selectedAlertId === alert.id ? 0.45 : 0.3,
            };
          },
        },
      );

      layer.on("click", function (event) {
        L.DomEvent.stopPropagation(event);
        toggleAlertSelection(alert.id);
      });

      layer.addTo(map);
      alertLayers[alert.id] = layer;
    });
  }

  function updateAlertLayerStyles() {
    Object.keys(alertLayers).forEach(function (alertId) {
      var layer = alertLayers[alertId];
      var alert = (latestData?.alerts || []).find(function (item) {
        return item.id === alertId;
      });
      if (!alert) return;

      layer.setStyle({
        color: alert.color,
        weight: selectedAlertId === alertId ? 3 : 2,
        fillColor: alert.color,
        fillOpacity: selectedAlertId === alertId ? 0.45 : 0.3,
      });
    });
  }

  function renderAlertCard(alert) {
    var areaLabel = alert.area_desc || "Affected area";
    if (areaLabel.length > 72) {
      areaLabel = areaLabel.slice(0, 69) + "…";
    }

    return (
      '<button type="button" class="warnings-card' +
      (selectedAlertId === alert.id ? " warnings-card--selected" : "") +
      '" data-alert-id="' +
      escapeHtml(alert.id) +
      '">' +
      '<div class="warnings-card__banner" style="background:' +
      escapeHtml(alert.color) +
      '">' +
      escapeHtml(alert.event) +
      "</div>" +
      '<div class="warnings-card__body">' +
      '<p class="warnings-card__distance">' +
      escapeHtml(String(alert.distance_miles)) +
      " mi</p>" +
      '<p class="warnings-card__area">' +
      escapeHtml(areaLabel) +
      "</p>" +
      '<div class="warnings-card__meta">' +
      "<span>Issued: " +
      escapeHtml(formatTimestamp(alert.sent || alert.effective)) +
      "</span>" +
      "<span>Expires: " +
      escapeHtml(formatTimestamp(alert.expires || alert.ends)) +
      "</span>" +
      "</div>" +
      "</div>" +
      "</button>"
    );
  }

  function renderAlertsList(alerts) {
    warningsCount.textContent = String(alerts.length);

    if (!alerts.length) {
      warningsList.innerHTML =
        '<p class="warnings-empty">No active NWS warnings within the selected radius.</p>';
      return;
    }

    warningsList.innerHTML = alerts.map(renderAlertCard).join("");

    warningsList.querySelectorAll("[data-alert-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        toggleAlertSelection(button.getAttribute("data-alert-id"));
      });
    });
  }

  function renderAlertDetail(alert) {
    detailBody.innerHTML =
      '<article class="warnings-detail" style="background:' +
      escapeHtml(alert.color) +
      '">' +
      '<h3 class="warnings-detail__event">' +
      escapeHtml(alert.event) +
      "</h3>" +
      (alert.headline
        ? '<p class="warnings-detail__headline">' + escapeHtml(alert.headline) + "</p>"
        : "") +
      '<p class="warnings-detail__text">' +
      escapeHtml(alert.description || "No description provided.") +
      "</p>" +
      (alert.instruction
        ? '<p class="warnings-detail__section-title">Instruction</p><p class="warnings-detail__text">' +
          escapeHtml(alert.instruction) +
          "</p>"
        : "") +
      '<p class="warnings-detail__section-title">Issuing office</p>' +
      '<p class="warnings-detail__meta">' +
      escapeHtml(alert.sender_name || "National Weather Service") +
      "</p>" +
      '<p class="warnings-detail__section-title">Issued</p>' +
      '<p class="warnings-detail__meta">' +
      escapeHtml(formatTimestamp(alert.sent || alert.effective)) +
      "</p>" +
      '<p class="warnings-detail__section-title">Expires</p>' +
      '<p class="warnings-detail__meta">' +
      escapeHtml(formatTimestamp(alert.expires || alert.ends)) +
      "</p>" +
      '<p class="warnings-detail__section-title">Area</p>' +
      '<p class="warnings-detail__meta">' +
      escapeHtml(alert.area_desc || "—") +
      "</p>" +
      "</article>";
  }

  function showDetailPanel(show) {
    detailPanel.classList.toggle("warnings-detail-panel--hidden", !show);
    detailPanel.setAttribute("aria-hidden", show ? "false" : "true");
    workspace.classList.toggle("warnings-workspace--detail-open", show);
  }

  function toggleAlertSelection(alertId) {
    if (selectedAlertId === alertId) {
      selectedAlertId = null;
      showDetailPanel(false);
      renderAlertsList(latestData?.alerts || []);
      updateAlertLayerStyles();
      return;
    }

    var alert = (latestData?.alerts || []).find(function (item) {
      return item.id === alertId;
    });
    if (!alert) return;

    selectedAlertId = alertId;
    showDetailPanel(true);
    renderAlertDetail(alert);
    renderAlertsList(latestData?.alerts || []);
    updateAlertLayerStyles();
  }

  function clearSelection() {
    selectedAlertId = null;
    showDetailPanel(false);
    if (latestData?.alerts) {
      renderAlertsList(latestData.alerts);
      updateAlertLayerStyles();
    }
  }

  function fitMapToWarnings() {
    if (!map) return;

    var layers = [];
    if (radiusCircle) layers.push(radiusCircle);
    if (platformMarker) layers.push(platformMarker);
    Object.keys(alertLayers).forEach(function (alertId) {
      layers.push(alertLayers[alertId]);
    });

    if (!layers.length) return;

    var group = L.featureGroup(layers);
    map.fitBounds(group.getBounds(), { padding: [24, 24], maxZoom: 10 });
  }

  function updateMonitorMeta(data, errorMessage) {
    if (errorMessage) {
      monitorMeta.textContent = errorMessage;
      return;
    }

    var platform = data.platform;
    var query = data.query;
    var gpsLabel =
      platform?.status === "LIVE"
        ? "GPS live"
        : platform?.status === "STALE"
          ? "GPS stale"
          : "GPS unavailable";

    monitorMeta.textContent =
      "Status: Monitoring · " +
      gpsLabel +
      " · Last poll: " +
      formatTimestamp(data.fetched_at) +
      " · Radius " +
      (query?.radius_miles || getRadiusMiles()) +
      " mi from platform GPS · " +
      (data.alert_count || 0) +
      " alerts";
  }

  async function refreshWarnings() {
    monitorMeta.textContent = "Loading warnings…";

    try {
      var data = await api("/api/warnings/platform?radius_miles=" + getRadiusMiles());
      latestData = data;

      var platformStatus = data.platform?.status || "UNKNOWN";
      setGpsBadge(platformStatus);
      setMonitorBadge(true, data.alert_count || 0);
      updateMonitorMeta(data);

      if (!data.query) {
        warningsList.innerHTML =
          '<p class="warnings-empty">' +
          escapeHtml(data.message || "Platform GPS location is not available yet.") +
          "</p>";
        warningsCount.textContent = "0";
        clearAlertLayers();
        return;
      }

      if (
        selectedAlertId &&
        !(data.alerts || []).some(function (alert) {
          return alert.id === selectedAlertId;
        })
      ) {
        clearSelection();
      }

      renderAlertsList(data.alerts || []);
      initMap();
      renderPlatformOnMap(data.query, data.platform);
      renderAlertsOnMap(data.alerts || []);

      if (selectedAlertId) {
        var selected = (data.alerts || []).find(function (alert) {
          return alert.id === selectedAlertId;
        });
        if (selected) {
          renderAlertDetail(selected);
        }
      }

      map.invalidateSize();
    } catch (error) {
      setMonitorBadge(false, 0);
      updateMonitorMeta(null, error.message || "Unable to load warnings.");
      warningsList.innerHTML =
        '<p class="warnings-empty">' + escapeHtml(error.message || "Unable to load warnings.") + "</p>";
    }
  }

  function setPollingEnabled(enabled) {
    pollingEnabled = enabled;
    pollingToggle.classList.toggle("warnings-polling-btn--on", enabled);
    pollingToggle.classList.toggle("warnings-polling-btn--off", !enabled);
    pollingToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
    pollingToggle.textContent = enabled ? "Warning polling: On" : "Warning polling: Off";

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    if (enabled) {
      pollTimer = setInterval(refreshWarnings, POLL_INTERVAL_MS);
    }

    if (latestData) {
      setMonitorBadge(enabled, latestData.alert_count || 0);
    }
  }

  radiusSelect.addEventListener("change", function () {
    clearSelection();
    refreshWarnings();
  });

  refreshBtn.addEventListener("click", refreshWarnings);

  pollingToggle.addEventListener("click", function () {
    setPollingEnabled(!pollingEnabled);
  });

  detailCloseBtn.addEventListener("click", clearSelection);

  fitWarningsBtn.addEventListener("click", fitMapToWarnings);

  layerButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      setMapLayer(button.getAttribute("data-layer"));
    });
  });

  initMap();
  setMapLayer("satellite");
  refreshWarnings();
  setPollingEnabled(true);
})();
