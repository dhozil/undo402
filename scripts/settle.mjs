// scripts/settle.mjs — THE idempotent GenLayer -> Base settlement path.
//
// Steward requirement:
//   "Read a finalized GenLayer case, verify its payment ID, verdict,
//    attestation and partial-refund binding, then invoke the matching Base
//    escrow settlement exactly once; the Base path must reject arbitrary or
//    empty attestations that are not bound to that case."
//
// v6 addition (steward rejection fix): Base settlement requires an attestor
// ECDSA signature proving the case was finalized on GenLayer. The SHA-256
// attestation digest binds the case parameters, and the attestor signature
// proves that binding corresponds to a GenLayer-finalized outcome (a party
// cannot self-attest a chosen verdict by computing the public hash alone).
// The transaction may still be submitted from the attestor/authorized wallet;
// the signature is the on-chain proof of finalization and the FUNDED ->
// terminal status transition is the exactly-once lock.
//
// Usage:
//   node scripts/settle.mjs --payment pay-1
//   node scripts/settle.mjs --payment pay-3 --check          # verify only
//   node scripts/settle.mjs --payment pay-3 --print-proof    # verify + output attestor proof (no Base tx)
//   node scripts/settle.mjs --all --json                     # every ready case
//
// Env:
//   UNDO402_CONTRACT_ADDRESS  GenLayer Undo402 address (default below)
//   ESCROW                    Base escrow address (default below)
//   GENLAYER_RPC_URL          default https://studio.genlayer.com/api
//   BASE_RPC_URL              default https://sepolia.base.org
//   WALLET_DIR                folder with seller.json (demo payer)
//   GENLAYER_PRIVATE_KEY      alternative to WALLET_DIR (must be attestor to settle)
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  getAddress,
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  encodeAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import { getClient, getPayment, getPayments } from "../api/relay.mjs";
import { sellerWallet } from "./wallet.mjs";

const GENLAYER_CONTRACT =
  process.env.UNDO402_CONTRACT_ADDRESS || "0xaee085b0f4921953dD3474a15467D73E3E90F2AD";
const ESCROW =
  process.env.ESCROW || process.env.ESCROW_CONTRACT || "0x85bC06C938532EF89388A401637bE1B8F7ac9037";
const CHAIN = (process.env.BASE_CHAIN || "base-sepolia").toLowerCase() === "base" ? base : baseSepolia;
const BASE_RPC = process.env.BASE_RPC_URL || (CHAIN.id === base.id ? "https://mainnet.base.org" : "https://sepolia.base.org");

const TERMINAL = {
  RELEASED: "release",
  REFUNDED: "refund",
  PARTIAL: "partial",
};
const STATUS = { NONE: 0, FUNDED: 1, RELEASED: 2, REFUNDED: 3, PARTIAL: 4 };
const STATUS_NAME = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [v, k]));

const escrowAbi = parseAbi([
  "function getEscrow(string paymentId) view returns ((address buyer, address seller, uint256 amount, uint8 status, string paymentId, string attestation, uint256 deadline))",
  "function release(string paymentId, uint256 score, string attestation, bytes proof)",
  "function refund(string paymentId, uint256 score, string attestation, bytes proof)",
  "function releasePartial(string paymentId, uint256 sellerPercent, uint256 score, string attestation, bytes proof)",
  "function relay() view returns (address)",
  "function owner() view returns (address)",
  "function attestor() view returns (address)",
  "function settlementHash(string paymentId, string decision, uint256 score, uint256 refundPercent, address buyer, address seller, bytes32 attestationDigest) view returns (bytes32)",
  "function expectedAttestation(string paymentId, string decision, uint256 score, uint256 refundPercent) view returns (bytes32)",
]);

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const flag = (name) => args.includes(name);
const jsonOut = flag("--json");
const checkOnly = flag("--check");
const wantAll = flag("--all");
const only = opt("--payment") || opt("--payment-id");

class SettlementError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

function log(...parts) {
  if (!jsonOut) console.error(...parts);
}

/**
 * Byte-for-byte reproduction of Undo402._attest().
 * GenLayer uses Address.as_hex -> EIP-55 checksummed mixed-case address.
 */
export function attestationDigest({ paymentId, verdict, score, refundPercent, buyer, seller }) {
  const payload =
    `undo402:${paymentId}|${verdict}|${score}|${refundPercent}|` +
    `${getAddress(buyer)}|${getAddress(seller)}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function sameAddr(a, b) {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

function requireHex64(name, value) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new SettlementError("BAD_ATTESTATION", `${name} is missing or not 64 hex chars`);
  }
  return value.toLowerCase();
}

/**
 * Verify a finalized GenLayer case and its Base escrow binding.
 * Pure verification: never sends a transaction.
 */
export async function verifyCase(payment, escrow) {
  const id = String(payment?.id || "");
  if (!id) throw new SettlementError("BAD_CASE", "GenLayer case has no payment id");

  const expectedVerdict = TERMINAL[payment.state];
  if (!expectedVerdict) {
    throw new SettlementError(
      "NOT_FINAL",
      `Case ${id} is ${payment.state || "UNKNOWN"}, not settled on GenLayer yet`
    );
  }
  if (payment.verdict !== expectedVerdict) {
    throw new SettlementError(
      "VERDICT_MISMATCH",
      `Case ${id} state ${payment.state} does not match verdict "${payment.verdict}"`
    );
  }
  if (expectedVerdict === "partial") {
    const refund = Number(payment.refund_percent);
    if (!Number.isInteger(refund) || refund < 1 || refund > 99) {
      throw new SettlementError("BAD_PARTIAL", `Case ${id} partial refund_percent must be 1..99, got ${payment.refund_percent}`);
    }
  }

  const attestation = requireHex64("attestation_digest", payment.attestation_digest);
  const score = BigInt(payment.verdict_score ?? 0);
  const refundPercent = expectedVerdict === "refund" ? 100n : expectedVerdict === "release" ? 0n : BigInt(payment.refund_percent);
  const digest = attestationDigest({
    paymentId: id,
    verdict: expectedVerdict,
    score,
    refundPercent,
    buyer: payment.buyer,
    seller: payment.seller,
  });
  if (digest !== attestation) {
    throw new SettlementError(
      "ATTESTATION_NOT_BOUND",
      `attestation_digest does not commit to case ${id} (verdict/score/split/parties)`,
      { expected: digest, onchain: attestation }
    );
  }

  if (!escrow || !escrow.paymentId) {
    throw new SettlementError("NO_ESCROW", `No Base escrow found for ${id}`);
  }
  if (escrow.paymentId !== id) {
    throw new SettlementError("ID_MISMATCH", `Escrow paymentId ${escrow.paymentId} != case ${id}`);
  }
  if (!sameAddr(escrow.buyer, payment.buyer)) {
    throw new SettlementError("BUYER_MISMATCH", "Escrow buyer does not match GenLayer buyer");
  }
  if (!sameAddr(escrow.seller, payment.seller)) {
    throw new SettlementError("SELLER_MISMATCH", "Escrow seller does not match GenLayer seller");
  }
  if (BigInt(escrow.amount) !== BigInt(payment.amount_usdc)) {
    throw new SettlementError(
      "AMOUNT_MISMATCH",
      `Escrow amount ${escrow.amount} != GenLayer amount ${payment.amount_usdc}`
    );
  }

  const status = Number(escrow.status);
  const sellerPercent = expectedVerdict === "partial" ? 100n - refundPercent : expectedVerdict === "release" ? 100n : 0n;
  const targetStatus = expectedVerdict === "release" ? STATUS.RELEASED : expectedVerdict === "refund" ? STATUS.REFUNDED : STATUS.PARTIAL;

  if (status === targetStatus) {
    if (String(escrow.attestation).toLowerCase() !== attestation) {
      throw new SettlementError(
        "CONFLICTING_SETTLEMENT",
        `Escrow ${id} already settled with a different attestation`,
        { onchain: escrow.attestation, expected: attestation }
      );
    }
    return { id, verdict: expectedVerdict, attestation, score: score.toString(), sellerPercent: sellerPercent.toString(), refundPercent: refundPercent.toString(), status, alreadySettled: true };
  }
  if (status !== STATUS.FUNDED) {
    throw new SettlementError(
      "STATUS_CONFLICT",
      `Escrow ${id} is ${STATUS_NAME[status] || status}, expected FUNDED or ${STATUS_NAME[targetStatus]}`
    );
  }
  return { id, verdict: expectedVerdict, attestation, score: score.toString(), sellerPercent: sellerPercent.toString(), refundPercent: refundPercent.toString(), status, alreadySettled: false };
}

function settlementHashLocal(chainId, escrowAddress, verified, buyer, seller) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
      ],
      [
        BigInt(chainId),
        getAddress(escrowAddress),
        keccak256(new TextEncoder().encode(verified.id)),
        keccak256(new TextEncoder().encode(verified.verdict)),
        BigInt(verified.score),
        BigInt(verified.refundPercent),
        getAddress(buyer),
        getAddress(seller),
        ("0x" + verified.attestation),
      ]
    )
  );
}

async function sendSettlement(wallet, pub, verified, proof) {
  const fn =
    verified.verdict === "release"
      ? "release"
      : verified.verdict === "refund"
        ? "refund"
        : "releasePartial";
  const callArgs =
    verified.verdict === "partial"
      ? [verified.id, BigInt(verified.sellerPercent), BigInt(verified.score), verified.attestation, proof]
      : [verified.id, BigInt(verified.score), verified.attestation, proof];

  log(`→ ${fn}(${verified.id}, ..., proof ${String(proof).slice(0, 10)}…)`);
  const hash = await wallet.writeContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: fn,
    args: callArgs,
  });
  log(`  Base tx ${hash} — waiting for receipt…`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new SettlementError("REVERTED", `${fn} reverted on Base (tx ${hash})`, { txHash: hash });
  }
  return hash;
}

async function settleOne(gl, pub, wallet, id, relayAddress, ownerAddress, attestorAddress) {
  log(`\n=== ${id} ===`);
  const payment = await getPayment(gl, id);
  const escrow = await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getEscrow", args: [id] });
  // Cross-check the digest with the escrow's own canonical implementation.
  const verified = await verifyCase(payment, escrow);

  const onchainExpected = await pub.readContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "expectedAttestation",
    args: [verified.id, verified.verdict, BigInt(verified.score), BigInt(verified.refundPercent)],
  });
  if (String(onchainExpected).toLowerCase().replace(/^0x/, "") !== verified.attestation) {
    throw new SettlementError("BASE_DIGEST_MISMATCH", "Escrow contract derives a different digest for this case");
  }

  log(`  verdict=${verified.verdict} score=${verified.score} sellerPercent=${verified.sellerPercent} digest=${verified.attestation}`);
  if (verified.alreadySettled) {
    log(`  already settled on Base (status ${STATUS_NAME[verified.status]}), no transaction sent`);
    return { ok: true, paymentId: id, ...verified, sent: false, txHash: null };
  }
  if (checkOnly) {
    log("  --check: binding verified, settlement skipped");
    return { ok: true, paymentId: id, ...verified, sent: false, txHash: null, checkedOnly: true };
  }

  const signer = wallet.account.address;
  if (!sameAddr(signer, attestorAddress)) {
    throw new SettlementError(
      "NOT_ATTESTOR",
      `Signer ${signer} is not the escrow attestor ${attestorAddress}. Settlement requires the attestor key to produce proof of GenLayer finalization.`
    );
  }

  const hash = settlementHashLocal(CHAIN.id, ESCROW, verified, escrow.buyer, escrow.seller);
  const proof = await wallet.account.signMessage({ message: { raw: hash } });
  log(`  finalization proof signed by attestor ${signer}`);
  if (printProof) {
    log(`  proof: ${proof}`);
    console.log(proof);
    return { ok: true, paymentId: id, ...verified, sent: false, txHash: null, proof, proofOnly: true };
  }

  let txHash;
  try {
    txHash = await sendSettlement(wallet, pub, verified, proof);
  } catch (err) {
    // Lost race / duplicate worker: the on-chain result wins. Re-read and only
    // accept it if it is the same settlement for this case.
    const after = await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getEscrow", args: [id] });
    const target =
      verified.verdict === "release" ? STATUS.RELEASED : verified.verdict === "refund" ? STATUS.REFUNDED : STATUS.PARTIAL;
    if (Number(after.status) === target && String(after.attestation).toLowerCase() === verified.attestation) {
      log("  duplicate settlement detected — on-chain result already correct, not resending");
      return { ok: true, paymentId: id, ...verified, status: Number(after.status), sent: false, txHash: null, raceLost: true };
    }
    throw err;
  }

  const after = await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getEscrow", args: [id] });
  if (String(after.attestation).toLowerCase() !== verified.attestation) {
    throw new SettlementError("POSTCHECK_FAILED", "Settled escrow does not store the verified attestation");
  }
  log(`  settled: status ${STATUS_NAME[Number(after.status)]} tx ${txHash}`);
  return { ok: true, paymentId: id, ...verified, status: Number(after.status), sent: true, txHash };
}

async function main() {
  if (!only && !wantAll) {
    throw new SettlementError("USAGE", "Pass --payment <id> or --all");
  }
  const key = process.env.GENLAYER_PRIVATE_KEY || sellerWallet().privateKey;
  process.env.GENLAYER_PRIVATE_KEY = key;
  process.env.UNDO402_CONTRACT_ADDRESS = GENLAYER_CONTRACT;
  if (!process.env.GENLAYER_RPC_URL) process.env.GENLAYER_RPC_URL = "https://studio.genlayer.com/api";
  const gl = getClient();
  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain: CHAIN, transport: http(BASE_RPC) });
  const wallet = createWalletClient({ chain: CHAIN, transport: http(BASE_RPC), account });

  const [relayAddress, ownerAddress, attestorAddress] = await Promise.all([
    pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "relay" }),
    pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "owner" }),
    pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "attestor" }),
  ]);
  log(`GenLayer ${GENLAYER_CONTRACT} · Base escrow ${ESCROW} (chain ${CHAIN.id}) · signer ${account.address} · attestor ${attestorAddress}`);

  let ids;
  if (wantAll) {
    const raw = await getPayments(gl);
    const payments = Array.isArray(raw) ? raw : Object.values(raw || {});
    ids = payments.filter((p) => TERMINAL[p.state]).map((p) => p.id);
  } else {
    ids = [only];
  }

  const results = [];
  for (const id of ids) {
    try {
      results.push(await settleOne(gl, pub, wallet, id, relayAddress, ownerAddress, attestorAddress));
    } catch (err) {
      if (err instanceof SettlementError && ["NOT_FINAL", "NO_ESCROW"].includes(err.code) && wantAll) {
        log(`  skip ${id}: ${err.message}`);
        results.push({ ok: true, paymentId: id, skipped: true, reason: err.code });
        continue;
      }
      throw err;
    }
  }

  const payload = {
    ok: true,
    idempotencyKey: `base:${CHAIN.id}:${ESCROW}:${only || "all"}`,
    genlayer: GENLAYER_CONTRACT,
    escrow: ESCROW,
    chainId: CHAIN.id,
    results,
  };
  if (jsonOut) console.log(JSON.stringify(payload, null, 2));
  else log(`\nDone: ${results.filter((r) => r.sent).length} sent, ${results.filter((r) => r.alreadySettled || r.raceLost).length} already settled, ${results.filter((r) => r.skipped).length} skipped`);
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const out = { ok: false, code: err.code || "ERROR", error: err.message, ...(err.detail || {}) };
    if (jsonOut) console.log(JSON.stringify(out, null, 2));
    console.error(`${out.code}: ${out.error}`);
    process.exit(1);
  });
}
