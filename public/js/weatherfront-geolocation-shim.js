(function () {
  "use strict";

  var origin = window.location.origin;
  var embedPrefix = "/weatherfront-embed";

  var UPSTREAM_REWRITES = [
    ["https://platform.weatherfront.com", origin + "/weatherfront-api"],
    ["https://cdn.wxfront.com", origin + "/weatherfront-cdn"],
    ["https://static.wxfront.com", origin + "/weatherfront-static"],
    ["https://api.wxfront.com", origin + "/weatherfront-wx-api"],
    ["https://events.wxfront.com", origin + "/weatherfront-events"],
    ["https://api.mapbox.com", origin + "/weatherfront-mapbox"],
    ["https://a.tiles.mapbox.com", origin + "/weatherfront-mapbox-tiles"],
    ["https://b.tiles.mapbox.com", origin + "/weatherfront-mapbox-tiles"],
    ["https://c.tiles.mapbox.com", origin + "/weatherfront-mapbox-tiles"],
    ["https://d.tiles.mapbox.com", origin + "/weatherfront-mapbox-tiles"],
  ];

  var ROOT_ASSET_PREFIXES = ["/assets/", "/icons/", "/data/", "/overlay/"];
  var ROOT_ASSET_FILES = {
    "/favicon.png": true,
    "/mapbox-logo.svg": true,
  };

  var REFRESH_MS = 5000;
  var cachedLocation = null;
  var watches = new Map();
  var watchSeq = 1;
  var pollTimer = null;
  var lastCaptureReported = null;

  function reportGpsCapture(captured, detail) {
    var next = captured ? true : false;
    if (lastCaptureReported === next && detail == null) {
      return;
    }
    lastCaptureReported = next;
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            source: "weatherfront-geolocation-shim",
            type: "gps-capture",
            captured: next,
            detail: detail || null,
          },
          origin,
        );
      }
    } catch (_error) {
      /* ignore */
    }
  }

  function rewriteRootAssetPath(url) {
    if (typeof url !== "string" || url.length === 0) return url;

    var path = url;
    var absOrigin = origin;
    if (path.indexOf(absOrigin) === 0) {
      path = path.slice(absOrigin.length);
    } else if (path.indexOf("https://") === 0 || path.indexOf("http://") === 0) {
      return url;
    } else if (path.charAt(0) !== "/") {
      return url;
    }

    if (path.indexOf(embedPrefix + "/") === 0 || path === embedPrefix) {
      return url;
    }

    for (var i = 0; i < ROOT_ASSET_PREFIXES.length; i++) {
      if (path.indexOf(ROOT_ASSET_PREFIXES[i]) === 0) {
        return absOrigin + embedPrefix + path;
      }
    }
    if (ROOT_ASSET_FILES[path.split("?")[0]]) {
      return absOrigin + embedPrefix + path;
    }
    return url;
  }

  function rewriteRequestUrl(url) {
    if (typeof url !== "string") return url;
    for (var i = 0; i < UPSTREAM_REWRITES.length; i++) {
      var from = UPSTREAM_REWRITES[i][0];
      var to = UPSTREAM_REWRITES[i][1];
      if (url.indexOf(from) === 0) {
        return to + url.slice(from.length);
      }
    }
    return rewriteRootAssetPath(url);
  }

  var originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === "string") {
      return originalFetch(rewriteRequestUrl(input), init);
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
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

  if (typeof WebSocket !== "undefined") {
    var OriginalWebSocket = WebSocket;
    window.WebSocket = function (url, protocols) {
      var rewritten = rewriteRequestUrl(String(url));
      if (protocols === undefined) {
        return new OriginalWebSocket(rewritten);
      }
      return new OriginalWebSocket(rewritten, protocols);
    };
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    Object.keys(OriginalWebSocket).forEach(function (key) {
      try {
        window.WebSocket[key] = OriginalWebSocket[key];
      } catch (_error) {
        /* ignore */
      }
    });
  }

  try {
    var desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    if (desc && desc.set) {
      var originalSrcSet = desc.set;
      Object.defineProperty(HTMLImageElement.prototype, "src", {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (value) {
          originalSrcSet.call(this, rewriteRequestUrl(String(value)));
        },
      });
    }
  } catch (_error) {
    /* ignore */
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
      var response = await originalFetch("/api/gps/platform", { credentials: "same-origin" });
      var data = await response.json();
      if (response.ok && data.platform_source && data.platform_source.location) {
        cachedLocation = data.platform_source.location;
        reportGpsCapture(true);
        return cachedLocation;
      }
    } catch (_error) {
      /* fall through */
    }
    reportGpsCapture(false, "platform-unavailable");
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
        reportGpsCapture(true, "getCurrentPosition");
        success(platformToPosition(location));
        return;
      }
      reportGpsCapture(false, "getCurrentPosition-failed");
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
        reportGpsCapture(true, "watchPosition");
        success(platformToPosition(location));
        return;
      }
      reportGpsCapture(false, "watchPosition-failed");
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
