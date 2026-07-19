export function redactUrl(urlString) {
  try {
    const url = new URL(urlString);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|password|auth|session|cookie/i.test(key)) {
        url.searchParams.set(key, "REDACTED");
      }
    }
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

export function sanitizeLogMessage(message, secrets = []) {
  let text = String(message);
  for (const secret of secrets) {
    if (secret && String(secret).length >= 6) {
      text = text.split(String(secret)).join("[redacted]");
    }
  }
  text = text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  text = text.replace(/Authorization:\s*\S+/gi, "Authorization: [redacted]");
  return text;
}

export function isAllowedWeatherfrontUrl(urlString, configuredOrigin) {
  try {
    const url = new URL(urlString);
    const allowed = new URL(configuredOrigin);
    if (url.origin === allowed.origin) {
      return true;
    }
    // Legitimate WeatherFront / auth navigations
    const host = url.hostname.toLowerCase();
    if (
      host === "app.weatherfront.com" ||
      host.endsWith(".weatherfront.com") ||
      host.endsWith(".auth0.com") ||
      host.endsWith(".google.com") ||
      host.endsWith(".googleapis.com") ||
      host === "accounts.google.com"
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function requireWeatherfrontAppUrl(urlString) {
  const url = new URL(urlString);
  if (url.hostname === "apps.weatherfront.com") {
    throw new Error("Use https://app.weatherfront.com (not apps.weatherfront.com)");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("WEATHERFRONT_URL must be http(s)");
  }
  return url.toString().replace(/\/$/, "") || "https://app.weatherfront.com";
}
