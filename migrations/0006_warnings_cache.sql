-- NWS warnings cache and polling interval (shared across all clients)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS warnings_cache (
  id TEXT PRIMARY KEY NOT NULL,
  alerts_json TEXT NOT NULL DEFAULT '[]',
  fetched_at TEXT,
  poll_interval_seconds INTEGER NOT NULL DEFAULT 3600
);

INSERT OR IGNORE INTO warnings_cache (id, alerts_json, poll_interval_seconds)
VALUES ('nws_active_alerts', '[]', 3600);
