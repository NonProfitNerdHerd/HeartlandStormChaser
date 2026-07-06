-- Chase trips: sessions, GPS trail, and expenses

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chases (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  chase_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  start_time TEXT NOT NULL,
  end_time TEXT,
  start_lat REAL,
  start_lng REAL,
  end_lat REAL,
  end_lng REAL,
  total_distance_miles REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES gps_devices(id)
);

CREATE TABLE IF NOT EXISTS chase_gps_points (
  id TEXT PRIMARY KEY,
  chase_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,
  speed REAL,
  heading REAL,
  altitude REAL,
  recorded_at TEXT NOT NULL,
  source_device_id TEXT NOT NULL,
  FOREIGN KEY (chase_id) REFERENCES chases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chase_expenses (
  id TEXT PRIMARY KEY,
  chase_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Gas', 'Food', 'Hotel', 'Other')),
  amount REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  expense_time TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (chase_id) REFERENCES chases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chases_device_id ON chases(device_id);
CREATE INDEX IF NOT EXISTS idx_chases_status ON chases(status);
CREATE INDEX IF NOT EXISTS idx_chases_start_time ON chases(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_chase_gps_points_chase_recorded ON chase_gps_points(chase_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_chase_expenses_chase_id ON chase_expenses(chase_id);
