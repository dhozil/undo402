# GenLayer Review — Networks, Native Token & Stablecoin Support

Source: https://docs.genlayer.com/ (Networks, Developers, Studio limitations, EVM interaction, Value Transfers) + GenLayer CLI skill + reference projects.

## Two-layer architecture

GenLayer is two layers:
1. **GenLayer RPC** — Intelligent Contract operations (`gen_*`), consensus, validators, LLM/web.
2. **GenLayer Chain** — Arbitrum Orbit L2 underneath, standard Ethereum operations (`eth_*`), transfers, EVM contracts.

Every Intelligent Contract has a **Ghost Contract** on the EVM layer at the same address. The ghost holds the contract's GEN balance and relays external messages. IC → EOA/EVM calls go through `@gl.evm.contract_interface` and only execute `on='finalized'`.

## Networks — Undo402 decision: StudioNet only

| Network | Chain ID | RPC | Currency | Purpose | Faucet |
|---|---|---|---|---|---|
| **StudioNet ⭐ Undo402 target (locked)** | 61999 | `https://studio.genlayer.com/api` | GEN | Hosted stable dev, **gasless** — chosen for stability | Built-in 💧 |
| Bradbury Phase 2 | 4221 | `https://rpc.testnet-chain.genlayer.com` | GEN | Production-like testnet (reference only, not our target) | testnet-faucet.genlayer.foundation |
| Studio-dev preview | 61997 | `https://studio-dev.genlayer.com/api` | GEN | Release-candidate, temporary | Built-in |
| Localnet | 61127 | `http://localhost:4000/api` | GEN | Local Docker/GLSim | Built-in |

Undo402 targets **StudioNet only** (locked decision). StudioNet is gasless — 0 GEN is normal and does not block deploy/interaction. It is also rate-limited: 60 req/min, 1000 req/hour, 10000 req/day, max 32 pending txs per sender.

## Stablecoin support — the key finding

**GenLayer has no native stablecoin. The only native currency on every network is GEN (18 decimals).**

No official USDC/USDT listing exists in the networks docs, Studio, or faucet. How real projects handle "USDC":
- InternetCourt: USDC escrow on Base, GenLayer AI jury, bridge via LayerZero.
- TreasuryPilot: USDC on Base mainnet via x402/Coinbase facilitator, GenLayer evaluates proposals.
- Nexa: USDC on Stellar (Soroban SAC) via MPP, GenLayer audits on StudioNet.
- Entropia Escrow / Tribunal / Freelance Court: GEN escrow directly on GenLayer.

GenLayer Chain is an EVM L2, so it *can* host ERC-20s via `@gl.evm.contract_interface` — but **Studio does not implement EVM contract calls beyond value transfers to EOAs**. ERC-20 `transfer()` from an IC will fail on StudioNet and must be validated on Bradbury.

## Undo402 decision

1. **Escrow inside GenLayer: GEN** — demoable end-to-end on StudioNet, treated as the stablecoin proxy (1 GEN = 1 unit of value in demos; amounts are atto-scale `u256`).
2. **External payment: USDC via x402 on Base Sepolia/mainnet** — recorded as `rail` + `payment_proof`, verified via deterministic RPC (`strict_eq`) in Phase 2; final USDC settlement executed by a relay on Base.
3. **Card rail:** processor reference only; GEN escrow is the chargeback pool.

Common USDC addresses (verify on explorer before use): Base Sepolia `0x036CbD5380bb54C30791522C5775850035E31C03`, Base mainnet `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
