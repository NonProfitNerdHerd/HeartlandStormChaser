-- Seed Android APK metadata keys for the GPS page QR download section.

INSERT INTO overlay_settings (key, value)
VALUES
  ('android_app_version_name', ''),
  ('android_app_version_code', ''),
  ('android_app_built_at', '')
ON CONFLICT(key) DO NOTHING;
