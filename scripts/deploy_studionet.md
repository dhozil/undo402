# Deploy to StudioNet

Target: **StudioNet only** — chain ID 61999, RPC `https://studio.genlayer.com/api`, explorer `explorer-studio.genlayer.com`. This is a locked decision: Undo402 targets StudioNet for stability. Gasless: no GEN funding required; use the 💧 faucet button in Studio if needed.

## Option A — GenLayer Studio (browser, fastest)

1. Open https://studio.genlayer.com
2. Deploy `contracts/Undo402Factory.py` first (no constructor args), then `register_type("undo402-case")`.
3. Deploy `contracts/Undo402.py` per case (no constructor args), then `register_case(case_address, "undo402-case", params)` on the factory.
4. Interact via the Studio UI on the case contract:
   - `create_payment` (payable): seller address, rail (`x402` / `chain` / `card`), criteria, payment_proof, ttl_seconds — set value to e.g. `1000000000000000000` (1 GEN).
   - `submit_delivery`, `open_dispute`, `resolve_dispute`, `get_payment`.

## Option B — CLI

```bash
npm install -g genlayer
genlayer network set studionet
genlayer network info
genlayer deploy --contract contracts/Undo402.py
```

## Demo scenarios

1. **Happy path:** buyer creates payment → seller submits delivery URL → buyer accepts → `RELEASED`.
2. **Refund path:** buyer creates payment → seller submits `https://example.com/` (does not meet criteria) → buyer opens dispute → anyone calls `resolve_dispute` → validators judge → `REFUNDED`.
3. **Timeout path:** no delivery, warp past deadline → buyer `claim_timeout` → `REFUNDED`.

## Verification checklist

- Run `genvm-lint check contracts/Undo402.py` and `pytest tests/direct/ -v`.
- Note: ERC-20 / USDC `@gl.evm.contract_interface` calls are not functional in Studio (docs: Studio limitation). On StudioNet, use GEN escrow as the chargeback pool and verify external USDC `payment_proof` via the off-chain relay — do not rely on on-chain ERC-20 transfers from the IC.
