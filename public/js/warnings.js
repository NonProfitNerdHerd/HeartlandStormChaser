(function () {
  var DEFAULT_RADIUS = 700;
  var DEFAULT_POLL_INTERVAL_SECONDS = 3600;
  var FILTER_STORAGE_KEY = "warnings-event-filters";
  var LABELS_STORAGE_KEY = "warnings-map-labels";

  var COMMON_EVENT_TYPES = [
    "Tornado Warning",
    "Severe Thunderstorm Warning",
    "Flash Flood Warning",
    "Flood Warning",
    "Flood Watch",
    "Flash Flood Watch",
    "Tornado Watch",
    "Severe Thunderstorm Watch",
    "Special Weather Statement",
    "Winter Storm Warning",
    "Blizzard Warning",
    "High Wind Warning",
  ];

  var workspace = document.getElementById("warnings-workspace");
  var gpsStatusBadge = document.getElementById("gps-status-badge");
  var monitorStatusBadge = document.getElementById("monitor-status-badge");
  var monitorMeta = document.getElementById("monitor-meta");
  var radiusSelect = document.getElementById("radius-select");
  var filterBtn = document.getElementById("filter-btn");
  var refreshBtn = document.getElementById("refresh-btn");
  var pollIntervalSelect = document.getElementById("poll-interval-select");
  var warningsCount = document.getElementById("warnings-count");
  var warningsList = document.getElementById("warnings-list");
  var detailPanel = document.getElementById("warnings-detail-panel");
  var detailBody = document.getElementById("warnings-detail-body");
  var detailCloseBtn = document.getElementById("detail-close-btn");
  var fitWarningsBtn = document.getElementById("fit-warnings-btn");
  var layerButtons = document.querySelectorAll(".warnings-layer-btn[data-layer]");
  var filterDialog = document.getElementById("filter-dialog");
  var filterList = document.getElementById("filter-list");
  var filterForm = document.getElementById("filter-form");
  var filterDialogClose = document.getElementById("filter-dialog-close");
  var filterEnableAll = document.getElementById("filter-enable-all");
  var filterDisableAll = document.getElementById("filter-disable-all");
  var labelsPanel = document.getElementById("labels-panel");
  var labelsPanelToggle = document.getElementById("labels-panel-toggle");
  var labelsPanelClose = document.getElementById("labels-panel-close");
  var cityLabelsToggle = document.getElementById("city-labels-toggle");
  var cityDensitySelect = document.getElementById("city-density-select");
  var citySizeRange = document.getElementById("city-size-range");
  var citySizeValue = document.getElementById("city-size-value");
  var boundaryLinesToggle = document.getElementById("boundary-lines-toggle");

  var map = null;
  var baseLayers = {};
  var currentLayer = "satellite";
  var cityLabelsLayer = null;
  var boundaryLayer = null;
  var radiusCircle = null;
  var platformMarker = null;
  var alertLayers = {};
  var pollTimer = null;
  var currentPollIntervalSeconds = DEFAULT_POLL_INTERVAL_SECONDS;
  var selectedAlertId = null;
  var latestData = null;
  var eventFilters = loadEventFilters();
  var labelSettings = loadLabelSettings();

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

  function loadEventFilters() {
    try {
      var stored = localStorage.getItem(FILTER_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (_error) {
      return {};
    }
  }

  function saveEventFilters() {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(eventFilters));
  }

  function loadLabelSettings() {
    try {
      var stored = localStorage.getItem(LABELS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : { citiesEnabled: true, density: "normal", size: 1, boundariesEnabled: true };
    } catch (_error) {
      return { citiesEnabled: true, density: "normal", size: 1, boundariesEnabled: true };
    }
  }

  function saveLabelSettings() {
    localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(labelSettings));
  }

  function isEventEnabled(event) {
    if (Object.prototype.hasOwnProperty.call(eventFilters, event)) {
      return eventFilters[event] !== false;
    }
    return true;
  }

  function getVisibleAlerts(alerts) {
    return (alerts || []).filter(function (alert) { return isEventEnabled(alert.event); }).slice().sort(function (a, b) {
      if (a.severity_rank !== b.severity_rank) return a.severity_rank - b.severity_rank;
      if (a.distance_miles !== b.distance_miles) return a.distance_miles - b.distance_miles;
      return a.event.localeCompare(b.event);
    });
  }

  function collectEventTypes(alerts) {
    var types = {};
    COMMON_EVENT_TYPES.forEach(function (event) { types[event] = true; });
    (alerts || []).forEach(function (alert) { if (alert.event) types[alert.event] = true; });
    return Object.keys(types).sort(function (a, b) { return a.localeCompare(b); });
  }

  async function api(path, options) {
    var response = await fetch(path, options);
    var data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ")");
    return data;
  }

  function formatPollInterval(seconds) {
    if (seconds === 60) return "1 minute";
    if (seconds === 300) return "5 minutes";
    if (seconds === 600) return "10 minutes";
    if (seconds === 1800) return "30 minutes";
    if (seconds === 3600) return "1 hour";
    return String(seconds) + " seconds";
  }

  function getRadiusMiles() { return Number(radiusSelect.value) || DEFAULT_RADIUS; }

  function setGpsBadge(status) {
    if (status === "LIVE") { gpsStatusBadge.className = "badge badge--success"; gpsStatusBadge.textContent = "GPS LIVE"; return; }
    if (status === "STALE") { gpsStatusBadge.className = "badge badge--warning"; gpsStatusBadge.textContent = "GPS STALE"; return; }
    gpsStatusBadge.className = "badge badge--danger"; gpsStatusBadge.textContent = "GPS SIGNAL LOST";
  }

  function setMonitorBadge(active, alertCount) {
    if (!active) { monitorStatusBadge.className = "badge badge--warning"; monitorStatusBadge.textContent = "MONITOR ERROR"; return; }
    monitorStatusBadge.className = alertCount > 0 ? "badge badge--danger" : "badge badge--success";
    monitorStatusBadge.textContent = alertCount > 0 ? "WARNINGS ACTIVE" : "MONITORING";
  }

  function labelDensityMinZoom() {
    if (labelSettings.density === "sparse") return 7;
    if (labelSettings.density === "dense") return 3;
    return 5;
  }

  function labelZoomOffset() {
    var size = Number(labelSettings.size) || 1;
    if (size <= 0.9) return 1;
    if (size >= 1.2) return -1;
    return 0;
  }

  function removeOverlayLayers() {
    if (map && cityLabelsLayer) { map.removeLayer(cityLabelsLayer); cityLabelsLayer = null; }
    if (map && boundaryLayer) { map.removeLayer(boundaryLayer); boundaryLayer = null; }
  }

  function applyLabelLayers() {
    removeOverlayLayers();
    if (!map) return;
    if (labelSettings.boundariesEnabled) {
      boundaryLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { opacity: 0.65, minZoom: 3, maxZoom: 16, pane: "overlayPane" }).addTo(map);
    }
    if (labelSettings.citiesEnabled) {
      cityLabelsLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png", { subdomains: "abcd", opacity: 0.95, minZoom: labelDensityMinZoom(), zoomOffset: labelZoomOffset(), pane: "overlayPane" }).addTo(map);
    }
  }

  function syncLabelControls() {
    if (cityLabelsToggle) cityLabelsToggle.checked = !!labelSettings.citiesEnabled;
    if (cityDensitySelect) cityDensitySelect.value = labelSettings.density || "normal";
    if (citySizeRange) citySizeRange.value = String(labelSettings.size || 1);
    if (citySizeValue) citySizeValue.textContent = Number(labelSettings.size || 1).toFixed(1);
    if (boundaryLinesToggle) boundaryLinesToggle.checked = !!labelSettings.boundariesEnabled;
  }

  function initMap() {
    if (map) return;
    map = L.map("warnings-map", { zoomControl: true, attributionControl: true }).setView([39.8283, -98.5795], 5);
    baseLayers.street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" });
    baseLayers.dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors &copy; CARTO" });
    baseLayers.satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Tiles &copy; Esri" });
    baseLayers[currentLayer].addTo(map);
    applyLabelLayers();
  }

  function setMapLayer(layerName) {
    if (!map || !baseLayers[layerName]) return;
    if (baseLayers[currentLayer]) map.removeLayer(baseLayers[currentLayer]);
    currentLayer = layerName;
    baseLayers[currentLayer].addTo(map);
    layerButtons.forEach(function (button) {
      button.classList.toggle("warnings-layer-btn--active", button.getAttribute("data-layer") === layerName);
    });
    applyLabelLayers();
  }

  function clearAlertLayers() {
    Object.keys(alertLayers).forEach(function (alertId) { map.removeLayer(alertLayers[alertId]); delete alertLayers[alertId]; });
  }

  function renderPlatformOnMap(query, platform) {
    if (!map || !query) return;
    var center = [query.latitude, query.longitude];
    if (radiusCircle) map.removeLayer(radiusCircle);
    radiusCircle = L.circle(center, { radius: query.radius_miles * 1609.34, color: "#38bdf8", weight: 2, fillColor: "#38bdf8", fillOpacity: 0.08 }).addTo(map);
    if (platformMarker) map.removeLayer(platformMarker);
    platformMarker = L.circleMarker(center, { radius: 8, color: "#ffffff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }).bindTooltip(escapeHtml(platform?.device_name || "Platform GPS") + "<br>" + query.latitude.toFixed(5) + ", " + query.longitude.toFixed(5), { direction: "top" }).addTo(map);
  }

  function renderAlertsOnMap(alerts) {
    clearAlertLayers();
    alerts.forEach(function (alert) {
      if (!alert.geometry) return;
      var layer = L.geoJSON({ type: "Feature", geometry: alert.geometry, properties: {} }, { style: function () { return { color: alert.color, weight: selectedAlertId === alert.id ? 3 : 2, fillColor: alert.color, fillOpacity: selectedAlertId === alert.id ? 0.45 : 0.3 }; } });
      layer.on("click", function (event) { L.DomEvent.stopPropagation(event); toggleAlertSelection(alert.id); });
      layer.addTo(map);
      alertLayers[alert.id] = layer;
    });
  }

  function updateAlertLayerStyles() {
    var visibleAlerts = getVisibleAlerts(latestData?.alerts || []);
    Object.keys(alertLayers).forEach(function (alertId) {
      if (!visibleAlerts.some(function (alert) { return alert.id === alertId; })) {
        map.removeLayer(alertLayers[alertId]); delete alertLayers[alertId]; return;
      }
      var layer = alertLayers[alertId];
      var alert = visibleAlerts.find(function (item) { return item.id === alertId; });
      if (!alert) return;
      layer.setStyle({ color: alert.color, weight: selectedAlertId === alertId ? 3 : 2, fillColor: alert.color, fillOpacity: selectedAlertId === alertId ? 0.45 : 0.3 });
    });
  }

  function renderAlertCard(alert) {
    var areaLabel = alert.area_desc || "Affected area";
    if (areaLabel.length > 72) areaLabel = areaLabel.slice(0, 69) + "…";
    return '<button type="button" class="warnings-card' + (selectedAlertId === alert.id ? " warnings-card--selected" : "") + '" data-alert-id="' + escapeHtml(alert.id) + '"><div class="warnings-card__banner" style="background:' + escapeHtml(alert.color) + '">' + escapeHtml(alert.event) + '</div><div class="warnings-card__body"><p class="warnings-card__severity">' + escapeHtml(alert.severity) + " · " + escapeHtml(alert.urgency) + '</p><p class="warnings-card__distance">' + escapeHtml(String(alert.distance_miles)) + ' mi</p><p class="warnings-card__area">' + escapeHtml(areaLabel) + '</p><div class="warnings-card__meta"><span>Issued: ' + escapeHtml(formatTimestamp(alert.sent || alert.effective)) + '</span><span>Expires: ' + escapeHtml(formatTimestamp(alert.expires || alert.ends)) + "</span></div></div></button>";
  }

  function renderAlertsList(alerts) {
    var visibleAlerts = getVisibleAlerts(alerts);
    warningsCount.textContent = String(visibleAlerts.length);
    if (!visibleAlerts.length) { warningsList.innerHTML = '<p class="warnings-empty">No matching NWS warnings within the selected radius and filters.</p>'; return; }
    warningsList.innerHTML = visibleAlerts.map(renderAlertCard).join("");
    warningsList.querySelectorAll("[data-alert-id]").forEach(function (button) {
      button.addEventListener("click", function () { toggleAlertSelection(button.getAttribute("data-alert-id")); });
    });
  }

  function renderAlertDetail(alert) {
    detailBody.innerHTML = '<article class="warnings-detail" style="background:' + escapeHtml(alert.color) + '"><h3 class="warnings-detail__event">' + escapeHtml(alert.event) + '</h3><p class="warnings-detail__meta">' + escapeHtml(alert.severity) + " severity · " + escapeHtml(alert.urgency) + ' urgency</p>' + (alert.headline ? '<p class="warnings-detail__headline">' + escapeHtml(alert.headline) + "</p>" : "") + '<p class="warnings-detail__text">' + escapeHtml(alert.description || "No description provided.") + "</p>" + (alert.instruction ? '<p class="warnings-detail__section-title">Instruction</p><p class="warnings-detail__text">' + escapeHtml(alert.instruction) + "</p>" : "") + '<p class="warnings-detail__section-title">Issuing office</p><p class="warnings-detail__meta">' + escapeHtml(alert.sender_name || "National Weather Service") + '</p><p class="warnings-detail__section-title">Issued</p><p class="warnings-detail__meta">' + escapeHtml(formatTimestamp(alert.sent || alert.effective)) + '</p><p class="warnings-detail__section-title">Expires</p><p class="warnings-detail__meta">' + escapeHtml(formatTimestamp(alert.expires || alert.ends)) + '</p><p class="warnings-detail__section-title">Area</p><p class="warnings-detail__meta">' + escapeHtml(alert.area_desc || "—") + "</p></article>";
  }

  function showDetailPanel(show) {
    detailPanel.classList.toggle("warnings-detail-panel--hidden", !show);
    detailPanel.setAttribute("aria-hidden", show ? "false" : "true");
    workspace.classList.toggle("warnings-workspace--detail-open", show);
  }

  function findAlertById(alertId) { return (latestData?.alerts || []).find(function (item) { return item.id === alertId; }); }

  function toggleAlertSelection(alertId) {
    if (selectedAlertId === alertId) { selectedAlertId = null; showDetailPanel(false); renderAlertsList(latestData?.alerts || []); updateAlertLayerStyles(); return; }
    var alert = findAlertById(alertId);
    if (!alert || !isEventEnabled(alert.event)) return;
    selectedAlertId = alertId; showDetailPanel(true); renderAlertDetail(alert); renderAlertsList(latestData?.alerts || []); updateAlertLayerStyles();
  }

  function clearSelection() {
    selectedAlertId = null; showDetailPanel(false);
    if (latestData?.alerts) { renderAlertsList(latestData.alerts); updateAlertLayerStyles(); }
  }

  function fitMapToWarnings() {
    if (!map) return;
    var layers = [];
    if (radiusCircle) layers.push(radiusCircle);
    if (platformMarker) layers.push(platformMarker);
    Object.keys(alertLayers).forEach(function (alertId) { layers.push(alertLayers[alertId]); });
    if (!layers.length) return;
    map.fitBounds(L.featureGroup(layers).getBounds(), { padding: [24, 24], maxZoom: 10 });
  }

  function updateMonitorMeta(data, errorMessage) {
    if (errorMessage) { monitorMeta.textContent = errorMessage; return; }
    var platform = data.platform;
    var query = data.query;
    var settings = data.settings || {};
    var visibleCount = getVisibleAlerts(data.alerts || []).length;
    var totalCount = (data.alerts || []).length;
    var gpsLabel = platform?.status === "LIVE" ? "GPS live" : platform?.status === "STALE" ? "GPS stale" : "GPS unavailable";
    var pollLabel = formatPollInterval(settings.poll_interval_seconds || currentPollIntervalSeconds);
    var nextRefresh = settings.next_refresh_at ? formatTimestamp(settings.next_refresh_at) : "pending first fetch";
    monitorMeta.textContent =
      "Status: Monitoring · " +
      gpsLabel +
      " · NWS fetched: " +
      formatTimestamp(data.fetched_at || settings.fetched_at) +
      " · Server poll: " +
      pollLabel +
      " · Next NWS refresh: " +
      nextRefresh +
      " · Radius " +
      (query?.radius_miles || getRadiusMiles()) +
      " mi · Showing " +
      visibleCount +
      " of " +
      totalCount +
      " alerts";
  }

  function renderFilterDialog() {
    filterList.innerHTML = collectEventTypes(latestData?.alerts || []).map(function (event) {
      return '<label class="warnings-filter-item"><input type="checkbox" data-event="' + escapeHtml(event) + '"' + (isEventEnabled(event) ? " checked" : "") + " /><span>" + escapeHtml(event) + "</span></label>";
    }).join("");
  }

  function syncPollIntervalSelect(seconds) {
    if (!pollIntervalSelect) return;
    pollIntervalSelect.value = String(seconds || DEFAULT_POLL_INTERVAL_SECONDS);
  }

  function schedulePolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    var intervalMs = Math.max(1000, currentPollIntervalSeconds * 1000);
    pollTimer = setInterval(function () { refreshWarnings(); }, intervalMs);
  }

  async function loadWarningsSettings() {
    try {
      var data = await api("/api/warnings/settings");
      if (data.settings?.poll_interval_seconds) {
        currentPollIntervalSeconds = data.settings.poll_interval_seconds;
        syncPollIntervalSelect(currentPollIntervalSeconds);
        schedulePolling();
      }
      return data.settings;
    } catch (_error) {
      schedulePolling();
      return null;
    }
  }

  async function savePollIntervalFromDialog() {
    if (!pollIntervalSelect) return null;
    var nextInterval = Number(pollIntervalSelect.value) || DEFAULT_POLL_INTERVAL_SECONDS;
    if (nextInterval === currentPollIntervalSeconds) return null;
    var data = await api("/api/warnings/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ poll_interval_seconds: nextInterval }),
    });
    currentPollIntervalSeconds = data.settings.poll_interval_seconds;
    syncPollIntervalSelect(currentPollIntervalSeconds);
    schedulePolling();
    return data.settings;
  }

  function openFilterDialog() {
    renderFilterDialog();
    syncPollIntervalSelect(currentPollIntervalSeconds);
    if (filterDialog && typeof filterDialog.showModal === "function") filterDialog.showModal();
  }

  function applyFiltersFromDialog() {
    filterList.querySelectorAll("input[data-event]").forEach(function (input) {
      var event = input.getAttribute("data-event"); if (event) eventFilters[event] = input.checked;
    });
    saveEventFilters();
    if (selectedAlertId) { var selected = findAlertById(selectedAlertId); if (!selected || !isEventEnabled(selected.event)) clearSelection(); }
    renderCurrentAlerts();
  }

  async function applySettingsFromDialog() {
    applyFiltersFromDialog();
    try {
      await savePollIntervalFromDialog();
      if (latestData) refreshWarnings();
    } catch (error) {
      monitorMeta.textContent = error.message || "Unable to save polling settings.";
    }
  }

  function renderCurrentAlerts() {
    if (!latestData) return;
    var visibleAlerts = getVisibleAlerts(latestData.alerts || []);
    renderAlertsList(latestData.alerts || []);
    renderAlertsOnMap(visibleAlerts);
    setMonitorBadge(true, visibleAlerts.length);
    updateMonitorMeta(latestData);
    if (selectedAlertId) { var selected = findAlertById(selectedAlertId); if (selected) renderAlertDetail(selected); }
    updateAlertLayerStyles();
  }

  async function refreshWarnings(options) {
    monitorMeta.textContent = "Loading warnings…";
    try {
      var forceQuery = options && options.force ? "&force=1" : "";
      var data = await api("/api/warnings/platform?radius_miles=" + getRadiusMiles() + forceQuery);
      if (data.settings?.poll_interval_seconds) {
        currentPollIntervalSeconds = data.settings.poll_interval_seconds;
        syncPollIntervalSelect(currentPollIntervalSeconds);
      }
      latestData = data;
      var visibleAlerts = getVisibleAlerts(data.alerts || []);
      setGpsBadge(data.platform?.status || "UNKNOWN");
      setMonitorBadge(true, visibleAlerts.length);
      updateMonitorMeta(data);
      if (!data.query) {
        warningsList.innerHTML = '<p class="warnings-empty">' + escapeHtml(data.message || "Platform GPS location is not available yet.") + "</p>";
        warningsCount.textContent = "0"; clearAlertLayers(); return;
      }
      if (selectedAlertId && !visibleAlerts.some(function (alert) { return alert.id === selectedAlertId; })) clearSelection();
      renderAlertsList(data.alerts || []);
      initMap();
      renderPlatformOnMap(data.query, data.platform);
      renderAlertsOnMap(visibleAlerts);
      if (selectedAlertId) { var selected = findAlertById(selectedAlertId); if (selected) renderAlertDetail(selected); }
      map.invalidateSize();
      if (options && options.fitMap) fitMapToWarnings();
    } catch (error) {
      setMonitorBadge(false, 0);
      updateMonitorMeta(null, error.message || "Unable to load warnings.");
      warningsList.innerHTML = '<p class="warnings-empty">' + escapeHtml(error.message || "Unable to load warnings.") + "</p>";
    }
  }

  radiusSelect.addEventListener("change", function () { clearSelection(); refreshWarnings({ fitMap: true }); });
  if (filterBtn) filterBtn.addEventListener("click", openFilterDialog);
  if (filterForm) filterForm.addEventListener("submit", function (event) {
    event.preventDefault();
    applySettingsFromDialog().finally(function () { if (filterDialog) filterDialog.close(); });
  });
  if (filterDialogClose) filterDialogClose.addEventListener("click", function () { if (filterDialog) filterDialog.close(); });
  if (filterEnableAll) filterEnableAll.addEventListener("click", function () { filterList.querySelectorAll("input[data-event]").forEach(function (input) { input.checked = true; }); });
  if (filterDisableAll) filterDisableAll.addEventListener("click", function () { filterList.querySelectorAll("input[data-event]").forEach(function (input) { input.checked = false; }); });
  refreshBtn.addEventListener("click", function () { refreshWarnings({ force: true }); });
  detailCloseBtn.addEventListener("click", clearSelection);
  fitWarningsBtn.addEventListener("click", fitMapToWarnings);
  layerButtons.forEach(function (button) { button.addEventListener("click", function () { setMapLayer(button.getAttribute("data-layer")); }); });
  if (labelsPanelToggle) labelsPanelToggle.addEventListener("click", function () { labelsPanel.classList.toggle("warnings-labels-panel--hidden"); });
  if (labelsPanelClose) labelsPanelClose.addEventListener("click", function () { labelsPanel.classList.add("warnings-labels-panel--hidden"); });

  function updateLabelSettingsFromControls() {
    labelSettings.citiesEnabled = !!cityLabelsToggle?.checked;
    labelSettings.density = cityDensitySelect?.value || "normal";
    labelSettings.size = Number(citySizeRange?.value || 1);
    labelSettings.boundariesEnabled = !!boundaryLinesToggle?.checked;
    if (citySizeValue) citySizeValue.textContent = labelSettings.size.toFixed(1);
    saveLabelSettings();
    applyLabelLayers();
  }

  if (cityLabelsToggle) cityLabelsToggle.addEventListener("change", updateLabelSettingsFromControls);
  if (cityDensitySelect) cityDensitySelect.addEventListener("change", updateLabelSettingsFromControls);
  if (citySizeRange) citySizeRange.addEventListener("input", updateLabelSettingsFromControls);
  if (boundaryLinesToggle) boundaryLinesToggle.addEventListener("change", updateLabelSettingsFromControls);

  syncLabelControls();
  initMap();
  setMapLayer("satellite");
  loadWarningsSettings().finally(function () {
    refreshWarnings({ fitMap: true });
  });
})();
