// Undo402 relay client — live StudioNet calls via genlayer-js.
// Pattern: Nexa src/genlayer.mjs (submit -> wait FINALIZED -> handle UNDETERMINED).
// Usage: set UNDO402_CONTRACT_ADDRESS, GENLAYER_PRIVATE_KEY, GENLAYER_RPC_URL.
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import { privateKeyToAccount } from "viem/accounts";

export function getClient() {
  const key = process.env.GENLAYER_PRIVATE_KEY;
  if (!key) throw new Error("GENLAYER_PRIVATE_KEY not set");
  const rpc = process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
  return createClient({
    chain: Object.assign({}, studionet, { rpcUrls: { default: { http: [rpc] } } }),
    account: privateKeyToAccount(key),
  });
}

const CONTRACT = () => process.env.UNDO402_CONTRACT_ADDRESS;

export async function write(client, functionName, args, value = 0n) {
  const hash = await client.writeContract({ address: CONTRACT(), functionName, args, value });
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries: 100,
    interval: 5000,
    fullTransaction: true,
  });
  if (receipt?.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    throw new Error(`Contract execution failed: ${hash}`);
  }
  const consensus = receipt?.consensus_data?.final?.consensus_result
    || receipt?.consensus_data?.consensus_result
    || receipt?.consensus_result;
  if (consensus && String(consensus).toLowerCase() === "undetermined") {
    const e = new Error("AI consensus UNDETERMINED — no settlement, safe to retry");
    e.code = "CONSENSUS_UNDETERMINED";
    e.txHash = hash;
    throw e;
  }
  return { hash, receipt };
}

export async function read(client, functionName, args) {
  return client.readContract({ address: CONTRACT(), functionName, args });
}

export const createPayment = (c, actor, seller, rail, criteria, proof, ttl, amountUsdc) =>
  write(c, "create_payment", [actor, seller, rail, criteria, proof, BigInt(amountUsdc), BigInt(ttl)]);

export const submitDelivery = (c, actor, id, url, note) => write(c, "submit_delivery", [actor, id, url, note]);
export const accept = (c, actor, id) => write(c, "accept", [actor, id]);
export const claimTimeout = (c, actor, id) => write(c, "claim_timeout", [actor, id]);
export const openDispute = (c, actor, id, reason) => write(c, "open_dispute", [actor, id, reason]);
export const counterEvidence = (c, actor, id, url) => write(c, "submit_counter_evidence", [actor, id, url]);
export const proposeOutcome = (c, actor, id, outcome) => write(c, "propose_outcome", [actor, id, outcome]);
export const resolveDispute = (c, id) => write(c, "resolve_dispute", [id]);
export const humanResolve = (c, id, decision) => write(c, "human_resolve", [id, decision]);

export const getPayment = (c, id) => read(c, "get_payment", [id]);
export const getPayments = (c) => read(c, "get_payments", []);
export const getRelay = (c) => read(c, "get_relay_address", []);
