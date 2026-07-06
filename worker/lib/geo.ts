import type { GeoJsonGeometry } from "./geojson";

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

export function boundingBox(lat: number, lon: number, radiusMiles: number) {
  const latDelta = radiusMiles / 69;
  const lonDelta = radiusMiles / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  };
}

export function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

export function minDistanceToRingMiles(
  lat: number,
  lon: number,
  ring: number[][],
): number {
  let min = Number.POSITIVE_INFINITY;

  for (const [ringLon, ringLat] of ring) {
    min = Math.min(min, haversineMiles(lat, lon, ringLat, ringLon));
  }

  return min;
}

export function distanceToGeometryMiles(
  lat: number,
  lon: number,
  geometry: GeoJsonGeometry | null | undefined,
): number {
  if (!geometry) {
    return Number.POSITIVE_INFINITY;
  }

  if (geometry.type === "Polygon") {
    const outerRing = geometry.coordinates[0];
    if (outerRing && pointInRing(lon, lat, outerRing)) {
      return 0;
    }
    return minDistanceToRingMiles(lat, lon, outerRing ?? []);
  }

  if (geometry.type === "MultiPolygon") {
    let min = Number.POSITIVE_INFINITY;
    for (const polygon of geometry.coordinates) {
      min = Math.min(
        min,
        distanceToGeometryMiles(lat, lon, { type: "Polygon", coordinates: polygon }),
      );
    }
    return min;
  }

  return Number.POSITIVE_INFINITY;
}

export function geometryIntersectsBoundingBox(
  geometry: GeoJsonGeometry | null | undefined,
  box: ReturnType<typeof boundingBox>,
): boolean {
  if (!geometry) {
    return false;
  }

  const rings: number[][][] = [];
  if (geometry.type === "Polygon") {
    rings.push(geometry.coordinates[0] ?? []);
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      rings.push(polygon[0] ?? []);
    }
  }

  for (const ring of rings) {
    for (const [ringLon, ringLat] of ring) {
      if (
        ringLat >= box.minLat &&
        ringLat <= box.maxLat &&
        ringLon >= box.minLon &&
        ringLon <= box.maxLon
      ) {
        return true;
      }
    }
  }

  return false;
}
