# Deployment — StudioNet (GenLayer) + Base Sepolia (USDC)

## GenLayer StudioNet (adjudication, no funds)

| Contract | Address |
|---|---|
| **Undo402 v9 (user-chosen payment id)** ⭐ | `0x9022290256C9b4B243fD4519b9857c83e45fFb5a` |
| Undo402 v8 (Sacramentum adoption) | `0x2Fa0B3d119FC8F6D54Ec643C8332c1fc22673fb7` |
| Undo402 v7 (evidence manifest + conserved + timeout) | `0xa2BFf07689Db9365597946858262Ca8dD6b7a1bc` |
| Undo402 v6 (stablecoin adjudication) | `0x6C7ea251273aC4FDF8d3C9B36F2E3089bb4c3660` |

- v9 adds **`create_payment_with_id`** so the Base escrow ID and the GenLayer case ID are the same string (the settlement path requires it). Legacy auto-`pay-N` `create_payment` is unchanged.
- Relay = seller wallet `0x99bF…D5Db3`, registered type `undo402-case`
- **E2E v9 `pay-v5-demo`:** Base escrow 0.1 USDC → `create_payment_with_id("pay-v5-demo")` → delivery → dispute → `human_resolve(refund)` → `settle.mjs` signed by the **buyer** wallet → refund tx `0x5c66…b831` → second run `alreadySettled`, no tx ✅
- **E2E v9 `pay-v9-demo`:** same flow, relay-signed refund tx `0xc66d…46a6` ✅
- v8 adds (Sacramentum adoption): evidence manifest (max 3 https sources, committed at create), `total_recorded_usdc`/`total_settled_usdc` conserved tracking + `get_stats`, undetermined 1h grace → neutral 50/50 via `claim_timeout`, delivery deadline enforced in `submit_delivery`, committed sources fetched contract-side in leader
- **E2E v8 `pay-1`:** create → delivery → dispute → **refund + attestation** ✅
- **Smoke live:** `get_payment_count=1`, `get_stats conserved=True (recorded=settled=1 USDC)`, `get_case_count=1` ✅
- **Adversarial live:** `create_payment` with `http://` source → **ERROR rejected** ✅; `submit_delivery` on settled `pay-1` → **ERROR rejected** (one-time guard) ✅
- E2E `pay-1` (v6): 1 USDC recorded → delivery → dispute → **refund verdict + attestation `e915a328…`** ✅
- Previous GEN-escrow versions (v1–v5) superseded — GEN was a proxy, now removed

## Base Sepolia (real USDC escrow) — LIVE

| Contract | Address | Tx |
|---|---|---|
| Undo402Escrow v5 (buyer/seller can settle) ⭐ | `0xB03759B87A19776a63BD2D7f8CB2f14cDFB8f70F` | `0xfab1e39b76684e5f728044c6c0bd2cd72e95a45aecf1ac7c1ed016df65e667aa` |
| Undo402Escrow v4 (on-chain attestation binding) | `0x8fcD766B2f52Fa754DE24207E3cA19EcD7AF8c24` | `0xd805c48e7924d03fb656a78512cd9b81ab4fe0ee2102b268ca7c81a7af0a529f` |
| Undo402Escrow v3 (timeout claim) | `0x2aa335805722FfeEa8b8eE96B9e8bb2a4B20Fde8` | `0xb7309282bb3fb10804bca75303fbb95fa3e567b822c8d6c2f58bb35cce057279` |
| Undo402Escrow v2 (release + refund + partial) | `0xC4ac27c83790a07a1dC8A3c1c2E9564Fb94D4dEa` | `0x1bf38dd6fd336d0bea14172ccc9cd006f43df1091db5b911f24c84d1ba0647eb` |
| Undo402Escrow v1 | `0x5333Eec70a74e6d01b0Cc3eF4428A612E9751346` | `0x26bf1f46a66bd8535140e7aa1ec93b595c51deba57c781e83da0f726f3793747` |
| USDC (testnet) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | — |

**v5 idempotent settlement proof (buyer wallet, real USDC):**
- Escrow `pay-v5-demo` (0.1 USDC): [`0xc37cd80aad4350a597b444a60995999a19c5cfdba885035cd20c154db24904b6`](https://sepolia.basescan.org/tx/0xc37cd80aad4350a597b444a60995999a19c5cfdba885035cd20c154db24904b6)
- Finalized on StudioNet: verdict `refund`, attestation `9b2c4d78fdb0c82ceb5e2061547b07c3ffbbdfadbe9c0b22425cb718501bb854`
- `settle.mjs` signed by the **buyer** (not the relay) refunded the escrow: [`0x5c66f8194274a783bc845e6f6790049b4a2df26c88ae08313e7573166de0b831`](https://sepolia.basescan.org/tx/0x5c66f8194274a783bc845e6f6790049b4a2df26c88ae08313e7573166de0b831) ✅
- Second run: `alreadySettled: true`, `sent: false` — no second USDC movement ✅
- `pay-2` (GenLayer state `FUNDED`) refused with `NOT_FINAL`; made-up 64-hex attestation on Base reverted with **`Attestation not bound to case`** ✅
- `forge test`: 14/14 (empty/arbitrary/cross-case/cross-party/wrong-verdict/wrong-score/partial-split/exactly-once/buyer-signed/seller-signed/outsider/timeout)
- See [`docs/SETTLEMENT.md`](docs/SETTLEMENT.md) for the identified path.

**v4 idempotent settlement proof (`pay-1`, real USDC):**
- Fresh v4 escrow for `pay-1` (1 USDC), then `node scripts/settle.mjs --payment pay-1 --check` → digest + buyer/seller/amount binding verified, no tx.
- First real run settled refund: [`0x22ef5b045a835974936f64cfc2017f83d2262fe9b468562366f94983a361697f`](https://sepolia.basescan.org/tx/0x22ef5b045a835974936f64cfc2017f83d2262fe9b468562366f94983a361697f) ✅
- Second run: `alreadySettled: true`, `sent: false` — no second USDC movement ✅

**Refund E2E `pay-1` (v1 escrow):** approve → escrow 1 USDC → GenLayer refund + attestation → Base refund → buyer back to 20 USDC ✅

**Release + Partial E2E (v2 escrow):**
- `pay-5`: escrow 1 USDC (`0xfa83…`) → GenLayer AI verdict **release** score 100 (GitHub API delivery: login+id present) attestation `9b13cef4…` → Base `release` (`0xc34b…`) → seller 23→24 USDC ✅ **AI release path proven live**
- `pay-3`: human override **partial 50%** → Base `releasePartial` (`0xb679…`) → buyer +1, seller +1 ✅
- `pay-2`: AI verdict refund (jsonplaceholder judged failing) — relay now gates on verdict match

Run: `UNDO402_CONTRACT_ADDRESS=0x9022… ESCROW=0xB037… node scripts/settle.mjs --payment <id>` (idempotent) or the historical `scripts/e2e_release_partial.mjs` / `scripts/e2e_release2.mjs`.

## Wallets (external, never committed)

- Relay/seller: `seller.json` in `$WALLET_DIR` → `0x99bF44395CaC814E671ADFF8b69d968Fac4e5Db3`
- Buyer: `recipient.json` in `$WALLET_DIR` → `0x0Eb9431eDdbF170d2224F4f9E47D4DD68b6c44bc`
- Set `WALLET_DIR=/path/to/wallet` or `GENLAYER_PRIVATE_KEY` on the server. Private keys are never in this repo.

## Redeploy GenLayer

```bash
genlayer network set studionet
genlayer account use asmodeus-deploy
genlayer deploy --contract contracts/Undo402.py
genlayer write <UNDO402> set_relay --args "<SELLER_ADDRESS>"
genlayer write <UNDO402> register_type --args "undo402-case"
genlayer write <UNDO402> register_case --args "<UNDO402_ADDRESS>" "undo402-case" "x402-single-v6"
```
