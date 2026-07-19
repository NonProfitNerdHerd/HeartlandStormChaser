import type { Env } from "../index";

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function generateDeviceToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function verifyPairingPin(env: Env, pin: string): boolean {
  const expected = env.GPS_PAIRING_PIN?.trim();
  if (!expected) {
    return false;
  }
  return timingSafeEqual(pin.trim(), expected);
}

/** Returns true when the provided bearer token matches HOME_GPS_BRIDGE_TOKEN. */
export function verifyHomeGpsBridgeToken(env: Env, token: string): boolean {
  const expected = env.HOME_GPS_BRIDGE_TOKEN?.trim();
  if (!expected || !token) {
    return false;
  }
  return timingSafeEqual(token.trim(), expected);
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization")?.trim();
  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

export async function findDeviceByToken(
  env: Env,
  token: string,
): Promise<{ id: string; device_name: string; enabled: number } | null> {
  const tokenHash = await hashToken(token);
  return env.DB.prepare(
    `SELECT id, device_name, enabled
     FROM gps_devices
     WHERE device_token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{ id: string; device_name: string; enabled: number }>();
}
