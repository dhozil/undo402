# Undo402 Dispute API — Relay Layer (StudioNet)

The relay is the off-chain orchestrator (TreasuryPilot + Nexa pattern). Users on any rail (Base x402, card, any chain) never need a GenLayer wallet: the relay submits on their behalf with `actor_address`.

## Flow

1. User pays via their rail (e.g. USDC via x402 facilitator on Base).
2. Relay verifies the facilitator receipt / tx hash off-chain (StudioNet-safe: no ERC-20 calls from the IC).
3. Relay calls `create_payment(actor_address=user, seller, rail, criteria, payment_proof, amount_usdc, ttl)` — USDC amount, no GEN escrow.
4. Seller / buyer act via relay or directly (both supported — `_resolve_actor` allows either).
5. Anyone calls `resolve_dispute`; verdict + `attestation_digest` (SHA-256) is returned.
6. `POST /payments/{id}/settle` runs `scripts/settle.mjs`: verifies payment id, verdict, attestation and partial split, then executes the final USDC settlement on Base exactly once (safe to retry).

## Endpoints (see `app.py`)

```
POST /payments                         Create payment (relay submits)
POST /payments/{id}/delivery           Submit delivery
POST /payments/{id}/accept             Buyer accepts
POST /payments/{id}/timeout            Claim timeout refund
POST /payments/{id}/dispute            Open dispute
POST /payments/{id}/counter-evidence   Seller counter-evidence
POST /payments/{id}/resolve            Trigger GenLayer verdict
POST /payments/{id}/settle?check=true  Verify attestation binding (no tx)
POST /payments/{id}/settle             Idempotent Base settlement
GET  /payments/{id}                    Payment + verdict + attestation
GET  /payments                         List payments
GET  /health                           Liveness
```

## API (live)

```bash
pip install fastapi uvicorn pydantic
UNDO402_CONTRACT_ADDRESS=0x9022290256C9b4B243fD4519b9857c83e45fFb5a ESCROW=0x8fcD766B2f52Fa754DE24207E3cA19EcD7AF8c24 uvicorn api.app:app --port 8000
# Frontend writes now submit live via this API (relay key from wallet/seller.json)
# Verified: POST /payments -> tx 0xae23827a… (pay-6 created on StudioNet)
```
