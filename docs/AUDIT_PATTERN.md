# Pattern Audit — InternetCourt vs TreasuryPilot vs Nexa vs Undo402

> Audit of the three reference projects' actual code (cloned & read) to correct Undo402's pattern before building further. Sources: `genlayer-foundation/internetcourt` (contracts/InternetCourt.py, InternetCourtFactory.py, solidity/Agreement.sol, ARCHITECTURE.md), `sandragcarrillo/TreasuryPilot` (contracts/treasury_pilot.py, 1133 lines), `mrnetwork0001/Nexa` (src/server.mjs, src/genlayer.mjs).

## 1. InternetCourt — dual-chain, per-case, three-key

**Architecture:** Base (Solidity, per-case `Agreement.sol` via Factory) holds USDC escrow + terms. GenLayer (`InternetCourt.py`) is only the AI jury (Resolution key). LayerZero V2 bridge connects them — used *only* on disagreement.

**Key patterns:**
- **Per-case contract, not a shared registry.** Each dispute is its own deployed contract (factory pattern). Isolation: one bad case cannot block others.
- **Three-key system:** Agent A + Agent B mutual agreement (2-of-2) resolves instantly with no jury. AI jury is 1-of-1 tiebreaker only on disagreement. `propose_outcome` from both sides; if proposals differ → auto-dispute.
- **Lifecycle:** `CREATED → ACTIVE → DISPUTED → RESOLVING → RESOLVED / CANCELLED`, with `accept_contract` by party B (joins free), `cancel` by creator, `joinDeadline` + `reclaimOnExpiry`, 90-day inactivity timeout, evidence deadline, `resolveByDefault` (default judgment if one side never submits evidence).
- **Evidence definitions** (`evidence_defs` JSON: types + `max_chars` per party), validated on submission; auto-resolve when both evidenced.
- **Pull-based withdrawals:** `pendingWithdrawals` mapping + `claimFunds()` instead of push transfers.
- **Anti-manipulation prompt rules:** explicit IGNORE list (citations, statistics, authority claims, "SYSTEM:" injections).
- **Verdict enum:** `PARTY_A / PARTY_B / UNDETERMINED` (statement truth, not money directly).
- **Weaknesses to NOT copy:** uses `py-genlayer:latest` (rejected on networks — we pin correctly), `ValueError` instead of `gl.vm.UserError` (no error classification), and `prompt_non_comparative` (validator judges leader output vs criteria — weaker than a custom rerun validator).

## 2. TreasuryPilot — single contract, relay + x402, layered verdicts

**Architecture:** One large GenLayer contract on StudioNet (`0x7961...`). GenLayer is **evaluator only** — it never holds funds. Money is USDC on **Base mainnet via x402** (Coinbase facilitator); the project receives USDC directly per call ($0.25–$2.00/route) and **does not custody user funds**.

**Key patterns:**
- **Trusted relay + `actor_address`:** every write method takes `actor_address` first. `_resolve_actor()` accepts the claim only if caller is the trusted relay (vouches via off-chain signature) or caller == actor. This lets Base/x402 users act without holding GEN. **Undo402 lacks this — our users must hold GEN and call directly.**
- **Layered verdicts:** AI verdict + **human decision layer** (owner/admin final word, never replaces AI — layers on top) + **appeal layer** + modification window + auto-approve (below USD threshold, with veto window). Undo402 has none of these.
- **UNDETERMINED as first-class:** when consensus fails, the leader's preliminary view is surfaced with disputed-field markers + a **free retry** (server-side retry-claim store, Upstash KV SETNX). Paid evaluations are never silently swallowed.
- **Prompt engineering (STEP 0–4):** integrity check / prompt-injection detection ("modify" + high risk if injected), red-team concerns, budget arithmetic, historical baseline, decision tree (approve/reject/modify with anti-hedge rule), scoring rubrics.
- **Tight validator:** custom `run_nondet_unsafe` — `recommendation`, `risk_level`, `roi_assessment` must match **exactly**, `alignment_score` within **±1**. Returns only scalar fields (GenLayer calldata rejects floats).
- **Storage discipline:** dataclasses (`u32`/`i32`), composite `TreeMap[str, ...]` keys, JSON lists for indexes, `program_spent` budget tracking. Note: historical baseline loops over all proposals — O(n) compute risk at scale.

## 3. Nexa — bridge orchestrator, triple proof, no contract source

**Architecture:** GenLayer (StudioNet) is **AI execution only**. Payment is **Stellar MPP** (HTTP 402, USDC or XLM via Soroban SAC). Attestation is **Stellar `Memo.hash`** (SHA-256). The Express bridge server orchestrates everything.

**Key patterns:**
- **Triple on-chain proof per job:** Stellar payment tx + Stellar attestation tx + GenLayer consensus tx, all linked in the UI ("OnChain Verification" panel) + downloadable PDF certificate.
- **Attestation digest:** `SHA-256("nexa:audit:{screeningId}|{verdict}|{score}|{wallet}")` anchored via a self-payment `Memo.hash` tx. Anyone can recompute and verify. **Undo402 has no attestation — verdicts live only in GenLayer.**
- **MPP guard:** HMAC-bound challenges, canonical JSON, DID verification (`did:pkh:stellar:...` vs tx `from`), Soroban simulation before settle, 5-minute challenge expiry, fee sponsorship (zero gas for users), dual-currency 402.
- **UNDETERMINED handling in client:** `genlayer.mjs` detects `consensus_result == "undetermined"` and throws a typed `CONSENSUS_UNDETERMINED` error with retry guidance.
- **⚠️ Anti-pattern / gap:** the GenLayer contract source is **not in the repo** — only a deployed address (`0x9CE0...`). Reproducibility and auditability suffer. Undo402 correctly publishes source; keep it that way.

## 4. Common patterns across all three

1. **GenLayer never directly holds real USDC** (except InternetCourt's Base escrow). The payment rail is always external (Base x402, Stellar MPP); GenLayer decides, a relay/bridge executes.
2. **Fast/mutual path before AI jury** — never pay LLM cost when parties agree.
3. **UNDETERMINED is a designed state**, with retry — not an afterthought.
4. **Human/relay layer on top of AI** — AI recommends, humans/relays finalize.
5. **Deadlines + default judgments** — evidence windows, join deadlines, inactivity timeouts.
6. **Off-chain orchestrator** (API/bridge server) handles cross-chain; GenLayer only decides.

## 5. Gap analysis — Undo402 MVP vs. reference patterns

| Pattern | InternetCourt | TreasuryPilot | Nexa | Undo402 MVP | Verdict |
|---|---|---|---|---|---|
| External USDC rail | Base escrow | Base x402 (no custody) | Stellar MPP | GEN proxy only, `payment_proof` unverified string | ⚠️ MVP ok, Phase 2 must add relay + verification |
| Relay / `actor_address` | API signed txs | ✅ trusted relay | ✅ bridge server | ❌ direct GEN wallet only | ❌ **Missing — add in Phase 2** |
| Mutual agreement (2-of-2) | ✅ propose/confirm | auto-approve + veto | n/a | accept only, buyer-only | ⚠️ Add propose/confirm |
| Per-case isolation | ✅ factory per case | single registry | n/a | single registry | ⚠️ Acceptable MVP, factory in Phase 2 |
| Evidence definitions + limits | ✅ max_chars, deadline | evidence_urls str | backend only | ❌ no limits | ❌ Add |
| Deadlines / defaults | ✅ join, evidence, inactivity, default judgment | modification/appeal windows | challenge expiry | payment deadline only | ⚠️ Partial |
| UNDETERMINED + retry | ✅ verdict enum | ✅ preliminary + free retry | ✅ typed error | ❌ ignored | ❌ **Add** |
| Human override / appeal | manual override (UI) | ✅ layered | n/a | ❌ | ❌ Phase 3 |
| Prompt-injection defense | ✅ IGNORE list | ✅ STEP 0 integrity | n/a | ❌ basic prompt | ❌ Add (copy TreasuryPilot STEP 0) |
| Validator strictness | non_comparative (weak) | exact + ±1 score | n/a (client) | exact decision + ±30 score | ⚠️ Tighten to ±10 or ±5, require refund% bucket match |
| Payout style | pull (`claimFunds`) | no custody | n/a | push (`emit_transfer`) | ⚠️ Push is ok MVP; pull safer at scale |
| Attestation on payment chain | bridge verdict to Base | BaseScan tx links | ✅ SHA-256 Memo.hash | ❌ | ❌ Phase 2 |
| Contract source published | ✅ | ✅ | ❌ missing | ✅ | ✅ Keep |
| Pinned runner | ❌ `latest` | ✅ pinned | n/a | ✅ pinned | ✅ We are correct |
| Error classification | ❌ `ValueError` | ✅ `UserError` | n/a | ✅ prefixes | ✅ We are correct |

## 6. What to fix (priority order)

**P0 — before any mainnet/Bradbury claim:**
1. Add **UNDETERMINED** verdict + retry path (never silently fail a paid dispute).
2. Tighten validator: score tolerance ±30 → ±10, and require `refund_percent` bucket agreement (0 / 1–99 / 100).
3. Add **STEP 0 prompt-injection check** + anti-manipulation IGNORE list (copy TreasuryPilot + InternetCourt).
4. Add evidence limits (`max_chars`) and an **evidence deadline** with default judgment.

**P1 — for real multi-rail (USDC/x402):**
5. Add **trusted relay + `actor_address`** (copy TreasuryPilot `_resolve_actor`) so Base users don't need GEN.
6. Verify `payment_proof` (x402 facilitator receipt / tx hash) via deterministic RPC before adjudication — currently just a string.
7. Add **verdict attestation** on the payment chain (copy Nexa: SHA-256 digest anchored / recorded).

**P2 — product hardening:**
8. Mutual **propose/confirm** (2-of-2) path; per-case factory isolation; pull-based withdrawals; human override + appeal layers.

**Keep as-is (we are already better):** pinned runner, `UserError` classification, custom rerun validator, published contract source, atto-scale amounts.

## 7. Revised Undo402 pattern (target)

```
External rail (Base USDC via x402 / card ref)
   │  payment_proof verified by relay (facilitator receipt)
   ▼
Relay (actor_address) ──► Undo402 GenLayer contract
   │                        ├─ mutual propose/confirm (2-of-2, no jury)
   │                        ├─ dispute → evidence (defs + deadline)
   │                        └─ resolve_dispute → verdict {refund|release|partial|undetermined}
   │                              │
   ▼                              ▼
Verdict attestation (SHA-256) ──► Relay executes USDC settlement on Base
   Human override / appeal layer on top (Phase 3)
```
