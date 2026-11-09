// Wallet loader — reads from WALLET_DIR env (never commit private keys).
// Set WALLET_DIR=/path/to/wallet on the server, or GENLAYER_PRIVATE_KEY directly.
import { readFileSync } from "fs";
import { join } from "path";

const DIR = process.env.WALLET_DIR || "./wallet";

export function loadWallet(name) {
  return JSON.parse(readFileSync(join(DIR, name), "utf8"));
}
export const sellerWallet = () => loadWallet("seller.json");
export const buyerWallet = () => loadWallet("recipient.json");
