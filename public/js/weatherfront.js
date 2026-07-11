(function () {
  var DEFAULT_URL = "https://app.weatherfront.com";
  var LOAD_TIMEOUT_MS = 20000;
  var GPS_POLL_MS = 10000;
  var CHASE_FRESH_SECONDS = 60;
  var IDLE_FRESH_SECONDS = 3600;

  var params = new URLSearchParams(window.location.search);
  var weatherFrontUrl = params.get("url") || DEFAULT_URL;

  var iframe = document.getElementById("weatherfront-iframe");
  var scaledEl = document.getElementById("weatherfront-scaled");
  var loadingEl = document.getElementById("weatherfront-loading");
  var errorEl = document.getElementById("weatherfront-error");
  var reloadBtn = document.getElementById("weatherfront-reload-btn");
  var zoomBar = document.getElementById("weatherfront-zoom-bar");
  var gpsBanner = document.getElementById("gps-status-banner");
  var gpsLineDevice = document.getElementById("gps-line-device");
  var gpsLineStatus = document.getElementById("gps-line-status");
  var gpsLineCoords = document.getElementById("gps-line-coords");
  var gpsLineAge = document.getElementById("gps-line-age");

  var reloadKey = 0;
  var loadState = "loading";
  var loadTimer = null;
  var currentZoom = 100;

  function setLoadState(state) {
    loadState = state;

    if (state === "loading") {
      loadingEl.classList.remove("weatherfront-embed__state--hidden");
      errorEl.classList.add("weatherfront-embed__state--hidden");
      iframe.classList.add("weatherfront-embed__iframe--loading");
      return;
    }

    loadingEl.classList.add("weatherfront-embed__state--hidden");

    if (state === "error") {
      errorEl.classList.remove("weatherfront-embed__state--hidden");
      iframe.classList.add("weatherfront-embed__iframe--loading");
      return;
    }

    errorEl.classList.add("weatherfront-embed__state--hidden");
    iframe.classList.remove("weatherfront-embed__iframe--loading");
  }

  function scheduleLoadTimeout() {
    if (loadTimer) {
      clearTimeout(loadTimer);
    }

    loadTimer = setTimeout(function () {
      if (loadState === "loading") {
        setLoadState("error");
      }
    }, LOAD_TIMEOUT_MS);
  }

  function scheduleWeatherFrontLocateAfterLoad() {
    if (!iframe || !iframe.contentWindow) {
      return;
    }

    var attempts = [
      { type: "weatherfront:locate" },
      { type: "locate" },
      { action: "locate" },
      { command: "locate" },
    ];

    attempts.forEach(function (message, index) {
      setTimeout(function () {
        try {
          iframe.contentWindow.postMessage(message, "*");
        } catch (error) {
          /* cross-origin postMessage is best-effort */
        }
      }, 400 + index * 350);
    });
  }

  function mountIframe() {
    reloadKey += 1;
    setLoadState("loading");
    scheduleLoadTimeout();
    iframe.src = weatherFrontUrl;
  }

  function handleIframeLoad() {
    if (loadTimer) {
      clearTimeout(loadTimer);
      loadTimer = null;
    }

    setLoadState("loaded");
    scheduleWeatherFrontLocateAfterLoad();
  }

  function formatGpsAge(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return "unknown age";
    if (seconds < 60) return seconds + "s ago";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
    return Math.floor(seconds / 3600) + "h ago";
  }

  function isChaseInProgress(chases) {
    return (chases || []).some(function (chase) {
      return chase.status === "active" || chase.status === "paused";
    });
  }

  function isGpsFresh(ageSeconds, chaseInProgress) {
    if (ageSeconds == null || Number.isNaN(ageSeconds)) {
      return false;
    }

    var threshold = chaseInProgress ? CHASE_FRESH_SECONDS : IDLE_FRESH_SECONDS;
    return ageSeconds <= threshold;
  }

  function setGpsFreshness(isFresh) {
    gpsBanner.classList.toggle("weatherfront-gps-overlay--ok", isFresh);
  }

  function setIframeZoom(percent) {
    currentZoom = percent;
    var scale = percent / 100;

    scaledEl.style.transform = "scale(" + scale + ")";
    scaledEl.style.width = 100 / scale + "%";
    scaledEl.style.height = 100 / scale + "%";

    var buttons = zoomBar.querySelectorAll(".weatherfront-zoom-btn");
    buttons.forEach(function (button) {
      var zoom = Number(button.getAttribute("data-zoom"));
      button.classList.toggle("weatherfront-zoom-btn--active", zoom === percent);
    });
  }

  async function refreshGpsBanner() {
    try {
      var responses = await Promise.all([
        fetch("/api/gps/latest-active"),
        fetch("/api/chases"),
      ]);
      var gpsData = await responses[0].json();
      var chaseData = await responses[1].json();
      var chaseInProgress = chaseData.ok && isChaseInProgress(chaseData.chases);

      gpsBanner.classList.remove("weatherfront-gps-overlay--hidden");

      if (!gpsData.ok || !gpsData.active) {
        gpsLineDevice.textContent = "No GPS";
        gpsLineStatus.textContent = "";
        gpsLineCoords.textContent = "";
        gpsLineAge.textContent = gpsData.message || "Select platform device";
        setGpsFreshness(false);
        return;
      }

      var status = gpsData.status || "UNKNOWN";
      var label = gpsData.device_name || "Platform GPS";
      var coords =
        Number(gpsData.latitude).toFixed(4) + ", " + Number(gpsData.longitude).toFixed(4);
      var age = formatGpsAge(gpsData.age_seconds);

      gpsLineDevice.textContent = label;
      gpsLineStatus.textContent = status;
      gpsLineCoords.textContent = coords;
      gpsLineAge.textContent = "updated " + age;

      setGpsFreshness(isGpsFresh(gpsData.age_seconds, chaseInProgress));
    } catch (error) {
      gpsBanner.classList.remove("weatherfront-gps-overlay--ok", "weatherfront-gps-overlay--hidden");
      gpsLineDevice.textContent = "GPS offline";
      gpsLineStatus.textContent = "";
      gpsLineCoords.textContent = "";
      gpsLineAge.textContent = "";
    }
  }

  iframe.addEventListener("load", handleIframeLoad);
  iframe.addEventListener("error", function () {
    setLoadState("error");
  });

  reloadBtn.addEventListener("click", mountIframe);

  zoomBar.addEventListener("click", function (event) {
    var button = event.target.closest(".weatherfront-zoom-btn");
    if (!button) {
      return;
    }

    var zoom = Number(button.getAttribute("data-zoom"));
    if (!Number.isFinite(zoom)) {
      return;
    }

    setIframeZoom(zoom);
  });

  mountIframe();
  setIframeZoom(currentZoom);
  gpsLineDevice.textContent = "Loading GPS…";
  refreshGpsBanner();
  setInterval(refreshGpsBanner, GPS_POLL_MS);
})();
