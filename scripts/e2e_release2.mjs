// Release E2E v2: GitHub API delivery -> AI release -> USDC to seller
import { sellerWallet, buyerWallet } from "./wallet.mjs";
import { createWalletClient, createPublicClient, http, getAddress, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getClient, createPayment, submitDelivery, openDispute, resolveDispute, getPayment } from "../api/relay.mjs";

const seller = sellerWallet();
const buyer = buyerWallet();
const USDC = getAddress("0x036cbd53842c5426634e7929541ec2318f3dcf7e");
const ESCROW = getAddress(process.env.ESCROW);
const AMOUNT = 1000000n;

const basePub = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const buyerWallet = createWalletClient({ chain: baseSepolia, transport: http("https://sepolia.base.org"), account: privateKeyToAccount(buyer.privateKey) });
const relayWallet = createWalletClient({ chain: baseSepolia, transport: http("https://sepolia.base.org"), account: privateKeyToAccount(seller.privateKey) });
const erc20 = [{ type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" }, { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }];
const escrowAbi = [
  { type: "function", name: "createEscrow", inputs: [{ type: "string" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "release", inputs: [{ type: "string" }, { type: "string" }], outputs: [], stateMutability: "nonpayable" },
];
async function bal(a) { return formatUnits(await basePub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [getAddress(a)] }), 6); }

process.env.GENLAYER_PRIVATE_KEY = seller.privateKey;
const gl = getClient();
const pid = "pay-4";
console.log("buyer/seller before:", await bal(buyer.address), await bal(seller.address));
let h = await buyerWallet.writeContract({ address: USDC, abi: erc20, functionName: "approve", args: [ESCROW, AMOUNT] });
await basePub.waitForTransactionReceipt({ hash: h });
h = await buyerWallet.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "createEscrow", args: [pid, getAddress(seller.address), AMOUNT, 86400n] });
await basePub.waitForTransactionReceipt({ hash: h });
console.log("escrow created, base tx:", h);
await createPayment(gl, buyer.address, seller.address, "x402", "Delivery URL must return valid JSON with login and id fields.", h, 86400, AMOUNT);
await submitDelivery(gl, seller.address, pid, "https://api.github.com/users/octocat", "github user record");
await openDispute(gl, buyer.address, pid, "Checking quality");
try { await resolveDispute(gl, pid); } catch (e) { console.log("resolve:", e.code || e.message); }
const v = await getPayment(gl, pid);
console.log("verdict:", v.verdict, "score:", v.verdict_score);
console.log("reason:", v.verdict_reason);
if (v.verdict === "release") {
  h = await relayWallet.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "release", args: [pid, v.attestation_digest || ""] });
  await basePub.waitForTransactionReceipt({ hash: h });
  console.log("release tx:", h, "buyer/seller after:", await bal(buyer.address), await bal(seller.address));
} else {
  console.log("NOT released — verdict was not release");
}
