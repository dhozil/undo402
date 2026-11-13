// Full USDC E2E: Base escrow (real USDC) + GenLayer verdict (StudioNet)
// Usage: WALLET_DIR=/path/to/wallet UNDO402_CONTRACT_ADDRESS=0x... ESCROW=0x... node scripts/e2e_usdc.mjs
import { sellerWallet, buyerWallet as loadBuyerWallet } from "./wallet.mjs";
import { createWalletClient, createPublicClient, http, getAddress, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getClient, createPayment, submitDelivery, openDispute, resolveDispute, getPayment } from "../api/relay.mjs";

const seller = sellerWallet();
const buyer = loadBuyerWallet();
const USDC = getAddress("0x036cbd53842c5426634e7929541ec2318f3dcf7e");
const ESCROW = getAddress(process.env.ESCROW);
const AMOUNT = 1000000n; // 1 USDC

const basePub = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const buyerWallet = createWalletClient({ chain: baseSepolia, transport: http("https://sepolia.base.org"), account: privateKeyToAccount(buyer.privateKey) });
const relayWallet = createWalletClient({ chain: baseSepolia, transport: http("https://sepolia.base.org"), account: privateKeyToAccount(seller.privateKey) });

const erc20 = [{ type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" }];
const escrowAbi = [
  { type: "function", name: "createEscrow", inputs: [{ type: "string" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "refund", inputs: [{ type: "string" }, { type: "uint256" }, { type: "string" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "release", inputs: [{ type: "string" }, { type: "uint256" }, { type: "string" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "getEscrow", inputs: [{ type: "string" }], outputs: [{ type: "tuple", components: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "string" }, { type: "string" }] }], stateMutability: "view" },
];

console.log("1. Buyer approves USDC...");
let h = await buyerWallet.writeContract({ address: USDC, abi: erc20, functionName: "approve", args: [ESCROW, AMOUNT] });
await basePub.waitForTransactionReceipt({ hash: h });
console.log("   approve tx:", h);

console.log("2. Buyer creates escrow (1 USDC locked on Base)...");
h = await buyerWallet.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "createEscrow", args: ["pay-1", getAddress(seller.address), AMOUNT, 86400n] });
const r = await basePub.waitForTransactionReceipt({ hash: h });
console.log("   escrow tx:", h, "status:", r.status);
const baseTx = h;

console.log("3. GenLayer create_payment (proof = Base tx)...");
process.env.GENLAYER_PRIVATE_KEY = seller.privateKey;
const gl = getClient();
await createPayment(gl, buyer.address, seller.address, "x402", "Delivery URL must contain a valid JSON API response with a user field.", baseTx, 86400, AMOUNT, "", "pay-1");
console.log("4. GenLayer delivery + dispute + resolve...");
await submitDelivery(gl, seller.address, "pay-1", "https://example.com/", "done");
await openDispute(gl, buyer.address, "pay-1", "Delivery does not match criteria");
try { await resolveDispute(gl, "pay-1"); } catch (e) { console.log("   resolve:", e.code || e.message); }
const verdict = await getPayment(gl, "pay-1");
console.log("   verdict:", verdict.verdict, "attestation:", verdict.attestation_digest);

console.log("5. Relay executes refund on Base...");
if (verdict.verdict !== "refund" || !/^[0-9a-fA-F]{64}$/.test(verdict.attestation_digest || "")) {
  throw new Error(`refusing to settle: verdict=${verdict.verdict} attestation=${verdict.attestation_digest || "empty"}`);
}
h = await relayWallet.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "refund", args: ["pay-1", BigInt(verdict.verdict_score), verdict.attestation_digest] });
await basePub.waitForTransactionReceipt({ hash: h });
console.log("   refund tx:", h);

const bal = await basePub.readContract({ address: USDC, abi: [{ type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }], functionName: "balanceOf", args: [getAddress(buyer.address)] });
console.log("Buyer USDC after refund:", formatUnits(bal, 6), "(was 20, escrowed 1, refunded 1)");
console.log("USDC E2E done.");
