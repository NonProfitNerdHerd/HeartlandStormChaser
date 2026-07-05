import type { Env } from "../index";

export const WEATHER_CACHE_SECONDS = 180;
const NWS_USER_AGENT = "HeartlandStormChaser/1.0 (contact@heartlandstormchaser.local)";
const NWS_BASE = "https://api.weather.gov";

export interface NormalizedWeather {
  latitude: number;
  longitude: number;
  temperature_f: number | null;
  conditions: string | null;
  dew_point_f: number | null;
  humidity_percent: number | null;
  wind_speed_mph: number | null;
  wind_direction: string | null;
  wind_gusts_mph: number | null;
  pressure_hpa: number | null;
  visibility_miles: number | null;
  fetched_at: string;
  observation_at: string | null;
  location_city: string | null;
  location_state: string | null;
  cache_age_seconds: number;
  from_cache: boolean;
  stale: boolean;
  source: "nws";
}

interface WeatherLatestRow {
  id: string;
  source_type: string;
  source_id: string | null;
  latitude: number;
  longitude: number;
  temperature: number | null;
  conditions: string | null;
  dew_point: number | null;
  humidity: number | null;
  wind_speed: number | null;
  wind_direction: string | null;
  wind_gusts: number | null;
  pressure: number | null;
  visibility: number | null;
  fetched_at: string;
  raw_json: string | null;
}

interface NwsQuantity {
  value: number | null;
  unitCode?: string | null;
}

function parseUtcTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const parsed = Date.parse(withZone);
  return Number.isNaN(parsed) ? null : parsed;
}

function cacheKeyForCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

function cacheIdForCoordinates(latitude: number, longitude: number): string {
  return `coords_${cacheKeyForCoordinates(latitude, longitude).replace(",", "_")}`;
}

function celsiusToFahrenheit(value: number): number {
  return (value * 9) / 5 + 32;
}

function metersPerSecondToMph(value: number): number {
  return value * 2.23694;
}

function kilometersPerHourToMph(value: number): number {
  return value * 0.621371;
}

function pascalsToHpa(value: number): number {
  return value / 100;
}

function metersToMiles(value: number): number {
  return value / 1609.344;
}

function degreesToCardinal(degrees: number): string {
  const directions = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  return directions[Math.round(degrees / 22.5) % 16];
}

function parseWindSpeedString(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /([\d.]+)/.exec(value);
  return match ? Number(match[1]) : null;
}

function convertQuantityToFahrenheit(quantity: NwsQuantity | null | undefined): number | null {
  if (!quantity || quantity.value == null) return null;
  const unit = quantity.unitCode ?? "";
  if (unit.includes("degF")) return quantity.value;
  return celsiusToFahrenheit(quantity.value);
}

function convertQuantityToMph(quantity: NwsQuantity | null | undefined): number | null {
  if (!quantity || quantity.value == null) return null;
  const unit = quantity.unitCode ?? "";
  if (unit.includes("km_h-1")) return kilometersPerHourToMph(quantity.value);
  if (unit.includes("m_s-1")) return metersPerSecondToMph(quantity.value);
  return quantity.value;
}

function convertQuantityToHpa(quantity: NwsQuantity | null | undefined): number | null {
  if (!quantity || quantity.value == null) return null;
  const unit = quantity.unitCode ?? "";
  if (unit.includes("Pa")) return pascalsToHpa(quantity.value);
  return quantity.value;
}

function convertQuantityToMiles(quantity: NwsQuantity | null | undefined): number | null {
  if (!quantity || quantity.value == null) return null;
  const unit = quantity.unitCode ?? "";
  if (unit.includes("m")) return metersToMiles(quantity.value);
  return quantity.value;
}

function roundNullable(value: number | null, digits: number): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function rowToNormalized(row: WeatherLatestRow, fromCache: boolean, stale: boolean): NormalizedWeather {
  const fetchedAtMs = parseUtcTimestamp(row.fetched_at);
  const cacheAgeSeconds =
    fetchedAtMs == null ? 0 : Math.max(0, Math.floor((Date.now() - fetchedAtMs) / 1000));

  let observationAt: string | null = null;
  let locationCity: string | null = null;
  let locationState: string | null = null;
  if (row.raw_json) {
    try {
      const parsed = JSON.parse(row.raw_json) as {
        observation_at?: string;
        location_city?: string;
        location_state?: string;
      };
      observationAt = parsed.observation_at ?? null;
      locationCity = parsed.location_city ?? null;
      locationState = parsed.location_state ?? null;
    } catch {
      observationAt = null;
    }
  }

  return {
    latitude: row.latitude,
    longitude: row.longitude,
    temperature_f: row.temperature,
    conditions: row.conditions,
    dew_point_f: row.dew_point,
    humidity_percent: row.humidity,
    wind_speed_mph: row.wind_speed,
    wind_direction: row.wind_direction,
    wind_gusts_mph: row.wind_gusts,
    pressure_hpa: row.pressure,
    visibility_miles: row.visibility,
    fetched_at: row.fetched_at,
    observation_at: observationAt,
    location_city: locationCity,
    location_state: locationState,
    cache_age_seconds: cacheAgeSeconds,
    from_cache: fromCache,
    stale,
    source: "nws",
  };
}

async function nwsFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": NWS_USER_AGENT,
    },
  });
}

async function fetchLatestObservation(
  latitude: number,
  longitude: number,
): Promise<NormalizedWeather | null> {
  const pointsResponse = await nwsFetch(
    `${NWS_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`,
  );
  if (!pointsResponse.ok) {
    throw new Error(`NWS points lookup failed (${pointsResponse.status})`);
  }

  const pointsData = (await pointsResponse.json()) as {
    properties?: {
      observationStations?: string;
      forecastHourly?: string;
      relativeLocation?: {
        properties?: {
          city?: string;
          state?: string;
        };
      };
    };
  };

  const locationCity = pointsData.properties?.relativeLocation?.properties?.city?.trim() || null;
  const locationState = pointsData.properties?.relativeLocation?.properties?.state?.trim() || null;

  const withLocation = (weather: NormalizedWeather): NormalizedWeather => ({
    ...weather,
    location_city: locationCity,
    location_state: locationState,
  });

  const stationsUrl = pointsData.properties?.observationStations;
  if (stationsUrl) {
    const stationsResponse = await nwsFetch(stationsUrl);
    if (stationsResponse.ok) {
      const stationsData = (await stationsResponse.json()) as {
        features?: Array<{ properties?: { stationIdentifier?: string } }>;
      };
      const stationId = stationsData.features?.[0]?.properties?.stationIdentifier;
      if (stationId) {
        const observationResponse = await nwsFetch(
          `${NWS_BASE}/stations/${stationId}/observations/latest`,
        );
        if (observationResponse.ok) {
          const observationData = (await observationResponse.json()) as {
            properties?: {
              timestamp?: string;
              textDescription?: string | null;
              temperature?: NwsQuantity;
              dewpoint?: NwsQuantity;
              relativeHumidity?: NwsQuantity;
              windSpeed?: NwsQuantity;
              windDirection?: NwsQuantity;
              windGust?: NwsQuantity;
              barometricPressure?: NwsQuantity;
              visibility?: NwsQuantity;
            };
          };

          const properties = observationData.properties;
          if (properties) {
            const windDirectionDegrees = properties.windDirection?.value ?? null;
            return withLocation({
              latitude,
              longitude,
              temperature_f: roundNullable(convertQuantityToFahrenheit(properties.temperature), 1),
              conditions: properties.textDescription?.trim() || null,
              dew_point_f: roundNullable(convertQuantityToFahrenheit(properties.dewpoint), 1),
              humidity_percent: roundNullable(properties.relativeHumidity?.value ?? null, 0),
              wind_speed_mph: roundNullable(convertQuantityToMph(properties.windSpeed), 1),
              wind_direction:
                windDirectionDegrees == null
                  ? null
                  : degreesToCardinal(windDirectionDegrees),
              wind_gusts_mph: roundNullable(convertQuantityToMph(properties.windGust), 1),
              pressure_hpa: roundNullable(convertQuantityToHpa(properties.barometricPressure), 1),
              visibility_miles: roundNullable(convertQuantityToMiles(properties.visibility), 1),
              fetched_at: new Date().toISOString(),
              observation_at: properties.timestamp ?? null,
              location_city: null,
              location_state: null,
              cache_age_seconds: 0,
              from_cache: false,
              stale: false,
              source: "nws",
            });
          }
        }
      }
    }
  }

  const forecastHourlyUrl = pointsData.properties?.forecastHourly;
  if (!forecastHourlyUrl) {
    throw new Error("NWS did not return observation or forecast data for this location");
  }

  const forecastResponse = await nwsFetch(forecastHourlyUrl);
  if (!forecastResponse.ok) {
    throw new Error(`NWS hourly forecast failed (${forecastResponse.status})`);
  }

  const forecastData = (await forecastResponse.json()) as {
    properties?: {
      periods?: Array<{
        startTime?: string;
        temperature?: number;
        shortForecast?: string;
        windSpeed?: string;
        windDirection?: string;
        relativeHumidity?: { value?: number };
      }>;
    };
  };

  const period = forecastData.properties?.periods?.[0];
  if (!period) {
    throw new Error("NWS hourly forecast returned no periods");
  }

  return withLocation({
    latitude,
    longitude,
    temperature_f: roundNullable(period.temperature ?? null, 1),
    conditions: period.shortForecast?.trim() || null,
    dew_point_f: null,
    humidity_percent: roundNullable(period.relativeHumidity?.value ?? null, 0),
    wind_speed_mph: roundNullable(parseWindSpeedString(period.windSpeed), 1),
    wind_direction: period.windDirection?.trim() || null,
    wind_gusts_mph: null,
    pressure_hpa: null,
    visibility_miles: null,
    fetched_at: new Date().toISOString(),
    observation_at: period.startTime ?? null,
    location_city: null,
    location_state: null,
    cache_age_seconds: 0,
    from_cache: false,
    stale: false,
    source: "nws",
  });
}

async function readCachedWeather(
  env: Env,
  latitude: number,
  longitude: number,
): Promise<WeatherLatestRow | null> {
  return env.DB.prepare(
    `SELECT id, source_type, source_id, latitude, longitude, temperature, conditions,
            dew_point, humidity, wind_speed, wind_direction, wind_gusts, pressure,
            visibility, fetched_at, raw_json
     FROM weather_latest
     WHERE source_type = ? AND source_id = ?`,
  )
    .bind("coordinates", cacheKeyForCoordinates(latitude, longitude))
    .first<WeatherLatestRow>();
}

async function saveCachedWeather(env: Env, weather: NormalizedWeather): Promise<void> {
  const id = cacheIdForCoordinates(weather.latitude, weather.longitude);
  const fetchedAt = weather.fetched_at;
  const rawJson = JSON.stringify({
    observation_at: weather.observation_at,
    location_city: weather.location_city,
    location_state: weather.location_state,
  });

  await env.DB.prepare(
    `INSERT INTO weather_latest
       (id, source_type, source_id, latitude, longitude, temperature, conditions,
        dew_point, humidity, wind_speed, wind_direction, wind_gusts, pressure,
        visibility, fetched_at, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       latitude = excluded.latitude,
       longitude = excluded.longitude,
       temperature = excluded.temperature,
       conditions = excluded.conditions,
       dew_point = excluded.dew_point,
       humidity = excluded.humidity,
       wind_speed = excluded.wind_speed,
       wind_direction = excluded.wind_direction,
       wind_gusts = excluded.wind_gusts,
       pressure = excluded.pressure,
       visibility = excluded.visibility,
       fetched_at = excluded.fetched_at,
       raw_json = excluded.raw_json`,
  )
    .bind(
      id,
      "coordinates",
      cacheKeyForCoordinates(weather.latitude, weather.longitude),
      weather.latitude,
      weather.longitude,
      weather.temperature_f,
      weather.conditions,
      weather.dew_point_f,
      weather.humidity_percent,
      weather.wind_speed_mph,
      weather.wind_direction,
      weather.wind_gusts_mph,
      weather.pressure_hpa,
      weather.visibility_miles,
      fetchedAt,
      rawJson,
    )
    .run();
}

function isCacheFresh(row: WeatherLatestRow): boolean {
  const fetchedAtMs = parseUtcTimestamp(row.fetched_at);
  if (fetchedAtMs == null) return false;
  return Date.now() - fetchedAtMs <= WEATHER_CACHE_SECONDS * 1000;
}

export async function getWeatherForCoordinates(
  env: Env,
  latitude: number,
  longitude: number,
): Promise<NormalizedWeather> {
  const cached = await readCachedWeather(env, latitude, longitude);
  if (cached && isCacheFresh(cached)) {
    return rowToNormalized(cached, true, false);
  }

  try {
    const fetched = await fetchLatestObservation(latitude, longitude);
    if (!fetched) {
      throw new Error("Unable to fetch weather from NWS");
    }

    await saveCachedWeather(env, fetched);
    return { ...fetched, from_cache: false, stale: false };
  } catch (error) {
    if (cached) {
      return rowToNormalized(cached, true, true);
    }
    throw error;
  }
}
