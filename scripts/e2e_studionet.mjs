// E2E live demo on StudioNet — create -> delivery -> dispute -> resolve -> claim
// Usage: GENLAYER_PRIVATE_KEY=0x... UNDO402_CONTRACT_ADDRESS=0x... node scripts/e2e_studionet.mjs
import { getClient, createPayment, submitDelivery, openDispute, resolveDispute, getPayment, claimFunds, getPending } from "../api/relay.mjs";

const client = getClient();
const BUYER = process.env.BUYER || "0xf615a9f8e6d94964e325c2d7ba417c723d48786f";
const SELLER = process.env.SELLER || "0x3c6ec53665cecf87909412e4e3d0d02b1749cea2";
const PROOF = "0x" + "a".repeat(64);
const CRITERIA = "Delivery URL must contain a valid JSON API response with a user field.";

console.log("1. create_payment (1 GEN escrow, relay submits for buyer)...");
const created = await createPayment(client, BUYER, SELLER, "x402", CRITERIA, PROOF, 86400, 1000000000000000000n);
console.log("   tx:", created.hash);
const pid = "pay-1";
console.log("2. get_payment...");
console.log(JSON.stringify(await getPayment(client, pid), null, 2));

console.log("3. submit_delivery (relay for seller)...");
await submitDelivery(client, SELLER, pid, "https://example.com/", "done");
console.log("4. open_dispute...");
await openDispute(client, BUYER, pid, "Delivery does not match criteria");
console.log("5. resolve_dispute (AI jury)...");
try {
  await resolveDispute(client, pid);
} catch (e) {
  console.log("   resolve error:", e.code || e.message);
}
console.log("6. final payment state...");
console.log(JSON.stringify(await getPayment(client, pid), null, 2));
console.log("7. pending withdrawals buyer/seller:", await getPending(client, BUYER), await getPending(client, SELLER));
console.log("E2E done.");
