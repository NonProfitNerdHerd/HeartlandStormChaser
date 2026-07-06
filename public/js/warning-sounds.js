(function (global) {
  var WARNING_SOUND_PATHS = {
    "Tornado Warning": "/sounds/TornadoWarning.mp3",
    "Tornado Watch": "/sounds/TornadoWatch.mp3",
    "Severe Thunderstorm Warning": "/sounds/SevereThunderstormWarning.mp3",
    "Severe Thunderstorm Watch": "/sounds/SevereThunderstormWatch.mp3",
  };

  var activeAudio = null;

  function getWarningSoundPath(eventName) {
    return WARNING_SOUND_PATHS[eventName] || null;
  }

  function hasWarningSound(eventName) {
    return Boolean(getWarningSoundPath(eventName));
  }

  function playWarningSound(eventName) {
    var path = getWarningSoundPath(eventName);
    if (!path) {
      return Promise.resolve(false);
    }

    try {
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      }

      activeAudio = new Audio(path);
      return activeAudio.play().then(function () {
        return true;
      }).catch(function () {
        return false;
      });
    } catch (_error) {
      return Promise.resolve(false);
    }
  }

  function playWarningSoundForNewAlert(alert) {
    if (!alert?.event) {
      return Promise.resolve(false);
    }

    return playWarningSound(alert.event);
  }

  global.WarningSounds = {
    WARNING_SOUND_PATHS: WARNING_SOUND_PATHS,
    getWarningSoundPath: getWarningSoundPath,
    hasWarningSound: hasWarningSound,
    playWarningSound: playWarningSound,
    playWarningSoundForNewAlert: playWarningSoundForNewAlert,
  };
})(typeof window !== "undefined" ? window : globalThis);
