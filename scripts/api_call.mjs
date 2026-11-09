// Generic CLI bridge: node scripts/api_call.mjs <function> <json-args>
// Used by api/app.py via subprocess. Relay key from WALLET_DIR/seller.json
// or GENLAYER_PRIVATE_KEY env (Vercel/server).
import { sellerWallet } from "./wallet.mjs";
import { getClient, write, read } from "../api/relay.mjs";

if (!process.env.GENLAYER_PRIVATE_KEY) {
  const seller = sellerWallet();
  process.env.GENLAYER_PRIVATE_KEY = seller.privateKey;
}
process.env.GENLAYER_RPC_URL = process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";

const [fn, argsJson] = process.argv.slice(2);
const args = argsJson ? JSON.parse(argsJson) : [];
const client = getClient();

const WRITE_FNS = new Set(["create_payment","submit_delivery","accept","claim_timeout","open_dispute","submit_counter_evidence","propose_outcome","resolve_dispute","human_resolve","set_relay","register_type","register_case"]);
try {
  const out = WRITE_FNS.has(fn) ? await write(client, fn, args) : await read(client, fn, args);
  console.log(JSON.stringify({ ok: true, ...out }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e.message, code: e.code, txHash: e.txHash, explorer: e.explorer }));
  process.exit(1);
}
