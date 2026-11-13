# Undo402 Dispute API — optional bridge (not used by the web app)

> **Optional.** The dashboard signs everything with the visitor's own wallet.
> This FastAPI bridge only exists for programmatic clients that have no wallet
> (agents, webhooks, server jobs). It is not required to run or demo Undo402.

The bridge wraps the GenLayer contract and `scripts/settle.mjs` so a caller can
use HTTP instead of holding a GenLayer wallet.

## Flow

1. Client pays via its rail (e.g. USDC via x402 facilitator on Base).
2. Client POSTs the payment with `payment_id`, `actor_address`, seller, rail,
   criteria, `payment_proof`, amount.
3. The bridge submits with its own key (from `WALLET_DIR` or
   `GENLAYER_PRIVATE_KEY`).
4. Seller / buyer act through the same endpoints, or directly with their wallet.
5. `resolve_dispute` returns verdict + `attestation_digest` (SHA-256).
6. `POST /payments/{id}/settle` runs `scripts/settle.mjs`: verifies payment id,
   verdict, attestation and partial split, then settles on Base exactly once.

## Endpoints (see `app.py`)

```
POST /payments                         Create payment (payment_id optional)
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

## Run locally

```bash
pip install fastapi uvicorn pydantic
UNDO402_CONTRACT_ADDRESS=0x9022290256C9b4B243fD4519b9857c83e45fFb5a \
ESCROW=0xB03759B87A19776a63BD2D7f8CB2f14cDFB8f70F \
uvicorn api.app:app --port 8000
```
