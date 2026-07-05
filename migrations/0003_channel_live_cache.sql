-- ChasersStreams — channel IDs and cached live status

PRAGMA foreign_keys = ON;

ALTER TABLE chasers_stream_sources ADD COLUMN channel_id TEXT;
ALTER TABLE chasers_stream_sources ADD COLUMN is_live INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chasers_stream_sources ADD COLUMN live_video_id TEXT;
ALTER TABLE chasers_stream_sources ADD COLUMN live_title TEXT;
ALTER TABLE chasers_stream_sources ADD COLUMN live_checked_at TEXT;

CREATE INDEX IF NOT EXISTS chasers_stream_sources_channel_id_idx
  ON chasers_stream_sources (channel_id);

-- Global refresh cache (shared across all clients/tablets)
CREATE TABLE IF NOT EXISTS chasers_live_cache (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  last_refreshed_at TEXT,
  cache_ttl_seconds INTEGER NOT NULL DEFAULT 120
);

INSERT OR IGNORE INTO chasers_live_cache (id, cache_ttl_seconds) VALUES (1, 120);
