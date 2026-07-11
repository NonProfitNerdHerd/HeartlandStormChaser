/**
 * Ask Desktop OBS to reload VDO browser sources after a Surface publisher reconnect.
 * Safe to call from Broadcast UI or the persist layer on other pages.
 * @param {string[]} [matchers]
 */
export async function requestObsBrowserRefresh(matchers = ["truck_front", "truck_dash"]) {
  try {
    const response = await fetch("/api/broadcast/sources/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchers }),
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  } catch {
    return null;
  }
}

/**
 * Refresh once soon, then again after the publisher has time to reappear in VDO.
 * @param {string[]} [matchers]
 */
export function scheduleObsBrowserRefresh(matchers = ["truck_front", "truck_dash"]) {
  window.setTimeout(() => {
    void requestObsBrowserRefresh(matchers);
  }, 2500);
  window.setTimeout(() => {
    void requestObsBrowserRefresh(matchers);
  }, 7000);
}
