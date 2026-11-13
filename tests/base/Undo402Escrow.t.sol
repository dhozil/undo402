// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Undo402Escrow} from "../../contracts/base/Undo402Escrow.sol";

interface Vm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert() external;
    function expectRevert(bytes calldata) external;
    function parseAddress(string calldata) external pure returns (address);
    function addr(uint256 privateKey) external pure returns (address);
    function sign(uint256 privateKey, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
}

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice Tests the steward request: Base settlement must be bound to the
///         case (payment id, verdict, score, split, parties), require proof
///         that GenLayer finalized that outcome (attestor signature), reject
///         empty/arbitrary/unbound/self-computed attestations, and settle
///         each case exactly once.
contract Undo402EscrowTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // Live GenLayer pay-1 parties (checksummed exactly as Address.as_hex).
    address constant BUYER = 0x0Eb9431eDdbF170d2224F4f9E47D4DD68b6c44bc;
    address constant SELLER = 0x99bF44395CaC814E671ADFF8b69d968Fac4e5Db3;
    address constant OTHER = 0x2d4Fb8b09C12145856B4dE1a9C7c320a3162FFF5;
    uint256 constant AMOUNT = 2_000_000; // 2 USDC
    uint256 constant ATTESTOR_PK = 0xA11CE; // test-only verifier key
    // sha256("undo402:pay-1|refund|0|100|0x0Eb9...|0x99bF...") on StudioNet.
    bytes32 constant PAY1_REFUND_DIGEST = 0xe915a32845fc52e743bfc9aef6ab99229142c15033d48a28775ab9cc64a9e731;

    address attestor;
    MockUSDC usdc;
    Undo402Escrow escrow;

    function setUp() public {
        attestor = vm.addr(ATTESTOR_PK);
        usdc = new MockUSDC();
        escrow = new Undo402Escrow(address(usdc), attestor);
        usdc.mint(BUYER, 100_000_000);
    }

    // ------------------------------------------------------------------
    // Attestation reproduction (GenLayer binding)
    // ------------------------------------------------------------------

    function testAttestationMatchesGenLayer() public view {
        bytes32 got = escrow.computeAttestation("pay-1", "refund", 0, 100, BUYER, SELLER);
        require(got == PAY1_REFUND_DIGEST, "digest mismatch vs live GenLayer attestation");
    }

    function testChecksumBindsMixedCaseAddresses() public view {
        bytes32 a = escrow.computeAttestation("pay-1", "refund", 0, 100, BUYER, SELLER);
        bytes32 b = escrow.computeAttestation(
            "pay-1",
            "refund",
            0,
            100,
            vm.parseAddress("0x0eb9431eddbf170d2224f4f9e47d4dd68b6c44bc"),
            vm.parseAddress("0x99bf44395cac814e671adff8b69d968fac4e5db3")
        );
        require(a == b, "checksum not canonical");
    }

    // ------------------------------------------------------------------
    // Rejection of empty / arbitrary / unbound attestations
    // ------------------------------------------------------------------

    function testEmptyAttestationRejected() public {
        _funded("pay-1", SELLER);
        bytes memory proof = _proof("pay-1", "refund", 0, 100, BUYER, SELLER, PAY1_REFUND_DIGEST);
        vm.prank(SELLER);
        vm.expectRevert();
        escrow.refund("pay-1", 0, "", proof);
        require(_status("pay-1") == 1, "status must stay FUNDED");
        require(usdc.balanceOf(SELLER) == 0, "no funds may move");
    }

    function testArbitraryAttestationRejected() public {
        _funded("pay-1", SELLER);
        string memory madeUp = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        bytes memory proof = _proof("pay-1", "refund", 0, 100, BUYER, SELLER, bytes32(0));
        vm.prank(SELLER);
        vm.expectRevert();
        escrow.refund("pay-1", 0, madeUp, proof);
        require(_status("pay-1") == 1, "status must stay FUNDED");
    }

    function testAttestationForOtherCaseRejected() public {
        _funded("pay-1", SELLER);
        bytes32 other = escrow.computeAttestation("pay-2", "refund", 0, 100, BUYER, SELLER);
        bytes memory proof = _proof("pay-1", "refund", 0, 100, BUYER, SELLER, other);
        vm.prank(SELLER);
        vm.expectRevert();
        escrow.refund("pay-1", 0, _hex(other), proof);
        require(_status("pay-1") == 1, "cross-case replay must revert");
    }

    function testAttestationForOtherPartiesRejected() public {
        _funded("pay-1", SELLER);
        bytes32 other = escrow.computeAttestation("pay-1", "refund", 0, 100, BUYER, OTHER);
        bytes memory proof = _proof("pay-1", "refund", 0, 100, BUYER, OTHER, other);
        vm.prank(SELLER);
        vm.expectRevert();
        escrow.refund("pay-1", 0, _hex(other), proof);
    }

    function testAttestationForWrongVerdictRejected() public {
        _funded("pay-1", SELLER);
        bytes32 releaseDigest = escrow.computeAttestation("pay-1", "release", 0, 0, BUYER, SELLER);
        bytes memory proof = _proof("pay-1", "refund", 0, 100, BUYER, SELLER, releaseDigest);
        vm.prank(SELLER);
        vm.expectRevert();
        escrow.refund("pay-1", 0, _hex(releaseDigest), proof);
    }

    function testWrongScoreRejected() public {
        _funded("pay-1", SELLER);
        bytes32 d = escrow.computeAttestation("pay-1", "refund", 0, 100, BUYER, SELLER);
        bytes memory proof = _proof("pay-1", "refund", 100, 100, BUYER, SELLER, d);
        vm.prank(SELLER);
        vm.expectRevert();
        escrow.refund("pay-1", 100, _hex(d), proof);
    }

    // ------------------------------------------------------------------
    // Proof of GenLayer finalization (steward rejection fix)
    // ------------------------------------------------------------------

    function testSelfComputedDigestWithoutFinalizationProofRejected() public {
        _funded("pay-1", SELLER);
        // A party can compute the public hash for a chosen verdict...
        bytes32 d = escrow.computeAttestation("pay-1", "refund", 0, 100, BUYER, SELLER);
        // ...but without attestor proof of GenLayer finalization, settlement must fail.
        vm.prank(SELLER);
        vm.expectRevert();
        escrow.refund("pay-1", 0, _hex(d), new bytes(65));
        require(_status("pay-1") == 1, "status must stay FUNDED");
    }

    function testNonAttestorSignatureRejected() public {
        _funded("pay-1", SELLER);
        bytes32 d = escrow.computeAttestation("pay-1", "refund", 0, 100, BUYER, SELLER);
        uint256 fakePk = 0xB0B;
        bytes memory bad = _proofWithKey(fakePk, "pay-1", "refund", 0, 100, BUYER, SELLER, d);
        vm.prank(SELLER);
        vm.expectRevert("Invalid settlement proof");
        escrow.refund("pay-1", 0, _hex(d), bad);
        require(_status("pay-1") == 1, "status must stay FUNDED");
    }

    // ------------------------------------------------------------------
    // Partial refund binding
    // ------------------------------------------------------------------

    function testPartialSplitMustMatchAttestation() public {
        _funded("pay-1", SELLER);
        bytes32 d50 = escrow.computeAttestation("pay-1", "partial", 0, 50, BUYER, SELLER);
        bytes32 d60 = escrow.computeAttestation("pay-1", "partial", 0, 60, BUYER, SELLER);
        require(d50 != d60, "digests must differ");
        bytes memory proof50 = _proof("pay-1", "partial", 0, 50, BUYER, SELLER, d50);

        vm.prank(SELLER);
        vm.expectRevert(); // 40% seller implies refund 60, but attestation/proof are for 50
        escrow.releasePartial("pay-1", 40, 0, _hex(d50), proof50);
        require(_status("pay-1") == 1, "status must stay FUNDED");

        escrow.releasePartial("pay-1", 50, 0, _hex(d50), proof50);
        require(_status("pay-1") == 4, "partial status");
        require(usdc.balanceOf(SELLER) == AMOUNT / 2, "seller half");
        require(usdc.balanceOf(BUYER) == 99_000_000, "buyer half back");
    }

    // ------------------------------------------------------------------
    // Exactly-once settlement
    // ------------------------------------------------------------------

    function testRefundSettlesExactlyOnce() public {
        _funded("pay-1", SELLER);
        bytes32 d = escrow.computeAttestation("pay-1", "refund", 0, 100, BUYER, SELLER);
        bytes memory proof = _proof("pay-1", "refund", 0, 100, BUYER, SELLER, d);

        escrow.refund("pay-1", 0, _hex(d), proof);
        require(_status("pay-1") == 3, "refunded");
        require(usdc.balanceOf(BUYER) == 100_000_000, "buyer refunded");

        vm.expectRevert(); // second invocation is a no-op revert, never a double spend
        escrow.refund("pay-1", 0, _hex(d), proof);
        require(usdc.balanceOf(BUYER) == 100_000_000, "no second payout");
    }

    // ------------------------------------------------------------------
    // Authorization (submitter can be buyer/seller/attestor/owner, proof required)
    // ------------------------------------------------------------------

    function testOutsiderCannotSettle() public {
        _funded("pay-1", SELLER);
        bytes32 d = escrow.computeAttestation("pay-1", "refund", 0, 100, BUYER, SELLER);
        bytes memory proof = _proof("pay-1", "refund", 0, 100, BUYER, SELLER, d);
        vm.prank(OTHER);
        vm.expectRevert("Not authorized");
        escrow.refund("pay-1", 0, _hex(d), proof);
        require(_status("pay-1") == 1, "status must stay FUNDED");
    }

    function testBuyerSettlesRefundFromOwnWalletWithProof() public {
        _funded("pay-1", SELLER);
        bytes32 d = escrow.computeAttestation("pay-1", "refund", 0, 100, BUYER, SELLER);
        vm.prank(BUYER);
        escrow.refund("pay-1", 0, _hex(d), _proof("pay-1", "refund", 0, 100, BUYER, SELLER, d));
        require(_status("pay-1") == 3, "buyer executed the refund");
        require(usdc.balanceOf(BUYER) == 100_000_000, "buyer refunded");
    }

    function testSellerSettlesReleaseFromOwnWalletWithProof() public {
        _funded("pay-1", SELLER);
        bytes32 d = escrow.computeAttestation("pay-1", "release", 0, 0, BUYER, SELLER);
        vm.prank(SELLER);
        escrow.release("pay-1", 0, _hex(d), _proof("pay-1", "release", 0, 0, BUYER, SELLER, d));
        require(_status("pay-1") == 2, "seller executed the release");
        require(usdc.balanceOf(SELLER) == AMOUNT, "seller paid");
    }

    // ------------------------------------------------------------------
    // Timeout backstop still independent (no attestor proof required)
    // ------------------------------------------------------------------

    function testBuyerTimeoutStillWorks() public {
        _funded("pay-1", SELLER);
        vm.warp(block.timestamp + 86_401);
        vm.prank(BUYER);
        escrow.claimTimeout("pay-1");
        require(_status("pay-1") == 3, "timeout refund");
        require(usdc.balanceOf(BUYER) == 100_000_000, "buyer refunded");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _funded(string memory id, address seller) internal {
        vm.prank(BUYER);
        usdc.approve(address(escrow), AMOUNT);
        vm.prank(BUYER);
        escrow.createEscrow(id, seller, AMOUNT, 86_400);
    }

    function _status(string memory id) internal view returns (uint8) {
        Undo402Escrow.Escrow memory e = escrow.getEscrow(id);
        return uint8(e.status);
    }

    function _hex(bytes32 value) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory out = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(value[i]);
            out[i * 2] = alphabet[b >> 4];
            out[i * 2 + 1] = alphabet[b & 0x0f];
        }
        return string(out);
    }

    function _proof(
        string memory id,
        string memory decision,
        uint256 score,
        uint256 refundPercent,
        address buyer,
        address seller,
        bytes32 digest
    ) internal view returns (bytes memory) {
        return _proofWithKey(ATTESTOR_PK, id, decision, score, refundPercent, buyer, seller, digest);
    }

    function _proofWithKey(
        uint256 pk,
        string memory id,
        string memory decision,
        uint256 score,
        uint256 refundPercent,
        address buyer,
        address seller,
        bytes32 digest
    ) internal view returns (bytes memory) {
        bytes32 hash = escrow.settlementHash(id, decision, score, refundPercent, buyer, seller, digest);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }
}
