# Undo402 Dispute API — Relay Layer (StudioNet)

The relay is the off-chain orchestrator (TreasuryPilot + Nexa pattern). Users on any rail (Base x402, card, any chain) never need a GenLayer wallet: the relay submits on their behalf with `actor_address`.

## Flow

1. User pays via their rail (e.g. USDC via x402 facilitator on Base).
2. Relay verifies the facilitator receipt / tx hash off-chain (StudioNet-safe: no ERC-20 calls from the IC).
3. Relay calls `create_payment(actor_address=user, seller, rail, criteria, payment_proof, ttl)` with GEN escrow.
4. Seller / buyer act via relay or directly (both supported — `_resolve_actor` allows either).
5. Anyone calls `resolve_dispute`; verdict + `attestation_digest` (SHA-256) is returned.
6. Relay executes the final USDC settlement on the payment chain and anchors the attestation digest there (Nexa pattern).

## Endpoints (see `app.py`)

```
POST /payments                         Create payment (relay submits)
POST /payments/{id}/delivery           Submit delivery
POST /payments/{id}/accept             Buyer accepts
POST /payments/{id}/timeout            Claim timeout refund
POST /payments/{id}/dispute            Open dispute
POST /payments/{id}/counter-evidence   Seller counter-evidence
POST /payments/{id}/resolve            Trigger GenLayer verdict
GET  /payments/{id}                    Payment + verdict + attestation
GET  /payments                         List payments
GET  /health                           Liveness
```

## API (live)

```bash
pip install fastapi uvicorn pydantic
UNDO402_CONTRACT_ADDRESS=0x6C7ea251273aC4FDF8d3C9B36F2E3089bb4c3660 uvicorn api.app:app --port 8000
# Frontend writes now submit live via this API (relay key from wallet/seller.json)
# Verified: POST /payments -> tx 0xae23827a… (pay-6 created on StudioNet)
```
