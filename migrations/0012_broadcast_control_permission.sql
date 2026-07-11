-- Broadcast Control Center permission

INSERT OR IGNORE INTO permissions (id, key, description) VALUES
  ('perm-broadcast-control', 'broadcast.control', 'Control OBS broadcast scenes, stream, and recording');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role-admin', 'perm-broadcast-control');
