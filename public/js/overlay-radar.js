(function () {
  var GPS_POLL_MS = 8000;
  var API_PATH = "/api/overlays/radar-data";
  var SETTINGS_PATH = "/api/overlays/radar-settings";
  var RECENTER_METERS = 350;

  var params = new URLSearchParams(window.location.search);
  var isPreview = params.get("preview") === "1";
  var isConfig = params.get("config") === "1";

  if (isPreview) document.body.classList.add("overlay-body--preview");
  if (isConfig) document.body.classList.add("overlay-body--config");

  var mapEl = document.getElementById("radar-map");
  var emptyEl = document.getElementById("radar-empty");
  var configEl = document.getElementById("radar-config");
  var configForm = document.getElementById("radar-config-form");
  var configMeta = document.getElementById("radar-config-meta");
  var configMessage = document.getElementById("radar-config-message");

  var coordsEl = document.getElementById("radar-coords");
  var gpsUpdatedEl = document.getElementById("radar-gps-updated");
  var radarStatusEl = document.getElementById("radar-status");
  var radarFrameEl = document.getElementById("radar-frame");

  var FRAME_MS = 400;
  var map = null;
  var baseLayer = null;
  var radarLayer = null;
  var marker = null;
  var lastCenter = null;
  var lastMapStyle = null;
  var lastZoomSetting = null;
  var pollTimer = null;
  var animTimer = null;
  var inFlight = false;
  var configDirty = false;
  var latestSettings = null;
  var latestRadar = null;
  var animFrames = [];
  var animIndex = 0;
  var lastFramesKey = "";
  var displayedFrameTime = null;

  if (isConfig && configEl) {
    configEl.hidden = false;
  }

  function haversineMeters(a, b) {
    var toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad;
    var dLon = (b.lon - a.lon) * toRad;
    var lat1 = a.lat * toRad;
    var lat2 = b.lat * toRad;
    var h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function formatCoords(lat, lon) {
    if (lat == null || lon == null) return "—";
    return Number(lat).toFixed(5) + ", " + Number(lon).toFixed(5);
  }

  function formatUpdated(iso) {
    if (!iso) return "—";
    if (window.HeartlandTime && typeof window.HeartlandTime.formatCentral === "function") {
      return window.HeartlandTime.formatCentral(iso);
    }
    try {
      return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago" });
    } catch {
      return iso;
    }
  }

  function gpsTone(status) {
    var s = String(status || "").toUpperCase();
    if (s === "LIVE") return "live";
    if (s === "STALE") return "stale";
    return "offline";
  }

  function setTone(el, tone) {
    el.classList.remove(
      "radar-hud__value--live",
      "radar-hud__value--stale",
      "radar-hud__value--offline",
      "radar-hud__value--error",
    );
    if (tone) el.classList.add("radar-hud__value--" + tone);
  }

  function applyVisibility(settings) {
    var mapFields = {
      coords: settings.show_coords,
      updated: settings.show_updated,
    };
    Object.keys(mapFields).forEach(function (key) {
      var row = document.querySelector('[data-field="' + key + '"]');
      if (row) row.hidden = !mapFields[key];
    });
  }

  function ensureMap(style, zoom) {
    if (typeof L === "undefined") {
      emptyEl.hidden = false;
      emptyEl.textContent = "Map failed to initialize (Leaflet unavailable)";
      return false;
    }
    if (!map) {
      map = L.map(mapEl, {
        zoomControl: false,
        attributionControl: true,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
      }).setView([39.5, -98.35], zoom || 8);
    }
    setBaseLayer(style || "dark");
    if (zoom != null && map.getZoom() !== zoom) {
      map.setZoom(zoom, { animate: false });
    }
    return true;
  }

  function setBaseLayer(style) {
    if (!map || style === lastMapStyle) return;
    if (baseLayer) {
      map.removeLayer(baseLayer);
      baseLayer = null;
    }
    if (style === "streets") {
      baseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      });
    } else if (style === "satellite") {
      baseLayer = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "Tiles &copy; Esri" },
      );
    } else {
      baseLayer = L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { maxZoom: 19, attribution: "&copy; OpenStreetMap &copy; CARTO" },
      );
    }
    baseLayer.addTo(map);
    lastMapStyle = style;
  }

  function clearAnimTimer() {
    if (animTimer) {
      clearTimeout(animTimer);
      animTimer = null;
    }
  }

  function removeRadarLayer() {
    clearAnimTimer();
    if (map && radarLayer) {
      map.removeLayer(radarLayer);
      radarLayer = null;
    }
    displayedFrameTime = null;
  }

  function framesKey(frames) {
    if (!frames || !frames.length) return "";
    return frames[0] + "|" + frames[frames.length - 1] + "|" + frames.length;
  }

  function showFrame(timeIso) {
    if (!radarLayer || !timeIso) return;
    displayedFrameTime = timeIso;
    radarLayer.setParams({ TIME: timeIso }, false);
    updateRadarHud();
  }

  function ensureRadarLayer() {
    if (!map || !latestRadar || !latestRadar.wms || !latestSettings) return false;
    var frames = latestRadar.frames || [];
    if (!frames.length) return false;

    var opacity = latestSettings.opacity != null ? latestSettings.opacity : 0.65;
    var wms = latestRadar.wms;
    var key = framesKey(frames);
    var needsRebuild = !radarLayer || key !== lastFramesKey;

    if (needsRebuild) {
      removeRadarLayer();
      radarLayer = L.tileLayer.wms(wms.url, {
        layers: wms.layers,
        format: wms.format || "image/png",
        transparent: wms.transparent !== false,
        opacity: opacity,
        attribution: wms.attribution || "Radar © IEM / NWS",
        uppercase: true,
        TIME: frames[frames.length - 1],
      });
      radarLayer.addTo(map);
      animFrames = frames.slice();
      animIndex = animFrames.length - 1;
      lastFramesKey = key;
      displayedFrameTime = animFrames[animIndex];
    } else {
      animFrames = frames.slice();
      if (radarLayer && latestSettings.opacity != null) {
        radarLayer.setOpacity(opacity);
      }
    }
    return true;
  }

  function tickAnimation() {
    clearAnimTimer();
    if (!latestSettings || !latestSettings.polling_enabled) return;
    if (!animFrames.length || !radarLayer) return;

    animIndex = (animIndex + 1) % animFrames.length;
    showFrame(animFrames[animIndex]);
    animTimer = setTimeout(tickAnimation, FRAME_MS);
  }

  function startOrContinueAnimation() {
    clearAnimTimer();
    if (!latestSettings || !latestSettings.polling_enabled) return;
    if (!ensureRadarLayer()) return;
    if (animFrames.length <= 1) {
      showFrame(animFrames[0]);
      return;
    }
    animTimer = setTimeout(tickAnimation, FRAME_MS);
  }

  function syncRadarLayerFromSettings() {
    if (!latestSettings) return;
    if (latestSettings.polling_enabled) {
      startOrContinueAnimation();
    } else {
      clearAnimTimer();
      // Keep last frame visible; do not start new upstream fetches via animation.
      if (radarLayer && latestSettings.opacity != null) {
        radarLayer.setOpacity(latestSettings.opacity);
      }
      updateRadarHud();
    }
  }

  function markerIcon(status) {
    var tone = gpsTone(status);
    return L.divIcon({
      className: "",
      html:
        '<div class="radar-marker' +
        (tone !== "live" ? " radar-marker--" + tone : "") +
        '"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  function updateMarker(lat, lon, status) {
    if (!map) return;
    var latlng = [lat, lon];
    if (!marker) {
      marker = L.marker(latlng, { icon: markerIcon(status), interactive: false }).addTo(map);
    } else {
      marker.setLatLng(latlng);
      marker.setIcon(markerIcon(status));
    }

    var next = { lat: lat, lon: lon };
    var desiredZoom = lastZoomSetting != null ? lastZoomSetting : map.getZoom();
    if (
      !lastCenter ||
      haversineMeters(lastCenter, next) >= RECENTER_METERS ||
      map.getZoom() !== desiredZoom
    ) {
      map.setView(latlng, desiredZoom, { animate: false });
    }
    lastCenter = next;
  }

  function fillConfigForm(settings, radar) {
    if (!configForm || !settings || configDirty) return;
    var enabled = configForm.querySelector('[name="overlay_radar_polling_enabled"]');
    if (enabled) enabled.checked = Boolean(settings.polling_enabled);
    var values = {
      overlay_radar_polling_interval_sec: settings.polling_interval_sec,
      overlay_radar_zoom: settings.zoom,
      overlay_radar_opacity: settings.opacity,
      overlay_radar_map_style: settings.map_style,
    };
    Object.keys(values).forEach(function (name) {
      var el = configForm.querySelector('[name="' + name + '"]');
      if (el) el.value = String(values[name]);
    });
    var shows = {
      overlay_radar_show_coords: settings.show_coords,
      overlay_radar_show_updated: settings.show_updated,
    };
    Object.keys(shows).forEach(function (name) {
      var el = configForm.querySelector('[name="' + name + '"]');
      if (el) el.checked = Boolean(shows[name]);
    });

    if (configMeta) {
      var parts = [];
      parts.push(settings.polling_enabled ? "Polling active" : "Polling paused");
      if (radar && radar.product) parts.push(radar.product);
      if (radar && radar.frame_count) parts.push(radar.frame_count + " frames cached");
      if (radar && radar.cache_expires_at) {
        parts.push("cache until " + formatUpdated(radar.cache_expires_at));
      }
      configMeta.textContent = parts.join(" · ");
    }
  }

  function updateRadarHud() {
    if (!latestSettings || !latestRadar) return;
    var n = (latestRadar.frames && latestRadar.frames.length) || 0;
    if (!latestSettings.polling_enabled) {
      radarStatusEl.textContent = radarLayer
        ? "Paused · frozen frame"
        : "Polling paused";
      setTone(radarStatusEl, "stale");
    } else if (n > 1) {
      radarStatusEl.textContent = "Looping · " + n + " frames";
      setTone(radarStatusEl, "live");
    } else if (n === 1) {
      radarStatusEl.textContent = "Active · 1 frame";
      setTone(radarStatusEl, "live");
    } else {
      radarStatusEl.textContent = "Waiting for frames";
      setTone(radarStatusEl, "stale");
    }
    radarFrameEl.textContent = displayedFrameTime
      ? formatUpdated(displayedFrameTime)
      : latestRadar.product || "CONUS Base Reflectivity";
  }

  function render(data) {
    var settings = data.settings || {};
    var radar = data.radar || {};
    var platform = data.platform;
    var settingsChanged =
      !latestSettings ||
      latestSettings.map_style !== settings.map_style ||
      latestSettings.zoom !== settings.zoom ||
      latestSettings.opacity !== settings.opacity ||
      latestSettings.polling_enabled !== settings.polling_enabled ||
      latestSettings.polling_interval_sec !== settings.polling_interval_sec;
    var nextFramesKey = framesKey(radar.frames);
    var framesChanged = nextFramesKey !== lastFramesKey;

    latestSettings = settings;
    latestRadar = radar;

    applyVisibility(settings);
    lastZoomSetting = settings.zoom != null ? settings.zoom : 8;

    if (!ensureMap(settings.map_style, settings.zoom)) {
      return;
    }

    fillConfigForm(settings, radar);

    if (settingsChanged || framesChanged) {
      syncRadarLayerFromSettings();
    } else if (settings.polling_enabled && !animTimer && animFrames.length > 1) {
      startOrContinueAnimation();
    }

    if (!data.has_platform_source || !platform) {
      emptyEl.hidden = false;
      emptyEl.textContent = data.message || "No platform GPS source selected";
      updateRadarHud();
      return;
    }

    emptyEl.hidden = true;

    var hasFix = platform.latitude != null && platform.longitude != null;
    if (hasFix) {
      updateMarker(Number(platform.latitude), Number(platform.longitude), platform.status);
    } else {
      emptyEl.hidden = false;
      emptyEl.textContent = data.message || "Waiting for GPS location";
    }

    coordsEl.textContent = formatCoords(platform.latitude, platform.longitude);
    gpsUpdatedEl.textContent = formatUpdated(platform.received_at_utc || platform.timestamp_utc);

    updateRadarHud();

    if (map) {
      setTimeout(function () {
        map.invalidateSize();
      }, 50);
    }
  }

  async function refresh() {
    if (inFlight) return;
    inFlight = true;
    try {
      var response = await fetch(API_PATH, { credentials: "same-origin" });
      var data = await response.json().catch(function () {
        return {};
      });
      if (!response.ok || data.ok === false) {
        emptyEl.hidden = false;
        emptyEl.textContent = data.error || "Radar overlay request failed";
        return;
      }
      render(data);
    } catch (error) {
      emptyEl.hidden = false;
      emptyEl.textContent =
        error instanceof Error ? error.message : "Radar overlay request failed";
    } finally {
      inFlight = false;
    }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async function () {
      await refresh();
      schedulePoll();
    }, GPS_POLL_MS);
  }

  if (configForm) {
    configForm.addEventListener("input", function () {
      configDirty = true;
    });
    configForm.addEventListener("change", function () {
      configDirty = true;
    });

    configForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var fd = new FormData(configForm);
      var payload = {
        overlay_radar_polling_enabled: configForm.querySelector(
          '[name="overlay_radar_polling_enabled"]',
        ).checked
          ? "1"
          : "0",
        overlay_radar_polling_interval_sec: String(
          fd.get("overlay_radar_polling_interval_sec") || "300",
        ),
        overlay_radar_zoom: String(fd.get("overlay_radar_zoom") || "8"),
        overlay_radar_opacity: String(fd.get("overlay_radar_opacity") || "0.65"),
        overlay_radar_map_style: String(fd.get("overlay_radar_map_style") || "dark"),
        overlay_radar_show_coords: configForm.querySelector('[name="overlay_radar_show_coords"]')
          .checked
          ? "1"
          : "0",
        overlay_radar_show_updated: configForm.querySelector(
          '[name="overlay_radar_show_updated"]',
        ).checked
          ? "1"
          : "0",
      };

      configMessage.hidden = true;
      configMessage.style.color = "";
      try {
        var response = await fetch(SETTINGS_PATH, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        var data = await response.json().catch(function () {
          return {};
        });
        if (!response.ok || data.ok === false) {
          throw new Error(data.error || "Save failed");
        }
        configDirty = false;
        lastMapStyle = null;
        lastZoomSetting = null;
        configMessage.hidden = false;
        configMessage.textContent = "Saved";
        configMessage.style.color = "#4ade80";
        await refresh();
      } catch (error) {
        configMessage.hidden = false;
        configMessage.textContent = error instanceof Error ? error.message : "Save failed";
        configMessage.style.color = "#f87171";
      }
    });
  }

  window.addEventListener("pagehide", function () {
    clearTimeout(pollTimer);
    clearAnimTimer();
  });

  refresh().then(schedulePoll);
})();
