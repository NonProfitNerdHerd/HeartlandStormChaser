/**

 * Ask Desktop OBS to reload VDO browser sources after a Surface publisher reconnect.

 * Safe to call from Broadcast UI or the persist layer on other pages.

 * @param {string[]} [matchers]

 * @param {{ force?: boolean }} [opts]

 */

const MIN_REFRESH_GAP_MS = 60_000;

/** @type {Map<string, number>} */

const lastRefreshByKey = new Map();



function refreshKey(matchers) {

  return (matchers || []).map((m) => String(m).toLowerCase()).sort().join("|") || "*";

}



export async function requestObsBrowserRefresh(

  matchers = ["truck_front", "truck_dash"],

  opts = {},

) {

  const force = Boolean(opts.force);

  const key = refreshKey(matchers);

  const now = Date.now();

  const last = lastRefreshByKey.get(key) || 0;

  if (!force && now - last < MIN_REFRESH_GAP_MS) {

    return null;

  }

  lastRefreshByKey.set(key, now);



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

 * @param {{ force?: boolean }} [opts]

 */

export function scheduleObsBrowserRefresh(

  matchers = ["truck_front", "truck_dash"],

  opts = {},

) {

  const force = Boolean(opts.force);

  window.setTimeout(() => {

    void requestObsBrowserRefresh(matchers, { force });

  }, 2500);

  window.setTimeout(() => {

    void requestObsBrowserRefresh(matchers, { force: true });

  }, 7000);

}


