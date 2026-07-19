/**
 * WeatherFront location-follow / navigation control discovery.
 * Prefer stable selectors; never click an arbitrary first page button.
 */

export const FOLLOW_SELECTOR_CANDIDATES = [
  {
    id: "data-testid-locate",
    selector:
      '[data-testid*="locate" i], [data-testid*="location" i], [data-testid*="follow" i], [data-testid*="geoloc" i], [data-testid*="my-location" i]',
  },
  {
    id: "aria-label-locate",
    selector:
      'button[aria-label*="location" i], button[aria-label*="locate" i], button[aria-label*="follow" i], button[aria-label*="my location" i], button[aria-label*="current location" i], [role="button"][aria-label*="location" i], [role="button"][aria-label*="locate" i], [role="button"][aria-label*="follow" i]',
  },
  {
    id: "title-locate",
    selector:
      'button[title*="location" i], button[title*="locate" i], button[title*="follow" i], [role="button"][title*="location" i]',
  },
  {
    id: "toolbar-nav-first",
    // Narrowly scoped: map toolbar / left controls — not whole page
    selector:
      '[class*="toolbar" i] button:first-child, [class*="map-controls" i] button:first-child, [class*="MapControl" i] button:first-child, nav[class*="map" i] button:first-child, [data-tour="map-toolbar"] button:first-child',
  },
];

const FOLLOW_NAME_RE =
  /location|locate|follow|my location|current location|geoloc|navigate|position/i;

export function looksLikeFollowCandidate(meta) {
  if (!meta || typeof meta !== "object") return false;
  const hay = [
    meta.name,
    meta.ariaLabel,
    meta.title,
    meta.testId,
    meta.dataAction,
  ]
    .filter(Boolean)
    .join(" ");
  return FOLLOW_NAME_RE.test(hay);
}

export function filterFollowCandidates(list) {
  return (list || []).filter(
    (item) => item.visible && item.enabled !== false && looksLikeFollowCandidate(item),
  );
}

export function isFollowActiveFromAttrs(attrs) {
  if (!attrs || typeof attrs !== "object") return false;
  if (attrs.ariaPressed === true || attrs.ariaPressed === "true") return true;
  if (attrs.ariaSelected === true || attrs.ariaSelected === "true") return true;
  if (attrs.dataActive === true || attrs.dataActive === "true" || attrs.dataActive === "active") {
    return true;
  }
  if (attrs.dataState === "active" || attrs.dataState === "on" || attrs.dataState === "pressed") {
    return true;
  }
  const cls = String(attrs.className || "");
  if (/\b(active|selected|pressed|is-active|isActive)\b/i.test(cls)) return true;
  return false;
}

/**
 * Bounded retry helper for follow activation.
 */
export function createBoundedRetry({ maxAttempts = 3, cooldownMs = 60_000 } = {}) {
  let attempts = 0;
  let cooldownUntil = 0;

  return {
    canAttempt(now = Date.now()) {
      if (now < cooldownUntil) return false;
      return attempts < maxAttempts;
    },
    recordFailure(now = Date.now()) {
      attempts += 1;
      if (attempts >= maxAttempts) {
        cooldownUntil = now + cooldownMs;
        attempts = 0;
        return { cooledDown: true, cooldownUntil };
      }
      return { cooledDown: false, cooldownUntil: 0 };
    },
    recordSuccess() {
      attempts = 0;
      cooldownUntil = 0;
    },
    getState(now = Date.now()) {
      return {
        attempts,
        inCooldown: now < cooldownUntil,
        cooldownUntil,
      };
    },
  };
}

/**
 * Page-side evaluation helpers (string functions for Playwright).
 */
export async function discoverFollowButton(page) {
  for (const candidate of FOLLOW_SELECTOR_CANDIDATES) {
    const handles = page.locator(candidate.selector);
    const count = await handles.count();
    for (let i = 0; i < Math.min(count, 8); i += 1) {
      const el = handles.nth(i);
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      const enabled = await el.isEnabled().catch(() => true);
      if (!enabled) continue;

      const meta = await el
        .evaluate((node) => ({
          name:
            node.getAttribute("aria-label") ||
            node.getAttribute("title") ||
            (node.textContent || "").trim().slice(0, 80),
          ariaLabel: node.getAttribute("aria-label"),
          title: node.getAttribute("title"),
          testId: node.getAttribute("data-testid"),
          dataAction: node.getAttribute("data-action"),
          role: node.getAttribute("role") || node.tagName.toLowerCase(),
          tag: node.tagName.toLowerCase(),
          ariaPressed: node.getAttribute("aria-pressed"),
          ariaSelected: node.getAttribute("aria-selected"),
          dataActive: node.getAttribute("data-active") || node.getAttribute("data-state"),
          dataState: node.getAttribute("data-state"),
          className: typeof node.className === "string" ? node.className : "",
        }))
        .catch(() => null);

      if (!meta) continue;
      // For toolbar-first strategy, require follow-like naming unless it's the only toolbar button with icon
      if (candidate.id === "toolbar-nav-first") {
        // Allow if name matches OR element is a lone icon button in toolbar (still require some signal)
        if (!looksLikeFollowCandidate(meta) && !meta.testId) {
          // Still allow first toolbar button only if it has aria-label or title at all
          if (!meta.ariaLabel && !meta.title) continue;
        }
      } else if (!looksLikeFollowCandidate(meta)) {
        continue;
      }

      return {
        found: true,
        strategy: candidate.id,
        selector: candidate.selector,
        index: i,
        meta,
        active: isFollowActiveFromAttrs(meta),
      };
    }
  }
  return { found: false, strategy: null, selector: null, index: -1, meta: null, active: false };
}

export async function ensureFollowActive(page, { retry, logger, clickXy = null } = {}) {
  const discovery = await discoverFollowButton(page);
  if (!discovery.found) {
    if (clickXy?.enabled && Number.isFinite(clickXy.x) && Number.isFinite(clickXy.y)) {
      if (retry && !retry.canAttempt()) {
        return { ok: false, degraded: true, reason: "follow-not-found-cooldown", discovery };
      }
      logger?.warn?.("Follow button not found; using brittle XY click (degraded)");
      await page.mouse.click(clickXy.x, clickXy.y);
      retry?.recordFailure?.();
      return { ok: false, degraded: true, reason: "xy-fallback", discovery };
    }
    retry?.recordFailure?.();
    return { ok: false, degraded: false, reason: "follow-not-found", discovery };
  }

  if (discovery.active) {
    retry?.recordSuccess?.();
    return { ok: true, alreadyActive: true, discovery };
  }

  if (retry && !retry.canAttempt()) {
    return { ok: false, degraded: true, reason: "follow-click-cooldown", discovery };
  }

  const locator = page.locator(discovery.selector).nth(discovery.index);
  await locator.click({ timeout: 5000 }).catch(async () => {
    await locator.click({ force: true, timeout: 5000 });
  });

  await page.waitForTimeout(400);
  const after = await discoverFollowButton(page);
  const active = after.found && after.active;
  if (active) {
    retry?.recordSuccess?.();
    logger?.info?.(`Location-follow activated via ${discovery.strategy}`);
    return { ok: true, alreadyActive: false, discovery: after };
  }

  const fail = retry?.recordFailure?.() || {};
  return {
    ok: false,
    degraded: Boolean(fail.cooledDown),
    reason: "follow-not-active-after-click",
    discovery: after.found ? after : discovery,
  };
}

export async function listToolbarCandidates(page) {
  return page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll('button, [role="button"], a[class*="button" i]'),
    );
    return nodes
      .slice(0, 80)
      .map((node, index) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const visible =
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0;
        return {
          index,
          tag: node.tagName.toLowerCase(),
          role: node.getAttribute("role") || "",
          name: (node.getAttribute("aria-label") || node.getAttribute("title") || "").slice(0, 120),
          ariaLabel: (node.getAttribute("aria-label") || "").slice(0, 120),
          title: (node.getAttribute("title") || "").slice(0, 120),
          testId: node.getAttribute("data-testid") || "",
          dataAttrs: Array.from(node.attributes)
            .filter((a) => a.name.startsWith("data-") && !/token|auth|session|cookie/i.test(a.name))
            .slice(0, 8)
            .map((a) => `${a.name}=${String(a.value).slice(0, 40)}`),
          visible,
          enabled: !(node.disabled || node.getAttribute("aria-disabled") === "true"),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
        };
      })
      .filter((n) => n.visible);
  });
}
