// Undo402 frontend — live StudioNet reads via genlayer-js (dynamic import)

const CONTRACT = (window.UNDO402 && window.UNDO402.GENLAYER_CONTRACT) || "0x2Fa0B3d119FC8F6D54Ec643C8332c1fc22673fb7";
const EXPLORER = "https://explorer-studio.genlayer.com";
const RELAY = "0x99bF44395CaC814E671ADFF8b69d968Fac4e5Db3";

const $ = (id) => document.getElementById(id);
const paymentsEl = $("payments");
let client = null;
let account = null;

function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.innerHTML = msg;
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), 9000);
}
function txLink(hash) {
  return hash ? `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noreferrer">tx ${hash.slice(0, 10)}… ↗</a>` : "";
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  if (label) btn.dataset.orig = btn.textContent, btn.textContent = busy ? label : btn.dataset.orig;
}

// Router lives in router.js (plain script, no imports) so navigation
// works even if the chain module below fails to load.

// Wallet connect lives in wallet.js (plain script) so the button works
// even if the chain module below fails to load.

// Live reads — dynamic import so a CDN failure shows a clear error
// instead of silently killing the whole module.
let genlayer = null;
async function ensureClient() {
  if (!genlayer) {
    try {
      genlayer = await Promise.race([
        Promise.all([import("genlayer-js"), import("genlayer-js/chains")]).then(([g, c]) => ({ createClient: g.createClient, studionet: c.studionet })),
        new Promise((_, rej) => setTimeout(() => rej(new Error("CDN timeout — genlayer-js failed to load from esm.sh")), 15000)),
      ]);
    } catch (e) {
      throw new Error("Chain module failed to load (" + e.message + "). Check connection / ad-blocker, then refresh.");
    }
  }
  if (!client) client = genlayer.createClient({ chain: genlayer.studionet });
  const ca = $("contractAddr"); if (ca) ca.textContent = CONTRACT;
  const ra = $("relayAddr"); if (ra) ra.textContent = RELAY;
  return client;
}

async function read(fn, args = []) {
  const c = await ensureClient();
  return c.readContract({ address: CONTRACT, functionName: fn, args });
}

async function loadPayments() {
  paymentsEl.innerHTML = `<p class="muted">Loading from StudioNet…</p>`;
  try {
    const [rawPayments, count, cases] = await Promise.all([
      read("get_payments"),
      read("get_payment_count"),
      read("get_case_count"),
    ]);
    // genlayer-js may decode DynArray as array OR object with numeric keys
    const payments = Array.isArray(rawPayments) ? rawPayments : Object.values(rawPayments || {});
    const sp = $("statPayments"); if (sp) sp.textContent = String(count);
    const sc = $("statCases"); if (sc) sc.textContent = String(cases);
    // Verdict distribution chart
    const dist = { refund: 0, release: 0, partial: 0, undetermined: 0, pending: 0 };
    payments.forEach((p) => { dist[p.verdict || "pending"] = (dist[p.verdict || "pending"] || 0) + 1; });
    const max = Math.max(1, ...Object.values(dist));
    const colors = { refund: "#e4572e", release: "#0a7d5c", partial: "#d9a441", undetermined: "#9aa3ad", pending: "#ddd6c7" };
    $("verdictChart").innerHTML = Object.entries(dist).map(([k, v]) =>
      `<div class="bar" style="height:${Math.round((v / max) * 70)}px;background:${colors[k] || "#ddd6c7"}"><span>${v}</span></div>`).join("");
    const labels = document.getElementById("verdictLabels");
    if (labels) labels.innerHTML = Object.keys(dist).map((k) => `<span>${k}</span>`).join("");
    const filter = $("fFilter")?.value || "";
    const shown = filter ? payments.filter((p) => p.state === filter) : payments;
    // Populate Payment ID dropdown — only payments where the connected
    // wallet is buyer OR seller. Unrelated payments never appear.
    const dd = $("aPid");
    if (dd && dd.tagName === "SELECT") {
      const cur = dd.value;
      const wallet = window.__walletAddr ? String(window.__walletAddr).toLowerCase() : "";
      const mine = wallet ? payments.filter((p) => String(p.seller || "").toLowerCase() === wallet || String(p.buyer || "").toLowerCase() === wallet) : payments;
      dd.innerHTML = `<option value="">— choose a payment${wallet ? ` (${mine.length} yours)` : ` (${payments.length} total)`} —</option>` + mine.map((p) => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(p.state)} · ${(Number(p.amount_usdc) / 1e6).toFixed(2)} USDC</option>`).join("");
      if (!mine.length && wallet) dd.innerHTML += `<option disabled>No payments for this wallet yet</option>`;
      if (cur && mine.some((p) => p.id === cur)) dd.value = cur;
      dd.dispatchEvent(new Event("input"));
    }
    if (!shown?.length) { paymentsEl.innerHTML = `<div class="empty-state"><strong>No payments ${filter ? "match this filter" : "yet"}</strong>${filter ? "Try another status above." : "Create your first payment — Step 1 above takes 2 minutes."}</div>`; return; }
    const PLAIN = {
      FUNDED: "💰 Waiting for delivery — USDC locked in escrow",
      DELIVERED: "📦 Delivered — buyer is checking",
      DISPUTED: "⚖ In dispute — AI jury is deciding",
      RELEASED: "✅ Seller paid — delivery accepted",
      REFUNDED: "↩ Buyer refunded — delivery failed",
      PARTIAL: "◐ Split — both sides got part of the money",
    };
    const cards = shown.map((p) => {
      const verdict = p.verdict ? `<span class="pill pill-${esc(p.verdict)}">${esc(p.verdict)}</span>` : `<span class="muted">no verdict yet</span>`;
      const usdc = (Number(p.amount_usdc) / 1e6).toFixed(2);
      return `<div class="card" style="margin:.7rem 0">
        <div class="card-head" style="margin:0">
          <div><code>${esc(p.id)}</code> <strong>${usdc} USDC</strong> <span class="muted">via ${esc(p.rail)}</span></div>
          ${verdict}
        </div>
        <p style="margin:.5rem 0">Status: <strong>${esc(p.state)}</strong> — ${PLAIN[p.state] || ""}</p>
        <button class="btn btn-ghost" data-view="${esc(p.id)}">See what happened →</button>
      </div>`;
    }).join("");
    paymentsEl.innerHTML = cards;
    paymentsEl.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
      $("aPid").value = b.dataset.view;
      $("aPid").dispatchEvent(new Event("input"));
      showPayment(b.dataset.view);
      $("verdictCard").scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  } catch (e) {
    paymentsEl.innerHTML = `<div class="empty-state"><strong>Could not load payments</strong>${esc(e.message)}<br><button class="btn btn-primary" onclick="window.loadPayments()">Retry</button></div>`;
    toast(`<strong>Load failed:</strong> ${esc(e.message)}`, "error");
  }
}

async function showPayment(id) {
  try {
    let p = await read("get_payment", [id]);
    if (Array.isArray(p)) p = p[0];
    $("verdictCard").hidden = false;
    const PLAIN_VERDICT = {
      refund: "💸 Buyer got their money back — the delivery didn't meet the agreed criteria.",
      release: "✅ Seller got paid — the delivery met the criteria.",
      partial: "◐ Money split — delivery was partly good, partly not.",
      undetermined: "🤔 Jury couldn't decide yet — retry for free, your money is safe.",
    };
    $("verdictBody").innerHTML = `
      <p><span class="pill pill-${esc(p.verdict || "undetermined")}">${esc(p.verdict || "pending")}</span>
      <code>${esc(p.id)}</code> · ${esc(p.state)} · ${(Number(p.amount_usdc) / 1e6).toFixed(2)} USDC · via ${esc(p.rail)}</p>
      <p style="font-size:1.05rem"><strong>${PLAIN_VERDICT[p.verdict] || "⏳ Waiting for a verdict — follow steps 2–4 to move this payment forward."}</strong></p>
      <p><strong>Why?</strong> ${esc(p.verdict_reason || "—")}</p>
      <p><strong>Proof this verdict is real (attestation):</strong> <code>${esc(p.attestation_digest || "—")}</code></p>
      <p><strong>Delivery:</strong> <a href="${esc(p.delivery_url)}" target="_blank" rel="noreferrer">${esc(p.delivery_url || "—")}</a></p>
      <div class="detail">
        <strong>The details</strong><br>
        Buyer <code>${esc(p.buyer)}</code> · Seller <code>${esc(p.seller)}</code><br>
        Agreed criteria: ${esc(p.criteria)}<br>
        Your payment proof: <code>${esc(p.payment_proof)}</code><br>
        AI confidence: ${esc(p.verdict_score)}/100 · Refund share: ${esc(p.refund_percent)}%<br>
        ${p.human_verdict ? "Human override: <strong>" + esc(p.human_verdict) + "</strong> — " + esc(p.human_reason) + "<br>" : ""}
        <a href="https://explorer-studio.genlayer.com/address/${CONTRACT}" target="_blank" rel="noreferrer">View contract ↗</a>
        · <a href="https://sepolia.basescan.org/address/0x2aa335805722FfeEa8b8eE96B9e8bb2a4B20Fde8" target="_blank" rel="noreferrer">Base escrow ↗</a>
      </div>`;
  } catch (e) {
    toast(`<strong>Read failed:</strong> ${esc(e.message)}`, "error");
  }
}

// Writes live in actions.js (plain script) so buttons work even if this
// chain module fails to load. This module only does live reads.
window.loadPayments = loadPayments;
