# Architecture — Undo402

## Boundary (what belongs where)

- **Frontend / backend owns:** wallet UX, forms, indexing, notifications, non-authoritative previews, USDC settlement relay on the payment chain (Base etc.).
- **GenLayer contract owns:** escrow state, role/deadline checks, evidence references, the consensus verdict, and the payout/refund/split state transition.
- **External sources own:** raw facts (delivery pages, x402 facilitator receipts, Stripe references). Validators re-fetch them; they are never trusted blindly.

> What decision must not depend on our server alone? **"Does the delivery satisfy the agreed criteria, and who gets the escrow?"** That is the only GenLayer decision.

## Contracts

### `contracts/Undo402.py` — case contract
Storage:
- `payments: TreeMap[str, Payment]` — buyer, seller, amount_atto (u256), rail, criteria, payment_proof, delivery_url/note, dispute_reason, counter_evidence_url, state, verdict, score, refund_percent, timestamps, attestation_digest, proposed_buyer/seller, human_verdict/reason.
- `payment_order: DynArray[str]` — listing order.
- `payment_count: u256` — O(1) count.
- `owner`, `relay_address` — TreasuryPilot relay pattern (`actor_address` on every write).

State machine:
```
FUNDED --submit_delivery--> DELIVERED --accept / propose_outcome (2-of-2)--> RELEASED
FUNDED/DELIVERED --claim_timeout (after deadline)--> REFUNDED
FUNDED/DELIVERED --open_dispute / propose_outcome (differ)--> DISPUTED (evidence deadline: 7 days)
DISPUTED --submit_counter_evidence--> DISPUTED (evidence added, before deadline)
DISPUTED --resolve_dispute (AI) / human_resolve (owner)--> RELEASED | REFUNDED | PARTIAL | UNDETERMINED (stays DISPUTED, retryable)
```

### `contracts/Undo402Factory.py` — per-case registry factory
InternetCourt pattern: each case is its own deployed `Undo402` instance (one payment per case contract = isolation). The factory registers case addresses by type (`undo402-case`) and deployer, with indexes for discovery. It does not deploy children itself — deploy off-chain (Studio/CLI), then `register_case(address, type, params)`.

Deploy flow:
```
1. Deploy Undo402Factory on StudioNet
2. register_type("undo402-case")
3. Deploy Undo402 case contract per payment
4. register_case(case_address, "undo402-case", params_json)
5. Discover via get_cases_by_type / get_cases_by_deployer
```

## Verdict — exact decision + score within ±10 + refund bucket match
- **Leader:** fetch delivery URL (+ counter-evidence URL if present) via `gl.nondet.web.get`, trim, ask LLM for `{"decision","score","refund_percent","reason"}` with `response_format="json"`. Prompt includes STEP 0 integrity check (prompt-injection = score 0 + flagged) and an anti-manipulation IGNORE list (TreasuryPilot + InternetCourt patterns).
- **Validator:** reruns the *same* task independently, then compares:
  - `decision` must match exactly (`refund` / `release` / `partial` / `undetermined`),
  - score gate: if either score is 0 (reject), both must be 0,
  - score difference ≤ 10,
  - refund bucket must match (0 / 1–99 / 100); within partial, refund difference ≤ 25.
- **UNDETERMINED:** no settlement — state stays `DISPUTED` so anyone can retry for free. Never silently swallow a paid dispute.
- **Payout** is deterministic from the accepted verdict: release = 100% seller, refund = 100% buyer, partial = split by `refund_percent`.

Error classification:
- `[EXPECTED]` business logic → exact match
- `[EXTERNAL]` HTTP 4xx → exact match
- `[TRANSIENT]` HTTP 5xx / fetch failure → agree if both transient
- `[LLM_ERROR]` bad LLM output → always disagree, force rotation

LLM resilience: defensive JSON cleanup, key aliasing (`verdict`/`outcome`/`result`, `rating`/`quality_score`), coercion, clamping 0–100.

## Multi-rail design

| Rail | External payment | GenLayer record |
|---|---|---|
| `x402` | USDC via x402 facilitator (Base etc.) | `payment_proof` = facilitator tx hash/receipt |
| `chain` | Any on-chain stablecoin | tx hash + chain id |
| `card` | Stripe/other processor | PaymentIntent / processor reference |

MVP escrow is GEN on StudioNet (gasless, demoable end-to-end). The GEN escrow is the chargeback pool. A relay executes the final USDC movement on the external chain from the verdict — the same pattern AgentEscrow uses to bridge verdicts to Base Sepolia. Note: `@gl.evm.contract_interface` ERC-20 calls are **not functional in Studio** — on StudioNet, verify external USDC `payment_proof` off-chain via the relay.

## Testing

- Lint: `genvm-lint check contracts/Undo402.py && genvm-lint check contracts/Undo402Factory.py`
- Direct tests: `pytest tests/direct/ -v` (20 tests; leader only — validator logic needs integration tests)
- Deploy: see `scripts/deploy_studionet.md`
