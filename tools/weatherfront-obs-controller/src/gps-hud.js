/**
 * On-page Platform GPS HUD for the WeatherFront Chromium window.
 * Styled like the broadcast-control GPS status badge.
 */

export function buildHudModel(gpsSnapshot) {
  const state = gpsSnapshot?.state || "Unavailable";
  const source = gpsSnapshot?.sourceName || gpsSnapshot?.lastAccepted?.sourceName || null;
  const ageSeconds =
    gpsSnapshot?.ageSeconds != null
      ? Math.round(gpsSnapshot.ageSeconds)
      : gpsSnapshot?.lastAccepted?.ageSeconds != null
        ? Math.round(gpsSnapshot.lastAccepted.ageSeconds)
        : null;

  let tone = "unavailable";
  if (state === "Fresh" || state === "Delayed") tone = "healthy";
  else if (state === "Stale") tone = "stale";
  else if (state === "Unauthorized" || state === "Malformed") tone = "disconnected";

  const ageLabel =
    ageSeconds == null ? "" : ageSeconds < 60 ? `${ageSeconds}s` : `${Math.round(ageSeconds / 60)}m`;

  let label = "GPS unavailable";
  if (state === "Fresh") label = `GPS LIVE${ageLabel ? ` · ${ageLabel}` : ""}`;
  else if (state === "Delayed") label = `GPS DELAYED${ageLabel ? ` · ${ageLabel}` : ""}`;
  else if (state === "Stale") {
    label = `GPS HELD${ageLabel ? ` · ${ageLabel}` : ""}`;
  } else if (state === "Unauthorized") label = "GPS UNAUTHORIZED";
  else if (state === "Malformed") label = "GPS BAD DATA";

  if (source && tone !== "unavailable") {
    label = `${label} · ${source}`;
  }

  return { tone, label, state, ageSeconds, source };
}

/** Playwright page.evaluate payload — no coords in the HUD text. */
export async function ensureGpsHud(page, model) {
  if (!page || page.isClosed()) return false;
  await page.evaluate((m) => {
    const ID = "heartland-platform-gps-hud";
    let el = document.getElementById(ID);
    if (!el) {
      el = document.createElement("div");
      el.id = ID;
      el.setAttribute("data-heartland-gps-hud", "1");
      el.style.cssText = [
        "position:fixed",
        "top:12px",
        "right:12px",
        "z-index:2147483646",
        "pointer-events:none",
        "font-family:Segoe UI,system-ui,sans-serif",
        "font-size:13px",
        "font-weight:600",
        "line-height:1.2",
        "padding:8px 12px",
        "border-radius:8px",
        "border:1px solid #334155",
        "background:rgba(15,23,42,0.92)",
        "color:#e2e8f0",
        "box-shadow:0 4px 16px rgba(0,0,0,0.35)",
        "max-width:min(420px,70vw)",
        "white-space:nowrap",
        "overflow:hidden",
        "text-overflow:ellipsis",
      ].join(";");
      (document.body || document.documentElement).appendChild(el);
    }

    const tones = {
      healthy: { border: "rgba(34,197,94,0.5)", color: "#86efac", bg: "rgba(34,197,94,0.14)" },
      stale: { border: "rgba(234,179,8,0.5)", color: "#fde047", bg: "rgba(234,179,8,0.14)" },
      disconnected: { border: "rgba(239,68,68,0.5)", color: "#fca5a5", bg: "rgba(239,68,68,0.14)" },
      unavailable: { border: "#64748b", color: "#cbd5e1", bg: "rgba(100,116,139,0.2)" },
    };
    const t = tones[m.tone] || tones.unavailable;
    el.style.borderColor = t.border;
    el.style.color = t.color;
    el.style.background = t.bg;
    el.textContent = m.label;
    el.title = "Heartland platform GPS (from Home GPS Bridge)";
  }, model);
  return true;
}
