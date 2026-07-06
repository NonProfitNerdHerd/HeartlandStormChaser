import { haversineMiles } from "./geo";

const NOMINATIM_USER_AGENT = "HeartlandStormChaser/1.0 (contact@heartlandstormchaser.local)";
const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";

const geocodeCache = new Map<string, { latitude: number; longitude: number }>();

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return "--";
  }

  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export async function geocodeCityState(
  city: string,
  state: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const normalizedCity = city.trim();
  const normalizedState = state.trim().toUpperCase();
  if (!normalizedCity || !normalizedState) {
    return null;
  }

  const cacheKey = `${normalizedCity}|${normalizedState}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const query = encodeURIComponent(`${normalizedCity}, ${normalizedState}, USA`);
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": NOMINATIM_USER_AGENT,
      },
    },
  );

  if (!response.ok) {
    return null;
  }

  const results = (await response.json()) as Array<{ lat?: string; lon?: string }>;
  const first = results[0];
  if (!first?.lat || !first?.lon) {
    return null;
  }

  const coordinates = {
    latitude: Number(first.lat),
    longitude: Number(first.lon),
  };

  if (Number.isNaN(coordinates.latitude) || Number.isNaN(coordinates.longitude)) {
    return null;
  }

  geocodeCache.set(cacheKey, coordinates);
  return coordinates;
}

export async function getDrivingDurationSeconds(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<number | null> {
  try {
    const url =
      `${OSRM_BASE}/${fromLon},${fromLat};${toLon},${toLat}?overview=false`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return estimateDrivingDurationSeconds(fromLat, fromLon, toLat, toLon);
    }

    const data = (await response.json()) as {
      routes?: Array<{ duration?: number }>;
    };
    const duration = data.routes?.[0]?.duration;
    if (duration == null || !Number.isFinite(duration)) {
      return estimateDrivingDurationSeconds(fromLat, fromLon, toLat, toLon);
    }

    return Math.round(duration);
  } catch {
    return estimateDrivingDurationSeconds(fromLat, fromLon, toLat, toLon);
  }
}

function estimateDrivingDurationSeconds(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): number | null {
  const miles = haversineMiles(fromLat, fromLon, toLat, toLon);
  if (!Number.isFinite(miles) || miles <= 0) {
    return null;
  }

  const averageMph = 55;
  return Math.round((miles / averageMph) * 3600);
}
