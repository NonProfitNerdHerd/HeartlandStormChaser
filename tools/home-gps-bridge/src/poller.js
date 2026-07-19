import { buildInvalidNmeaSentences, buildNmeaSentences } from "./nmea.js";

export const FixState = {
  FRESH: "Fresh",
  DELAYED: "Delayed",
  STALE: "Stale",
  UNAVAILABLE: "Unavailable",
  UNAUTHORIZED: "Unauthorized",
  MALFORMED: "Malformed",
};

const DELAYED_AFTER_SECONDS = 10;

export function parseUtcTimestamp(value) {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const normalized = String(value).includes("T")
    ? String(value)
    : String(value).replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const parsed = Date.parse(withZone);
  return Number.isNaN(parsed) ? null : parsed;
}

export function isValidCoordinate(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Validate and normalize a backend home-bridge JSON payload.
 * @returns {{ ok: true, record: object } | { ok: false, reason: string }}
 */
export function parseLocationPayload(body, previousCapturedAtMs = null) {
  if (body == null || typeof body !== "object") {
    return { ok: false, reason: "Response is not a JSON object" };
  }

  if (body.ok === false || body.active === false) {
    return { ok: false, reason: body.message || "No active platform location" };
  }

  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!isValidCoordinate(latitude, longitude)) {
    return { ok: false, reason: "Invalid latitude/longitude" };
  }

  const capturedAtMs = parseUtcTimestamp(body.capturedAt);
  if (capturedAtMs == null) {
    return { ok: false, reason: "Missing or invalid capturedAt timestamp" };
  }

  if (previousCapturedAtMs != null && capturedAtMs < previousCapturedAtMs) {
    return { ok: false, reason: "Out-of-order location (older than last accepted)" };
  }

  const optionalNumber = (value) => {
    if (value == null || value === "") {
      return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  return {
    ok: true,
    record: {
      latitude,
      longitude,
      altitudeMeters: optionalNumber(body.altitudeMeters),
      accuracyMeters: optionalNumber(body.accuracyMeters),
      speedMps: optionalNumber(body.speedMps),
      headingDegrees: optionalNumber(body.headingDegrees),
      capturedAt: new Date(capturedAtMs).toISOString(),
      capturedAtMs,
      sourceId: body.sourceId != null ? String(body.sourceId) : null,
      sourceName: body.sourceName != null ? String(body.sourceName) : null,
      serverValid: body.valid === true,
      status: body.status != null ? String(body.status) : null,
      receivedAt: body.receivedAt != null ? String(body.receivedAt) : null,
    },
  };
}

export function classifyFix({ record, staleAfterSeconds, nowMs = Date.now(), authState, lastErrorKind }) {
  if (authState === "unauthorized") {
    return FixState.UNAUTHORIZED;
  }
  if (lastErrorKind === "malformed") {
    if (!record) {
      return FixState.MALFORMED;
    }
  }
  if (!record) {
    return FixState.UNAVAILABLE;
  }

  const ageSeconds = Math.max(0, (nowMs - record.capturedAtMs) / 1000);
  if (ageSeconds > staleAfterSeconds) {
    return FixState.STALE;
  }
  if (ageSeconds > DELAYED_AFTER_SECONDS) {
    return FixState.DELAYED;
  }
  return FixState.FRESH;
}

export function sentencesForState({ record, fixState, now = new Date() }) {
  const validFix = fixState === FixState.FRESH || fixState === FixState.DELAYED;
  if (!record || !validFix) {
    if (record && (fixState === FixState.STALE || fixState === FixState.MALFORMED)) {
      return buildNmeaSentences({
        latitude: record.latitude,
        longitude: record.longitude,
        capturedAt: new Date(record.capturedAtMs),
        speedMps: record.speedMps,
        headingDegrees: record.headingDegrees,
        altitudeMeters: record.altitudeMeters,
        accuracyMeters: record.accuracyMeters,
        validFix: false,
      });
    }
    return buildInvalidNmeaSentences(now);
  }

  return buildNmeaSentences({
    latitude: record.latitude,
    longitude: record.longitude,
    capturedAt: new Date(record.capturedAtMs),
    speedMps: record.speedMps,
    headingDegrees: record.headingDegrees,
    altitudeMeters: record.altitudeMeters,
    accuracyMeters: record.accuracyMeters,
    validFix: true,
  });
}

export function createPoller({
  gpsApiUrl,
  gpsApiToken,
  pollIntervalMs,
  requestTimeoutMs,
  staleAfterSeconds,
  logger,
  fetchImpl = fetch,
}) {
  let timer = null;
  let inFlight = false;
  let stopped = false;

  /** @type {object|null} */
  let lastAccepted = null;
  let lastSuccessfulRequestAt = null;
  let lastError = null;
  let lastErrorKind = null;
  let authState = "unknown";
  let backendConnected = false;
  let consecutiveFailures = 0;

  async function pollOnce() {
    if (inFlight || stopped) {
      return;
    }
    inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetchImpl(gpsApiUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${gpsApiToken}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        authState = "unauthorized";
        backendConnected = true;
        lastError = "Authentication failed (invalid or missing token)";
        lastErrorKind = "unauthorized";
        consecutiveFailures += 1;
        logger.warn("Backend authentication failed");
        return;
      }

      if (!response.ok) {
        authState = authState === "unauthorized" ? authState : "ok";
        backendConnected = true;
        lastError = `Backend HTTP ${response.status}`;
        lastErrorKind = "http";
        consecutiveFailures += 1;
        logger.warn(`Backend returned HTTP ${response.status}`);
        return;
      }

      let body;
      try {
        body = await response.json();
      } catch {
        lastError = "Malformed JSON from backend";
        lastErrorKind = "malformed";
        backendConnected = true;
        authState = "ok";
        consecutiveFailures += 1;
        logger.warn("Malformed JSON from backend");
        return;
      }

      const parsed = parseLocationPayload(body, lastAccepted?.capturedAtMs ?? null);
      if (!parsed.ok) {
        if (parsed.reason.startsWith("Out-of-order")) {
          lastError = parsed.reason;
          lastErrorKind = "out-of-order";
          logger.debug(parsed.reason);
          backendConnected = true;
          authState = "ok";
          lastSuccessfulRequestAt = new Date().toISOString();
          return;
        }
        lastError = parsed.reason;
        lastErrorKind =
          parsed.reason.includes("Invalid latitude") ||
          parsed.reason.includes("capturedAt") ||
          parsed.reason.includes("JSON")
            ? "malformed"
            : "unavailable";
        backendConnected = true;
        authState = "ok";
        consecutiveFailures += 1;
        if (lastErrorKind === "malformed") {
          logger.warn(`Rejected location payload: ${parsed.reason}`);
        }
        return;
      }

      const wasStale =
        lastAccepted &&
        classifyFix({
          record: lastAccepted,
          staleAfterSeconds,
          authState: "ok",
        }) === FixState.STALE;

      lastAccepted = parsed.record;
      lastSuccessfulRequestAt = new Date().toISOString();
      lastError = null;
      lastErrorKind = null;
      authState = "ok";
      backendConnected = true;
      consecutiveFailures = 0;

      if (wasStale) {
        logger.info("Platform GPS recovered to a fresh fix");
      }
      logger.debug("Accepted platform GPS update");
    } catch (error) {
      backendConnected = false;
      consecutiveFailures += 1;
      const message =
        error?.name === "AbortError"
          ? "Backend request timed out"
          : error?.message || "Backend request failed";
      lastError = message;
      lastErrorKind = "network";
      if (consecutiveFailures === 1 || consecutiveFailures % 15 === 0) {
        logger.warn(`Backend unreachable: ${message}`);
      }
    } finally {
      clearTimeout(timeout);
      inFlight = false;
    }
  }

  function getSnapshot(nowMs = Date.now()) {
    const fixState = classifyFix({
      record: lastAccepted,
      staleAfterSeconds,
      nowMs,
      authState,
      lastErrorKind,
    });

    if (fixState === FixState.STALE && lastAccepted) {
      // Log transition sparingly via caller if needed
    }

    const ageSeconds = lastAccepted
      ? Math.max(0, (nowMs - lastAccepted.capturedAtMs) / 1000)
      : null;

    return {
      lastAccepted,
      lastSuccessfulRequestAt,
      lastError,
      lastErrorKind,
      authState,
      backendConnected,
      fixState,
      ageSeconds,
      consecutiveFailures,
      inFlight,
    };
  }

  function getNmeaSentences(now = new Date()) {
    const snap = getSnapshot(now.getTime());
    return {
      ...sentencesForState({
        record: snap.lastAccepted,
        fixState: snap.fixState,
        now,
      }),
      fixState: snap.fixState,
    };
  }

  function start() {
    stopped = false;
    void pollOnce();
    timer = setInterval(() => {
      void pollOnce();
    }, pollIntervalMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    start,
    stop,
    pollOnce,
    getSnapshot,
    getNmeaSentences,
  };
}
