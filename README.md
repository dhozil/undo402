<div align="center">

# ↩ Undo402

### Undo for x402. Stablecoin payments with chargeback — one dispute API across cards, x402, and any chain.

[![StudioNet](https://img.shields.io/badge/GenLayer-StudioNet-61999-2dd4a7)](https://studio.genlayer.com)
[![Base Sepolia](https://img.shields.io/badge/Base-Sepolia-USDC-0a7d5c)](https://sepolia.basescan.org)
[![Tests](https://img.shields.io/badge/tests-33_passing-0a7d5c)](tests/)
[![Contract](https://img.shields.io/badge/Undo402-0xaee0…2AD-7c5cff)](https://explorer-studio.genlayer.com/address/0xaee085b0f4921953dD3474a15467D73E3E90F2AD)
[![Escrow](https://img.shields.io/badge/Escrow-0x85bC…9037-e4572e)](https://sepolia.basescan.org/address/0x85bC06C938532EF89388A401637bE1B8F7ac9037)

**Agentic Commerce Infrastructure** — real USDC escrows on Base, decentralized AI-validator adjudication on GenLayer.

[Live Demo](#-live-demo) · [How it works](#-how-it-works) · [Architecture](#-architecture) · [Contracts](#-contracts) · [API](#-api) · [Deploy](#-deploy)

</div>

---

## 📌 Live demo

| Layer | Network | Address |
|---|---|---|
| **Undo402** (adjudication, hardened) | StudioNet 61999 | `0xaee085b0f4921953dD3474a15467D73E3E90F2AD` |
| Undo402 v9 (live test history) | StudioNet 61999 | `0x9022290256C9b4B243fD4519b9857c83e45fFb5a` |
| **Undo402Escrow** (USDC) | Base Sepolia 84532 | `0x85bC06C938532EF89388A401637bE1B8F7ac9037` |
| **USDC** (testnet) | Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

✅ **Proven live:** refund · release · partial — all three verdicts settled in real USDC on Base.

```bash
# Frontend (static, Vercel-ready)
cd frontend && python -m http.server 8099
# → http://localhost:8099
```

All writes are signed by the wallet you connect (MetaMask) — no backend or custodied key.

---

## ❓ Why Undo402?

| | x402 alone | Cards | **Undo402** |
|---|---|---|---|
| Finality | Irreversible, no recourse | Chargeback (slow, $35–50) | **Verdict in minutes** |
| Agent-native | ✅ | ❌ | ✅ |
| Neutral arbiter | ❌ | ❌ (network decides) | ✅ **5 AI validators** |
| Multi-rail | x402 only | Card only | ✅ **cards · x402 · any chain** |

> Every layer of the agentic stack engineers the happy path. **None ships dispute resolution.** Undo402 is that missing layer.

---

## ⚙️ How it works

```
Buyer pays USDC ──▶ Base escrow (locked)
                        │ payment_proof recorded
                        ▼
Seller delivers ──▶ GenLayer Undo402 ──▶ AI jury (5 validators)
                        │ verdict + SHA-256 attestation
                        ▼
Connected wallet settles ──▶ release / refund / partial
```

1. **Pay** — buyer locks USDC in `Undo402Escrow` (Base Sepolia)
2. **Deliver** — seller submits a URL; buyer accepts, mutual-agrees (2-of-2), or disputes
3. **Adjudicate** — GenLayer validators independently judge delivery vs criteria (exact decision consensus, score ±10)
4. **Settle** — the app re-checks the finalized verdict and attestation binding, then settlement is executed with an **attestor finalization proof** (ECDSA signature produced after verifying GenLayer finality) so a party cannot self-attest a chosen verdict by computing the public hash alone. The attestor can sign in-browser, or share the proof (e.g. `scripts/settle.mjs --print-proof`) so any authorized party (buyer/seller/owner/relay) can submit settlement with the provided proof; settlement is exactly-once.

**Anti-stuck by design:** buyer timeout claim on Base · evidence deadline + default judgment · prompt-injection defense (STEP 0) · human override layer · `undetermined` = free retry, never silent failure.

---

## 🏗 Architecture

```
┌──────────────┐   ┌──────────────────┐
│  AI Agents   │──▶│  Buyer / Seller  │──▶ GenLayer StudioNet
│  (buyer/seller)  │  connected wallet│    Undo402 (Python)
└──────────────┘   └────────┬─────────┘   └─────────┬──────────┘
                            │ verdict+attestation  │
                            ▼                      │
                 verify digest + verdict ◀─────────┘
                            │ release/refund/partial
                 ┌──────────▼──────────┐
                 │  Base Sepolia       │
                 │  Undo402Escrow      │
                 │  (real USDC)        │
                 └─────────────────────┘
```

| Component | File | Role |
|---|---|---|
| **Undo402** | `contracts/Undo402.py` | Adjudication + factory registry (single contract, 27 methods) |
| **Undo402Escrow** | `contracts/base/Undo402Escrow.sol` | Real USDC escrow on Base |
| **Frontend** | `frontend/` | Landing · How · Integrations · Dashboard · Contracts |
| **Tests** | `tests/direct/` + `tests/base/` | 19 direct + 16 Foundry (binding, finalization proof, exactly-once) |

---

## 🔌 Contracts API

### Undo402 (GenLayer)

```python
create_payment(actor, seller, rail, criteria, payment_proof, amount_usdc, ttl)  # auto id pay-N
create_payment_with_id(actor, payment_id, seller, rail, criteria, payment_proof, amount_usdc, ttl)  # Base escrow id == case id
submit_delivery(actor, payment_id, delivery_url, note)
accept / claim_timeout / open_dispute / submit_counter_evidence
propose_outcome(actor, payment_id, outcome)        # 2-of-2 mutual, no jury
resolve_dispute(payment_id)                        # AI jury → refund/release/partial/undetermined
human_resolve(payment_id, decision)                # owner override, no LLM
register_type / register_case / get_cases_by_*     # factory registry (merged)
get_payment / get_payments / get_case_count        # views
```

### Undo402Escrow (Base)

```solidity
createEscrow(paymentId, seller, amount, ttlSeconds)                          // buyer locks USDC
release(paymentId, score, attestation, proof)                                // → seller
refund(paymentId, score, attestation, proof)                                 // → buyer
releasePartial(paymentId, sellerPercent, score, attestation, proof)          // → split
claimTimeout(paymentId)                                                      // buyer, after deadline (anti-stuck)
```

Every settlement call must present (1) the SHA-256 attestation GenLayer produced
for that exact case — the escrow recomputes it on-chain (payment id, verdict,
score, refund split, buyer, seller), so empty or arbitrary/unbound attestations
revert — and (2) an **attestor signature** (`proof`) certifying that the case was
finalized on GenLayer. This prevents a buyer/seller from settling a chosen
verdict by computing the public hash alone. Settlement is exactly-once
(`FUNDED → terminal`). See [`docs/SETTLEMENT.md`](docs/SETTLEMENT.md).

---

## 🚀 Deploy

```bash
# GenLayer (StudioNet, gasless)
genlayer network set studionet
genlayer deploy --contract contracts/Undo402.py
genlayer write <UNDO402> set_relay --args "<RELAY_ADDRESS>"
genlayer write <UNDO402> register_type --args "undo402-case"

# Base Sepolia (needs ETH + test USDC from faucets)
forge create --broadcast --rpc-url https://sepolia.base.org \
  --private-key $PK contracts/base/Undo402Escrow.sol:Undo402Escrow \
  --constructor-args <USDC_ADDRESS> <ATTESTOR_ADDRESS>

# Frontend → Vercel (see VERCEL.md)
vercel --prod   # Root Directory: frontend
```

---

## 📂 Project layout

```
contracts/
  Undo402.py                  # GenLayer adjudication (single contract)
  base/Undo402Escrow.sol      # Base USDC escrow
frontend/  index.html · app.js · actions.js · router.js · styles.css
scripts/   settle.mjs · e2e_*.mjs · wallet.mjs
tests/     direct/test_undo402.py · base/Undo402Escrow.t.sol
docs/      SETTLEMENT · ANALYSIS · ARCHITECTURE · AUDIT_PATTERN · GENLAYER_REVIEW
DEPLOYMENT.md · VERCEL.md
```

---

## 🧪 Testing

```bash
genvm-lint check contracts/Undo402.py   # lint + validate
pytest tests/direct/ -v                  # direct tests
forge test -vv                           # escrow binding + finalization proof + exactly-once (16 tests)
WALLET_DIR=/path/to/wallet node scripts/settle.mjs --payment pay-1 --check
```

---

## 📚 Docs

- [`docs/SETTLEMENT.md`](docs/SETTLEMENT.md) — idempotent verdict → Base settlement path, attestation binding
- [`docs/ANALYSIS.md`](docs/ANALYSIS.md) — market & ecosystem (Internet Court, x402, ERC-8004)
- [`docs/AUDIT_PATTERN.md`](docs/AUDIT_PATTERN.md) — pattern audit vs InternetCourt / TreasuryPilot / Nexa
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — equivalence principle, multi-rail design
- [`docs/GENLAYER_REVIEW.md`](docs/GENLAYER_REVIEW.md) — networks, GEN token, stablecoin support
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — live addresses & E2E records

---

<div align="center">

**Undo402** — stablecoin payments with chargeback. GenLayer adjudicates, Base settles.

Released under MIT · Built on [GenLayer](https://docs.genlayer.com) + [x402](https://x402.org)

</div>
