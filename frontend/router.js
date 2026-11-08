// Plain router — no imports, runs even if chain modules fail to load.
(function () {
  var pages = ["home", "how", "integrations", "dashboard", "contracts"];
  function route() {
    var hash = (location.hash || "#/home").replace("#/", "").split("?")[0];
    if (pages.indexOf(hash) === -1) hash = "home";
    document.querySelectorAll("[data-page]").forEach(function (s) {
      s.hidden = s.dataset.page !== hash;
    });
    document.querySelectorAll(".nav nav a").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("href") === "#/" + hash);
    });
    window.scrollTo({ top: 0 });
    if (hash === "dashboard" && window.loadPayments) window.loadPayments();
  }
  window.addEventListener("hashchange", route);
  document.addEventListener("DOMContentLoaded", route);
  route();
})();
