(function () {
  /**
   * Register OBS browser source overlays here as they are built.
   * status: "live" | "coming-soon"
   */
  var OVERLAY_CATALOG = [
    {
      id: "chase-laptop",
      label: "ChaseLaptop",
      title: "Chase laptop dashboard bar",
      description:
        "Full-width six-column chase bar with current location, heading, target, ETA, ceiling, temp, wind, and pressure for laptop/OBS scenes.",
      path: "/overlays/chase-laptop.html",
      previewQuery: "preview=1",
      status: "live",
      previewHeight: 176,
    },
    {
      id: "gps-weather",
      label: "GPS + Weather",
      title: "Platform GPS and weather panel",
      description:
        "Live platform GPS position, speed, heading, target location, and NWS weather for OBS scenes.",
      path: "/overlays/gps-weather.html",
      previewQuery: "preview=1",
      status: "live",
      previewHeight: 220,
    },
    {
      id: "chase-ticker",
      label: "Chase status",
      title: "Scrolling status ticker",
      description:
        "Right-to-left scrolling ticker using status text from the Android Overlays tab. Line breaks become dot-separated items.",
      path: "/overlays/ticker.html",
      previewQuery: "preview=1",
      status: "live",
      previewHeight: 72,
    },
    {
      id: "warnings-bar",
      label: "Warnings",
      title: "Active NWS warning bar",
      description:
        "Two-row warning banner for the highest-priority NWS alert near platform GPS, using the same colors as the Warnings page.",
      path: "/overlays/warnings.html",
      previewQuery: "preview=1",
      status: "live",
      previewHeight: 96,
    },
    {
      id: "radar-gps",
      label: "Radar + GPS",
      title: "Platform GPS map with radar",
      description:
        "Map centered on the active platform GPS source with a looping CONUS Base Reflectivity radar (last ~2 hours / 24 frames, cached 3 days), location HUD, and controllable radar polling for OBS.",
      path: "/overlays/radar/",
      previewQuery: "preview=1",
      configQuery: "config=1",
      status: "live",
      previewHeight: 280,
    },
  ];

  var catalogEl = document.getElementById("overlay-catalog");
  var settingsBadge = document.getElementById("overlay-settings-badge");
  var targetLocationEl = document.getElementById("overlay-target-location");
  var tickerTextEl = document.getElementById("overlay-ticker-text");
  var platformGpsEl = document.getElementById("overlay-platform-gps");

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function absoluteUrl(path, query) {
    var url = new URL(path, window.location.origin);
    if (query) {
      var params = new URLSearchParams(query);
      params.forEach(function (value, key) {
        url.searchParams.set(key, value);
      });
    }
    return url.toString();
  }

  function formatLocation(city, state) {
    if (city && state) return city + ", " + state;
    if (city) return city;
    if (state) return state;
    return "Not set";
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      var original = button.textContent;
      button.textContent = "Copied!";
      setTimeout(function () {
        button.textContent = original;
      }, 1600);
    } catch (error) {
      window.prompt("Copy this URL:", text);
    }
  }

  function renderCatalog() {
    catalogEl.innerHTML = OVERLAY_CATALOG.map(function (overlay) {
      var isLive = overlay.status === "live" && overlay.path;
      var fullUrl = isLive
        ? absoluteUrl(overlay.path, overlay.previewQuery)
        : null;
      var obsUrl = isLive ? absoluteUrl(overlay.path, null) : null;
      var configUrl =
        isLive && overlay.configQuery
          ? absoluteUrl(overlay.path, overlay.configQuery)
          : null;
      var statusClass =
        overlay.status === "live" ? "overlay-card__status--live" : "overlay-card__status--soon";
      var statusLabel = overlay.status === "live" ? "Live" : "Coming soon";

      var previewHtml = isLive
        ? '<iframe class="overlay-card__preview" title="' +
          escapeHtml(overlay.title) +
          ' preview" src="' +
          escapeHtml(fullUrl) +
          '" loading="lazy"></iframe>'
        : '<div class="overlay-card__preview-placeholder">Preview available when this overlay is built.</div>';

      var sidebarHtml = isLive
        ? '<p class="overlay-card__url-label">OBS browser source URL</p>' +
          '<p class="overlay-card__url">' +
          escapeHtml(obsUrl) +
          "</p>" +
          '<div class="overlay-card__actions">' +
          '<button type="button" class="btn btn--secondary overlay-copy-btn" data-url="' +
          escapeHtml(obsUrl) +
          '">Copy URL</button>' +
          '<a class="btn btn--secondary" href="' +
          escapeHtml(obsUrl) +
          '" target="_blank" rel="noopener noreferrer">Open overlay</a>' +
          (configUrl
            ? '<a class="btn btn--secondary" href="' +
              escapeHtml(configUrl) +
              '" target="_blank" rel="noopener noreferrer">Configure</a>'
            : "") +
          "</div>" +
          '<p class="overlay-card__path">' +
          escapeHtml(overlay.path) +
          "</p>"
        : '<p class="overlay-card__url-label">OBS browser source URL</p>' +
          '<p class="overlay-card__url">Not available yet</p>' +
          '<div class="overlay-card__actions">' +
          '<button type="button" class="btn btn--secondary" disabled>Copy URL</button>' +
          '<button type="button" class="btn btn--secondary" disabled>Open overlay</button>' +
          "</div>";

      return (
        '<article class="overlay-card' +
        (isLive ? "" : " overlay-card--soon") +
        '" aria-labelledby="overlay-' +
        escapeHtml(overlay.id) +
        '-title">' +
        '<div class="overlay-card__main">' +
        '<div class="overlay-card__head">' +
        '<p class="overlay-card__label">' +
        escapeHtml(overlay.label) +
        "</p>" +
        '<h2 class="overlay-card__title" id="overlay-' +
        escapeHtml(overlay.id) +
        '-title">' +
        escapeHtml(overlay.title) +
        "</h2>" +
        '<p class="overlay-card__description">' +
        escapeHtml(overlay.description) +
        '<span class="overlay-card__status ' +
        statusClass +
        '">' +
        statusLabel +
        "</span></p>" +
        "</div>" +
        '<div class="overlay-card__preview-wrap">' +
        previewHtml +
        "</div>" +
        "</div>" +
        '<aside class="overlay-card__sidebar">' +
        sidebarHtml +
        "</aside>" +
        "</article>"
      );
    }).join("");

    catalogEl.querySelectorAll(".overlay-copy-btn").forEach(function (button) {
      button.addEventListener("click", function () {
        copyText(button.dataset.url, button);
      });
    });
  }

  async function loadOverlayContext() {
    try {
      var results = await Promise.all([
        fetch("/api/overlay/settings").then(function (r) {
          return r.json();
        }),
        fetch("/api/gps/platform").then(function (r) {
          return r.json();
        }),
      ]);

      var settingsData = results[0];
      var platformData = results[1];

      if (settingsData.ok && settingsData.settings) {
        var settings = settingsData.settings;
        targetLocationEl.textContent = formatLocation(
          settings.overlay_target_city,
          settings.overlay_target_state,
        );
        tickerTextEl.textContent =
          (settings.overlay_ticker_text && settings.overlay_ticker_text.trim()) ||
          "Not set";
        settingsBadge.textContent = "Synced";
        settingsBadge.className = "badge badge--success";
      } else {
        settingsBadge.textContent = "Unavailable";
        settingsBadge.className = "badge badge--danger";
      }

      if (platformData.ok && platformData.platform_source) {
        var platform = platformData.platform_source;
        var status = platform.location ? platform.location.status : platform.status;
        platformGpsEl.textContent =
          platform.device_name + (status ? " · " + status : "");
      } else {
        platformGpsEl.textContent =
          platformData.message || "No platform GPS source selected";
      }
    } catch (error) {
      settingsBadge.textContent = "Offline";
      settingsBadge.className = "badge badge--danger";
      targetLocationEl.textContent = "Could not load settings";
      tickerTextEl.textContent = "—";
      platformGpsEl.textContent = "—";
    }
  }

  renderCatalog();
  loadOverlayContext();
})();
