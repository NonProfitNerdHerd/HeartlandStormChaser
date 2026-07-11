-- Scheduled broadcasts + workflow operations for Broadcast Control Center

CREATE TABLE IF NOT EXISTS scheduled_broadcasts (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  scheduled_at TEXT NOT NULL,
  time_zone TEXT NOT NULL DEFAULT 'America/Chicago',
  platform TEXT NOT NULL DEFAULT 'obs',
  visibility TEXT NOT NULL DEFAULT 'private',
  expected_duration_minutes INTEGER,
  auto_start INTEGER NOT NULL DEFAULT 0 CHECK (auto_start IN (0, 1)),
  auto_stop INTEGER NOT NULL DEFAULT 0 CHECK (auto_stop IN (0, 1)),
  starting_scene TEXT,
  main_live_scene TEXT,
  ending_scene TEXT,
  obs_profile TEXT,
  operator_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
  operation_id TEXT,
  workflow_step TEXT,
  external_platform_id TEXT,
  actual_start_at TEXT,
  actual_end_at TEXT,
  error_message TEXT,
  emergency_stopped INTEGER NOT NULL DEFAULT 0 CHECK (emergency_stopped IN (0, 1)),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_broadcasts_scheduled_at
  ON scheduled_broadcasts (scheduled_at);

CREATE INDEX IF NOT EXISTS idx_scheduled_broadcasts_status
  ON scheduled_broadcasts (status);

CREATE TABLE IF NOT EXISTS broadcast_operations (
  id TEXT PRIMARY KEY NOT NULL,
  broadcast_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (broadcast_id) REFERENCES scheduled_broadcasts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_broadcast_operations_broadcast
  ON broadcast_operations (broadcast_id);
