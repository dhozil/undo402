# Adversarial & Trust Test Proof — StudioNet + Base (repo evidence)

**Date:** 2026-11-13  
**Scope:** Additional StudioNet method tests (adversarial/trust), receipt/execution evidence, propose-outcome & human/timeout flows, Base v6 finalization-proof fix, and on-chain criteria-length hardening in repo.

**Contracts**
- GenLayer (StudioNet, live, v9): `0x9022290256C9b4B243fD4519b9857c83e45fFb5a`
- Base escrow (active, v6): `0x85bC06C938532EF89388A401637bE1B8F7ac9037` (attestor `0x99bF44395CaC814E671ADFF8b69d968Fac4e5Db3`)

---

## 1. StudioNet adversarial batch (live state + receipts)

Batch executed against v9 contract (relay/signer `0x99bF…5Db3`, buyer `0x0Eb9…44bc`, seller `0x99bF…5Db3`). **Conclusion source:** on-chain state (`get_payment(s)`, `get_stats`) and tx receipts. Note: a submitted tx hash can still end with `execution_result: ERROR` (no state side-effect) — this was observed and verified.

### 1.1 Account/state snapshot
- `get_payment_count` (before batch run context): `3` → (after observed): `5` payments recorded in list; `get_stats`: `conserved=True`, `total_recorded_usdc=401000`, `total_settled_usdc=300000`.
- `get_relay_address`: `0x99bF44395CaC814E671ADFF8b69d968Fac4e5Db3`
- `get_owner`: `0xD92eBB228e9385Ea90a852387aA1c4162B2ec009`

### 1.2 Adversarial create attempts (expected reject) — verified no harmful materialization
Txs finalized with **`execution_result: ERROR`** (receipt evidence) and/or no corresponding valid payment created:

| Case | Tx | Receipt result | State evidence |
|---|---|---|---|
| self-pay (buyer==seller) | `0x354a8cf6ba86c444a0d520875f9e3069772065b33db410b1693b765e15d0c3c9` | ERROR | no `adv-self-*` payment created |
| zero amount | `0xe84f61e0c2aae4c4dff09e750cc21e394b4af3151cd239f575fe7b24de54df4f` | ERROR | no `adv-zero-*` payment |
| bad rail | `0x9e2308ec2cabc049b9307affe11bd3d0eb7a79f13bd8d928fd06ce4c00dd3f6c` | ERROR | no `adv-rail-*` payment |
| bad x402 proof format | `0x53eb569720957f39458ac5061ce876ad769303d71fea28921598650c9d729d80` | ERROR | no `adv-proof-*` payment |
| bad card proof format | `0x17b31ed2d0f1a02b9fc75144b09a0da60ae525de54350dbd8a69130af85f49d8` | ERROR | no bad-card payment |
| empty criteria | `0x5890939756208349cb654a20738cedf9324d3cf305953ae27e1f7228a20474ed` | ERROR (batch) | no empty-criteria payment |
| http evidence source (non-https) | `0x3c360884abe3c5cb8e9fa9b54365a5ea48213c18879af32f8d1d7907a686928d` | ERROR | no `adv-http-*` payment |
| invalid payment id (spaces) | `0x8967bed47f0d8329d32fc817a8c559ee9fc200782b51ca778c1d7b223b17ba80` | ERROR (batch) | `get_payment("bad id with spaces")` not found |
| duplicate id (same as created good id) | `0xb1f8f1c66d3bb35fc5ab210cf77a3c84209b2ee652b2970b7fc7464fbe9dec0f` | ERROR (batch) | original payment unchanged |

**Finding (documented):** `adv-crit-1794580528347` (criteria `"short"`, 5 chars) was **accepted by v9 contract** (FUNDED, 1000 µUSDC) because v9 enforced non-empty/max-length but not min-length; frontend enforced min 10 chars. **Hardened in repo** (see §5): contract now rejects `< 10` chars.

### 1.3 Actor/state adversarial actions (expected reject) — no state corruption
All below showed ERROR in batch/receipts and/or produced no effective state change on the target payment:

| Case | Tx | Receipt result |
|---|---|---|
| delivery by buyer (not seller) | `0xe91faa665b680ec5e4ffcbdb8e4af9f24ab33611f22ceb026312f05074cf4846` | ERROR |
| delivery URL `http://` | `0x869be69136c75a683fe40ba8a43a5093f636fd4a63d6d25a493b31426fa26fee` | ERROR |
| accept by seller | `0x893cf3c1f1cb3aa9084ca7db4690c129782ec43af51438e89ea45821e68470e3` | ERROR (batch) |
| open dispute by seller | `0x11213c495e1b49b3a881285c2d591878cf86cddb6840ed3a3e287afc2c753e4b` | ERROR (batch) |
| resolve when not disputed | `0xe2321ff3f62ce60f4887f4083b5d7868c6b5ba3fc64e5f5e4346d92e8235b2cc` | ERROR |
| duplicate/invalid-state delivery | `0xfc518e9c643ae5f8e62c7ca69b08bb6feb760ea01a6f55b8f26836848b91c4e3` | ERROR (batch) |
| counter-evidence by buyer | `0x27993293824f2e70622bbd8b0dd3fc188720eb26ee26bc03794c91ffbccbc845` | ERROR |

**State proof (positive control):** `adv-good-1794580646961` progressed correctly and remained consistent despite adversarial attempts:
- create `0xce91bca25880ddd94f9e8654bf5b49d572b8f3618038754daa7cbb91d8afaa38` (SUCCESS)
- submit_delivery (seller) `0xfee4b945b3ce4f56c1a699e67ca84d1f01790697a9b41b9158fc8491bf43227f` → DELIVERED
- open_dispute (buyer) `0xc6d292bdda115f08d70f90a0ffde53c4653a12d8a14570bd5ec276704f7acf6b`
- submit_counter_evidence (seller) `0x8ee6535267a5244f265f7217df677692fe6b6c27e61db4573c5d6fd679a8247f`
- Final read: `state=DISPUTED`, `delivery_url=https://example.com/`, `counter_evidence_url=https://example.com/evidence`, `verdict=""` (wrong-actor actions had no effect).

### 1.4 claim_timeout adversarial (trust)
Target: `adv-crit-1794580528347` (FUNDED, deadline not reached) — remained **FUNDED** after attempts.

| Case | Tx | Receipt result |
|---|---|---|
| claim_timeout too early (buyer, before deadline) | `0x3587503763961b8b3b5cacda06cdd71a4adbe3b584a44dddb9b0efc867a477e3` | ERROR |
| claim_timeout by non-buyer (seller) | `0x449b448698d8e26fa65dff6b00adfc5976490dbfe7f0117163d6087ef8c656df` | ERROR |

### 1.5 2-of-2 propose_outcome (mutual agreement)
Payment `adv-mutual-1794582890001` (0.1 USDC, x402):
- create `0x635dddcd03f8f05115240d8603bb9fb98d59d53ccd8c1b657c3cc8e605ed8659`
- delivery `0x6d4f1b281c4ad6187815072d047a2f694309ee587f7c279a1af64c2262e0e310`
- buyer proposes `release` `0x2008b947c51c12489f06e3762500c3d84eebeab527e48be8496eb213dc8a3a01`
- seller proposes `release` `0x4e4e4b094a58dedc5356b8d26c2840128069175a1e1180bbda9ca2abf19153ef`
- **Final:** `state=RELEASED`, `verdict=release`, `proposed_buyer=release`, `proposed_seller=release`.

### 1.6 human_resolve (owner)
`adv-good-1794580646961` (DISPUTED) resolved by owner (`asmodeus-deploy` 0xD92e…):
- `human_resolve("adv-good-1794580646961","refund")` → **ACCEPTED**, validators agreed.
- **Final:** `state=REFUNDED`, `verdict=refund`, `human_verdict=refund`, `attestation_digest=5f46a50e2a1d3ed4db964e659a3c8d1ba4da5622cc16caa81c33480e9fe026d6`.

**Receipt/trace note:** `genlayer receipt <tx>` confirms FINALIZED status and `execution_result` (SUCCESS/ERROR) with consensus votes; `genlayer trace` (`gen_dbg_traceTransaction`) was not available on the StudioNet RPC used (`Method not found`), so detailed revert strings were not retrievable via trace — enforcement is evidenced by ERROR receipts + absence of state side-effects and by direct/local contract tests.

---

## 2. Base escrow v6 — finalization-proof fix (steward rejection)

**Issue fixed:** v5 allowed a party to compute the public SHA-256 digest for a chosen verdict and settle without proof GenLayer finalized it. v6 requires **attestor ECDSA finalization proof** in addition to the bound digest.

- Escrow v6: `0x85bC06C938532EF89388A401637bE1B8F7ac9037` (attestor `0x99bF…5Db3`, deploy `0x86de302c…74ea`).
- **Rejection case (live):** `pay-v6-noproof` funded `0x1e09388c789209fcb058ac7f7ab2ba815c1e1bfcadb2e32c6d1cd40aa1874b59`. Authorized buyer called `refund` with correct self-computed bound digest `c01fe38c08a2931210450514361048a5e77870f11d036153d4729ea0545036d0` but invalid proof → **reverted at ECDSA signature verification** (custom error `0xf645eedf`, `ECDSAInvalidSignature`). No settlement.
- **Valid finalized settlement (live, idempotent):** `pay-v6-proof` funded `0x306df11faa237f1da417f7199ac1b3b1fb029eeb3b748d9b838dc3b64543a2e4`, GenLayer finalized refund (attestation `84566d2f21221a6c79600bdc6208e29437140258ad5922fe54e46d22fff61fcf`, `human_resolve` tx accepted) → `settle.mjs --check` verified → settled with attestor proof `0x39ec45a3e91ab0f80115474dd86188c493f32bd8d31c061ee86ed4aacf1f167a` → rerun **`alreadySettled: true`, no tx**.
- **Foundry:** 16/16 pass, including `testSelfComputedDigestWithoutFinalizationProofRejected` and `testNonAttestorSignatureRejected`.

---

## 3. Repo/local test evidence

| Suite | Result |
|---|---|
| `forge test -vv` | **16 passed, 0 failed** (escrow binding, finalization proof required, exactly-once, timeout) |
| `python -m pytest tests/direct -q` | **20 passed** (includes `test_criteria_too_short_rejected`) |
| `genvm-lint check contracts/Undo402.py` | **pass**, 27 methods |
| syntax checks | `node --check` frontend/scripts, `python -m py_compile api/app.py` OK |

---

## 4. Trust model notes
- **GenLayer contract (v9, live):** enforces actor authorization, rail/proof format, https sources, state-machine transitions, duplicate/id guards, non-zero amount, self-pay rejection, evidence/timeout rules as evidenced above; criteria min-length was UI-only on v9 (live record `adv-crit-1794580528347`) and is **hardened in repo** (§5).
- **Base escrow (v6):** enforces case-bound attestation + **attestor proof of GenLayer finalization** + exactly-once settlement; independent buyer timeout claim remains.
- **Cross-layer:** Base cannot read GenLayer state; finalization is proven to Base via attestor signature produced only after verified finality (`scripts/settle.mjs`).

## 5. On-chain hardening in repo (criteria min length)
- `contracts/Undo402.py` (`_prepare_payment`): added `len(criteria.strip()) < 10` → `UserError("[EXPECTED] Criteria too short (min 10 chars)")`.
- `tests/direct/test_undo402.py`: added `test_criteria_too_short_rejected`; existing tests updated to use valid-length criteria. **20/20 direct tests pass**.
- **Redeployed (hardened, active):** `0xaee085b0f4921953dD3474a15467D73E3E90F2AD` (StudioNet, deploy tx `0xba0b432e3ee056a2bf9736e3ba5be9cf90cce971c01b690a1c3afef4afbc4bcb`, owner/relay deployer). Frontend/scripts/configs now target this address so on-chain min-criteria (>=10 chars) is enforced for new cases; historical adversarial/live evidence above remains on v9 `0x9022290256C9b4B243fD4519b9857c83e45fFb5a`.
