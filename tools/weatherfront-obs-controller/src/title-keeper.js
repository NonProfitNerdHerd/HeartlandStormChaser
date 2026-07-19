export async function applyWindowTitle(page, title) {
  if (!page || page.isClosed()) return false;
  await page.evaluate((t) => {
    document.title = t;
    const mo = window.__heartlandTitleObserver;
    if (mo) mo.disconnect();
    const observer = new MutationObserver(() => {
      if (document.title !== t) document.title = t;
    });
    const target = document.querySelector("title") || document.head || document.documentElement;
    observer.observe(target, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    window.__heartlandTitleObserver = observer;
    // Also intercept property writes
    try {
      Object.defineProperty(document, "title", {
        configurable: true,
        get() {
          return t;
        },
        set() {
          /* ignore WeatherFront title changes */
        },
      });
    } catch {
      /* some browsers may block redefine after first time */
    }
  }, title);
  return true;
}

export function createTitleKeeper({ getPage, title, intervalMs = 3000, logger }) {
  let timer = null;

  async function tick() {
    const page = getPage?.();
    if (!page || page.isClosed()) return;
    try {
      const current = await page.title();
      if (current !== title) {
        logger?.info?.("Restoring WeatherFront window title");
        await applyWindowTitle(page, title);
      }
    } catch {
      /* page may be navigating */
    }
  }

  function start() {
    timer = setInterval(() => void tick(), intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick, apply: () => applyWindowTitle(getPage?.(), title) };
}
