// Dashboard actions — plain script, no imports. Works even if chain module fails.
// Strategy: try relay API first (fast, demo), fall back to direct wallet
// signing via genlayer-js (works on Vercel for any visitor, no backend).
(function () {
  var API = (window.UNDO402 && window.UNDO402.API_URL) || "http://localhost:8000";
  var CONTRACT = (window.UNDO402 && window.UNDO402.GENLAYER_CONTRACT) || "0x9022290256C9b4B243fD4519b9857c83e45fFb5a";
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
  // Sacramentum pattern: account = address string, provider = injected wallet separately.
  async function directWrite(fn, args, action) {
    if (!window.ethereum) throw new Error("Connect MetaMask first (button top-right), then retry.");
    const { createClient } = await import("genlayer-js");
    const { studionet } = await import("genlayer-js/chains");
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = accounts[0];
    if (!address) throw new Error("No account shared by wallet.");
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xf22f" }] });
    } catch (e) {
      if (e.code === 4902 || e.code === -32603) {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
          chainId: "0xf22f", chainName: "Genlayer Studio Network",
          nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
          rpcUrls: ["https://studio.genlayer.com/api"], blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
        }] });
      }
    }
    const client = createClient({ chain: studionet, account: address, provider: window.ethereum });
    const hash = await client.writeContract({ address: CONTRACT, functionName: fn, args });
    try {
      const { TransactionStatus } = await import("genlayer-js/types");
      await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, retries: 100, interval: 5000, fullTransaction: true });
    } catch (e) {
      const err = new Error(e.message + " — tx: " + hash + " — see explorer: https://explorer-studio.genlayer.com/tx/" + hash);
      err.txHash = hash;
      throw err;
    }
    return hash;
  }

  function isAddress(v) { return /^0x[0-9a-fA-F]{40}$/.test(String(v || "").trim()); }
  function validate(body) {
    var errors = [];
    var addrFields = Object.keys(body).filter(function (k) { return k.includes("address") || k === "seller"; });
    addrFields.forEach(function (k) {
      var v = body[k];
      if (v && !isAddress(v)) errors.push(k + " must be a valid 0x address (40 hex chars)");
    });
    if (body.seller && body.actor_address && isAddress(body.seller) && isAddress(body.actor_address) && body.seller.toLowerCase() === body.actor_address.toLowerCase())
      errors.push("buyer and seller cannot be the same wallet");
    if (body.rail && ["x402", "chain"].includes(body.rail) && body.payment_proof && !/^0x[0-9a-fA-F]{64}$/.test(body.payment_proof.trim()))
      errors.push("payment_proof for x402/chain must be 0x + 64 hex (Base tx hash)");
    if (body.rail === "card" && body.payment_proof && !(body.payment_proof.startsWith("pi_") || body.payment_proof.startsWith("card:")))
      errors.push("payment_proof for card must start with pi_ or card:");
    if (body.amount_usdc !== undefined && !(Number(body.amount_usdc) > 0))
      errors.push("amount must be greater than 0");
    if (body.criteria && String(body.criteria).trim().length < 10)
      errors.push("criteria too short — describe what good delivery means (min 10 chars)");
    if (body.delivery_url && !String(body.delivery_url).startsWith("https://"))
      errors.push("delivery_url must start with https://");
    return errors;
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) { btn.dataset.orig = btn.textContent; btn.disabled = true; btn.textContent = label || "⏳ Processing…"; }
    else { btn.disabled = false; btn.textContent = btn.dataset.orig || btn.textContent; }
  }

  async function apiWrite(path, body, action, directFn, directArgs, btn) {
    var errors = validate(body);
    if (errors.length) {
      toast("<strong>Please fix:</strong><br>• " + errors.map(esc).join("<br>• "), "error");
      return;
    }
    if (btn) setBusy(btn, true, "⏳ " + action + "… check MetaMask");
    toast("<strong>" + esc(action) + " submitting…</strong> (direct wallet, StudioNet)");
    try {
      var hash = await directWrite(directFn, directArgs, action);
      toast("<strong>" + esc(action) + " success.</strong><br><a href=\"https://explorer-studio.genlayer.com/tx/" + esc(hash) + "\" target=\"_blank\" rel=\"noreferrer\">tx " + esc(hash.slice(0, 10)) + "… ↗</a><br><span class=\"muted\">✅ FINALIZED on StudioNet — state change confirmed.</span>", "success");
      if (window.loadPayments) window.loadPayments();
    } catch (e) {
      var txMatch = String(e.message).match(/0x[a-fA-F0-9]{64}/);
      var txLink = txMatch ? '<br><a href="https://explorer-studio.genlayer.com/tx/' + txMatch[0] + '" target="_blank" rel="noreferrer">View failed tx ↗</a>' : "";
      toast("<strong>" + esc(action) + " failed:</strong> " + esc(e.message) + txLink + '<br><span class="muted">Connect MetaMask (top-right) and ensure StudioNet network is added.</span>', "error");
    } finally {
      if (btn) setBusy(btn, false);
    }
  }

  function bind(id, fn) {
    document.addEventListener("DOMContentLoaded", function () {
      var el = document.getElementById(id);
      if (el) el.addEventListener("click", function () { fn(el); });
    });
  }

  bind("btnCreate", function (btn) {
    var pid = ($("ePid") && $("ePid").value || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(pid)) {
      toast("<strong>Payment ID invalid.</strong> Use 1-64 chars: letters, numbers, dot, underscore, colon, dash. It must match your Base escrow ID (Step 1).", "error");
      return;
    }
    var amount = Math.round(parseFloat($("fAmount").value || "0") * 1000000);
    apiWrite("/payments", {
      payment_id: pid, actor_address: $("fBuyer").value, seller: $("fSeller").value, rail: $("fRail").value,
      criteria: $("fCriteria").value, payment_proof: $("fProof").value,
      amount_usdc: amount, ttl_seconds: 86400, evidence_urls: "",
    }, "create_payment", "create_payment_with_id", [$("fBuyer").value, pid, $("fSeller").value, $("fRail").value, $("fCriteria").value, $("fProof").value, amount, 86400, ""], btn);
  });
  bind("btnDelivery", function (btn) {
    var pid = $("aPid").value;
    var sellerAddr = $("fSeller").value || "0x99bF44395CaC814E671ADFF8b69d968Fac4e5Db3";
    if (window.__walletAddr && sellerAddr.toLowerCase() !== window.__walletAddr.toLowerCase())
      { toast("<strong>Only seller can submit delivery.</strong> Connected wallet is not the seller of this payment.", "error"); return; }
    apiWrite("/payments/" + pid + "/delivery", { actor_address: sellerAddr, delivery_url: $("aUrl").value, note: "done" }, "submit_delivery", "submit_delivery", [sellerAddr, pid, $("aUrl").value, "done"], btn);
  });
  bind("btnDispute", function (btn) { apiWrite("/payments/" + $("aPid").value + "/dispute", { actor_address: $("fBuyer").value || "0x0Eb9431eDdbF170d2224F4f9E47D4DD68b6c44bc", reason: "Delivery does not match criteria" }, "open_dispute", "open_dispute", [$("fBuyer").value, $("aPid").value, "Delivery does not match criteria"], btn); });
  bind("btnResolve", function (btn) { apiWrite("/payments/" + $("aPid").value + "/resolve", {}, "resolve_dispute", "resolve_dispute", [$("aPid").value], btn); });
  bind("btnPropose", function (btn) { apiWrite("/payments/" + $("aPid").value + "/propose", { actor_address: $("fBuyer").value, outcome: "release" }, "propose_outcome", "propose_outcome", [$("fBuyer").value, $("aPid").value, "release"], btn); });
  bind("btnAccept", function (btn) { apiWrite("/payments/" + $("aPid").value + "/accept", { actor_address: $("fBuyer").value }, "accept", "accept", [$("fBuyer").value, $("aPid").value], btn); });
  bind("btnRefresh", function () { if (window.loadPayments) window.loadPayments(); else toast("Dashboard data module not loaded yet.", "error"); });

  // Base escrow actions (viem + MetaMask on Base Sepolia)
  var ESCROW = (window.UNDO402 && window.UNDO402.ESCROW_CONTRACT) || "0x8fcD766B2f52Fa754DE24207E3cA19EcD7AF8c24";
  var USDC = (window.UNDO402 && window.UNDO402.USDC) || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  async function baseClient() {
    if (!window.ethereum) throw new Error("Connect MetaMask first.");
    const { createWalletClient, createPublicClient, http, custom } = await import("viem");
    const { baseSepolia } = await import("viem/chains");
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = accounts[0];
    if (!address) throw new Error("No account shared by wallet.");
    try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] }); } catch (e) {
      if (e.code === 4902 || e.code === -32603) {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x14a34", chainName: "Base Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://sepolia.base.org"], blockExplorerUrls: ["https://sepolia.basescan.org"] }] });
      }
    }
    const pub = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
    const wallet = createWalletClient({ chain: baseSepolia, transport: custom(window.ethereum), account: address });
    return { pub, wallet };
  }
  async function baseWrite(fn, args, label, opts) {
    var btn = null;
    try {
      toast("<strong>" + label + "…</strong> check MetaMask (Base Sepolia)");
      const { pub, wallet } = await baseClient();
      const escrowAbi = {
        approve: [{ type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" }],
        createEscrow: [{ type: "function", name: "createEscrow", inputs: [{ type: "string" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" }],
        refund: [{ type: "function", name: "refund", inputs: [{ type: "string" }, { type: "uint256" }, { type: "string" }], outputs: [], stateMutability: "nonpayable" }],
        release: [{ type: "function", name: "release", inputs: [{ type: "string" }, { type: "uint256" }, { type: "string" }], outputs: [], stateMutability: "nonpayable" }],
        releasePartial: [{ type: "function", name: "releasePartial", inputs: [{ type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "string" }], outputs: [], stateMutability: "nonpayable" }],
        claimTimeout: [{ type: "function", name: "claimTimeout", inputs: [{ type: "string" }], outputs: [], stateMutability: "nonpayable" }],
      };
      const addr = fn === "approve" ? USDC : ESCROW;
      if (opts && opts.requireRelay) {
        const rel = await pub.readContract({ address: ESCROW, abi: [{ type: "function", name: "relay", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }], functionName: "relay" });
        if (String(rel).toLowerCase() !== String(wallet.account.address).toLowerCase()) {
          throw new Error("Only the escrow relay (" + rel + ") can settle. Connect that wallet or run scripts/settle.mjs.");
        }
      }
      const h = await wallet.writeContract({ address: addr, abi: escrowAbi[fn], functionName: fn, args });
      await pub.waitForTransactionReceipt({ hash: h });
      toast("<strong>" + label + " success.</strong><br><a href=\"https://sepolia.basescan.org/tx/" + h + "\" target=\"_blank\" rel=\"noreferrer\">tx " + h.slice(0, 10) + "… ↗</a>" + (fn === "createEscrow" ? "<br><span class='muted'>Copy this tx hash into Proof field below 👇</span>" : ""), "success");
      if (fn === "createEscrow") { var p = document.getElementById("fProof"); if (p) p.value = h; }
    } catch (e) {
      toast("<strong>" + label + " failed:</strong> " + esc(e.message), "error");
    }
  }
  // Verify the finalized GenLayer case before touching Base. This mirrors
  // scripts/settle.mjs and the on-chain check in Undo402Escrow v4.
  async function genPayment(pid) {
    const { createClient } = await import("genlayer-js");
    const { studionet } = await import("genlayer-js/chains");
    const c = createClient({ chain: studionet });
    return c.readContract({ address: CONTRACT, functionName: "get_payment", args: [pid] });
  }
  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  async function baseSettle(expected) {
    var pid = ($("ePid") && $("ePid").value || "").trim();
    if (!pid) { toast("<strong>Payment ID required.</strong>", "error"); return; }
    try {
      toast("<strong>Verifying case " + esc(pid) + "…</strong> payment id, verdict, attestation and refund split");
      const p = await genPayment(pid);
      const wantState = expected === "release" ? "RELEASED" : expected === "refund" ? "REFUNDED" : "PARTIAL";
      if (p.state !== wantState || p.verdict !== expected) {
        throw new Error("Case " + pid + " is " + (p.state || "unknown") + " / " + (p.verdict || "no verdict") + ", not a finalized " + expected + " verdict.");
      }
      if (!/^[0-9a-fA-F]{64}$/.test(String(p.attestation_digest || ""))) {
        throw new Error("Case " + pid + " has an empty/invalid attestation — refusing to settle.");
      }
      const { getAddress } = await import("viem");
      const refundPercent = expected === "refund" ? 100n : expected === "release" ? 0n : BigInt(p.refund_percent);
      if (expected === "partial" && (refundPercent < 1n || refundPercent > 99n)) {
        throw new Error("Partial refund_percent must be 1..99, got " + refundPercent);
      }
      const payload = "undo402:" + p.id + "|" + expected + "|" + BigInt(p.verdict_score) + "|" + refundPercent + "|" + getAddress(p.buyer) + "|" + getAddress(p.seller);
      const digest = await sha256Hex(payload);
      if (digest !== String(p.attestation_digest).toLowerCase()) {
        throw new Error("Attestation is not bound to " + pid + " (verdict/score/split/parties mismatch).");
      }
      const args = expected === "partial"
        ? [pid, 100n - refundPercent, BigInt(p.verdict_score), digest]
        : [pid, BigInt(p.verdict_score), digest];
      await baseWrite(expected === "partial" ? "releasePartial" : expected, args, "Settle " + expected, { requireRelay: true });
    } catch (e) {
      toast("<strong>Settlement blocked:</strong> " + esc(e.message), "error");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var b1 = document.getElementById("btnApprove");
    if (b1) b1.addEventListener("click", function () {
      var amt = Math.round(parseFloat(document.getElementById("fAmount").value || "0") * 1000000);
      if (!(amt > 0)) { toast("<strong>Amount invalid:</strong> enter USDC amount above 0 first.", "error"); return; }
      baseWrite("approve", [ESCROW, BigInt(amt)], "Approve USDC");
    });
    var b2 = document.getElementById("btnEscrow");
    if (b2) b2.addEventListener("click", function () {
      var seller = document.getElementById("fSeller").value.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(seller)) { toast("<strong>Seller wallet invalid:</strong> fill it in Step 1 form first (0x + 40 hex).", "error"); return; }
      var amt = Math.round(parseFloat(document.getElementById("fAmount").value || "0") * 1000000);
      if (!(amt > 0)) { toast("<strong>Amount invalid:</strong> enter USDC amount above 0.", "error"); return; }
      baseWrite("createEscrow", [document.getElementById("ePid").value, seller, BigInt(amt), 86400n], "Create escrow");
    });
    var b3 = document.getElementById("btnEscrowStatus");    if (b3) b3.addEventListener("click", async function () {
      try {
        const { pub } = await baseClient();
        const e = await pub.readContract({ address: ESCROW, abi: [{ type: "function", name: "getEscrow", inputs: [{ type: "string" }], outputs: [{ type: "tuple", components: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "string" }, { type: "string" }, { type: "uint256" }] }], stateMutability: "view" }], functionName: "getEscrow", args: [document.getElementById("ePid").value] });
        document.getElementById("escrowOut").innerHTML = "Escrow: amount " + e[2].toString() + " µUSDC · status " + e[3] + " (0 none, 1 funded, 2 released, 3 refunded, 4 partial)" + (e[5] ? " · attestation " + esc(String(e[5]).slice(0, 12)) + "…" : " · no attestation yet");
      } catch (err) { toast("<strong>Escrow read failed:</strong> " + esc(err.message), "error"); }
    });
    var b4 = document.getElementById("btnRefund");
    if (b4) b4.addEventListener("click", function () { baseSettle("refund"); });
    var b5 = document.getElementById("btnRelease");
    if (b5) b5.addEventListener("click", function () { baseSettle("release"); });
    var b5p = document.getElementById("btnPartial");
    if (b5p) b5p.addEventListener("click", function () { baseSettle("partial"); });
    var b6 = document.getElementById("btnTimeout");
    if (b6) b6.addEventListener("click", function () { baseWrite("claimTimeout", [document.getElementById("ePid").value], "Claim timeout"); });
    var bb = document.getElementById("btnBalance");
    if (bb) bb.addEventListener("click", async function () {
      try {
        const { pub } = await baseClient();
        const accts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const bal = await pub.readContract({ address: USDC, abi: [{ type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }], functionName: "balanceOf", args: [accts[0]] });
        const eth = await pub.getBalance({ address: accts[0] });
        document.getElementById("balanceOut").textContent = (Number(bal) / 1e6).toFixed(2) + " USDC · " + (Number(eth) / 1e18).toFixed(4) + " ETH (Base Sepolia)";
      } catch (err) { toast("<strong>Balance failed:</strong> " + esc(err.message), "error"); }
    });
  });

  document.addEventListener("DOMContentLoaded", function () {
    var f = document.getElementById("fFilter");
    if (f) f.addEventListener("change", function () { if (window.loadPayments) window.loadPayments(); });
    // Step 2-4 buttons disabled until a Payment ID is entered
    var pid = document.getElementById("aPid");
    var ids = ["btnDelivery", "btnDispute", "btnResolve", "btnPropose", "btnAccept"];
    function sync() {
      var has = pid && pid.value.trim() !== "";
      ids.forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = !has; });
    }
    if (pid) { pid.addEventListener("input", sync); sync(); }
  });
})();
