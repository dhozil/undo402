# Historical payment/case migration to hardened contract

**Date:** 2026-11-13  
**From (historical, live test evidence):** GenLayer Undo402 v9 `0x9022290256C9b4B243fD4519b9857c83e45fFb5a` (StudioNet 61999)  
**To (active, hardened):** GenLayer Undo402 hardened `0xaee085b0f4921953dD3474a15467D73E3E90F2AD` (StudioNet 61999, deploy tx `0xba0b432e3ee056a2bf9736e3ba5be9cf90cce971c01b690a1c3afef4afbc4bcb`)  

**Goal:** make historical payment/case records available on the trusted active (hardened) contract for continuity, without falsifying original on-chain history.

## What was migrated

Historical cases were re-created on the hardened contract with the **same payment IDs, parties, rail, criteria, payment proof, and amount** (`create_payment_with_id`) and progressed to the **same terminal state/verdict** (and therefore the same deterministic attestation digest, which is bound to id/decision/score/refundPercent/buyer/seller).

| Payment ID | Historical (v9) | Migrated (hardened) | Verdict | Attestation digest (same) | Notes |
|---|---|---|---|---|---|
| `pay-v9-demo` | REFUNDED | REFUNDED | refund | `4ed9cecbc755f0561ef85af70178616b0a1f7a8bfacb242aea02ac1a740b5d58` | re-created → delivery → dispute → `human_resolve(refund)` (owner) |
| `pay-v5-demo` | REFUNDED | REFUNDED | refund | `9b2c4d78fdb0c82ceb5e2061547b07c3ffbbdfadbe9c0b22425cb718501bb854` | re-created → delivery → dispute → `human_resolve(refund)` (owner) |
| `pay-v6-proof` | REFUNDED | REFUNDED | refund | `84566d2f21221a6c79600bdc6208e29437140258ad5922fe54e46d22fff61fcf` | re-created → delivery → dispute → `human_resolve(refund)` (owner); original Base v6 finalized settlement remains the canonical on-chain USDC proof |
| `adv-good-1794580646961` | REFUNDED | REFUNDED | refund | `5f46a50e2a1d3ed4db964e659a3c8d1ba4da5622cc16caa81c33480e9fe026d6` | re-created → delivery → dispute → `human_resolve(refund)` (owner) |
| `adv-mutual-1794582890001` | RELEASED | RELEASED | release | `5e2f8b59be33deb21c3f590a4b385d835b7364ddb0a1a951b3148ea0d374c91c` | re-created → delivery → 2-of-2 `propose_outcome(release)` (buyer+seller) |
| `adv-crit-1794580528347` | FUNDED (`criteria="short"`) | **not migrated** | — | — | correctly **rejected** by hardened contract: `[EXPECTED] Criteria too short (min 10 chars)` (demonstrates on-chain hardening) |

**Post-migration state (hardened contract):** `payment_count=5`, `total_recorded_usdc=500000`, `total_settled_usdc=500000`, `conserved=True`.

## Important trust/semantics notes

- **On-chain history is not moved:** original transactions, receipts, and execution traces remain on the v9 contract `0x9022…Fb5a` (see `docs/ADVERSARIAL_STUDIONET_PROOF.md`, `DEPLOYMENT.md`, `information_needed.md`). Migration creates *new* records/transactions on the hardened contract reproducing the same case definitions and terminal outcomes.
- **Deterministic attestations:** the SHA-256 attestation digest is computed from `(paymentId, decision, score, refundPercent, buyer, seller)`; migrated cases with identical parameters therefore produce identical digests/verdict binding.
- **Base escrow/USDC settlement is separate:** Base escrows (v6 `0x85bC…9037`) were funded/settled against the original GenLayer outcomes and cannot be re-settled (exactly-once). Migrated GenLayer records provide adjudication continuity on the active contract; canonical USDC movement proofs remain the original Base txs referenced in deployment/settlement docs.
- **Hardening benefit:** cases that would violate the hardened rule (e.g. too-short criteria) are refused on the active contract, increasing trust for new cases.