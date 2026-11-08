<div align="center">

# ↩ Undo402

### Undo for x402. Stablecoin payments with chargeback — one dispute API across cards, x402, and any chain.

[![StudioNet](https://img.shields.io/badge/GenLayer-StudioNet-61999-2dd4a7)](https://studio.genlayer.com)
[![Base Sepolia](https://img.shields.io/badge/Base-Sepolia-USDC-0a7d5c)](https://sepolia.basescan.org)
[![Tests](https://img.shields.io/badge/tests-16_passing-0a7d5c)](tests/direct/)
[![Contract](https://img.shields.io/badge/Undo402-0x6C7e…3660-7c5cff)](https://explorer-studio.genlayer.com/address/0x6C7ea251273aC4FDF8d3C9B36F2E3089bb4c3660)
[![Escrow](https://img.shields.io/badge/Escrow-0x2aa3…Fde8-e4572e)](https://sepolia.basescan.org/address/0x2aa335805722FfeEa8b8eE96B9e8bb2a4B20Fde8)

**Agentic Commerce Infrastructure** — real USDC escrows on Base, decentralized AI-validator adjudication on GenLayer.

[Live Demo](#-live-demo) · [How it works](#-how-it-works) · [Architecture](#-architecture) · [Contracts](#-contracts) · [API](#-api) · [Deploy](#-deploy)

</div>

---

## 📌 Live demo

| Layer | Network | Address |
|---|---|---|
| **Undo402** (adjudication) | StudioNet 61999 | `0x6C7ea251273aC4FDF8d3C9B36F2E3089bb4c3660` |
| **Undo402Escrow** (USDC) | Base Sepolia 84532 | `0x2aa335805722FfeEa8b8eE96B9e8bb2a4B20Fde8` |
| **USDC** (testnet) | Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

✅ **Proven live:** refund · release · partial — all three verdicts settled in real USDC on Base.

```bash
# Frontend (static, Vercel-ready)
cd frontend && python -m http.server 8099
# → http://localhost:8099

# API (live relay)
pip install fastapi uvicorn pydantic
UNDO402_CONTRACT_ADDRESS=0x6C7ea251273aC4FDF8d3C9B36F2E3089bb4c3660 uvicorn api.app:app --port 8000
```

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
Relay settles on Base ──▶ release / refund / partial
```

1. **Pay** — buyer locks USDC in `Undo402Escrow` (Base Sepolia)
2. **Deliver** — seller submits a URL; buyer accepts, mutual-agrees (2-of-2), or disputes
3. **Adjudicate** — GenLayer validators independently judge delivery vs criteria (exact decision consensus, score ±10)
4. **Settle** — relay executes the verdict on Base; attestation recorded as cross-chain proof

**Anti-stuck by design:** buyer timeout claim on Base · evidence deadline + default judgment · prompt-injection defense (STEP 0) · human override layer · `undetermined` = free retry, never silent failure.

---

## 🏗 Architecture

```
┌──────────────┐   ┌──────────────────┐   ┌────────────────────┐
│  AI Agents   │──▶│  Dispute API     │──▶│  GenLayer StudioNet│
│  (buyer/seller)     │  (FastAPI relay)│   │  Undo402 (Python)  │
└──────────────┘   └────────┬─────────┘   └─────────┬──────────┘
                            │ verdict+attestation  │
                 ┌──────────┴──────────┐            │
                 │  Relay (seller key) │◀───────────┘
                 └──────────┬──────────┘
                            │ release/refund/partial
                 ┌──────────▼──────────┐
                 │  Base Sepolia       │
                 │  Undo402Escrow      │
                 │  (real USDC)        │
                 └─────────────────────┘
```

| Component | File | Role |
|---|---|---|
| **Undo402** | `contracts/Undo402.py` | Adjudication + factory registry (single contract, 24 methods) |
| **Undo402Escrow** | `contracts/base/Undo402Escrow.sol` | Real USDC escrow on Base |
| **Dispute API** | `api/app.py` + `api/relay.mjs` | Live relay: frontend → StudioNet → Base |
| **Frontend** | `frontend/` | Landing · How · Integrations · Dashboard · Contracts |
| **Tests** | `tests/direct/` | 16 direct tests (payments, factory, relay, verdicts) |

---

## 🔌 Contracts API

### Undo402 (GenLayer)

```python
create_payment(actor, seller, rail, criteria, payment_proof, amount_usdc, ttl)  # records USDC payment
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
createEscrow(paymentId, seller, amount, ttlSeconds)   // buyer locks USDC
release(paymentId, attestation)                       // → seller
refund(paymentId, attestation)                        // → buyer
releasePartial(paymentId, sellerPercent, attestation) // → split
claimTimeout(paymentId)                               // buyer, after deadline (anti-stuck)
```

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
  --constructor-args <USDC_ADDRESS>

# Frontend → Vercel (see VERCEL.md)
vercel --prod   # Root Directory: frontend
```

---

## 📂 Project layout

```
contracts/
  Undo402.py                  # GenLayer adjudication (single contract)
  base/Undo402Escrow.sol      # Base USDC escrow
api/       app.py · relay.mjs # Live Dispute API relay
frontend/  index.html · app.js · router.js · styles.css
scripts/   e2e_*.mjs · api_call.mjs · wallet.mjs
tests/     direct/test_undo402.py (16 tests)
docs/      ANALYSIS · ARCHITECTURE · AUDIT_PATTERN · GENLAYER_REVIEW
DEPLOYMENT.md · VERCEL.md
```

---

## 🧪 Testing

```bash
genvm-lint check contracts/Undo402.py   # lint + validate
pytest tests/direct/ -v                  # 16 passed
UNDO402_CONTRACT_ADDRESS=0x6C7e… node scripts/e2e_wallet.mjs  # live E2E
```

---

## 📚 Docs

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
