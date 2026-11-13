// Release + Partial E2E on Base Sepolia + GenLayer StudioNet
// Usage: WALLET_DIR=/path/to/wallet UNDO402_CONTRACT_ADDRESS=0x... ESCROW=0x... node scripts/e2e_release_partial.mjs
import { sellerWallet, buyerWallet as loadBuyerWallet } from "./wallet.mjs";
import { createWalletClient, createPublicClient, http, getAddress, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getClient, createPayment, submitDelivery, openDispute, resolveDispute, humanResolve, getPayment } from "../api/relay.mjs";

const seller = sellerWallet();
const buyer = loadBuyerWallet();
const USDC = getAddress("0x036cbd53842c5426634e7929541ec2318f3dcf7e");
const ESCROW = getAddress(process.env.ESCROW);
const AMOUNT = 2000000n; // 2 USDC per payment for clear split math

const basePub = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const buyerWallet = createWalletClient({ chain: baseSepolia, transport: http("https://sepolia.base.org"), account: privateKeyToAccount(buyer.privateKey) });
const relayWallet = createWalletClient({ chain: baseSepolia, transport: http("https://sepolia.base.org"), account: privateKeyToAccount(seller.privateKey) });

const erc20 = [{ type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" }, { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }];
const escrowAbi = [
  { type: "function", name: "createEscrow", inputs: [{ type: "string" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "release", inputs: [{ type: "string" }, { type: "uint256" }, { type: "string" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "releasePartial", inputs: [{ type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "string" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "getEscrow", inputs: [{ type: "string" }], outputs: [{ type: "tuple", components: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "string" }, { type: "string" }] }], stateMutability: "view" },
];

async function bal(a) { return formatUnits(await basePub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [getAddress(a)] }), 6); }
async function escrowFor(id) { return basePub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getEscrow", args: [id] }); }

process.env.GENLAYER_PRIVATE_KEY = seller.privateKey;
const gl = getClient();

async function setupBaseEscrow(pid) {
  let h = await buyerWallet.writeContract({ address: USDC, abi: erc20, functionName: "approve", args: [ESCROW, AMOUNT] });
  await basePub.waitForTransactionReceipt({ hash: h });
  h = await buyerWallet.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "createEscrow", args: [pid, getAddress(seller.address), AMOUNT, 86400n] });
  await basePub.waitForTransactionReceipt({ hash: h });
  return h;
}

// --- RELEASE: valid JSON delivery -> AI release -> USDC to seller ---
console.log("=== RELEASE pay-2 === buyer/seller before:", await bal(buyer.address), await bal(seller.address));
const baseTx2 = await setupBaseEscrow("pay-2");
await createPayment(gl, buyer.address, seller.address, "x402", "Delivery URL must return valid JSON with id and name fields.", baseTx2, 86400, AMOUNT, "", "pay-2");
await submitDelivery(gl, seller.address, "pay-2", "https://jsonplaceholder.typicode.com/users/1", "user record");
await openDispute(gl, buyer.address, "pay-2", "Checking quality");
try { await resolveDispute(gl, "pay-2"); } catch (e) { console.log(" resolve:", e.code || e.message); }
const v2 = await getPayment(gl, "pay-2");
console.log(" verdict:", v2.verdict, "attestation:", v2.attestation_digest);
if (v2.verdict !== "release" || !/^[0-9a-fA-F]{64}$/.test(v2.attestation_digest || "")) { console.log(" SKIP Base release: verdict is not release or attestation is empty"); }
else {
let h = await relayWallet.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "release", args: ["pay-2", BigInt(v2.verdict_score), v2.attestation_digest] });
await basePub.waitForTransactionReceipt({ hash: h });
console.log(" release tx:", h, "buyer/seller after:", await bal(buyer.address), await bal(seller.address));
}

// --- PARTIAL: human override partial 50% (deterministic demo of split) ---
console.log("\n=== PARTIAL pay-3 (human override 50%) ===");
const baseTx3 = await setupBaseEscrow("pay-3");
await createPayment(gl, buyer.address, seller.address, "x402", "Delivery must have id, name, email, phone, website.", baseTx3, 86400, AMOUNT, "", "pay-3");
await submitDelivery(gl, seller.address, "pay-3", "https://jsonplaceholder.typicode.com/users/1", "partial record");
await openDispute(gl, buyer.address, "pay-3", "Missing some fields");
// Owner is deployer on GenLayer; human_resolve must be called by owner via CLI — relay here is seller, so use CLI outside.
console.log(" pay-3 DISPUTED on GenLayer, ready for human_resolve(partial) via owner CLI");
console.log("Done release path. Partial settlement on Base after human_resolve.");
