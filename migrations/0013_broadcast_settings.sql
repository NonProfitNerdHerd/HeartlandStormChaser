-- Broadcast Control Center settings (listener URL/token, OBS connection)

CREATE TABLE IF NOT EXISTS broadcast_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
