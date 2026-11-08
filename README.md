# Undo402 — Stablecoin Payments with Chargeback

> **Undo for x402. Stablecoin payments with chargeback — one dispute API across cards, x402, and any chain.**

Undo402 is **stablecoin-based by design**: real USDC moves on Base escrow, GenLayer adjudicates disputes. GEN is never the payment asset — it only exists on StudioNet for the adjudication contract (gasless, no value at risk).

## Architecture (stablecoin-first)

```
Buyer pays USDC → Undo402Escrow.sol (Base Sepolia) — funds locked
       │ payment_proof (Base tx hash) recorded
       ▼
Undo402 (GenLayer StudioNet) — adjudication only, holds NO funds
       │ verdict + SHA-256 attestation_digest
       ▼
Relay reads verdict → calls release/refund on Base escrow
       ▼
USDC moves: seller (release) / buyer (refund) / split (partial)
```

| Layer | Chain | Role |
|---|---|---|
| `contracts/base/Undo402Escrow.sol` | Base Sepolia | **Real USDC escrow** — holds, releases, refunds |
| `contracts/Undo402.py` | GenLayer StudioNet | Dispute adjudication, verdict, attestation (no funds) |
| `api/relay.mjs` + `api/app.py` | Off-chain | Verifies Base payment, submits to GenLayer, executes verdict on Base |

## Why not GEN escrow?

GEN is volatile and GenLayer-native — using it as the payment asset contradicts the thesis ("stablecoin payments"). The GEN-proxy era is superseded: v6 contract records `amount_usdc` (6 decimals) and never touches GEN value.

## Contract API (GenLayer, single contract)

- `create_payment(actor, seller, rail, criteria, payment_proof, amount_usdc, ttl)` — records a USDC payment whose escrow exists on Base; `payment_proof` = Base escrow tx hash
- `submit_delivery`, `accept`, `claim_timeout`, `open_dispute`, `submit_counter_evidence`
- `propose_outcome` — 2-of-2 mutual agreement, no jury
- `resolve_dispute` — AI jury verdict (`refund`/`release`/`partial`/`undetermined`) + attestation
- `human_resolve`, `set_human_decision` — owner human layer
- Factory registry merged in: `register_type`, `register_case`, `get_cases_by_type`, …
- Views: `get_payment`, `get_payments`, `get_case_count`, `get_relay_address`

## Base escrow API (Solidity)

- `createEscrow(paymentId, seller, amount)` — buyer approves USDC first
- `release(paymentId, attestation)` / `refund(paymentId, attestation)` — relay/owner only, after GenLayer verdict

## Quick start

```bash
# GenLayer side (StudioNet, gasless)
genlayer network set studionet
genlayer deploy --contract contracts/Undo402.py
genlayer write <UNDO402> set_relay --args "<RELAY_ADDRESS>"
genlayer write <UNDO402> register_type --args "undo402-case"

# Base side (Sepolia) — see contracts/base/README.md
# 1. Get Base Sepolia ETH (gas) + test USDC from faucets
# 2. Deploy MockUSDC (or use Circle test USDC), then Undo402Escrow
# 3. Buyer approves + createEscrow, relay records proof in Undo402
```

## Status

Stablecoin-based v6 live on StudioNet (`0x6C7e…3660`), E2E verified with wallet folder (`D:\Genlayer-project\wallet`): create → delivery → dispute → **refund verdict + attestation**. Base escrow contract ready for Sepolia deployment (needs Base faucets). See `DEPLOYMENT.md`.
