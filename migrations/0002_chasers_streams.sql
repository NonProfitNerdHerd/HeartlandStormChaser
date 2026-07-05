-- ChasersStreams — YouTube stream sources and quad slot assignments

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chasers_stream_sources (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  youtube_url TEXT NOT NULL,
  embed_url TEXT NOT NULL,
  notes TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chasers_stream_slots (
  slot_number INTEGER PRIMARY KEY NOT NULL CHECK (slot_number BETWEEN 1 AND 4),
  source_id TEXT REFERENCES chasers_stream_sources(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS chasers_stream_sources_enabled_idx
  ON chasers_stream_sources (enabled);

INSERT INTO chasers_stream_slots (slot_number) VALUES (1), (2), (3), (4);
