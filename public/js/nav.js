/**
 * Highlights the active nav link based on the current page.
 * Add data-nav on each link and data-page on <body>.
 */
(function () {
  const currentPage = document.body.dataset.page;
  if (!currentPage) return;

  document.querySelectorAll(".nav-link[data-nav]").forEach(function (link) {
    if (link.dataset.nav === currentPage) {
      link.classList.add("nav-link--active");
    }
  });
})();
