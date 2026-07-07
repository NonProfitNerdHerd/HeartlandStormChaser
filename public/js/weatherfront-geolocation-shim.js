(function () {
  "use strict";

  var UPSTREAM_REWRITES = [
    ["https://platform.weatherfront.com", "/weatherfront-api"],
    ["https://cdn.wxfront.com", "/weatherfront-cdn"],
    ["https://static.wxfront.com", "/weatherfront-static"],
    ["https://api.wxfront.com", "/weatherfront-wx-api"],
  ];

  var REFRESH_MS = 5000;
  var cachedLocation = null;
  var watches = new Map();
  var watchSeq = 1;
  var pollTimer = null;

  function rewriteRequestUrl(url) {
    if (typeof url !== "string") return url;
    for (var i = 0; i < UPSTREAM_REWRITES.length; i++) {
      var from = UPSTREAM_REWRITES[i][0];
      var to = UPSTREAM_REWRITES[i][1];
      if (url.startsWith(from)) {
        return to + url.slice(from.length);
      }
    }
    if (url.startsWith("https://static.wxfront.com")) {
      return "/weatherfront-static" + url.slice("https://static.wxfront.com".length);
    }
    return url;
  }

  var originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === "string") {
      return originalFetch(rewriteRequestUrl(input), init);
    }
    if (input instanceof Request) {
      var rewritten = rewriteRequestUrl(input.url);
      if (rewritten !== input.url) {
        input = new Request(rewritten, input);
      }
    }
    return originalFetch(input, init);
  };

  if (window.XMLHttpRequest) {
    var originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      args[1] = rewriteRequestUrl(String(url));
      return originalOpen.apply(this, args);
    };
  }

  function mphToMps(mph) {
    if (mph == null || Number.isNaN(mph)) return null;
    return Number(mph) * 0.44704;
  }

  function platformToPosition(location) {
    return {
      coords: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy_meters != null ? location.accuracy_meters : 10,
        altitude: location.altitude_meters != null ? location.altitude_meters : null,
        altitudeAccuracy: null,
        heading: location.heading_degrees != null ? location.heading_degrees : null,
        speed: mphToMps(location.speed_mph),
      },
      timestamp: Date.now(),
    };
  }

  async function fetchPlatformLocation() {
    try {
      var response = await fetch("/api/gps/platform", { credentials: "same-origin" });
      var data = await response.json();
      if (response.ok && data.platform_source && data.platform_source.location) {
        cachedLocation = data.platform_source.location;
        return cachedLocation;
      }
    } catch (_error) {
      /* fall through */
    }
    return null;
  }

  function notifyWatches() {
    if (!cachedLocation) return;
    var position = platformToPosition(cachedLocation);
    watches.forEach(function (success) {
      try {
        success(position);
      } catch (_error) {
        /* ignore listener errors */
      }
    });
  }

  function ensurePolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      fetchPlatformLocation().then(function () {
        notifyWatches();
      });
    }, REFRESH_MS);
  }

  function stopPollingIfIdle() {
    if (watches.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  navigator.geolocation.getCurrentPosition = function (success, error) {
    fetchPlatformLocation().then(function (location) {
      if (location) {
        success(platformToPosition(location));
        return;
      }
      if (error) {
        error({
          code: 2,
          message: "Platform GPS unavailable",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      }
    });
  };

  navigator.geolocation.watchPosition = function (success, error) {
    var watchId = watchSeq++;
    watches.set(watchId, success);
    ensurePolling();

    fetchPlatformLocation().then(function (location) {
      if (location) {
        success(platformToPosition(location));
        return;
      }
      if (error) {
        error({
          code: 2,
          message: "Platform GPS unavailable",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      }
    });

    return watchId;
  };

  navigator.geolocation.clearWatch = function (watchId) {
    watches.delete(watchId);
    stopPollingIfIdle();
  };

  fetchPlatformLocation();
})();
