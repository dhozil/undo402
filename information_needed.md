# Undo402 / Steward Request — Audit & Technical Resolution

**Audit date:** 2026-11-13 (re-audit after wallet-signed settlement rollout)  
**Repo:** `D:\Genlayer-project\Stablecoin-payments` (`main`)  
**Scope:** Steward critique — identify an idempotent GenLayer → Base settlement path that verifies payment ID, verdict, attestation, and partial-refund binding, and settles exactly once; plus all listed product/security requirements.

This document records each request, the implemented fix, where it lives, and the evidence that it is satisfied. Items marked **Resolved** are implemented, tested, and (where applicable) proven on live networks.

---

## 1. Steward request summary (source of truth)

| # | Request | Status |
|---|---|---|
| R1 | Identify an **idempotent GenLayer → Base settlement path** that verifies **payment ID, verdict, attestation, and partial-refund binding**, and settles **exactly once** | **Resolved** |
| R2 | All UI/content in **English**; professional glassmorphism, responsive, loading/error/success states, tx explorer links, input validation | **Resolved** (existing UI polished; settlement/error states added) |
| R3 | GenLayer target is **StudioNet only** (chain ID 61999); payment asset must be **USDC, never GEN** | **Resolved** |
| R4 | **Never expose local wallet folder path**; use `WALLET_DIR` | **Resolved** |
| R5 | **No permanently locked funds**; **timeout backstop** required | **Resolved** |
| R6 | **Payment ID dropdown must only show payments belonging to the connected seller/buyer** | **Resolved** (re-audited; strict filter enforced) |
| R7 | **Only the seller may submit delivery** | **Resolved** |
| R8 | **No backend/relay API dependency**: all writes signed by the **user’s connected wallet** (MetaMask); do not remind the user about relay API deployment | **Resolved** |
| R9 | Base settlement must **reject arbitrary/empty attestations not bound to the case** | **Resolved** |
| R10 | **Base escrow ID and GenLayer payment ID must match** so settlement can find the escrow | **Resolved** |
| R11 | Settlement must work from the **buyer’s or seller’s own connected wallet** (not relay-only) | **Resolved** |

---

## 2. Live deployments (current)

| Layer | Network | Address / details |
|---|---|---|
| Undo402 adjudication (v9) | GenLayer **StudioNet** (61999) | `0x9022290256C9b4B243fD4519b9857c83e45fFb5a` |
| Undo402Escrow (v5) | **Base Sepolia** (84532) | `0xB03759B87A19776a63BD2D7f8CB2f14cDFB8f70F` (deploy tx `0xfab1e39b76684e5f728044c6c0bd2cd72e95a45aecf1ac7c1ed016df65e667aa`) |
| Payment asset | Base Sepolia | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (**no GEN**) |
| Frontend | Vercel | https://undo402pay.vercel.app/ (serves v5 config, no API/relay dependency) |

Historical escrow versions (v1–v4) remain documented in `DEPLOYMENT.md` for traceability only; the active app/config points to **v5**.

---

## 3. Detailed technical fixes

### R1 — Idempotent GenLayer → Base settlement path (verify ID, verdict, attestation, partial-refund binding; exactly once)

**Canonical path:** `scripts/settle.mjs` (CLI/automation) and the same verification logic in `frontend/actions.js` (`baseSettle`) for wallet-signed in-app settlement.

**Verification performed before any Base transaction (`scripts/settle.mjs`, `verifyCase`):**
1. **Final state only:** `state ∈ {RELEASED, REFUNDED, PARTIAL}`. `FUNDED`/`DISPUTED`/non-final refused (`NOT_FINAL`).
2. **Verdict matches state:** `RELEASED↔release`, `REFUNDED↔refund`, `PARTIAL↔partial` (`VERDICT_STATE_MISMATCH`).
3. **Attestation present and well-formed:** 64 hex chars (`EMPTY_ATTESTATION` / `ATTESTATION_FORMAT`).
4. **Attestation recomputed and bound to this exact case** (SHA-256, byte-for-byte):
   - Payload: `undo402:{paymentId}|{decision}|{score}|{refundPercent}|{buyerEip55}|{sellerEip55}`
   - Addresses checksummed via `viem.getAddress` (EIP-55), matching `Undo402._attest()` / on-chain `computeAttestation`.
   - Mismatch → `ATTESTATION_UNBOUND`.
5. **Partial-refund binding:** `partial` requires `refund_percent` 1..99 and derives seller share as `100 - refund_percent` (1..99). Other verdicts require the correct terminal refund percent (0 for release, 100 for refund). Wrong split → `REFUND_PERCENT_INVALID`.
6. **Escrow binding:** on-chain escrow must exist and its `paymentId`, `buyer`, `seller`, `amount` must equal the GenLayer case (`ESCROW_MISSING/ID_MISMATCH/BUYER_MISMATCH/SELLER_MISMATCH/AMOUNT_MISMATCH`).
7. **On-chain digest cross-check:** script reads `expectedAttestation(...)` from the escrow contract and requires it to equal the verified digest (`BASE_DIGEST_MISMATCH`).

**Exactly-once semantics:**
- **Idempotency key:** `(Base chain id, escrow address, paymentId)`.
- **Durable lock:** escrow `FUNDED → terminal` transition (`Status` set before transfer; re-entry guarded by `require(e.status == Status.FUNDED, "Not funded")` in `_requireBound`).
- **Behavior:**
  - already terminal + same attestation → **exit 0 / `alreadySettled: true`, no transaction sent**.
  - already terminal + different attestation → **exit 1 / conflict** (`ALREADY_SETTLED_CONFLICT`).
  - `FUNDED` + valid/bound attestation → send exactly one matching settlement tx.
  - lost race (two wallets settling) → second observes terminal escrow and does not pay twice.
- **Race handling:** `settle.mjs` catches settlement reverts, re-reads escrow, and reports the authoritative on-chain outcome.

**On-chain binding (Base, defense in depth):** `contracts/base/Undo402Escrow.sol` v5 recomputes the same SHA-256 digest in `computeAttestation/_requireBound` from stored escrow `buyer/seller`, strictly decodes the 64-hex attestation, and reverts on empty/arbitrary/unbound values (`Empty attestation`, `Attestation must be 64 hex chars`, `Invalid hex in attestation`, `Attestation not bound to case`, `Not funded`).

**Live proof (v5, buyer-signed):**
- Escrow funded `pay-v5-demo` (0.1 USDC): Base tx `0xc37cd80aad4350a597b444a60995999a19c5cfdba885035cd20c154db24904b6`.
- GenLayer: `create_payment_with_id("pay-v5-demo")` → delivery → dispute → `human_resolve(refund)`; attestation `9b2c4d78fdb0c82ceb5e2061547b07c3ffbbdfadbe9c0b22425cb718501bb854`, verdict `refund`, `refund_percent 100`.
- Settled with the **buyer** key (connected-wallet path equivalent) via `scripts/settle.mjs`: Base tx `0x5c66f8194274a783bc845e6f6790049b4a2df26c88ae08313e7573166de0b831`.
- Rerun: `alreadySettled: true`, `sent: false`, **no second USDC movement**. Escrow status `REFUNDED` with matching attestation on-chain.
- Earlier proofs retained: `pay-v9-demo` tx `0xc66dc4e77ae64f8b6ff875921ea1139c98e2ac0f8e3cbee65620452d6fea46a6`; `pay-1` tx `0x22ef5b045a835974936f64cfc2017f83d2262fe9b468562366f94983a361697f`. Negative cases proven: non-final refused; arbitrary/made-up attestation reverted on-chain.

**Docs:** `docs/SETTLEMENT.md`, `DEPLOYMENT.md`.

### R2 — UI/content English, professional, responsive, states, links, validation
- UI copy in English (`frontend/index.html`, `frontend/app.js`, `frontend/actions.js`).
- Loading/success/error feedback via toasts and busy states; tx links to StudioNet explorer / BaseScan; empty/loading/error states for payment list; input validation in `frontend/actions.js` (`validate`, amount/criteria/address/proof/delivery URL checks, payment ID format).
- Vercel serves the current frontend build (verified).

### R3 — StudioNet only (61999); USDC never GEN
- GenLayer: `genlayer-js` `studionet` client, chain switch/add uses `0xf22f` (61999) in `frontend/actions.js` / `frontend/wallet.js` flow.
- Base escrow uses USDC token `0x036CbD53842c5426634e7929541eC2318f3dCF7e`; `createEscrow` transfers USDC via `SafeERC20`; no GEN token used as payment asset.

### R4 — No exposed local wallet folder path; use `WALLET_DIR`
- UI/frontend and user-facing docs do not contain local wallet directory paths.
- Scripts/API use `WALLET_DIR` or `GENLAYER_PRIVATE_KEY` env vars (e.g. `scripts/settle.mjs`, `scripts/wallet.mjs`, `api/app.py` reads env). This is an environment variable name, not a hardcoded path.

### R5 — No permanently locked funds; timeout backstop
- `claimTimeout(string paymentId)` in `contracts/base/Undo402Escrow.sol`: callable by **buyer** after `deadline`, requires `FUNDED`, refunds buyer directly (`Status.REFUNDED`, attestation marker `"timeout-claim"`). No relay/backend required.
- Frontend “Claim timeout” button calls `claimTimeout` from the connected wallet (`frontend/actions.js`).
- Covered by Foundry tests (buyer timeout still works).

### R6 — Payment ID dropdown shows only payments belonging to connected seller/buyer
- `frontend/app.js` `loadPayments`: when a wallet is connected (`window.__walletAddr`), dropdown is populated **only** with payments where `buyer == wallet || seller == wallet`. When not connected, dropdown prompts to connect (no unrelated payments shown). Selection restored only if still in the user’s set.
- `frontend/wallet.js` sets `window.__walletAddr` on connect and triggers `loadPayments()` so the dropdown refreshes immediately.
- (Re-audited in this pass; strict “no wallet → empty/prompt” behavior enforced.)

### R7 — Only the seller may submit delivery
- **On-chain (authoritative):** `contracts/Undo402.py` `submit_delivery` checks `sender != payment.seller` → `UserError("... Only seller can submit delivery")`.
- **Frontend guard:** `frontend/actions.js` blocks delivery submit when connected wallet is not the seller context for the action.
- Direct tests assert seller-only delivery (and reject non-seller).

### R8 — No backend/relay API dependency; all writes signed by connected wallet (MetaMask)
- **GenLayer writes:** `frontend/actions.js` `directWrite` uses `genlayer-js` with `account: address, provider: window.ethereum` and `eth_requestAccounts`/chain switch (StudioNet `0xf22f`) — signed by the user’s MetaMask; waits for finalization.
- **Base writes:** `baseClient/baseWrite` use `viem` `createWalletClient` over `window.ethereum`, switch to Base Sepolia (`0x14a34`), and sign from the connected account.
- **No relay/API in frontend:** `frontend/config.js` has no `API_URL`; `frontend/actions.js` / `frontend/app.js` contain no `API_URL`, no `localhost:8000`, no relay-round-trip settlement path. Vercel live `config.js`/`actions.js` verified to match.
- **`api/app.py` / FastAPI bridge:** retained as **optional** for programmatic clients only (`api/README.md` marked optional, out of main setup path); not required by the web app.

### R9 — Base settlement rejects arbitrary/empty attestations not bound to the case
- **Contract (`_requireBound` / `_decodeDigest` / `computeAttestation`):** rejects empty, non-64-hex, invalid hex, and any digest not equal to the recomputed SHA-256 for the stored escrow’s `(paymentId, decision, score, refundPercent, buyer, seller)`.
- **Client-side precheck:** `frontend/actions.js` and `scripts/settle.mjs` recompute and compare the digest and refuse to send a tx if unbound/invalid.
- **Foundry tests:** empty, arbitrary, cross-case, cross-party, wrong-verdict, wrong-score, partial-split mismatch all rejected.

### R10 — Base escrow ID and GenLayer payment ID must match
- **Contract:** `Undo402.py` v9 provides `create_payment_with_id(actor_address, payment_id, seller, rail, criteria, payment_proof, amount_usdc, ttl_seconds, evidence_urls)`; payment stored/read by that ID.
- **Frontend:** create flow uses the same Payment ID for Base escrow and `create_payment_with_id` (Step 1 / Base escrow card ID carried into GenLayer create; validation enforces ID format).
- **Settlement:** `scripts/settle.mjs` and on-chain checks bind `paymentId` in the digest and require escrow `paymentId` to equal the GenLayer case ID.

### R11 — Settlement from buyer’s or seller’s own connected wallet (not relay-only)
- **Contract v5:** `release/refund/releasePartial` call `_requireBound`, which authorizes `msg.sender == buyer || seller || relay || owner` (error `Not party/relay`). The **attestation** (not the caller alone) pins the verdict/split/parties, so an authorized party can only execute the finalized outcome.
- **Frontend:** `baseSettle` verifies the case, recomputes digest, checks the connected wallet is the case buyer or seller, then signs `release/refund/releasePartial` from that wallet (MetaMask/Base Sepolia).
- **Script:** `scripts/settle.mjs` allows buyer/seller/relay/owner signers and rejects others with `NOT_PARTY`.
- **Live proof:** `pay-v5-demo` refunded by the **buyer** wallet tx `0x5c66…b831`.

---

## 4. Test & lint evidence

| Suite | Command | Result |
|---|---|---|
| Foundry (Base escrow) | `forge test` | **14/14 passed** — binding, buyer-signed refund, seller-signed release, outsider reject, exactly-once, timeout, etc. (`tests/base/Undo402Escrow.t.sol`) |
| Direct (GenLayer contract) | `python -m pytest tests/direct -q` | **19/19 passed** (`tests/direct/test_undo402.py`, incl. custom IDs/seller-only delivery) |
| Lint | `genvm-lint check contracts/Undo402.py` | **Pass**, 27 methods |
| Syntax checks (this rollout) | `node --check frontend/actions.js app.js config.js wallet.js scripts/settle.mjs`, `python -m py_compile api/app.py` | OK |

---

## 5. Notes / non-issues (audited)

- **`onlyRelay` modifier** remains defined in `Undo402Escrow.sol` but settlement functions are party-authorized via `_requireBound`; unused modifier is non-functional/dead code (no security impact). Can be removed in a cleanup pass if desired.
- **`DEPLOYMENT.md`** still lists escrow v4 address in the historical versions table — intentional history; active/v5 addresses are clearly marked.
- **Optional bridge:** `api/app.py` and relay-capable scripts remain for programmatic use but are not part of the frontend/main user flow and do not hold/require a deployed backend for the app.
- **Party check in frontend:** in addition to the UI dropdown filter, settlement is blocked if the connected wallet is not buyer/seller for the case, and the contract enforces party/attestation binding on-chain.

---

## 6. Conclusion

All steward-requested items (R1–R11) are **implemented and evidenced**: an idempotent, bound, exactly-once GenLayer→Base settlement path exists (`scripts/settle.mjs` + on-chain enforcement in v5 escrow + in-app wallet-signed flow), with payment ID/verdict/attestation/partial-refund binding verified, arbitrary/empty attestations rejected, matching Base/GenLayer IDs, buyer-or-seller wallet settlement, no frontend backend dependency, seller-only delivery, timeout backstop, USDC-only on StudioNet, and no exposed local wallet paths. The live Vercel deployment serves the v5/wallet-signed build and a real buyer-signed settlement (`pay-v5-demo`) has been executed and proven idempotent.

**No blocking gaps identified in this audit.**
