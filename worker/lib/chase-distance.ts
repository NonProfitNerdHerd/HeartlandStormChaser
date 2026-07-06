const EARTH_RADIUS_MILES = 3958.7613;
const MAX_POINT_ACCURACY_METERS = 150;
const MIN_MOVE_METERS = 15;
const MAX_SEGMENT_SPEED_MPH = 180;

export interface ChasePointInput {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  recordedAt: string;
}

export interface ChasePointRow extends ChasePointInput {
  id: string;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

function metersToMiles(meters: number): number {
  return meters / 1609.344;
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return Number.isNaN(parsed) ? null : parsed;
}

export function isValidChasePoint(point: ChasePointInput): boolean {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return false;
  }
  if (point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) {
    return false;
  }
  if (point.accuracy != null && point.accuracy > MAX_POINT_ACCURACY_METERS) {
    return false;
  }
  if (parseTimestamp(point.recordedAt) == null) {
    return false;
  }
  return true;
}

export function shouldAcceptPoint(
  previous: ChasePointRow | null,
  next: ChasePointInput,
): boolean {
  if (!isValidChasePoint(next)) {
    return false;
  }

  if (!previous) {
    return true;
  }

  const distanceMiles = haversineMiles(previous.lat, previous.lng, next.lat, next.lng);
  const distanceMeters = distanceMiles / metersToMiles(1);

  if (distanceMeters < MIN_MOVE_METERS) {
    return false;
  }

  const prevTime = parseTimestamp(previous.recordedAt);
  const nextTime = parseTimestamp(next.recordedAt);
  if (prevTime == null || nextTime == null || nextTime <= prevTime) {
    return false;
  }

  const hours = (nextTime - prevTime) / 3_600_000;
  if (hours > 0) {
    const impliedSpeedMph = distanceMiles / hours;
    if (impliedSpeedMph > MAX_SEGMENT_SPEED_MPH) {
      return false;
    }
  }

  return true;
}

export function calculateTotalDistanceMiles(points: ChasePointRow[]): number {
  if (points.length < 2) {
    return 0;
  }

  let total = 0;
  let lastAccepted: ChasePointRow | null = null;

  for (const point of points) {
    if (!isValidChasePoint(point)) {
      continue;
    }
    if (lastAccepted && !shouldAcceptPoint(lastAccepted, point)) {
      continue;
    }
    if (lastAccepted) {
      total += haversineMiles(lastAccepted.lat, lastAccepted.lng, point.lat, point.lng);
    }
    lastAccepted = point;
  }

  return Math.round(total * 100) / 100;
}
