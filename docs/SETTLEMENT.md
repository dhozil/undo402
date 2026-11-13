# Settlement path — GenLayer verdict → Base escrow, exactly once

This is the repository path the steward asked to identify:

| What | Where |
|---|---|
| **Idempotent settlement** | [`scripts/settle.mjs`](../scripts/settle.mjs) |
| **On-chain binding check** | [`contracts/base/Undo402Escrow.sol`](../contracts/base/Undo402Escrow.sol) (`release`, `refund`, `releasePartial`) |
| **In-app settlement** | Dashboard buttons in [`frontend/actions.js`](../frontend/actions.js) — same checks, signed by the connected wallet |
| **Tests** | [`tests/base/Undo402Escrow.t.sol`](../tests/base/Undo402Escrow.t.sol) (`forge test`) |

## What it guarantees

`scripts/settle.mjs` reads a **finalized** GenLayer case with
`get_payment(payment_id)` and refuses to continue unless all of the following
hold:

1. **Final state** — `state` is `RELEASED`, `REFUNDED`, or `PARTIAL`.
   `FUNDED`, `DISPUTED`, and `undetermined` cases are never settled.
2. **Verdict matches state** — `RELEASED↔release`, `REFUNDED↔refund`,
   `PARTIAL↔partial`.
3. **Attestation is real and bound to this case** — the script recomputes,
   byte-for-byte:

   ```
   sha256("undo402:{paymentId}|{decision}|{score}|{refundPercent}|{buyer}|{seller}")
   ```

   with EIP-55 checksummed addresses, and requires it to equal the on-chain
   `attestation_digest` (64 hex chars). Empty or arbitrary attestations fail
   before any Base transaction is built.
4. **Partial-refund binding** — for `partial`, `refund_percent` must be 1..99
   and the seller share is derived as `100 - refund_percent`. A verdict cannot
   be replayed with a different split.
5. **Escrow binding** — the Base escrow's `paymentId`, `buyer`, `seller`, and
   `amount` must equal the GenLayer case. A digest for another case, another
   party, or another verdict is rejected.
6. **Base supports the same check on-chain** — the escrow recomputes the same
   SHA-256 digest (including EIP-55 checksums) from its stored buyer/seller.
   It reverts with `Empty attestation`, `Attestation must be 64 hex chars`,
   `Invalid hex in attestation`, or `Attestation not bound to case`.

## Who can settle

The buyer, the seller, the relay, or the owner. In the app, the buyer and
seller use **their own connected wallet** — the browser re-verifies the digest
and then asks MetaMask to sign. No backend key is involved. Because the
attestation pins the verdict, score, split and both parties, the caller can
only execute the outcome GenLayer already produced.

## Matching IDs (required)

Base escrow `paymentId` and GenLayer `payment_id` must be the **same string**.
Use `create_payment_with_id(...)` (v9) from the dashboard; the legacy
`create_payment(...)` still auto-generates `pay-N` but is not suitable when the
escrow was created first.

## Exactly-once semantics

Idempotency key: `(Base chain id, escrow address, paymentId)`.

The escrow's `FUNDED → terminal` status transition is the durable lock:

- already terminal **with the same attestation** → exit 0, **no transaction**
- already terminal **with a different attestation** → exit 1 (conflict)
- still `FUNDED` → send the one matching settlement transaction
- a lost race (two wallets settling) re-reads the escrow and treats the
  on-chain result as authoritative instead of paying twice

Settlement cannot be replayed because the second call reverts with
`Not funded`.

## Usage

```bash
# verify only — no Base transaction
node scripts/settle.mjs --payment pay-v5-demo --check

# settle with whoever's key you pass (buyer, seller, relay or owner)
WALLET_DIR=/path/to/wallet node scripts/settle.mjs --payment pay-v5-demo

# settle every finalized case that has a matching escrow
node scripts/settle.mjs --all --json
```

Environment:

```
UNDO402_CONTRACT_ADDRESS   0x9022290256C9b4B243fD4519b9857c83e45fFb5a
ESCROW                     0xB03759B87A19776a63BD2D7f8CB2f14cDFB8f70F
GENLAYER_RPC_URL           https://studio.genlayer.com/api
BASE_RPC_URL               https://sepolia.base.org
WALLET_DIR                 folder containing seller.json (demo payer)
```

## Live proof (Base Sepolia, v5 escrow)

**Buyer-signed settlement (the app path):**

- Base escrow `pay-v5-demo` (0.1 USDC) —
  [`0xc37cd80aad4350a597b444a60995999a19c5cfdba885035cd20c154db24904b6`](https://sepolia.basescan.org/tx/0xc37cd80aad4350a597b444a60995999a19c5cfdba885035cd20c154db24904b6)
- `create_payment_with_id("pay-v5-demo")` → delivery → dispute →
  `human_resolve(refund)` → attestation
  `9b2c4d78fdb0c82ceb5e2061547b07c3ffbbdfadbe9c0b22425cb718501bb854`
- `settle.mjs` run with the **buyer** key (not the relay) refunded the escrow:
  [`0x5c66f8194274a783bc845e6f6790049b4a2df26c88ae08313e7573166de0b831`](https://sepolia.basescan.org/tx/0x5c66f8194274a783bc845e6f6790049b4a2df26c88ae08313e7573166de0b831)
- Second run returned `alreadySettled: true`, `sent: false` — no second USDC
  movement.

**Earlier proofs:** `pay-v9-demo` (0.1 USDC, relay-signed) settled at
[`0xc66dc4e77ae64f8b6ff875921ea1139c98e2ac0f8e3cbee65620452d6fea46a6`](https://sepolia.basescan.org/tx/0xc66dc4e77ae64f8b6ff875921ea1139c98e2ac0f8e3cbee65620452d6fea46a6);
`pay-1` (1 USDC) settled at
[`0x22ef5b045a835974936f64cfc2017f83d2262fe9b468562366f94983a361697f`](https://sepolia.basescan.org/tx/0x22ef5b045a835974936f64cfc2017f83d2262fe9b468562366f94983a361697f).
A `FUNDED` case was refused with `NOT_FINAL`; a made-up 64-hex attestation on
Base reverted with `Attestation not bound to case`.

## Test coverage

```bash
forge test -vv
```

14 tests cover: live digest reproduction, lowercase/checksum canonicalization,
empty/arbitrary/cross-case/cross-party/wrong-verdict/wrong-score rejection,
partial-split binding, exactly-once settlement, buyer-signed refund,
seller-signed release, outsider rejection, and the independent buyer timeout
backstop.
