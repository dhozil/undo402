# Base escrow — real USDC movement

`Undo402Escrow.sol` holds **real USDC** on Base. GenLayer never touches USDC; the relay bridges verdicts.

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

1. Buyer `approve(escrow, amount)` + `createEscrow("pay-1", seller, 1000000)` on Base
2. Relay verifies Base tx, calls `Undo402.create_payment(..., payment_proof=<tx>, amount_usdc=1000000)` on StudioNet
3. Seller delivers, buyer disputes (or mutual agreement)
4. `resolve_dispute` on GenLayer → verdict + `attestation_digest`
5. Relay calls `release("pay-1", attestation)` or `refund("pay-1", attestation)` on Base escrow
6. USDC moves to seller/buyer; attestation recorded on-chain as cross-chain proof

## Why Base Sepolia + StudioNet?

- StudioNet: stable, gasless GenLayer adjudication (locked decision)
- Base Sepolia: real USDC ecosystem, x402 facilitator compatible, EVM escrow
- GEN is not used as payment asset anywhere in this flow
