/** NMEA 0183 helpers for GPRMC / GPGGA. */

const MPS_TO_KNOTS = 1.9438444924406;

export function nmeaChecksum(body) {
  let checksum = 0;
  for (let i = 0; i < body.length; i += 1) {
    checksum ^= body.charCodeAt(i);
  }
  return checksum.toString(16).toUpperCase().padStart(2, "0");
}

export function formatNmeaSentence(body) {
  return `$${body}*${nmeaChecksum(body)}\r\n`;
}

export function decimalLatitudeToNmea(lat) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`Invalid latitude: ${lat}`);
  }
  const hemisphere = lat >= 0 ? "N" : "S";
  const abs = Math.abs(lat);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  const field = `${String(degrees).padStart(2, "0")}${minutes.toFixed(4).padStart(7, "0")}`;
  return { field, hemisphere };
}

export function decimalLongitudeToNmea(lon) {
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(`Invalid longitude: ${lon}`);
  }
  const hemisphere = lon >= 0 ? "E" : "W";
  const abs = Math.abs(lon);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  const field = `${String(degrees).padStart(3, "0")}${minutes.toFixed(4).padStart(7, "0")}`;
  return { field, hemisphere };
}

export function metersPerSecondToKnots(mps) {
  if (mps == null || !Number.isFinite(mps)) {
    return null;
  }
  return mps * MPS_TO_KNOTS;
}

export function normalizeHeading(degrees) {
  if (degrees == null || !Number.isFinite(degrees)) {
    return null;
  }
  let h = degrees % 360;
  if (h < 0) {
    h += 360;
  }
  // Normalize 360 → 0
  if (h >= 360) {
    h -= 360;
  }
  return h;
}

export function formatUtcTime(date) {
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  const ms = String(date.getUTCMilliseconds()).padStart(3, "0");
  return `${hh}${mm}${ss}.${ms.slice(0, 2)}`;
}

export function formatUtcDate(date) {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

function numField(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) {
    return "";
  }
  return value.toFixed(digits);
}

/**
 * Build GPRMC + GPGGA for a fix.
 * @param {object} opts
 * @param {number} opts.latitude
 * @param {number} opts.longitude
 * @param {Date} opts.capturedAt
 * @param {number|null} [opts.speedMps]
 * @param {number|null} [opts.headingDegrees]
 * @param {number|null} [opts.altitudeMeters]
 * @param {number|null} [opts.accuracyMeters]
 * @param {boolean} opts.validFix
 */
export function buildNmeaSentences(opts) {
  const {
    latitude,
    longitude,
    capturedAt,
    speedMps = null,
    headingDegrees = null,
    altitudeMeters = null,
    accuracyMeters = null,
    validFix,
  } = opts;

  if (!(capturedAt instanceof Date) || Number.isNaN(capturedAt.getTime())) {
    throw new Error("capturedAt must be a valid Date");
  }

  const lat = decimalLatitudeToNmea(latitude);
  const lon = decimalLongitudeToNmea(longitude);
  const time = formatUtcTime(capturedAt);
  const date = formatUtcDate(capturedAt);
  const status = validFix ? "A" : "V";
  const knots = metersPerSecondToKnots(speedMps);
  const heading = normalizeHeading(headingDegrees);
  const speedField = knots == null ? "" : numField(Math.max(0, knots), 2);
  const courseField = heading == null ? "" : numField(heading, 1);

  const rmcBody = [
    "GPRMC",
    time,
    status,
    lat.field,
    lat.hemisphere,
    lon.field,
    lon.hemisphere,
    speedField,
    courseField,
    date,
    "",
    "",
    "A",
  ].join(",");

  const fixQuality = validFix ? "1" : "0";
  let hdop = "";
  if (accuracyMeters != null && Number.isFinite(accuracyMeters) && accuracyMeters > 0) {
    // Rough HDOP estimate from horizontal accuracy (meters / ~5m typical)
    hdop = numField(Math.min(99.9, Math.max(0.5, accuracyMeters / 5)), 1);
  }

  const altField =
    altitudeMeters != null && Number.isFinite(altitudeMeters)
      ? numField(altitudeMeters, 1)
      : "";

  const ggaBody = [
    "GPGGA",
    time,
    lat.field,
    lat.hemisphere,
    lon.field,
    lon.hemisphere,
    fixQuality,
    validFix ? "08" : "00",
    hdop,
    altField,
    "M",
    "",
    "M",
    "",
    "",
  ].join(",");

  return {
    rmc: formatNmeaSentence(rmcBody),
    gga: formatNmeaSentence(ggaBody),
    combined: formatNmeaSentence(rmcBody) + formatNmeaSentence(ggaBody),
  };
}

/** Empty / invalid fix sentences when no usable location is available. */
export function buildInvalidNmeaSentences(now = new Date()) {
  const time = formatUtcTime(now);
  const date = formatUtcDate(now);
  const rmcBody = ["GPRMC", time, "V", "", "", "", "", "", "", date, "", "", "N"].join(",");
  const ggaBody = ["GPGGA", time, "", "", "", "", "0", "00", "", "", "M", "", "M", "", ""].join(
    ",",
  );
  return {
    rmc: formatNmeaSentence(rmcBody),
    gga: formatNmeaSentence(ggaBody),
    combined: formatNmeaSentence(rmcBody) + formatNmeaSentence(ggaBody),
  };
}
