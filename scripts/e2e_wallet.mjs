// E2E v6 (stablecoin-based): GenLayer adjudicates, USDC moves on Base escrow.
// Usage: WALLET_DIR=/path/to/wallet UNDO402_CONTRACT_ADDRESS=0x... node scripts/e2e_wallet.mjs
import { sellerWallet, buyerWallet } from "./wallet.mjs";
import { getClient, createPayment, submitDelivery, openDispute, resolveDispute, getPayment } from "../api/relay.mjs";

const seller = sellerWallet();
const recipient = buyerWallet();

process.env.GENLAYER_PRIVATE_KEY = seller.privateKey;
process.env.GENLAYER_RPC_URL = process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";

const client = getClient();
const BUYER = recipient.address;
const SELLER = seller.address;
const PROOF = "0x" + "b".repeat(64);
const CRITERIA = "Delivery URL must contain a valid JSON API response with a user field.";
const AMOUNT_USDC = 1_000_000; // 1 USDC, 6 decimals

console.log("Relay/seller:", SELLER);
console.log("Buyer:", BUYER);
console.log("1. create_payment (1 USDC recorded, Base escrow is source of truth)...");
const created = await createPayment(client, BUYER, SELLER, "x402", CRITERIA, PROOF, 86400, AMOUNT_USDC);
console.log("   tx:", created.hash);
const pid = "pay-1";
console.log("2. get_payment:", JSON.stringify(await getPayment(client, pid)));
console.log("3. submit_delivery...");
await submitDelivery(client, SELLER, pid, "https://example.com/", "done");
console.log("4. open_dispute...");
await openDispute(client, BUYER, pid, "Delivery does not match criteria");
console.log("5. resolve_dispute (AI jury)...");
try { await resolveDispute(client, pid); } catch (e) { console.log("   resolve:", e.code || e.message); }
console.log("6. final:", JSON.stringify(await getPayment(client, pid)));
console.log("Note: USDC release/refund now executes on Base escrow via relay (see contracts/base/Undo402Escrow.sol).");
console.log("E2E done.");
