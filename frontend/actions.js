// Dashboard actions — plain script, no imports. Works even if chain module fails.
(function () {
  var API = "http://localhost:8000";
  function $(id) { return document.getElementById(id); }
  function toast(msg, kind) {
    var box = document.getElementById("toasts");
    if (!box) return;
    var t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.innerHTML = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 9000);
  }
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  async function apiWrite(path, body, action) {
    var missing = Object.entries(body).filter(function (pair) { return pair[1] === undefined || pair[1] === null || String(pair[1]).trim() === ""; });
    if (missing.length) {
      toast("<strong>Missing fields:</strong> " + missing.map(function (p) { return esc(p[0]); }).join(", "), "error");
      return;
    }
    toast("<strong>" + esc(action) + " submitting…</strong> (waiting for StudioNet finality)");
    try {
      var res = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.detail || res.statusText);
      var tx = data.tx ? '<br><a href="https://explorer-studio.genlayer.com/tx/' + esc(data.tx) + '" target="_blank" rel="noreferrer">tx ' + esc(data.tx.slice(0, 10)) + '… ↗</a>' : "";
      toast("<strong>" + esc(action) + " success.</strong><br>" + tx, "success");
      if (window.loadPayments) window.loadPayments();
    } catch (e) {
      toast("<strong>" + esc(action) + " failed:</strong> " + esc(e.message) + '<br><span class="muted">Is the API running? <code>uvicorn api.app:app --port 8000</code></span>', "error");
    }
  }

  function bind(id, fn) {
    document.addEventListener("DOMContentLoaded", function () {
      var el = document.getElementById(id);
      if (el) el.addEventListener("click", fn);
    });
  }

  bind("btnCreate", function () { apiWrite("/payments", {
    actor_address: $("fBuyer").value, seller: $("fSeller").value, rail: $("fRail").value,
    criteria: $("fCriteria").value, payment_proof: $("fProof").value,
    amount_usdc: Math.round(parseFloat($("fAmount").value || "0") * 1000000), ttl_seconds: 86400,
  }, "create_payment"); });
  bind("btnDelivery", function () { apiWrite("/payments/" + $("aPid").value + "/delivery", { actor_address: $("fSeller").value || "0x99bF44395CaC814E671ADFF8b69d968Fac4e5Db3", delivery_url: $("aUrl").value, note: "done" }, "submit_delivery"); });
  bind("btnDispute", function () { apiWrite("/payments/" + $("aPid").value + "/dispute", { actor_address: $("fBuyer").value || "0x0Eb9431eDdbF170d2224F4f9E47D4DD68b6c44bc", reason: "Delivery does not match criteria" }, "open_dispute"); });
  bind("btnResolve", function () { apiWrite("/payments/" + $("aPid").value + "/resolve", {}, "resolve_dispute"); });
  bind("btnPropose", function () { apiWrite("/payments/" + $("aPid").value + "/propose", { actor_address: $("fBuyer").value, outcome: "release" }, "propose_outcome"); });
  bind("btnAccept", function () { apiWrite("/payments/" + $("aPid").value + "/accept", { actor_address: $("fBuyer").value }, "accept"); });
  bind("btnRefresh", function () { if (window.loadPayments) window.loadPayments(); else toast("Dashboard data module not loaded yet.", "error"); });

  document.addEventListener("DOMContentLoaded", function () {
    var f = document.getElementById("fFilter");
    if (f) f.addEventListener("change", function () { if (window.loadPayments) window.loadPayments(); });
  });
})();
