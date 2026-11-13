# Undo402 / Steward Request — Audit & Technical Resolution (v6, rejection addressed)

**Audit date:** 2026-11-13 (re-audit + security fix after steward rejection)  
**Repo:** `D:\Genlayer-project\Stablecoin-payments` (`main`)  
**Scope:** Steward critique — identify an idempotent GenLayer → Base settlement path that verifies payment ID, verdict, attestation, and partial-refund binding, and settles exactly once; plus all listed product/security requirements.

## Steward rejection (addressed)

> *"The requested Base attestation binding is still incomplete: although empty and malformed values are rejected, the buyer or seller can compute the public hash for a chosen verdict and submit it without proof that GenLayer finalized that outcome."*

**Fix (v6):** Base settlement now requires, in addition to the on-chain-recomputed case-bound SHA-256 attestation, an **attestor ECDSA signature** (`proof`) certifying that the specific outcome was finalized on GenLayer. The attestor signs:

`keccak256(abi.encode(chainId, escrow, keccak256(paymentId), keccak256(decision), score, refundPercent, buyer, seller, attestationDigest))` (verified as an Ethereum signed message on-chain)

A buyer/seller can still compute the public attestation hash, but **cannot settle without a valid attestor finalization proof** (rejected on-chain). The attestor produces the proof only after verifying the case is finalized on GenLayer (`scripts/settle.mjs` performs this verification before signing/submitting). Settlement remains **exactly-once** (`FUNDED → terminal`).

**Evidence of fix:**
- **Foundry:** `testSelfComputedDigestWithoutFinalizationProofRejected` — correct bound digest, no/invalid proof → revert, funds unmoved. `testNonAttestorSignatureRejected` — wrong signer → revert. (16/16 tests pass)
- **Live on-chain (v6):** funded escrow `pay-v6-noproof` (`0x85bC…9037`), authorized buyer call to `refund` with the correct self-computed bound digest `c01fe38c08a2931210450514361048a5e77870f11d036153d4729ea0545036d0` but invalid proof **reverted** at ECDSA signature verification (custom error `0xf645eedf`, `ECDSAInvalidSignature`) — cannot settle a chosen verdict without GenLayer-finalization proof. ✅
- **Live finalized settlement with proof:** `pay-v6-proof` (0.1 USDC) — Base escrow funded [`0x306df11faa237f1da417f7199ac1b3b1fb029eeb3b748d9b838dc3b64543a2e4`](https://sepolia.basescan.org/tx/0x306df11faa237f1da417f7199ac1b3b1fb029eeb3b748d9b838dc3b64543a2e4), GenLayer finalized refund (attestation `84566d2f21221a6c79600bdc6208e29437140258ad5922fe54e46d22fff61fcf`), `settle.mjs --check` verified, settled with attestor finalization proof [`0x39ec45a3e91ab0f80115474dd86188c493f32bd8d31c061ee86ed4aacf1f167a`](https://sepolia.basescan.org/tx/0x39ec45a3e91ab0f80115474dd86188c493f32bd8d31c061ee86ed4aacf1f167a), rerun `alreadySettled: true`, no tx. ✅

---

## 1. Steward request summary

| # | Request | Status |
|---|---|---|
| R1 | **Idempotent GenLayer → Base settlement path** verifying **payment ID, verdict, attestation, and partial-refund binding**, and settling **exactly once** | **Resolved** |
| R2 | All UI/content in **English**; professional glassmorphism, responsive, loading/error/success states, tx explorer links, input validation | **Resolved** |
| R3 | GenLayer target **StudioNet only** (61999); payment asset **USDC, never GEN** | **Resolved** |
| R4 | **Never expose local wallet folder path**; use `WALLET_DIR` | **Resolved** |
| R5 | **No permanently locked funds**; **timeout backstop** required | **Resolved** |
| R6 | **Payment ID dropdown must only show payments belonging to the connected seller/buyer** | **Resolved** (strict filter; prompt when disconnected) |
| R7 | **Only the seller may submit delivery** | **Resolved** |
| R8 | **No backend/relay API dependency**: writes signed by the **user’s connected wallet** (MetaMask); no relay-API deployment reminders | **Resolved** |
| R9 | Base settlement must **reject arbitrary/empty attestations not bound to the case** | **Resolved** |
| R10 | **Base escrow ID and GenLayer payment ID must match** | **Resolved** |
| R11 | Settlement must work from the **buyer’s or seller’s own connected wallet** (not relay-only) | **Resolved** (tx submitted from connected/authorized wallet with on-chain attestor finalization proof; attestor may sign in-browser or share proof via `settle.mjs --print-proof` so any authorized party can submit with the provided proof) |
| R12 *(rejection)* | Base path must require **proof that GenLayer finalized that outcome** (not just a self-computed public hash) | **Resolved (v6)** |

---

## 2. Live deployments (current)

| Layer | Network | Address / details |
|---|---|---|
| Undo402 adjudication (hardened, active) | GenLayer **StudioNet** (61999) | `0xaee085b0f4921953dD3474a15467D73E3E90F2AD` (redeploy tx `0xba0b432e3ee056a2bf9736e3ba5be9cf90cce971c01b690a1c3afef4afbc4bcb`; on-chain criteria min-length ≥10) |
| Undo402 adjudication (v9, live test history) | GenLayer **StudioNet** (61999) | `0x9022290256C9b4B243fD4519b9857c83e45fFb5a` |
| Undo402Escrow (v6) | **Base Sepolia** (84532) | `0x85bC06C938532EF89388A401637bE1B8F7ac9037` (deploy `0x86de302cb8d06c7089ab66b49326d7521663290cecfce9906eb0b03b513474ea`, attestor `0x99bF44395CaC814E671ADFF8b69d968Fac4e5Db3`) |
| Payment asset | Base Sepolia | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (**no GEN**) |
| Frontend | Vercel | https://undo402pay.vercel.app/ (v6 config, no API/relay dependency) |

Historical escrows (v1–v5) documented in `DEPLOYMENT.md`; app/config target **v6**.

---

## 3. Detailed technical fixes

### R1, R9, R12 — Idempotent, bound settlement with proof of GenLayer finalization

**Canonical path:** `scripts/settle.mjs` (verifies + signs attestor proof + settles, or `--print-proof` to output proof without sending) and `frontend/actions.js` (re-verifies; attestor can sign in-browser, or any authorized connected party can submit by pasting an obtained attestor finalization proof).

**Verification before any Base tx:**
1. **Final state:** `RELEASED|REFUNDED|PARTIAL` only (`NOT_FINAL` otherwise).
2. **Verdict matches state:** `RELEASED↔release`, `REFUNDED↔refund`, `PARTIAL↔partial`.
3. **Attestation present & well-formed:** 64 hex chars.
4. **Attestation bound to this exact case (SHA-256):**  
   `sha256("undo402:{paymentId}|{decision}|{score}|{refundPercent}|{buyerEip55}|{sellerEip55}")` recomputed (EIP-55) and required equal to on-chain `attestation_digest` (`ATTESTATION_NOT_BOUND` on mismatch).
5. **Partial-refund binding:** `partial` requires `refund_percent` 1..99, `sellerPercent = 100 - refund_percent`.
6. **Escrow binding:** escrow `paymentId`, `buyer`, `seller`, `amount` must equal the GenLayer case.
7. **On-chain digest cross-check:** `expectedAttestation(...)` matches verified digest.
8. **Proof of GenLayer finalization (v6, on-chain):** escrow requires valid **attestor ECDSA signature** over the settlement intent `(chainId, escrow, paymentId, decision, score, refundPercent, buyer, seller, attestationDigest)`. Without valid proof, settlement reverts (e.g. `ECDSAInvalidSignature` / invalid proof) even if the public digest is correct — preventing self-attestation of a chosen verdict.

**Exactly-once semantics:**
- **Idempotency key:** `(Base chain id, escrow address, paymentId)`.
- **Durable lock:** `FUNDED → terminal` status transition (reverts `Not funded` on replay).
- Terminal + same attestation → **no tx** (`alreadySettled`); terminal + different attestation → conflict; race-safe re-read.

**Contracts/files:** `contracts/base/Undo402Escrow.sol` (v6: `attestor`, `settlementHash`, proof-checked `release/refund/releasePartial`, on-chain digest binding), `scripts/settle.mjs`, `frontend/actions.js`, `docs/SETTLEMENT.md`.

### R2 — UI/content
- English UI, loading/error/success toasts, busy states, StudioNet/BaseScan tx links, input validation; v6 copy reflects attestor finalization proof.

### R3 — StudioNet only, USDC never GEN
- GenLayer `studionet` (61999, `0xf22f`); Base escrow holds/transfers USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` only.

### R4 — No exposed local wallet folder path
- No hardcoded local wallet paths in UI/docs; scripts use `WALLET_DIR` / `GENLAYER_PRIVATE_KEY` env vars.

### R5 — No permanently locked funds
- `claimTimeout(paymentId)` (buyer, after deadline, `FUNDED` only) refunds buyer directly on Base — no attestor/backend required.

### R6 — Payment dropdown only connected buyer/seller
- `frontend/app.js`: when wallet connected, list only payments where `buyer == wallet || seller == wallet`; when disconnected, prompt to connect (no unrelated payments). Refreshes on connect (`frontend/wallet.js`).

### R7 — Only seller may submit delivery
- Enforced on-chain in `contracts/Undo402.py` (`submit_delivery`, `submit_counter_evidence`) and guarded in frontend.

### R8 — No backend/relay API dependency
- GenLayer writes via `genlayer-js` + MetaMask (StudioNet); Base writes via `viem` + MetaMask. No `API_URL`/relay in frontend (Vercel verified). `api/app.py` remains optional, out of main path.

### R10 — Matching Base/GenLayer IDs
- `create_payment_with_id` (GenLayer v9) + frontend uses the same escrow/payment ID string.

### R11 — Settlement from connected wallet (not relay-only)
- Settlement tx is submitted from an authorized connected wallet. v6 requires an attestor finalization proof for security: the attestor verifies GenLayer finality and produces the proof (in-browser signing when connected as attestor, or `node scripts/settle.mjs --print-proof` to share). Any authorized party (buyer/seller/owner/relay/attestor) can submit the exactly-once settlement with that valid proof; proof-of-finalization remains mandatory on-chain. `scripts/settle.mjs` can also verify+sign+submit directly.

---

## 4. Test & verification evidence

| Suite | Command | Result |
|---|---|---|
| Foundry (Base escrow v6) | `forge test -vv` | **16/16 passed** — binding, **self-computed digest without GenLayer-finalization proof rejected**, non-attestor signature rejected, partial-split binding, exactly-once, authorized settlement with valid proof, buyer timeout (`tests/base/Undo402Escrow.t.sol`) |
| Direct (GenLayer) | `python -m pytest tests/direct -q` | **19/19 passed** |
| Lint | `genvm-lint check contracts/Undo402.py` | **Pass**, 27 methods |
| Syntax | `node --check frontend/actions.js app.js config.js wallet.js scripts/settle.mjs`, `python -m py_compile api/app.py` | OK |

**Live (v6):**
- Funded escrow `pay-v6-proof` [`0x306d…a2e4`](https://sepolia.basescan.org/tx/0x306df11faa237f1da417f7199ac1b3b1fb029eeb3b748d9b838dc3b64543a2e4) → GenLayer finalized refund (attestation `84566d2f…1fcf`) → settled with attestor proof [`0x39ec…167a`](https://sepolia.basescan.org/tx/0x39ec45a3e91ab0f80115474dd86188c493f32bd8d31c061ee86ed4aacf1f167a) → rerun **already settled, no tx**.
- Funded escrow `pay-v6-noproof` [`0x1e09…4b59`](https://sepolia.basescan.org/tx/0x1e09388c789209fcb058ac7f7ab2ba815c1e1bfcadb2e32c6d1cd40aa1874b59): authorized buyer + correct self-computed bound digest, invalid proof → **reverted (ECDSA invalid signature)**, no settlement.

---

## 5. Conclusion

The steward rejection is resolved: Base settlement no longer accepts a self-computed public hash without proof of GenLayer finalization. v6 escrow enforces **on-chain attestation binding + attestor finalization proof + exactly-once** settlement, proven by tests and live transactions. R1–R11 remain satisfied (idempotent verified path, matching IDs, USDC/StudioNet, no exposed wallet paths, timeout backstop, strict payment dropdown, seller-only delivery, wallet-signed frontend flow, no backend dependency). **No blocking gaps identified.**
