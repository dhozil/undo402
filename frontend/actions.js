// Dashboard actions — plain script, no imports. Works even if chain module fails.
// Strategy: try relay API first (fast, demo), fall back to direct wallet
// signing via genlayer-js (works on Vercel for any visitor, no backend).
(function () {
  var API = "http://localhost:8000";
  var CONTRACT = "0xa2BFf07689Db9365597946858262Ca8dD6b7a1bc";
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

  // Direct wallet write via genlayer-js (EVM-compatible, MetaMask signs).
  async function directWrite(fn, args, action) {
    if (!window.ethereum) throw new Error("Connect MetaMask first (button top-right), then retry.");
    const { createClient } = await import("genlayer-js");
    const { studionet } = await import("genlayer-js/chains");
    const client = createClient({ chain: studionet, account: window.ethereum });
    const hash = await client.writeContract({ address: CONTRACT, functionName: fn, args });
    const { TransactionStatus } = await import("genlayer-js/types");
    await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, retries: 100, interval: 5000, fullTransaction: true });
    return hash;
  }

  async function apiWrite(path, body, action, directFn, directArgs) {
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
      // API unreachable (e.g. Vercel visitor without local backend) -> direct wallet fallback
      if (e instanceof TypeError && /fetch|Failed to fetch|ERR_CONNECTION|refused/i.test(e.message)) {
        toast("<strong>Relay API offline</strong> — trying direct wallet signing…");
        try {
          var hash = await directWrite(directFn, directArgs, action);
          toast("<strong>" + esc(action) + " success (direct wallet).</strong><br><a href=\"https://explorer-studio.genlayer.com/tx/" + esc(hash) + "\" target=\"_blank\" rel=\"noreferrer\">tx " + esc(hash.slice(0, 10)) + "… ↗</a>", "success");
          if (window.loadPayments) window.loadPayments();
          return;
        } catch (e2) {
          toast("<strong>" + esc(action) + " failed:</strong> " + esc(e2.message) + '<br><span class="muted">Connect MetaMask (top-right) and ensure StudioNet network is added.</span>', "error");
          return;
        }
      }
      toast("<strong>" + esc(action) + " failed:</strong> " + esc(e.message), "error");
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
  }, "create_payment", "create_payment", [$("fBuyer").value, $("fSeller").value, $("fRail").value, $("fCriteria").value, $("fProof").value, Math.round(parseFloat($("fAmount").value || "0") * 1000000), 86400]); });
  bind("btnDelivery", function () { apiWrite("/payments/" + $("aPid").value + "/delivery", { actor_address: $("fSeller").value || "0x99bF44395CaC814E671ADFF8b69d968Fac4e5Db3", delivery_url: $("aUrl").value, note: "done" }, "submit_delivery", "submit_delivery", [$("fSeller").value, $("aPid").value, $("aUrl").value, "done"]); });
  bind("btnDispute", function () { apiWrite("/payments/" + $("aPid").value + "/dispute", { actor_address: $("fBuyer").value || "0x0Eb9431eDdbF170d2224F4f9E47D4DD68b6c44bc", reason: "Delivery does not match criteria" }, "open_dispute", "open_dispute", [$("fBuyer").value, $("aPid").value, "Delivery does not match criteria"]); });
  bind("btnResolve", function () { apiWrite("/payments/" + $("aPid").value + "/resolve", {}, "resolve_dispute", "resolve_dispute", [$("aPid").value]); });
  bind("btnPropose", function () { apiWrite("/payments/" + $("aPid").value + "/propose", { actor_address: $("fBuyer").value, outcome: "release" }, "propose_outcome", "propose_outcome", [$("fBuyer").value, $("aPid").value, "release"]); });
  bind("btnAccept", function () { apiWrite("/payments/" + $("aPid").value + "/accept", { actor_address: $("fBuyer").value }, "accept", "accept", [$("fBuyer").value, $("aPid").value]); });
  bind("btnRefresh", function () { if (window.loadPayments) window.loadPayments(); else toast("Dashboard data module not loaded yet.", "error"); });

  document.addEventListener("DOMContentLoaded", function () {
    var f = document.getElementById("fFilter");
    if (f) f.addEventListener("change", function () { if (window.loadPayments) window.loadPayments(); });
  });
})();
