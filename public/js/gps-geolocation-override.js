/**
 * Overrides navigator.geolocation on Heartland pages using platform GPS from the worker.
 * Cross-origin iframes (e.g. WeatherFront) still use their own origin geolocation policy.
 */
(function () {
  var API_PATH = "/api/gps/latest-active";
  var POLL_INTERVAL_MS = 5000;

  var cachedPosition = null;
  var watchCallbacks = new Map();
  var watchIdCounter = 1;

  function parseUtcTimestamp(value) {
    if (!value) return Date.now();
    var normalized = value.includes("T") ? value : value.replace(" ", "T");
    var withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : normalized + "Z";
    var parsed = Date.parse(withZone);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }

  function mphToMps(value) {
    if (value == null || Number.isNaN(value)) return null;
    return Number(value) * 0.44704;
  }

  function toPosition(data) {
    if (!data || !data.ok || data.latitude == null || data.longitude == null) {
      return null;
    }

    return {
      coords: {
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        accuracy: data.accuracy_meters != null ? Number(data.accuracy_meters) : 50,
        altitude: null,
        altitudeAccuracy: null,
        heading: data.heading_degrees != null ? Number(data.heading_degrees) : null,
        speed: mphToMps(data.speed_mph),
      },
      timestamp: parseUtcTimestamp(data.received_at_utc || data.timestamp_utc),
    };
  }

  async function refreshCachedPosition() {
    try {
      var response = await fetch(API_PATH);
      var data = await response.json();
      cachedPosition = toPosition(data);
      notifyWatchers();
      return cachedPosition;
    } catch (error) {
      return cachedPosition;
    }
  }

  function notifyWatchers() {
    if (!cachedPosition) return;
    watchCallbacks.forEach(function (callback) {
      try {
        callback(cachedPosition);
      } catch (error) {
        /* ignore watcher errors */
      }
    });
  }

  if (!navigator.geolocation) {
    return;
  }

  var originalGetCurrentPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
  var originalWatchPosition = navigator.geolocation.watchPosition.bind(navigator.geolocation);
  var originalClearWatch = navigator.geolocation.clearWatch.bind(navigator.geolocation);

  navigator.geolocation.getCurrentPosition = function (success, error, options) {
    refreshCachedPosition().then(function (position) {
      if (position) {
        success(position);
        return;
      }
      originalGetCurrentPosition(success, error, options);
    });
  };

  navigator.geolocation.watchPosition = function (success, error, options) {
    var watchId = watchIdCounter++;
    watchCallbacks.set(watchId, success);

    refreshCachedPosition().then(function (position) {
      if (position) {
        success(position);
        return;
      }
      originalWatchPosition(success, error, options);
    });

    return watchId;
  };

  navigator.geolocation.clearWatch = function (watchId) {
    if (watchCallbacks.has(watchId)) {
      watchCallbacks.delete(watchId);
      return;
    }
    originalClearWatch(watchId);
  };

  function patchIframeGeolocation(iframe) {
    if (!iframe || iframe.tagName !== "IFRAME") return;

    var src = iframe.getAttribute("src") || "";
    if (!/weatherfront\.com|google\./i.test(src)) {
      return;
    }

    var allow = iframe.getAttribute("allow") || "";
    if (!/\bgeolocation\b/i.test(allow)) {
      iframe.setAttribute("allow", (allow ? allow + "; " : "") + "geolocation");
    }

    var sandbox = iframe.getAttribute("sandbox");
    if (sandbox && !/\ballow-scripts\b/i.test(sandbox)) {
      iframe.setAttribute("sandbox", sandbox + " allow-scripts allow-same-origin");
    }
  }

  function scanIframes(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("iframe").forEach(patchIframeGeolocation);
  }

  scanIframes(document);

  if (typeof MutationObserver !== "undefined") {
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.tagName === "IFRAME") {
            patchIframeGeolocation(node);
          } else {
            scanIframes(node);
          }
        });
      });
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  refreshCachedPosition();
  setInterval(refreshCachedPosition, POLL_INTERVAL_MS);
})();
