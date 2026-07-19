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

export function parseUtcTimestamp(value) {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).includes("T")
    ? String(value)
    : String(value).replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const parsed = Date.parse(withZone);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Validate bridge /location JSON. Never invent home-PC location.
 * Accepts last-known fixes (including Stale/held) so WeatherFront can keep injecting.
 */
export function validateBridgeLocation(body, previousCapturedAtMs = null) {
  if (body == null || typeof body !== "object") {
    return { ok: false, reason: "not-object", kind: "malformed" };
  }

  const state = body.state != null ? String(body.state) : "Unavailable";
  const hasCoords =
    body.latitude != null &&
    body.longitude != null &&
    isValidCoordinate(Number(body.latitude), Number(body.longitude));

  // Injectable when bridge marks valid, OR when last-known coords are present (held/stale).
  const injectable =
    body.valid === true ||
    (hasCoords && (state === "Stale" || body.held === true));

  if (!injectable) {
    return {
      ok: false,
      reason: `bridge-state-${state}`,
      kind: state.toLowerCase().includes("unauthor")
        ? "unauthorized"
        : state.toLowerCase() === "stale"
          ? "stale"
          : state.toLowerCase() === "malformed"
            ? "malformed"
            : "unavailable",
      state,
      diagnostic: hasCoords
        ? {
            latitude: Number(body.latitude),
            longitude: Number(body.longitude),
            capturedAt: body.capturedAt ?? null,
            sourceId: body.sourceId ?? null,
            sourceName: body.sourceName ?? null,
            ageSeconds: body.ageSeconds ?? null,
            state,
          }
        : null,
    };
  }

  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!isValidCoordinate(latitude, longitude)) {
    return { ok: false, reason: "invalid-coordinates", kind: "malformed", state };
  }

  const capturedAtMs = parseUtcTimestamp(body.capturedAt);
  if (capturedAtMs == null) {
    return { ok: false, reason: "missing-capturedAt", kind: "malformed", state };
  }

  if (previousCapturedAtMs != null && capturedAtMs < previousCapturedAtMs) {
    return { ok: false, reason: "out-of-order", kind: "out-of-order", state };
  }

  const optionalNumber = (v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
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
      state,
      ageSeconds: optionalNumber(body.ageSeconds),
      held: body.held === true || state === "Stale",
      valid: true,
    },
  };
}

export function createGpsClient({
  url,
  pollIntervalMs,
  requestTimeoutMs,
  logger,
  fetchImpl = fetch,
  onAccepted,
  onStateChange,
}) {
  let timer = null;
  let inFlight = false;
  let stopped = false;
  let lastAccepted = null;
  let lastState = "Unavailable";
  let bridgeReachable = false;
  let lastError = null;
  let lastSuccessfulPollAt = null;

  async function pollOnce() {
    if (inFlight || stopped) return;
    inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        bridgeReachable = true;
        lastError = `HTTP ${response.status}`;
        if (lastState !== "Unavailable") {
          lastState = "Unavailable";
          onStateChange?.(lastState);
        }
        return;
      }
      let body;
      try {
        body = await response.json();
      } catch {
        bridgeReachable = true;
        lastError = "Malformed JSON from GPS bridge";
        lastState = "Malformed";
        onStateChange?.(lastState);
        return;
      }

      bridgeReachable = true;
      lastSuccessfulPollAt = new Date().toISOString();
      const parsed = validateBridgeLocation(body, lastAccepted?.capturedAtMs ?? null);

      if (!parsed.ok) {
        if (parsed.kind === "out-of-order") {
          lastError = parsed.reason;
          return;
        }
        lastError = parsed.reason;
        if (parsed.state && parsed.state !== lastState) {
          lastState = parsed.state;
          onStateChange?.(lastState);
        } else if (parsed.kind === "stale" && lastState !== "Stale") {
          lastState = "Stale";
          onStateChange?.(lastState);
        } else if (parsed.kind === "unavailable" && lastState !== "Unavailable") {
          lastState = "Unavailable";
          onStateChange?.(lastState);
        } else if (parsed.kind === "unauthorized" && lastState !== "Unauthorized") {
          lastState = "Unauthorized";
          onStateChange?.(lastState);
        } else if (parsed.kind === "malformed" && lastState !== "Malformed") {
          lastState = "Malformed";
          onStateChange?.(lastState);
        }
        // Do NOT inject / do NOT clear lastAccepted map position guidance — keep lastAccepted for age display only when we had one
        return;
      }

      const coordinatesChanged =
        !lastAccepted ||
        lastAccepted.latitude !== parsed.record.latitude ||
        lastAccepted.longitude !== parsed.record.longitude;
      const timestampChanged =
        !lastAccepted || lastAccepted.capturedAtMs !== parsed.record.capturedAtMs;
      const stateChanged = parsed.record.state !== lastState;

      lastAccepted = parsed.record;
      lastError = null;
      if (stateChanged) {
        lastState = parsed.record.state;
        onStateChange?.(lastState);
      }
      // Always notify for HUD age; consumers must NOT remount map on timestamp-only updates
      onAccepted?.(parsed.record, {
        coordinatesChanged,
        timestampChanged,
        stateChanged,
        // legacy alias: only true when lat/lon change
        positionChanged: coordinatesChanged,
      });
    } catch (error) {
      bridgeReachable = false;
      lastError =
        error?.name === "AbortError" ? "GPS bridge request timed out" : error?.message || "GPS bridge unreachable";
      if (lastState !== "Unavailable") {
        lastState = "Unavailable";
        onStateChange?.(lastState);
      }
      logger?.warn?.(`GPS bridge poll failed: ${lastError}`);
    } finally {
      clearTimeout(timeout);
      inFlight = false;
    }
  }

  function start() {
    stopped = false;
    void pollOnce();
    timer = setInterval(() => void pollOnce(), pollIntervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  function getSnapshot() {
    return {
      bridgeReachable,
      state: lastState,
      lastAccepted,
      lastError,
      lastSuccessfulPollAt,
      ageSeconds: lastAccepted
        ? Math.max(0, (Date.now() - lastAccepted.capturedAtMs) / 1000)
        : null,
    };
  }

  return { start, stop, pollOnce, getSnapshot };
}
