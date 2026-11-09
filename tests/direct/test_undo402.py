import json

ONE_USDC = 1_000_000  # 6 decimals
PROOF = "0x" + "a" * 64
CARD_PROOF = "pi_3ExampleIntent"


def _addr(a):
    if isinstance(a, bytes):
        return "0x" + a.hex()
    return str(a)


def _create(direct_vm, direct_deploy, direct_alice, direct_bob, rail="x402", criteria="Delivery URL must contain a valid JSON API response with a user field.", proof=PROOF):
    contract = direct_deploy("contracts/Undo402.py")
    direct_vm.sender = direct_alice
    pid = contract.create_payment(
        _addr(direct_alice),
        _addr(direct_bob),
        rail,
        criteria,
        proof,
        ONE_USDC,
        86400,
        "https://example.com/spec",
    )
    return contract, pid


def test_create_and_read(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    data = contract.get_payment(pid)
    assert data["state"] == "FUNDED"
    assert data["rail"] == "x402"
    assert data["amount_usdc"] == str(ONE_USDC)
    assert data["buyer"].lower() == _addr(direct_alice).lower()
    assert data["seller"].lower() == _addr(direct_bob).lower()
    assert contract.get_payment_count() == "1"


def test_create_rejects_zero_self_and_bad_proof(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/Undo402.py")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[EXPECTED] Zero USDC amount"):
        contract.create_payment(_addr(direct_alice), _addr(direct_alice), "x402", "criteria", PROOF, 0, 86400, "")

    with direct_vm.expect_revert("[EXPECTED] Cannot pay yourself"):
        contract.create_payment(_addr(direct_alice), _addr(direct_alice), "x402", "criteria", PROOF, ONE_USDC, 86400, "")

    with direct_vm.expect_revert("[EXPECTED] Invalid rail: cash"):
        contract.create_payment(_addr(direct_alice), _addr(direct_alice), "cash", "criteria", PROOF, ONE_USDC, 86400, "")

    with direct_vm.expect_revert("[EXPECTED] Invalid payment proof for rail x402: expected 0x tx hash"):
        contract.create_payment(_addr(direct_alice), _addr(direct_alice), "x402", "criteria", "0xproof123", ONE_USDC, 86400, "")


def test_relay_cannot_be_impersonated(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("[EXPECTED] Cannot act on behalf of another address"):
        contract.accept(_addr(direct_alice), pid)


def test_card_rail_proof(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob, rail="card", proof=CARD_PROOF)
    assert contract.get_payment(pid)["rail"] == "card"


def test_delivery_and_accept(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[EXPECTED] Only seller can submit delivery"):
        contract.submit_delivery(_addr(direct_alice), pid, "https://example.com/result.json", "done")
    direct_vm.sender = direct_bob
    contract.submit_delivery(_addr(direct_bob), pid, "https://example.com/result.json", "done")
    assert contract.get_payment(pid)["state"] == "DELIVERED"
    direct_vm.sender = direct_alice
    contract.accept(_addr(direct_alice), pid)
    assert contract.get_payment(pid)["state"] == "RELEASED"
    assert contract.get_payment(pid)["verdict"] == "release"
    # No GEN moves: relay executes USDC release on Base from verdict
    assert contract.get_payment(pid)["amount_usdc"] == str(ONE_USDC)


def test_dispute_flow_and_counter_evidence(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    contract.submit_delivery(_addr(direct_bob), pid, "https://example.com/result.json", "done")
    direct_vm.sender = direct_alice
    contract.open_dispute(_addr(direct_alice), pid, "Missing user field")
    assert contract.get_payment(pid)["state"] == "DISPUTED"
    direct_vm.sender = direct_bob
    contract.submit_counter_evidence(_addr(direct_bob), pid, "https://example.com/evidence.json")
    assert contract.get_payment(pid)["counter_evidence_url"] == "https://example.com/evidence.json"


def test_resolve_dispute_refund(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.mock_web(r".*example\.com/result\.json.*", {"status": 200, "body": '{"error": "not found"}'})
    direct_vm.mock_llm(r".*neutral dispute adjudicator.*", json.dumps({"decision": "refund", "score": 10, "refund_percent": 100, "reason": "No user field in delivery"}))
    direct_vm.sender = direct_bob
    contract.submit_delivery(_addr(direct_bob), pid, "https://example.com/result.json", "done")
    direct_vm.sender = direct_alice
    contract.open_dispute(_addr(direct_alice), pid, "Delivery does not match criteria")
    verdict = contract.resolve_dispute(pid)
    assert verdict == "refund"
    data = contract.get_payment(pid)
    assert data["state"] == "REFUNDED"
    assert data["verdict_score"] == "10"
    assert data["refund_percent"] == "100"
    assert len(data["attestation_digest"]) == 64


def test_resolve_dispute_release(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob, rail="chain")
    direct_vm.mock_web(r".*example\.com/result\.json.*", {"status": 200, "body": '{"user": {"id": 1, "name": "alice"}}'})
    direct_vm.mock_llm(r".*neutral dispute adjudicator.*", json.dumps({"decision": "release", "score": 95, "refund_percent": 0, "reason": "User field present"}))
    direct_vm.sender = direct_bob
    contract.submit_delivery(_addr(direct_bob), pid, "https://example.com/result.json", "done")
    direct_vm.sender = direct_alice
    contract.open_dispute(_addr(direct_alice), pid, "Checking quality")
    verdict = contract.resolve_dispute(pid)
    assert verdict == "release"
    assert contract.get_payment(pid)["state"] == "RELEASED"


def test_claim_timeout_after_deadline(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[EXPECTED] Deadline not reached"):
        contract.claim_timeout(_addr(direct_alice), pid)
    direct_vm.warp("2030-01-01T00:00:00Z")
    contract.claim_timeout(_addr(direct_alice), pid)
    assert contract.get_payment(pid)["state"] == "REFUNDED"


def test_resolve_dispute_undetermined_allows_retry(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.mock_web(r".*example\.com/result\.json.*", {"status": 200, "body": ''})
    direct_vm.mock_llm(r".*neutral dispute adjudicator.*", json.dumps({"decision": "undetermined", "score": 0, "refund_percent": 0, "reason": "Insufficient evidence"}))
    direct_vm.sender = direct_bob
    contract.submit_delivery(_addr(direct_bob), pid, "https://example.com/result.json", "done")
    direct_vm.sender = direct_alice
    contract.open_dispute(_addr(direct_alice), pid, "Unclear delivery")
    verdict = contract.resolve_dispute(pid)
    assert verdict == "undetermined"
    data = contract.get_payment(pid)
    assert data["state"] == "DISPUTED"
    assert data["verdict"] == "undetermined"


def test_evidence_limits(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("[EXPECTED] Delivery note exceeds max length"):
        contract.submit_delivery(_addr(direct_bob), pid, "https://example.com/result.json", "x" * 5001)


def test_mutual_agreement_2of2(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    contract.submit_delivery(_addr(direct_bob), pid, "https://example.com/result.json", "done")
    direct_vm.sender = direct_alice
    assert contract.propose_outcome(_addr(direct_alice), pid, "release") == "proposed"
    direct_vm.sender = direct_bob
    assert contract.propose_outcome(_addr(direct_bob), pid, "release") == "release"
    assert contract.get_payment(pid)["state"] == "RELEASED"
    assert contract.get_payment(pid)["verdict_reason"] == "Resolved by mutual agreement (2-of-2)"


def test_mutual_disagreement_auto_disputes(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    contract.submit_delivery(_addr(direct_bob), pid, "https://example.com/result.json", "done")
    direct_vm.sender = direct_alice
    contract.propose_outcome(_addr(direct_alice), pid, "refund")
    direct_vm.sender = direct_bob
    assert contract.propose_outcome(_addr(direct_bob), pid, "release") == "disputed"
    assert contract.get_payment(pid)["state"] == "DISPUTED"


def test_human_override_requires_owner(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    contract.submit_delivery(_addr(direct_bob), pid, "https://example.com/result.json", "done")
    direct_vm.sender = direct_alice
    contract.open_dispute(_addr(direct_alice), pid, "Bad delivery")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[EXPECTED] Only owner can human-resolve"):
        contract.human_resolve(pid, "refund")
    direct_vm.sender = direct_owner
    assert contract.human_resolve(pid, "refund") == "refund"
    assert contract.get_payment(pid)["state"] == "REFUNDED"
    assert contract.get_payment(pid)["human_verdict"] == "refund"


def test_factory_registry_merged(direct_vm, direct_deploy, direct_alice, direct_owner):
    contract = direct_deploy("contracts/Undo402.py")
    direct_vm.sender = direct_owner
    contract.register_type("undo402-case")
    assert contract.is_type_registered("undo402-case") == "true"
    direct_vm.sender = direct_alice
    case_id = contract.register_case("0x1111111111111111111111111111111111111111", "undo402-case", '{"rail":"x402"}')
    assert str(case_id) == "0"
    assert str(contract.get_case_count()) == "1"
    data = json.loads(contract.get_case(case_id))
    assert data["contract_type"] == "undo402-case"
    by_type = json.loads(contract.get_cases_by_type("undo402-case"))
    assert len(by_type) == 1


def test_factory_requires_registered_type(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/Undo402.py")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[EXPECTED] Contract type not registered"):
        contract.register_case("0x2222222222222222222222222222222222222222", "unknown", "{}")


def test_evidence_manifest_and_stats(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pid = _create(direct_vm, direct_deploy, direct_alice, direct_bob)
    assert contract.get_sources(pid) == ["https://example.com/spec"]
    stats = contract.get_stats()
    assert stats["total_recorded_usdc"] == str(ONE_USDC)
    assert stats["conserved"] == "True"


def test_sources_must_be_https(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/Undo402.py")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[EXPECTED] source url must start with https://: http://example.com/spec"):
        contract.create_payment(_addr(direct_alice), _addr(direct_bob), "x402", "criteria", PROOF, ONE_USDC, 86400, "http://example.com/spec")
