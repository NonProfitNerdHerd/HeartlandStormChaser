-- HeartlandStormChaser — initial D1 schema (Phase 1)
-- Tables: devices, latest_location, alert_layers, system_settings

PRAGMA foreign_keys = ON;

-- Registered chase devices (Android phones, GPS puck, etc.)
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY NOT NULL,
  device_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'android',
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Current position per device (one row per device)
CREATE TABLE IF NOT EXISTS latest_location (
  device_id TEXT PRIMARY KEY NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  speed_mph REAL,
  heading_degrees REAL,
  heading_cardinal TEXT,
  altitude_ft REAL,
  accuracy_meters REAL,
  battery_percent INTEGER,
  gps_time TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Alert layer configuration and status (not live feeds yet)
CREATE TABLE IF NOT EXISTS alert_layers (
  id TEXT PRIMARY KEY NOT NULL,
  layer_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'idle',
  status_message TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  last_checked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Key-value system configuration
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS devices_device_key_idx ON devices (device_key);
CREATE INDEX IF NOT EXISTS devices_last_seen_at_idx ON devices (last_seen_at);
CREATE INDEX IF NOT EXISTS alert_layers_layer_key_idx ON alert_layers (layer_key);
CREATE INDEX IF NOT EXISTS alert_layers_status_idx ON alert_layers (status);

-- Seed alert layers (dashboard placeholders)
INSERT INTO alert_layers (id, layer_key, display_name, enabled, status, status_message)
VALUES
  ('al-weather', 'weather', 'Weather Alerts', 1, 'idle', 'NWS feed not connected'),
  ('al-public-safety', 'public_safety', 'Public Safety Alerts', 1, 'idle', 'Feed not configured'),
  ('al-infrastructure', 'infrastructure', 'Infrastructure Alerts', 1, 'idle', 'Feed not configured'),
  ('al-cyber', 'cyber', 'Cyber Alerts', 1, 'idle', 'Feed not configured');

-- Seed system settings
INSERT INTO system_settings (key, value_json, description)
VALUES
  ('app_name', '"HeartlandStormChaser"', 'Application display name'),
  ('phase', '"1"', 'Current build phase'),
  ('environment', '"development"', 'Deployment environment label');
