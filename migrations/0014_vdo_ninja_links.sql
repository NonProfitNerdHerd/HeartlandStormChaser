-- VDO.Ninja camera send/view links for Broadcast Control Center

CREATE TABLE IF NOT EXISTS vdo_ninja_links (
  id TEXT PRIMARY KEY,
  link_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  push_url TEXT NOT NULL,
  view_url TEXT NOT NULL,
  is_active_send INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO vdo_ninja_links
  (id, link_key, display_name, push_url, view_url, is_active_send, sort_order, created_at)
VALUES
  (
    'vdo-truck-front',
    'truck_front',
    'Truck Front',
    'https://vdo.ninja/?push=heartland2012_truck_front',
    'https://vdo.ninja/?view=heartland2012_truck_front',
    1,
    1,
    '2026-07-11T00:00:00.000Z'
  ),
  (
    'vdo-truck-dash',
    'truck_dash',
    'Truck Dash',
    'https://vdo.ninja/?push=heartland2012_truck_dash',
    'https://vdo.ninja/?view=heartland2012_truck_dash',
    0,
    2,
    '2026-07-11T00:00:00.000Z'
  ),
  (
    'vdo-jess',
    'jess',
    'Jess Cam',
    'https://vdo.ninja/?push=heartland2012_jess',
    'https://vdo.ninja/?view=heartland2012_jess',
    0,
    3,
    '2026-07-11T00:00:00.000Z'
  ),
  (
    'vdo-ike',
    'ike',
    'Ike Cam',
    'https://vdo.ninja/?push=heartland2012_ike',
    'https://vdo.ninja/?view=heartland2012_ike',
    0,
    4,
    '2026-07-11T00:00:00.000Z'
  ),
  (
    'vdo-ike2',
    'ike2',
    'Ike2',
    'https://vdo.ninja/?push=heartland2012_ike2',
    'https://vdo.ninja/?view=heartland2012_ike2',
    0,
    5,
    '2026-07-11T00:00:00.000Z'
  ),
  (
    'vdo-tablet1',
    'tablet1',
    'Tablet1',
    'https://vdo.ninja/?push=heartland2012_tablet1',
    'https://vdo.ninja/?view=heartland2012_tablet1',
    0,
    6,
    '2026-07-11T00:00:00.000Z'
  );
