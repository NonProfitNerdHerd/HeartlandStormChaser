export function createRecoveryController({
  maxReloadAttempts,
  maxRelaunchAttempts,
  cooldownSeconds,
  logger,
}) {
  let reloadAttempts = 0;
  let relaunchAttempts = 0;
  let cooldownUntil = 0;
  let degraded = false;
  let lastReloadAt = null;
  let lastRelaunchAt = null;
  let recoveryCount = 0;

  function inCooldown(now = Date.now()) {
    return now < cooldownUntil;
  }

  function enterCooldown(now = Date.now()) {
    degraded = true;
    cooldownUntil = now + cooldownSeconds * 1000;
    reloadAttempts = 0;
    relaunchAttempts = 0;
    logger?.warn?.(`Entering recovery cooldown for ${cooldownSeconds}s`);
  }

  function canReload(now = Date.now()) {
    if (inCooldown(now)) return false;
    return reloadAttempts < maxReloadAttempts;
  }

  function canRelaunch(now = Date.now()) {
    if (inCooldown(now)) return false;
    return relaunchAttempts < maxRelaunchAttempts;
  }

  function recordReload(now = Date.now()) {
    reloadAttempts += 1;
    lastReloadAt = new Date(now).toISOString();
    recoveryCount += 1;
    if (reloadAttempts >= maxReloadAttempts) enterCooldown(now);
  }

  function recordRelaunch(now = Date.now()) {
    relaunchAttempts += 1;
    lastRelaunchAt = new Date(now).toISOString();
    recoveryCount += 1;
    if (relaunchAttempts >= maxRelaunchAttempts) enterCooldown(now);
  }

  function recordSuccess() {
    reloadAttempts = 0;
    relaunchAttempts = 0;
    degraded = false;
    cooldownUntil = 0;
  }

  function getState(now = Date.now()) {
    return {
      degraded,
      inCooldown: inCooldown(now),
      cooldownUntil: cooldownUntil || null,
      reloadAttempts,
      relaunchAttempts,
      lastReloadAt,
      lastRelaunchAt,
      recoveryCount,
    };
  }

  /** Exponential backoff delay in ms for attempt n (0-based). */
  function backoffMs(attempt, base = 2000, cap = 60_000) {
    return Math.min(cap, base * 2 ** Math.max(0, attempt));
  }

  return {
    canReload,
    canRelaunch,
    recordReload,
    recordRelaunch,
    recordSuccess,
    enterCooldown,
    inCooldown,
    getState,
    backoffMs,
  };
}
