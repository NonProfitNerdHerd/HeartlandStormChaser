(function () {
  var POLL_INTERVAL_MS = 5000;
  var API_PATH = "/api/overlay/settings";

  var root = document.getElementById("ticker-root");
  var viewport = document.getElementById("ticker-viewport");
  var track = document.getElementById("ticker-track");
  var runA = document.getElementById("ticker-run-a");
  var runB = document.getElementById("ticker-run-b");
  var emptyState = document.getElementById("ticker-empty");
  var lastRenderedKey = "";

  if (window.location.search.indexOf("preview=1") !== -1) {
    document.body.classList.add("overlay-body--preview");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseTickerItems(raw) {
    if (!raw || !raw.trim()) {
      return [];
    }

    return raw
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
  }

  function buildTickerHtml(items) {
    return items
      .map(function (item, index) {
        var segment = '<span class="ticker-item">' + escapeHtml(item) + "</span>";
        if (index < items.length - 1) {
          segment += '<span class="ticker-dot" aria-hidden="true">·</span>';
        }
        return segment;
      })
      .join("");
  }

  function updateScrollSpeed(items) {
    var totalChars = items.join(" ").length;
    var seconds = Math.max(18, Math.min(60, 12 + totalChars * 0.35));
    track.style.setProperty("--ticker-speed", seconds + "s");
  }

  function renderTicker(rawText) {
    var items = parseTickerItems(rawText);
    var renderKey = items.join("\n");

    if (renderKey === lastRenderedKey) {
      return;
    }

    lastRenderedKey = renderKey;

    if (!items.length) {
      root.classList.add("ticker-stage--empty");
      emptyState.classList.remove("ticker-empty--hidden");
      viewport.hidden = true;
      runA.innerHTML = "";
      runB.innerHTML = "";
      return;
    }

    root.classList.remove("ticker-stage--empty");
    emptyState.classList.add("ticker-empty--hidden");
    viewport.hidden = false;

    var html = buildTickerHtml(items);
    runA.innerHTML = html;
    runB.innerHTML = html;
    updateScrollSpeed(items);

    track.style.animation = "none";
    void track.offsetWidth;
    track.style.animation = "";
  }

  async function refreshTicker() {
    try {
      var response = await fetch(API_PATH);
      var data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Request failed");
      }

      renderTicker(data.settings?.overlay_ticker_text || "");
    } catch (_error) {
      if (!lastRenderedKey) {
        root.classList.add("ticker-stage--empty");
        emptyState.classList.remove("ticker-empty--hidden");
        emptyState.textContent = "Ticker unavailable";
        viewport.hidden = true;
      }
    }
  }

  refreshTicker();
  setInterval(refreshTicker, POLL_INTERVAL_MS);
})();
