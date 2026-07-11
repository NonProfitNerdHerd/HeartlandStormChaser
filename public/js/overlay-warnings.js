(function () {
  var POLL_INTERVAL_MS = 15000;
  var DEFAULT_ROTATE_MS = 20000;
  var API_PATH = "/api/overlays/warnings-data";

  var root = document.getElementById("warnings-root");
  var bar = document.getElementById("warnings-bar");
  var eventEl = document.getElementById("warning-event");
  var untilEl = document.getElementById("warning-until");
  var expiresWrap = document.getElementById("warning-expires-wrap");
  var expiresEl = document.getElementById("warning-expires");
  var newBadge = document.getElementById("warning-new-badge");
  var detailViewport = document.getElementById("warning-detail-viewport");
  var detailTrack = document.getElementById("warning-detail-track");
  var detailRunA = document.getElementById("warning-detail-a");
  var detailRunB = document.getElementById("warning-detail-b");

  var alerts = [];
  var currentIndex = 0;
  var rotateTimer = null;
  var rotateMs = DEFAULT_ROTATE_MS;
  var seenAlertIds = Object.create(null);
  var alertsInitialized = false;
  var lastDetailAlertId = "";
  var lastAlertsFingerprint = "";
  var rotationStarted = false;

  if (window.location.search.indexOf("preview=1") !== -1) {
    document.body.classList.add("overlay-body--preview");
  }

  function alertsFingerprint(nextAlerts) {
    return nextAlerts.map(function (alert) {
      return alert.id;
    }).join("\n");
  }

  function hideBar() {
    root.classList.add("warnings-stage--hidden");
    bar.hidden = true;
    document.body.classList.add("overlay-body--empty");
    clearTimeout(rotateTimer);
    rotateTimer = null;
    rotationStarted = false;
    alerts = [];
    currentIndex = 0;
    lastDetailAlertId = "";
    lastAlertsFingerprint = "";
    alertsInitialized = false;
  }

  function showBar() {
    root.classList.remove("warnings-stage--hidden");
    bar.hidden = false;
    document.body.classList.remove("overlay-body--empty");
  }

  function applyColors(alert) {
    eventEl.style.backgroundColor = alert.color_primary_left;
    untilEl.style.backgroundColor = alert.color_primary_right;
    expiresWrap.style.backgroundColor = alert.color_meta_left;
    detailViewport.style.backgroundColor = alert.color_primary_left;
    var detailCell = document.getElementById("warning-detail-cell");
    if (detailCell) {
      detailCell.style.backgroundColor = alert.color_primary_left;
    }
  }

  function playEnterAnimation() {
    bar.classList.remove("warnings-bar--enter");
    void bar.offsetWidth;
    bar.classList.add("warnings-bar--enter");
  }

  function updateDetailTicker(alert) {
    var text = alert.detail_scroll_label || alert.detail_label || "—";
    if (alert.id === lastDetailAlertId && detailRunA.textContent === text) {
      return;
    }

    lastDetailAlertId = alert.id;
    detailRunA.textContent = text;
    detailRunB.textContent = text;

    var seconds = Math.max(24, Math.min(120, 18 + text.length * 0.12));
    detailTrack.style.setProperty("--warnings-detail-speed", seconds + "s");
    detailTrack.style.animation = "none";
    void detailTrack.offsetWidth;
    detailTrack.style.animation = "";
  }

  function renderWarning(alert, animateEnter) {
    showBar();
    applyColors(alert);
    eventEl.textContent = alert.event_label || "—";
    untilEl.textContent = alert.until_label || "—";
    expiresEl.textContent = alert.expires_label || "—";
    newBadge.hidden = !alert.is_new;
    updateDetailTicker(alert);
    if (animateEnter) {
      playEnterAnimation();
    }
  }

  function advanceWarning() {
    if (alerts.length <= 1) {
      return;
    }

    currentIndex = (currentIndex + 1) % alerts.length;
    lastDetailAlertId = "";
    renderWarning(alerts[currentIndex], true);
    scheduleRotation();
  }

  function scheduleRotation() {
    clearTimeout(rotateTimer);
    rotateTimer = null;

    if (alerts.length <= 1) {
      return;
    }

    rotateTimer = setTimeout(advanceWarning, rotateMs);
  }

  function startRotationCycle() {
    if (rotationStarted || alerts.length <= 1) {
      return;
    }

    rotationStarted = true;
    scheduleRotation();
  }

  function noteNewAlerts(nextAlerts) {
    if (!alertsInitialized) {
      nextAlerts.forEach(function (alert) {
        if (alert?.id) {
          seenAlertIds[alert.id] = true;
        }
      });
      alertsInitialized = true;
      return;
    }

    var newAlerts = nextAlerts.filter(function (alert) {
      return alert?.id && !seenAlertIds[alert.id];
    });

    newAlerts.forEach(function (alert) {
      seenAlertIds[alert.id] = true;
    });

    if (!newAlerts.length || !globalThis.WarningSounds) {
      return;
    }

    for (var i = 0; i < newAlerts.length; i++) {
      if (globalThis.WarningSounds.hasWarningSound(newAlerts[i].event)) {
        globalThis.WarningSounds.playWarningSound(newAlerts[i].event);
        return;
      }
    }
  }

  function setAlerts(nextAlerts) {
    var fingerprint = alertsFingerprint(nextAlerts);
    var listChanged = fingerprint !== lastAlertsFingerprint;
    var previousId = alerts[currentIndex] && alerts[currentIndex].id;

    alerts = nextAlerts;
    if (!alerts.length) {
      hideBar();
      return;
    }

    noteNewAlerts(alerts);

    if (listChanged) {
      lastAlertsFingerprint = fingerprint;
      rotationStarted = false;
      clearTimeout(rotateTimer);
      rotateTimer = null;

      var matchedIndex = previousId
        ? alerts.findIndex(function (alert) {
            return alert.id === previousId;
          })
        : -1;
      currentIndex = matchedIndex >= 0 ? matchedIndex : 0;
      lastDetailAlertId = "";
      renderWarning(alerts[currentIndex], matchedIndex < 0);
      startRotationCycle();
      return;
    }

    if (currentIndex >= alerts.length) {
      currentIndex = 0;
    }

    renderWarning(alerts[currentIndex], false);
    startRotationCycle();
  }

  async function refreshWarningsOverlay() {
    try {
      var response = await fetch(API_PATH);
      var data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Request failed");
      }

      rotateMs = Math.max(5000, Number(data.rotate_seconds || 20) * 1000);

      if (!data.has_warning || !Array.isArray(data.alerts) || !data.alerts.length) {
        hideBar();
        return;
      }

      setAlerts(data.alerts);
    } catch (_error) {
      hideBar();
    }
  }

  refreshWarningsOverlay();
  setInterval(refreshWarningsOverlay, POLL_INTERVAL_MS);
})();
