import type { Env } from "../index";

export const SESSION_COOKIE_NAME = "hsc_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const BOOTSTRAP_USERNAME = "IJRebout";
/** Cloudflare Workers Web Crypto limits PBKDF2 to 100,000 iterations. */
export const PBKDF2_ITERATIONS = 100_000;

export interface AuthUser {
  id: string;
  username: string;
  roles: string[];
  permissions: string[];
}

interface UserRow {
  id: string;
  username: string;
  password_salt: string;
  password_hash: string;
  enabled: number;
}

function nowUtc(): string {
  return new Date().toISOString();
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hashBuffer));
}

export function generateSessionToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

export function createPasswordSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const actualHash = await hashPassword(password, salt);
  return timingSafeEqual(actualHash, expectedHash);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function getSessionTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    if (rawName === SESSION_COOKIE_NAME) {
      const value = rawValueParts.join("=");
      return value ? decodeURIComponent(value) : null;
    }
  }

  return null;
}

export function buildSessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function buildClearSessionCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

async function getUserRoles(env: Env, userId: string): Promise<string[]> {
  const result = await env.DB.prepare(
    `SELECT r.name
     FROM user_roles ur
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?`,
  )
    .bind(userId)
    .all<{ name: string }>();

  return (result.results ?? []).map((row) => row.name);
}

async function getUserPermissions(env: Env, userId: string): Promise<string[]> {
  const result = await env.DB.prepare(
    `SELECT DISTINCT p.key AS key
     FROM user_roles ur
     INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
     INNER JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = ?`,
  )
    .bind(userId)
    .all<{ key: string }>();

  return (result.results ?? []).map((row) => row.key);
}

export async function getUserByUsername(env: Env, username: string): Promise<UserRow | null> {
  return env.DB.prepare(
    `SELECT id, username, password_salt, password_hash, enabled
     FROM users
     WHERE username = ? COLLATE NOCASE`,
  )
    .bind(username.trim())
    .first<UserRow>();
}

export async function getAuthUserById(env: Env, userId: string): Promise<AuthUser | null> {
  const user = await env.DB.prepare(
    `SELECT id, username, enabled FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<{ id: string; username: string; enabled: number }>();

  if (!user || user.enabled !== 1) {
    return null;
  }

  const [roles, permissions] = await Promise.all([
    getUserRoles(env, user.id),
    getUserPermissions(env, user.id),
  ]);

  return {
    id: user.id,
    username: user.username,
    roles,
    permissions,
  };
}

export async function createUser(
  env: Env,
  username: string,
  password: string,
  roleNames: string[],
): Promise<AuthUser> {
  const timestamp = nowUtc();
  const userId = crypto.randomUUID();
  const salt = createPasswordSalt();
  const passwordHash = await hashPassword(password, salt);

  await env.DB.prepare(
    `INSERT INTO users (id, username, password_salt, password_hash, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(userId, username.trim(), salt, passwordHash, timestamp, timestamp)
    .run();

  for (const roleName of roleNames) {
    const role = await env.DB.prepare(`SELECT id FROM roles WHERE name = ?`)
      .bind(roleName)
      .first<{ id: string }>();
    if (!role) {
      continue;
    }

    await env.DB.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`)
      .bind(userId, role.id)
      .run();
  }

  const authUser = await getAuthUserById(env, userId);
  if (!authUser) {
    throw new Error("Failed to create user");
  }

  return authUser;
}

export async function ensureBootstrapUser(env: Env): Promise<boolean> {
  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS count FROM users`).first<{
    count: number;
  }>();
  if ((countRow?.count ?? 0) > 0) {
    return false;
  }

  const bootstrapPassword = env.WEB_AUTH_BOOTSTRAP_PASSWORD?.trim();
  if (!bootstrapPassword) {
    return false;
  }

  await createUser(env, BOOTSTRAP_USERNAME, bootstrapPassword, ["admin"]);
  return true;
}

export async function authenticateUser(
  env: Env,
  username: string,
  password: string,
): Promise<AuthUser | null> {
  const user = await getUserByUsername(env, username);
  if (!user || user.enabled !== 1) {
    return null;
  }

  const valid = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!valid) {
    return null;
  }

  return getAuthUserById(env, user.id);
}

export async function createSession(
  env: Env,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken();
  const tokenHash = await hashToken(token);
  const sessionId = crypto.randomUUID();
  const createdAt = nowUtc();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(sessionId, userId, tokenHash, expiresAt, createdAt)
    .run();

  return { token, expiresAt };
}

export async function deleteSessionByToken(env: Env, token: string): Promise<void> {
  const tokenHash = await hashToken(token);
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
}

export async function getAuthUserFromRequest(
  env: Env,
  request: Request,
): Promise<AuthUser | null> {
  const token = getSessionTokenFromRequest(request);
  if (!token) {
    return null;
  }

  const tokenHash = await hashToken(token);
  const session = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.enabled
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: string; enabled: number }>();

  if (!session || session.enabled !== 1) {
    return null;
  }

  if (Date.parse(session.expires_at) <= Date.now()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
    return null;
  }

  return getAuthUserById(env, session.user_id);
}

export function userHasPermission(user: AuthUser, permission: string): boolean {
  return user.permissions.includes(permission);
}

export function userHasAnyPermission(user: AuthUser, permissions: string[]): boolean {
  return permissions.some((permission) => user.permissions.includes(permission));
}
