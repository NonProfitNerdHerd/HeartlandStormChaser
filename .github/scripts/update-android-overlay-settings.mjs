import { execFileSync } from "node:child_process";

const required = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "ANDROID_DOWNLOAD_URL",
  "ANDROID_VERSION_NAME",
  "ANDROID_VERSION_CODE",
];

for (const key of required) {
  if (!process.env[key]?.trim()) {
    console.warn(`Skipping D1 overlay update: missing ${key}.`);
    console.warn("Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID repo secrets to auto-update the GPS page QR code.");
    process.exit(0);
  }
}

const downloadUrl = process.env.ANDROID_DOWNLOAD_URL.trim();
const versionName = process.env.ANDROID_VERSION_NAME.trim();
const versionCode = process.env.ANDROID_VERSION_CODE.trim();
const builtAt = new Date().toISOString();

const entries = [
  ["android_app_download_url", downloadUrl],
  ["android_app_version_name", versionName],
  ["android_app_version_code", versionCode],
  ["android_app_built_at", builtAt],
];

const sql = entries
  .map(
    ([key, value]) =>
      `INSERT INTO overlay_settings (key, value, updated_at) VALUES ('${key.replace(/'/g, "''")}', '${value.replace(/'/g, "''")}', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
  )
  .join("\n");

console.log("Updating overlay settings for Android APK download...");
console.log(`  version_name: ${versionName}`);
console.log(`  version_code: ${versionCode}`);
console.log(`  download_url: ${downloadUrl}`);

execFileSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "heartland-storm-chaser-db",
    "--remote",
    "--command",
    sql,
  ],
  {
    stdio: "inherit",
    env: process.env,
  },
);

console.log("D1 overlay settings updated.");
