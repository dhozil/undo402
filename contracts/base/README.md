# Base escrow — real USDC movement

`Undo402Escrow.sol` holds **real USDC** on Base. GenLayer never touches USDC; a
finalized verdict, its bound attestation, and an **attestor finalization proof**
authorize the transfer.

## Deploy (Base Sepolia)

```bash
# Faucets needed:
# - Base Sepolia ETH (gas): Alchemy / Coinbase / QuickNode faucet
# - Test USDC: Circle testnet faucet, or deploy MockUSDC (InternetCourt pattern)

forge create --rpc-url https://sepolia.base.org \
  --private-key $PK contracts/base/Undo402Escrow.sol:Undo402Escrow \
  --constructor-args <USDC_ADDRESS> <ATTESTOR_ADDRESS>
```

## Flow

1. Buyer `approve(escrow, amount)` + `createEscrow("pay-v6-demo", seller, 1000000, ttl)` on Base
2. Buyer calls `Undo402.create_payment_with_id("pay-v6-demo", ..., payment_proof=<Base tx>)` on StudioNet — the same ID on both chains
3. Seller delivers, buyer disputes (or mutual agreement)
4. `resolve_dispute` on GenLayer → verdict + `attestation_digest`
5. Authorized submitter calls `release/refund/releasePartial(..., attestation, proof)` where `proof` is the attestor's signature certifying GenLayer finalization (produced by `scripts/settle.mjs` after verification)
6. USDC moves to seller/buyer; attestation recorded on-chain as cross-chain proof

The escrow recomputes the SHA-256 digest on-chain (so empty/arbitrary/unbound
attestations revert) and requires a valid **attestor finalization proof** (so a
party cannot settle a self-computed verdict hash without GenLayer finalization).
The `FUNDED → terminal` transition makes settlement exactly-once.

## Why Base Sepolia + StudioNet?

- StudioNet: stable, gasless GenLayer adjudication (locked decision)
- Base Sepolia: real USDC ecosystem, x402 facilitator compatible, EVM escrow
- GEN is not used as payment asset anywhere in this flow
