# Base escrow — real USDC movement

`Undo402Escrow.sol` holds **real USDC** on Base. GenLayer never touches USDC; the finalized verdict and its bound attestation authorize the transfer.

## Deploy (Base Sepolia)

```bash
# Faucets needed:
# - Base Sepolia ETH (gas): Alchemy / Coinbase / QuickNode faucet
# - Test USDC: Circle testnet faucet, or deploy MockUSDC (InternetCourt pattern)

forge create --rpc-url https://sepolia.base.org \
  --private-key $PK contracts/base/Undo402Escrow.sol:Undo402Escrow \
  --constructor-args <USDC_ADDRESS>
```

## Flow

1. Buyer `approve(escrow, amount)` + `createEscrow("pay-v5-demo", seller, 1000000, ttl)` on Base
2. Buyer calls `Undo402.create_payment_with_id("pay-v5-demo", ..., payment_proof=<Base tx>)` on StudioNet — the same ID on both chains
3. Seller delivers, buyer disputes (or mutual agreement)
4. `resolve_dispute` on GenLayer → verdict + `attestation_digest`
5. Buyer or seller (or relay/owner) calls `release("pay-v5-demo", score, digest)`, `refund(...)`, or `releasePartial(...)`
6. USDC moves to seller/buyer; attestation recorded on-chain as cross-chain proof

The escrow recomputes the SHA-256 digest on-chain, so an empty or arbitrary
attestation reverts with `Attestation not bound to case`, and the
`FUNDED → terminal` transition makes settlement exactly-once.

## Why Base Sepolia + StudioNet?

- StudioNet: stable, gasless GenLayer adjudication (locked decision)
- Base Sepolia: real USDC ecosystem, x402 facilitator compatible, EVM escrow
- GEN is not used as payment asset anywhere in this flow
