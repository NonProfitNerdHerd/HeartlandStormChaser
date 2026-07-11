-- Web authentication: users, sessions, roles, and permissions

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

INSERT OR IGNORE INTO roles (id, name, description, created_at) VALUES
  ('role-admin', 'admin', 'Full access to the platform', '2026-07-09T00:00:00.000Z'),
  ('role-member', 'member', 'Standard signed-in access', '2026-07-09T00:00:00.000Z');

INSERT OR IGNORE INTO permissions (id, key, description) VALUES
  ('perm-site-access', 'site.access', 'Sign in and use the web app'),
  ('perm-chases-read', 'chases.read', 'View chase trips'),
  ('perm-chases-write', 'chases.write', 'Create and edit chase trips'),
  ('perm-gps-manage', 'gps.manage', 'Manage GPS devices and platform source'),
  ('perm-streams-manage', 'streams.manage', 'Manage chaser streams'),
  ('perm-settings-manage', 'settings.manage', 'View backend and platform settings'),
  ('perm-users-manage', 'users.manage', 'Manage users, roles, and permissions');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role-admin', id FROM permissions;

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role-member', 'perm-site-access'),
  ('role-member', 'perm-chases-read'),
  ('role-member', 'perm-chases-write'),
  ('role-member', 'perm-gps-manage'),
  ('role-member', 'perm-streams-manage');
