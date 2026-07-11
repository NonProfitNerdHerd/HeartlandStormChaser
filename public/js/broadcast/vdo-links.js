import { escapeHtml } from "./ui-utils.js";

/**
 * @typedef {{
 *   id: string,
 *   link_key: string,
 *   display_name: string,
 *   push_url: string,
 *   view_url: string,
 *   is_active_send: boolean,
 *   sort_order: number
 * }} VdoLink
 */

/**
 * @param {string} text
 * @param {HTMLElement} container
 */
function renderQr(text, container) {
  container.innerHTML = "";
  if (typeof window.QRCode !== "function") {
    container.textContent = "QR unavailable";
    return;
  }

  try {
    // qrcodejs API
    // eslint-disable-next-line no-new
    new window.QRCode(container, {
      text,
      width: 148,
      height: 148,
      correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 1,
    });
  } catch (error) {
    container.textContent = "QR error";
  }
}

/**
 * @param {HTMLElement | null} container
 * @param {VdoLink[] | null | undefined} links
 * @param {{ busyKey: string | null, message: string | null, error: string | null }} ui
 * @param {(linkKey: string) => void} onActivate
 */
export function renderVdoLinks(container, links, ui, onActivate) {
  if (!container) return;

  if (!links || links.length === 0) {
    container.innerHTML = `<p class="bcc-empty">No VDO.Ninja links configured.</p>`;
    return;
  }

  container.innerHTML = `
    <p class="bcc-vdo__help">Scan a push QR on the road, or select the primary send link. Desktop OBS Browser Sources should use the matching view link.</p>
    <div class="bcc-vdo-grid">
      ${links
        .map((link) => {
          const active = Boolean(link.is_active_send);
          const busy = ui.busyKey === link.link_key;
          return `
            <article class="bcc-vdo-card${active ? " bcc-vdo-card--active" : ""}" data-vdo-key="${escapeHtml(link.link_key)}">
              <div class="bcc-vdo-card__header">
                <div>
                  <h3 class="bcc-vdo-card__name">${escapeHtml(link.display_name)}</h3>
                  <p class="bcc-vdo-card__hint">Scan to open VDO.Ninja push</p>
                </div>
                <button
                  type="button"
                  class="btn ${active ? "btn--danger" : "btn--secondary"} btn--small"
                  data-vdo-activate="${escapeHtml(link.link_key)}"
                  ${busy ? "disabled" : ""}
                >${active ? "Active" : busy ? "Saving…" : "Use Send Link"}</button>
              </div>
              <div class="bcc-vdo-card__body">
                <div class="bcc-vdo-card__qr" data-vdo-qr="${escapeHtml(link.link_key)}"></div>
                <div class="bcc-vdo-card__links">
                  <p class="bcc-vdo-card__label">Push link</p>
                  <a class="bcc-vdo-card__url" href="${escapeHtml(link.push_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.push_url)}</a>
                  <p class="bcc-vdo-card__label">View link</p>
                  <a class="bcc-vdo-card__url bcc-vdo-card__url--muted" href="${escapeHtml(link.view_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.view_url)}</a>
                </div>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
    <p class="bcc-inline-error" ${ui.error ? "" : "hidden"}>${escapeHtml(ui.error || "")}</p>
    <p class="bcc-settings__success" ${ui.message ? "" : "hidden"}>${escapeHtml(ui.message || "")}</p>
  `;

  links.forEach((link) => {
    const qrHost = container.querySelector(`[data-vdo-qr="${CSS.escape(link.link_key)}"]`);
    if (qrHost instanceof HTMLElement) {
      renderQr(link.push_url, qrHost);
    }
  });

  container.querySelectorAll("[data-vdo-activate]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.getAttribute("data-vdo-activate");
      if (key) onActivate(key);
    });
  });
}
