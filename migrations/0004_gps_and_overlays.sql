-- HeartlandStormChaser — GPS devices, overlay settings, weather cache

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gps_devices (
  id TEXT PRIMARY KEY NOT NULL,
  device_name TEXT NOT NULL,
  device_token_hash TEXT NOT NULL,
  is_platform_source INTEGER NOT NULL DEFAULT 0 CHECK (is_platform_source IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gps_latest_location (
  device_id TEXT PRIMARY KEY NOT NULL REFERENCES gps_devices(id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  speed_mph REAL,
  heading_degrees REAL,
  accuracy_meters REAL,
  altitude_meters REAL,
  battery_percent INTEGER,
  timestamp_utc TEXT NOT NULL,
  received_at_utc TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gps_location_history (
  id TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL REFERENCES gps_devices(id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  speed_mph REAL,
  heading_degrees REAL,
  accuracy_meters REAL,
  altitude_meters REAL,
  battery_percent INTEGER,
  timestamp_utc TEXT NOT NULL,
  received_at_utc TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS overlay_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weather_latest (
  id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  temperature REAL,
  conditions TEXT,
  dew_point REAL,
  humidity REAL,
  wind_speed REAL,
  wind_direction TEXT,
  wind_gusts REAL,
  pressure REAL,
  visibility REAL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS gps_devices_device_name_idx ON gps_devices (device_name);
CREATE INDEX IF NOT EXISTS gps_devices_platform_source_idx ON gps_devices (is_platform_source);
CREATE INDEX IF NOT EXISTS gps_devices_last_seen_at_idx ON gps_devices (last_seen_at);
CREATE INDEX IF NOT EXISTS gps_location_history_device_id_idx ON gps_location_history (device_id);
CREATE INDEX IF NOT EXISTS gps_location_history_received_at_idx ON gps_location_history (received_at_utc);
CREATE INDEX IF NOT EXISTS weather_latest_coords_idx ON weather_latest (latitude, longitude);

INSERT INTO overlay_settings (key, value)
VALUES
  ('android_app_download_url', ''),
  ('overlay_target_city', ''),
  ('overlay_target_state', ''),
  ('overlay_ticker_text', '');
