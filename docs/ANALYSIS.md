# Analysis — Agentic Commerce & Why Undo402 Exists

## GenLayer in one sentence

GenLayer is the **adjudication layer for the agentic economy**: decentralized AI-validator consensus for contracts that require judgment, not just code. Bitcoin = trustless money, Ethereum = trustless computation, GenLayer = trustless adjudication.

Intelligent Contracts (Python, `gl.Contract`) can read natural language, fetch live web data, and call LLMs — no oracles. Validators independently verify the leader's result (Optimistic Democracy); the agreed result moves money on-chain.

## The agentic commerce stack (Internet Court consortium, July 2026)

27 companies formed an open standard so any two AI agents can structure a deal, hold funds, and settle disagreements:

1. Discovery, identity & reputation — ERC-7857, ERC-8004
2. Negotiation — A2A
3. Contracts & obligations — ERC-7710, ERC-8183, Arkhai
4. Payment & escrow — x402, MPP, ACP
5. Execution — OpenClaw, Hermes
6. **Verification & disputes — GenLayer, Kleros, UMA** ← our layer

Docs: *"Every layer engineers the happy path. None ships dispute resolution. GenLayer fills that gap."*

## x402: final by design — and that is the problem

Coinbase x402 revives HTTP 402: client requests → server replies 402 with price → client signs a USDC payment (EIP-3009/Permit2) → facilitator verifies & settles → server replies 200. Sub-second on L2s, <$0.001, no accounts, machine-to-machine native. Coinbase explicitly lists **"Final: no chargebacks"** as a feature. For real commerce, that means: pay first, and if the agent delivers nothing or garbage, there is no recourse.

Cards have the opposite problem: chargebacks exist but take days/weeks, cost ~$35–50 per dispute, and are not agent-native. Stripe now integrates x402 + MPP, but **no single dispute API spans cards, x402, and any chain**. That gap is Undo402.

## Prior art (proves the pattern)

- **InternetCourt** (GenLayer Foundation): statement + guidelines + evidence, USDC escrow on Base, mutual agreement or AI jury verdict (TRUE/FALSE/UNDETERMINED).
- **Entropia Escrow**: GEN deposit → delivery URL → validators fetch + LLM judges per brief requirement → RELEASED/REFUNDED. Best MVP template.
- **Tribunal / Freelance Court / AgentEscrow**: escrow + AI arbitration + payout/refund/split; AgentEscrow bridges verdicts to Base Sepolia.
- **Recourse / Clawback / AgentGuard / x402-disputes**: x402 chargeback concepts outside GenLayer — validation that the problem is real and crowded, hence the need for a distinctive name (Undo402).

## Fit check (GenLayer docs)

Undo402 fits because: real on-chain consequence (escrow payout), judgment-based outcome (does delivery meet criteria?), independently checkable evidence (public URLs), neutral consensus benefit, and a structured result (`refund` / `release` / `partial` + score). Framing: *agreed arbitration primitive*, not a legal court.

## Name

**Undo402** — "Undo for x402." Checked against GitHub: RefundRail, Rail402, settle402, Verdicta, Recoura, Chargehound, Recourse, Clawback, AgentGuard are taken. Undo402 was free. Alternatives considered: Railback, ChargeLane, Rewind402, SanggahPay.
