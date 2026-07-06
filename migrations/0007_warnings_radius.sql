-- Shared warnings radius for web UI and overlays

PRAGMA foreign_keys = ON;

ALTER TABLE warnings_cache ADD COLUMN radius_miles INTEGER NOT NULL DEFAULT 700;

UPDATE warnings_cache SET radius_miles = 700 WHERE radius_miles IS NULL;
