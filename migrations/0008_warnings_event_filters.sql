-- Shared event-type filters for warnings page and overlay

PRAGMA foreign_keys = ON;

ALTER TABLE warnings_cache ADD COLUMN event_filters_json TEXT NOT NULL DEFAULT '{}';
