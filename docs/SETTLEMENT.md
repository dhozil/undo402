# Settlement path — GenLayer verdict → Base escrow, exactly once

This is the repository path the steward asked to identify:

| What | Where |
|---|---|
| **Idempotent settlement** | [`scripts/settle.mjs`](../scripts/settle.mjs) |
| **On-chain binding + finalization proof** | [`contracts/base/Undo402Escrow.sol`](../contracts/base/Undo402Escrow.sol) (`release`, `refund`, `releasePartial`) |
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
6. **Base enforces the same check on-chain** — the escrow recomputes the same
   SHA-256 digest (including EIP-55 checksums) from its stored buyer/seller.
   It reverts with `Empty attestation`, `Attestation must be 64 hex chars`,
   `Invalid hex in attestation`, or `Attestation not bound to case`.
7. **Proof that GenLayer finalized the outcome (v6)** — settlement additionally
   requires an ECDSA signature (`proof`) from the escrow's configured
   `attestor` over the settlement intent:

   ```
   keccak256(abi.encode(
     chainId, escrowAddress,
     keccak256(paymentId), keccak256(decision),
     score, refundPercent, buyer, seller, attestationDigest
   ))
   ```

   verified on-chain as an Ethereum signed message. The attestor must only sign
   after verifying the case is finalized on GenLayer (which `scripts/settle.mjs`
   does). This prevents a buyer or seller from computing the public hash for a
   chosen verdict and settling without proof of GenLayer finalization.

## Who can settle

Settlement can be **submitted** from an authorized wallet (buyer, seller,
relay, owner, or attestor) **together with a valid attestor finalization
proof**. The proof is the on-chain evidence that GenLayer finalized the
outcome; the `FUNDED → terminal` transition makes settlement exactly-once. In
practice, `scripts/settle.mjs` verifies finality, signs the proof with the
attestor key, and submits the transaction.

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
- still `FUNDED` → send the one matching settlement transaction (with valid attestor proof)
- a lost race re-reads the escrow and treats the on-chain result as
  authoritative instead of paying twice

Settlement cannot be replayed because the second call reverts with
`Not funded`.

## Usage

```bash
# verify only — no Base transaction
node scripts/settle.mjs --payment <id> --check

# settle (signer must be the escrow attestor; script verifies finality then signs proof)
WALLET_DIR=/path/to/wallet node scripts/settle.mjs --payment <id>

# settle every finalized case that has a matching escrow
node scripts/settle.mjs --all --json
```

Environment:

```
UNDO402_CONTRACT_ADDRESS   0x9022290256C9b4B243fD4519b9857c83e45fFb5a
ESCROW                     0x85bC06C938532EF89388A401637bE1B8F7ac9037
GENLAYER_RPC_URL           https://studio.genlayer.com/api
BASE_RPC_URL               https://sepolia.base.org
WALLET_DIR                 folder containing seller.json (demo payer/attestor)
```

## Live proof

### v6 — finalization-proof binding (steward rejection fix)

- Escrow: `0x85bC06C938532EF89388A401637bE1B8F7ac9037` (Base Sepolia), attestor
  `0x99bF44395CaC814E671ADFF8b69d968Fac4e5Db3`.
- Settlement functions require `(attestation, proof)`; `proof` is verified
  on-chain against the attestor and the bound settlement hash.
- **Security fix (tested on-chain):** a party that computes the public SHA-256
  digest for a chosen verdict **cannot** settle without attestor proof of
  GenLayer finalization (`Invalid settlement proof` / invalid signature). Valid
  attestor-signed proof for a bound, finalized case settles exactly once.
- Foundry: **16/16** tests (digest reproduction, binding, empty/arbitrary/
  cross-case/cross-party/wrong-verdict/wrong-score rejection, partial-split
  binding, **self-computed digest without finalization proof rejected**,
  non-attestor signature rejected, exactly-once, authorized settlement with
  valid proof, buyer timeout backstop).

### Earlier proofs (v5/v4 history)

- **v5 buyer-signed `pay-v5-demo`:** Base escrow `0xc37c…04b6`, GenLayer refund
  attestation `9b2c4d78…`, settled by buyer tx `0x5c66…b831`, rerun
  `alreadySettled: true` with no tx (on escrow `0xB037…f70F`, pre-proof-fix).
- **v4 `pay-1`:** refund settled tx `0x22ef…697f`, rerun idempotent; `NOT_FINAL`
  and arbitrary-attestation cases rejected.

## Test coverage

```bash
forge test -vv
```

16 tests cover: live digest reproduction, lowercase/checksum canonicalization,
empty/arbitrary/cross-case/cross-party/wrong-verdict/wrong-score rejection,
**self-computed digest without GenLayer-finalization proof rejected**,
non-attestor signature rejected, partial-split binding, exactly-once settlement,
authorized settlement with valid attestor proof, and the independent buyer
timeout backstop.
