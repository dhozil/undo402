# Deployment — StudioNet (GenLayer) + Base Sepolia (USDC)

## GenLayer StudioNet (adjudication, no funds)

| Contract | Address |
|---|---|
| **Undo402 v8 (Sacramentum adoption)** ⭐ | `0x2Fa0B3d119FC8F6D54Ec643C8332c1fc22673fb7` |
| Undo402 v7 (evidence manifest + conserved + timeout) | `0xa2BFf07689Db9365597946858262Ca8dD6b7a1bc` |
| Undo402 v6 (stablecoin adjudication) | `0x6C7ea251273aC4FDF8d3C9B36F2E3089bb4c3660` |

- Relay = seller wallet `0x99bF…D5Db3`, registered type `undo402-case`, self-registered case 0
- v8 adds (Sacramentum adoption): evidence manifest (max 3 https sources, committed at create), `total_recorded_usdc`/`total_settled_usdc` conserved tracking + `get_stats`, undetermined 1h grace → neutral 50/50 via `claim_timeout`, delivery deadline enforced in `submit_delivery`, committed sources fetched contract-side in leader
- **E2E v8 `pay-1`:** create → delivery → dispute → **refund + attestation** ✅
- **Smoke live:** `get_payment_count=1`, `get_stats conserved=True (recorded=settled=1 USDC)`, `get_case_count=1` ✅
- **Adversarial live:** `create_payment` with `http://` source → **ERROR rejected** ✅; `submit_delivery` on settled `pay-1` → **ERROR rejected** (one-time guard) ✅
- E2E `pay-1` (v6): 1 USDC recorded → delivery → dispute → **refund verdict + attestation `e915a328…`** ✅
- Previous GEN-escrow versions (v1–v5) superseded — GEN was a proxy, now removed

## Base Sepolia (real USDC escrow) — LIVE

| Contract | Address | Tx |
|---|---|---|
| Undo402Escrow v3 (timeout claim) ⭐ | `0x2aa335805722FfeEa8b8eE96B9e8bb2a4B20Fde8` | `0xb7309282bb3fb10804bca75303fbb95fa3e567b822c8d6c2f58bb35cce057279` |
| Undo402Escrow v2 (release + refund + partial) | `0xC4ac27c83790a07a1dC8A3c1c2E9564Fb94D4dEa` | `0x1bf38dd6fd336d0bea14172ccc9cd006f43df1091db5b911f24c84d1ba0647eb` |
| Undo402Escrow v1 | `0x5333Eec70a74e6d01b0Cc3eF4428A612E9751346` | `0x26bf1f46a66bd8535140e7aa1ec93b595c51deba57c781e83da0f726f3793747` |
| USDC (testnet) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | — |

**Refund E2E `pay-1` (v1 escrow):** approve → escrow 1 USDC → GenLayer refund + attestation → Base refund → buyer back to 20 USDC ✅

**Release + Partial E2E (v2 escrow):**
- `pay-5`: escrow 1 USDC (`0xfa83…`) → GenLayer AI verdict **release** score 100 (GitHub API delivery: login+id present) attestation `9b13cef4…` → Base `release` (`0xc34b…`) → seller 23→24 USDC ✅ **AI release path proven live**
- `pay-3`: human override **partial 50%** → Base `releasePartial` (`0xb679…`) → buyer +1, seller +1 ✅
- `pay-2`: AI verdict refund (jsonplaceholder judged failing) — relay now gates on verdict match

Run: `UNDO402_CONTRACT_ADDRESS=0x6C7e… ESCROW=0xC4ac… node scripts/e2e_release_partial.mjs` (release) / `scripts/e2e_release2.mjs` (GitHub delivery)

## Wallets (`D:\Genlayer-project\wallet`)

- Relay/seller: `seller.json` → `0x99bF44395CaC814E671ADFF8b69d968Fac4e5Db3`
- Buyer: `recipient.json` → `0x0Eb9431eDdbF170d2224F4f9E47D4DD68b6c44bc`

## Redeploy GenLayer

```bash
genlayer network set studionet
genlayer account use asmodeus-deploy
genlayer deploy --contract contracts/Undo402.py
genlayer write <UNDO402> set_relay --args "<SELLER_ADDRESS>"
genlayer write <UNDO402> register_type --args "undo402-case"
genlayer write <UNDO402> register_case --args "<UNDO402_ADDRESS>" "undo402-case" "x402-single-v6"
```
