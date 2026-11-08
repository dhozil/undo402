// Undo402 frontend — live StudioNet reads + relay writes via genlayer-js
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const CONTRACT = "0x6C7ea251273aC4FDF8d3C9B36F2E3089bb4c3660";
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

// Wallet (read-only demo: relay signs writes, wallet is for identity)
async function connect() {
  try {
    if (!window.ethereum) throw new Error("No injected wallet found. Install MetaMask or use the relay demo account.");
    const addr = await window.ethereum.request({ method: "eth_requestAccounts" });
    account = addr[0];
    $("connectBtn").textContent = account.slice(0, 6) + "…" + account.slice(-4);
    toast(`Wallet connected: <code>${esc(account)}</code>`, "success");
  } catch (e) {
    toast(`<strong>Connection failed:</strong> ${esc(e.message)}`, "error");
  }
}
$("connectBtn").addEventListener("click", connect);

// Live reads
async function ensureClient() {
  if (!client) client = createClient({ chain: studionet });
  $("contractAddr").textContent = CONTRACT;
  $("relayAddr").textContent = RELAY;
  return client;
}

async function read(fn, args = []) {
  const c = await ensureClient();
  return c.readContract({ address: CONTRACT, functionName: fn, args });
}

async function loadPayments() {
  paymentsEl.innerHTML = `<p class="muted">Loading from StudioNet…</p>`;
  try {
    const [payments, count, cases] = await Promise.all([
      read("get_payments").catch(() => []),
      read("get_payment_count").catch(() => "0"),
      read("get_case_count").catch(() => "0"),
    ]);
    $("statPayments").textContent = String(count);
    $("statCases").textContent = String(cases);
    // Verdict distribution chart
    const dist = { refund: 0, release: 0, partial: 0, undetermined: 0, pending: 0 };
    payments.forEach((p) => { dist[p.verdict || "pending"] = (dist[p.verdict || "pending"] || 0) + 1; });
    const max = Math.max(1, ...Object.values(dist));
    const colors = { refund: "#e4572e", release: "#0a7d5c", partial: "#d9a441", undetermined: "#9aa3ad", pending: "#ddd6c7" };
    $("verdictChart").innerHTML = Object.entries(dist).map(([k, v]) =>
      `<div class="bar" style="height:${Math.round((v / max) * 70)}px;background:${colors[k] || "#ddd6c7"}"><span>${v}</span></div>`).join("") +
      `<div class="chart-labels" style="display:none"></div>`;
    $("verdictChart").insertAdjacentHTML("afterend", `<div class="chart-labels">${Object.keys(dist).map((k) => `<span>${k}</span>`).join("")}</div>`);
    const filter = $("fFilter")?.value || "";
    const shown = filter ? payments.filter((p) => p.state === filter) : payments;
    if (!shown?.length) { paymentsEl.innerHTML = `<p class="muted">No payments match this filter.</p>`; return; }
    const rows = shown.map((p) => {
      const verdict = p.verdict ? `<span class="pill pill-${esc(p.verdict)}">${esc(p.verdict)}</span>` : `<span class="muted">—</span>`;
      return `<tr>
        <td><code>${esc(p.id)}</code></td>
        <td>${esc(p.state)}</td>
        <td>${verdict}</td>
        <td>${esc(p.amount_usdc)} <small>µUSDC</small></td>
        <td>${esc(p.rail)}</td>
        <td>${p.attestation_digest ? `<code title="${esc(p.attestation_digest)}">${esc(p.attestation_digest.slice(0, 10))}…</code>` : "—"}</td>
        <td><button class="btn btn-ghost" data-view="${esc(p.id)}">View</button></td>
      </tr>`;
    }).join("");
    paymentsEl.innerHTML = `<table><thead><tr><th>ID</th><th>State</th><th>Verdict</th><th>Amount</th><th>Rail</th><th>Attestation</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    paymentsEl.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => showPayment(b.dataset.view)));
  } catch (e) {
    paymentsEl.innerHTML = `<p class="muted">Could not load payments. Is StudioNet reachable?</p>`;
    toast(`<strong>Load failed:</strong> ${esc(e.message)}`, "error");
  }
}

async function showPayment(id) {
  try {
    const p = await read("get_payment", [id]);
    $("verdictCard").hidden = false;
    $("verdictBody").innerHTML = `
      <p><span class="pill pill-${esc(p.verdict || "undetermined")}">${esc(p.verdict || "pending")}</span>
      <code>${esc(p.id)}</code> · state <strong>${esc(p.state)}</strong> · ${esc(p.amount_usdc)} µUSDC · ${esc(p.rail)}</p>
      <p><strong>Reason:</strong> ${esc(p.verdict_reason || "—")}</p>
      <p><strong>Attestation:</strong> <code>${esc(p.attestation_digest || "—")}</code></p>
      <p><strong>Delivery:</strong> <a href="${esc(p.delivery_url)}" target="_blank" rel="noreferrer">${esc(p.delivery_url || "—")}</a></p>
      <div class="detail">
        <strong>Detail</strong><br>
        Buyer <code>${esc(p.buyer)}</code> · Seller <code>${esc(p.seller)}</code><br>
        Criteria: ${esc(p.criteria)}<br>
        Proof: <code>${esc(p.payment_proof)}</code> · Refund: ${esc(p.refund_percent)}% · Score: ${esc(p.verdict_score)}<br>
        ${p.human_verdict ? `Human override: <strong>${esc(p.human_verdict)}</strong> — ${esc(p.human_reason)}<br>` : ""}
        <a href="https://explorer-studio.genlayer.com/address/${CONTRACT}" target="_blank" rel="noreferrer">View contract ↗</a>
        · <a href="https://sepolia.basescan.org/address/0x2aa335805722FfeEa8b8eE96B9e8bb2a4B20Fde8" target="_blank" rel="noreferrer">Base escrow ↗</a>
      </div>
  } catch (e) {
    toast(`<strong>Read failed:</strong> ${esc(e.message)}`, "error");
  }
}

// Writes go through the live relay API (api/app.py -> relay.mjs -> StudioNet).
const API = "http://localhost:8000";
async function apiWrite(path, body, action) {
  const missing = Object.entries(body).filter(([, v]) => v === undefined || v === null || String(v).trim() === "");
  if (missing.length) {
    toast(`<strong>Missing fields:</strong> ${missing.map(([k]) => esc(k)).join(", ")}`, "error");
    return;
  }
  toast(`<strong>${esc(action)} submitting…</strong> (waiting for StudioNet finality)`);
  try {
    const res = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || res.statusText);
    toast(`<strong>${esc(action)} success.</strong><br>${txLink(data.tx)}<br><span class="muted">Confirmed on StudioNet.</span>`, "success");
    loadPayments();
  } catch (e) {
    toast(`<strong>${esc(action)} failed:</strong> ${esc(e.message)}<br><span class="muted">Is the API running? <code>uvicorn api.app:app --port 8000</code></span>`, "error");
  }
}

$("btnCreate").addEventListener("click", () => apiWrite("/payments", {
  actor_address: $("fBuyer").value, seller: $("fSeller").value, rail: $("fRail").value,
  criteria: $("fCriteria").value, payment_proof: $("fProof").value,
  amount_usdc: Math.round(parseFloat($("fAmount").value || "0") * 1000000), ttl_seconds: 86400,
}, "create_payment"));
$("btnDelivery").addEventListener("click", () => apiWrite(`/payments/${$("aPid").value}/delivery`, { actor_address: $("fSeller").value || "0x99bF44395CaC814E671ADFF8b69d968Fac4e5Db3", delivery_url: $("aUrl").value, note: "done" }, "submit_delivery"));
$("btnDispute").addEventListener("click", () => apiWrite(`/payments/${$("aPid").value}/dispute`, { actor_address: $("fBuyer").value || "0x0Eb9431eDdbF170d2224F4f9E47D4DD68b6c44bc", reason: "Delivery does not match criteria" }, "open_dispute"));
$("btnResolve").addEventListener("click", () => apiWrite(`/payments/${$("aPid").value}/resolve`, {}, "resolve_dispute"));
$("btnPropose").addEventListener("click", () => apiWrite(`/payments/${$("aPid").value}/propose`, { actor_address: $("fBuyer").value, outcome: "release" }, "propose_outcome"));
$("btnAccept").addEventListener("click", () => apiWrite(`/payments/${$("aPid").value}/accept`, { actor_address: $("fBuyer").value }, "accept"));
$("btnRefresh").addEventListener("click", loadPayments);
$("fFilter")?.addEventListener("change", loadPayments);
window.loadPayments = loadPayments;
