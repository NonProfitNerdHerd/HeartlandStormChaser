(function () {
  var SCALE_STORAGE_KEY = "weatherfront-scale";
  var WEATHERFRONT_URL = "/weatherfront-embed/";
  var VALID_SCALES = { "90": true, "100": true, "110": true, "125": true };

  var scaleButtons = document.querySelectorAll(".weatherfront-scale__btn[data-scale]");
  var iframeGpsBug = document.getElementById("iframe-gps-bug");
  var frameScaler = document.getElementById("frame-scaler");
  var frame = document.getElementById("weatherfront-frame");
  var errorEl = document.getElementById("weatherfront-error");
  var errorDetail = document.getElementById("weatherfront-error-detail");
  var retryBtn = document.getElementById("weatherfront-retry-btn");
  var reloadBtn = document.getElementById("weatherfront-reload-btn");

  function setIframeGpsBug(captured) {
    if (!iframeGpsBug) return;
    if (captured === true) {
      iframeGpsBug.dataset.state = "ok";
      iframeGpsBug.textContent = "GPS";
      iframeGpsBug.title = "Iframe captured platform GPS";
      return;
    }
    if (captured === false) {
      iframeGpsBug.dataset.state = "miss";
      iframeGpsBug.textContent = "GPS";
      iframeGpsBug.title = "Iframe did not capture platform GPS";
      return;
    }
    iframeGpsBug.dataset.state = "unknown";
    iframeGpsBug.textContent = "GPS?";
    iframeGpsBug.title = "Waiting for iframe GPS capture status";
  }

  function setScale(percent) {
    var value = String(percent);
    if (!VALID_SCALES[value]) value = "100";

    frameScaler.style.setProperty("--wf-scale", String(Number(value) / 100));
    localStorage.setItem(SCALE_STORAGE_KEY, value);

    scaleButtons.forEach(function (button) {
      var active = button.getAttribute("data-scale") === value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function loadScalePreference() {
    var stored = localStorage.getItem(SCALE_STORAGE_KEY) || "100";
    setScale(stored);
  }

  function hideError() {
    if (errorEl) errorEl.hidden = true;
    if (frameScaler) frameScaler.hidden = false;
  }

  function showError(message) {
    if (!errorEl) return;
    if (frameScaler) frameScaler.hidden = true;
    errorEl.hidden = false;
    if (errorDetail) errorDetail.textContent = message;
  }

  function reloadFrame() {
    if (!frame) return;
    hideError();
    setIframeGpsBug(null);
    frame.src = WEATHERFRONT_URL + "?_=" + Date.now();
  }

  scaleButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      setScale(button.getAttribute("data-scale"));
    });
  });

  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || data.source !== "weatherfront-geolocation-shim") return;
    if (data.type !== "gps-capture") return;
    setIframeGpsBug(Boolean(data.captured));
  });

  if (retryBtn) {
    retryBtn.addEventListener("click", reloadFrame);
  }

  if (reloadBtn) {
    reloadBtn.addEventListener("click", reloadFrame);
  }

  if (frame) {
    hideError();
    setIframeGpsBug(null);
    frame.addEventListener("error", function () {
      setIframeGpsBug(false);
      showError(
        "The browser could not load the WeatherFront proxy embed. Try Retry, or open WeatherFront in a new tab.",
      );
    });
  }

  loadScalePreference();
})();
