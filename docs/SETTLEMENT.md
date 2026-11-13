# Settlement path — GenLayer verdict → Base escrow, exactly once

This is the repository path the steward asked to identify:

| What | Where |
|---|---|
| **Idempotent settlement** | [`scripts/settle.mjs`](../scripts/settle.mjs) |
| **On-chain binding check** | [`contracts/base/Undo402Escrow.sol`](../contracts/base/Undo402Escrow.sol) (`release`, `refund`, `releasePartial`) |
| **HTTP entry point** | `POST /payments/{payment_id}/settle` in [`api/app.py`](../api/app.py) (`?check=true` for verify-only) |
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

## Matching IDs (required)

Base escrow `paymentId` and GenLayer `payment_id` must be the **same string**.
Use `create_payment_with_id(...)` (v9) from the dashboard or API; the legacy
`create_payment(...)` still auto-generates `pay-N` but is not suitable when the
escrow was created first.

## Exactly-once semantics

Idempotency key: `(Base chain id, escrow address, paymentId)`.

The escrow's `FUNDED → terminal` status transition is the durable lock:

- already terminal **with the same attestation** → exit 0, **no transaction**
- already terminal **with a different attestation** → exit 1 (conflict)
- still `FUNDED` → send the one matching settlement transaction
- a lost race (two workers) re-reads the escrow and treats the on-chain result
  as authoritative instead of paying twice

Settlement cannot be replayed because the second call reverts with
`Not funded`.

## Usage

```bash
# verify only — no Base transaction
node scripts/settle.mjs --payment pay-1 --check

# settle (signs with WALLET_DIR/seller.json, or GENLAYER_PRIVATE_KEY)
WALLET_DIR=/path/to/wallet node scripts/settle.mjs --payment pay-1

# settle every finalized case that has a matching escrow
node scripts/settle.mjs --all --json
```

Environment:

```
UNDO402_CONTRACT_ADDRESS   0x9022290256C9b4B243fD4519b9857c83e45fFb5a
ESCROW                     0x8fcD766B2f52Fa754DE24207E3cA19EcD7AF8c24
GENLAYER_RPC_URL           https://studio.genlayer.com/api
BASE_RPC_URL               https://sepolia.base.org
WALLET_DIR                 folder containing seller.json (relay key)
```

Via the API:

```bash
curl -X POST "http://localhost:8000/payments/pay-1/settle?check=true"
curl -X POST "http://localhost:8000/payments/pay-1/settle"
```

## Live proof (Base Sepolia, v4 escrow)

**v9 custom-ID flow (recommended path):** Base escrow `pay-v9-demo` (0.1 USDC)
→ `create_payment_with_id("pay-v9-demo")` on StudioNet → delivery → dispute
→ `human_resolve(refund)` → attestation
`4ed9cecbc755f0561ef85af70178616b0a1f7a8bfacb242aea02ac1a740b5d58` →
settled at
[`0xc66dc4e77ae64f8b6ff875921ea1139c98e2ac0f8e3cbee65620452d6fea46a6`](https://sepolia.basescan.org/tx/0xc66dc4e77ae64f8b6ff875921ea1139c98e2ac0f8e3cbee65620452d6fea46a6),
second run `alreadySettled: true`, no tx.

**v8 case `pay-1`:** verdict `refund`, score `0`, refund_percent `100`,
attestation
`e915a32845fc52e743bfc9aef6ab99229142c15033d48a28775ab9cc64a9e731`.
- `--check` verified the digest and escrow binding.
- First run settled:
  [`0x22ef5b045a835974936f64cfc2017f83d2262fe9b468562366f94983a361697f`](https://sepolia.basescan.org/tx/0x22ef5b045a835974936f64cfc2017f83d2262fe9b468562366f94983a361697f)
- Second run returned `alreadySettled: true`, `sent: false` — no second USDC
  movement.
- A `FUNDED` case (`pay-2`) was refused with `NOT_FINAL`; a made-up 64-hex
  attestation on Base reverted with `Attestation not bound to case`.

## Test coverage

```bash
forge test -vv
```

12 tests cover: live digest reproduction, lowercase/checksum canonicalization,
empty/arbitrary/cross-case/cross-party/wrong-verdict/wrong-score rejection,
partial-split binding, exactly-once settlement, relay-only authorization, and
the independent buyer timeout backstop.
