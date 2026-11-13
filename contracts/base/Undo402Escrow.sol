// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title Undo402Escrow — USDC escrow on Base (Sepolia / mainnet)
/// @notice Holds REAL stablecoin (USDC) for agentic payments.
///         GenLayer (Undo402) adjudicates the dispute; this contract only
///         holds and releases USDC based on a verified, finalized verdict.
/// @dev v6: settlement requires (1) the exact SHA-256 attestation digest that
///      GenLayer produced for this case, recomputed on-chain from stored
///      escrow parties:
///
///        sha256("undo402:{paymentId}|{decision}|{score}|{refundPercent}|
///                {buyerEip55}|{sellerEip55}")
///
///      and (2) an ECDSA signature from the configured `attestor` over the
///      settlement intent (chain id, escrow, payment id, verdict, score,
///      refund percent, buyer, seller, attestation digest). The attestor must
///      only sign after verifying the case is finalized on GenLayer, so a
///      buyer/seller cannot self-attest a chosen verdict by computing the
///      public hash alone. The transaction may be submitted from the buyer's
///      or seller's own connected wallet (or relay/owner/attestor); the
///      signature is the proof of GenLayer finalization, and the FUNDED ->
///      terminal status transition is the exactly-once guard.
contract Undo402Escrow is Ownable {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    enum Status { NONE, FUNDED, RELEASED, REFUNDED, PARTIAL }

    struct Escrow {
        address buyer;
        address seller;
        uint256 amount; // USDC amount (6 decimals)
        Status status;
        string paymentId; // Undo402 payment id, e.g. "pay-1"
        string attestation; // GenLayer verdict attestation_digest
        uint256 deadline; // buyer timeout refund after this timestamp
    }

    IERC20 public immutable usdc;
    mapping(string => Escrow) public escrows;
    address public relay; // GenLayer relay wallet (legacy/admin)
    address public attestor; // signs finalized GenLayer verdicts for Base settlement

    event EscrowCreated(string indexed paymentId, address indexed buyer, address indexed seller, uint256 amount);
    event EscrowReleased(string indexed paymentId, address indexed seller, uint256 amount, string attestation);
    event EscrowRefunded(string indexed paymentId, address indexed buyer, uint256 amount, string attestation);
    event EscrowPartial(string indexed paymentId, address indexed seller, uint256 sellerAmount, address indexed buyer, uint256 buyerAmount, string attestation);
    event AttestorUpdated(address indexed attestor);
    event RelayUpdated(address indexed relay);

    modifier onlyRelay() {
        require(msg.sender == relay || msg.sender == owner(), "Not relay/owner");
        _;
    }

    constructor(address _usdc, address _attestor) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        require(_attestor != address(0), "Invalid attestor");
        usdc = IERC20(_usdc);
        relay = msg.sender;
        attestor = _attestor;
        emit AttestorUpdated(_attestor);
    }

    function setRelay(address _relay) external onlyOwner {
        relay = _relay;
        emit RelayUpdated(_relay);
    }

    function setAttestor(address _attestor) external onlyOwner {
        require(_attestor != address(0), "Invalid attestor");
        attestor = _attestor;
        emit AttestorUpdated(_attestor);
    }

    /// @notice Create escrow: buyer approves USDC first, then calls this.
    /// @param ttlSeconds Buyer timeout window (e.g. 86400 = 1 day). After this,
    ///        buyer can claim refund directly even if nobody settles.
    function createEscrow(string calldata paymentId, address seller, uint256 amount, uint256 ttlSeconds) external {
        require(bytes(paymentId).length > 0, "Empty paymentId");
        require(seller != address(0) && seller != msg.sender, "Invalid seller");
        require(amount > 0, "Zero amount");
        require(ttlSeconds > 0, "Zero ttl");
        require(escrows[paymentId].status == Status.NONE, "Exists");
        escrows[paymentId] = Escrow({
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            status: Status.FUNDED,
            paymentId: paymentId,
            attestation: "",
            deadline: block.timestamp + ttlSeconds
        });
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit EscrowCreated(paymentId, msg.sender, seller, amount);
    }

    /// @notice Release USDC to seller (GenLayer verdict: release).
    /// @param score GenLayer verdict_score bound into the attestation.
    /// @param attestation GenLayer attestation_digest (64 lowercase hex chars).
    /// @param proof ECDSA signature from `attestor` certifying this finalized outcome.
    /// @dev Callable from the buyer's or seller's own connected wallet (or
    ///      relay/owner/attestor). The attestor signature is the on-chain proof
    ///      that GenLayer finalized this exact verdict; the digest binds the
    ///      case parameters and the status transition makes settlement exactly once.
    function release(string calldata paymentId, uint256 score, string calldata attestation, bytes calldata proof) external {
        Escrow storage e = escrows[paymentId];
        bytes32 digest = _requireBound(e, paymentId, "release", score, 0, attestation);
        _requireProof(paymentId, "release", score, 0, e.buyer, e.seller, digest, proof);
        e.status = Status.RELEASED;
        e.attestation = attestation;
        usdc.safeTransfer(e.seller, e.amount);
        emit EscrowReleased(paymentId, e.seller, e.amount, attestation);
    }

    /// @notice Refund USDC to buyer (GenLayer verdict: refund).
    /// @param score GenLayer verdict_score bound into the attestation.
    /// @param attestation GenLayer attestation_digest (64 lowercase hex chars).
    /// @param proof ECDSA signature from `attestor` certifying this finalized outcome.
    /// @dev Callable from the buyer's or seller's own connected wallet (or
    ///      relay/owner/attestor) with a valid finalization proof.
    function refund(string calldata paymentId, uint256 score, string calldata attestation, bytes calldata proof) external {
        Escrow storage e = escrows[paymentId];
        bytes32 digest = _requireBound(e, paymentId, "refund", score, 100, attestation);
        _requireProof(paymentId, "refund", score, 100, e.buyer, e.seller, digest, proof);
        e.status = Status.REFUNDED;
        e.attestation = attestation;
        usdc.safeTransfer(e.buyer, e.amount);
        emit EscrowRefunded(paymentId, e.buyer, e.amount, attestation);
    }

    /// @notice Partial split (GenLayer verdict: partial).
    /// @param sellerPercent 0-100, seller share. Buyer gets the rest.
    /// @param score GenLayer verdict_score bound into the attestation.
    /// @param attestation GenLayer attestation_digest (64 lowercase hex chars).
    /// @param proof ECDSA signature from `attestor` certifying this finalized outcome.
    /// @dev The attestation and proof commit to refundPercent = 100 - sellerPercent,
    ///      so a verdict cannot be replayed with a different split.
    function releasePartial(string calldata paymentId, uint256 sellerPercent, uint256 score, string calldata attestation, bytes calldata proof) external {
        require(sellerPercent > 0 && sellerPercent < 100, "Percent 1-99");
        Escrow storage e = escrows[paymentId];
        uint256 refundPercent = 100 - sellerPercent;
        bytes32 digest = _requireBound(e, paymentId, "partial", score, refundPercent, attestation);
        _requireProof(paymentId, "partial", score, refundPercent, e.buyer, e.seller, digest, proof);
        e.status = Status.PARTIAL;
        e.attestation = attestation;
        uint256 sellerAmount = (e.amount * sellerPercent) / 100;
        uint256 buyerAmount = e.amount - sellerAmount;
        usdc.safeTransfer(e.seller, sellerAmount);
        usdc.safeTransfer(e.buyer, buyerAmount);
        emit EscrowPartial(paymentId, e.seller, sellerAmount, e.buyer, buyerAmount, attestation);
    }

    /// @notice Buyer timeout claim — prevents permanently stuck funds.
    /// After deadline, buyer can refund directly without relay.
    function claimTimeout(string calldata paymentId) external {
        Escrow storage e = escrows[paymentId];
        require(msg.sender == e.buyer, "Not buyer");
        require(e.status == Status.FUNDED, "Not funded");
        require(block.timestamp > e.deadline, "Deadline not reached");
        e.status = Status.REFUNDED;
        e.attestation = "timeout-claim";
        usdc.safeTransfer(e.buyer, e.amount);
        emit EscrowRefunded(paymentId, e.buyer, e.amount, "timeout-claim");
    }

    function getEscrow(string calldata paymentId) external view returns (Escrow memory) {
        return escrows[paymentId];
    }

    /// @notice Canonical GenLayer attestation digest, reproduced on-chain.
    ///         Mirrors Undo402._attest() exactly, including EIP-55 checksums.
    function computeAttestation(
        string memory paymentId,
        string memory decision,
        uint256 score,
        uint256 refundPercent,
        address buyer,
        address seller
    ) public pure returns (bytes32) {
        string memory payload = string.concat(
            "undo402:",
            paymentId,
            "|",
            decision,
            "|",
            _toString(score),
            "|",
            _toString(refundPercent),
            "|",
            _checksumHex(buyer),
            "|",
            _checksumHex(seller)
        );
        return sha256(bytes(payload));
    }

    /// @notice Expected digest for a stored escrow (helper for relay/tests).
    function expectedAttestation(
        string calldata paymentId,
        string calldata decision,
        uint256 score,
        uint256 refundPercent
    ) external view returns (bytes32) {
        Escrow storage e = escrows[paymentId];
        require(bytes(e.paymentId).length > 0, "No escrow");
        return computeAttestation(paymentId, decision, score, refundPercent, e.buyer, e.seller);
    }

    // ------------------------------------------------------------------
    // Internal verification helpers
    // ------------------------------------------------------------------

    /// @dev Reverts unless the caller is authorized, the escrow is funded,
    ///      and `attestation` is the digest GenLayer produced for this exact
    ///      case. Returns the decoded digest for proof verification.
    function _requireBound(
        Escrow storage e,
        string memory paymentId,
        string memory decision,
        uint256 score,
        uint256 refundPercent,
        string memory attestation
    ) internal view returns (bytes32 supplied) {
        require(
            msg.sender == e.buyer || msg.sender == e.seller || msg.sender == relay || msg.sender == owner() || msg.sender == attestor,
            "Not authorized"
        );
        require(bytes(e.paymentId).length > 0, "No escrow");
        require(e.status == Status.FUNDED, "Not funded");
        supplied = _decodeDigest(attestation);
        bytes32 expected = computeAttestation(paymentId, decision, score, refundPercent, e.buyer, e.seller);
        require(supplied == expected, "Attestation not bound to case");
    }

    /// @notice Hash that the attestor signs to certify a finalized GenLayer verdict.
    function settlementHash(
        string memory paymentId,
        string memory decision,
        uint256 score,
        uint256 refundPercent,
        address buyer,
        address seller,
        bytes32 attestationDigest
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                keccak256(bytes(paymentId)),
                keccak256(bytes(decision)),
                score,
                refundPercent,
                buyer,
                seller,
                attestationDigest
            )
        );
    }

    /// @dev Requires a valid attestor signature proving this exact outcome was
    ///      finalized on GenLayer. This prevents a party from self-attesting a
    ///      chosen verdict by computing the public digest alone.
    function _requireProof(
        string memory paymentId,
        string memory decision,
        uint256 score,
        uint256 refundPercent,
        address buyer,
        address seller,
        bytes32 attestationDigest,
        bytes memory proof
    ) internal view {
        bytes32 hash = settlementHash(paymentId, decision, score, refundPercent, buyer, seller, attestationDigest);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        address signer = ECDSA.recover(ethHash, proof);
        require(signer == attestor, "Invalid settlement proof");
    }

    /// @dev Strict decoder: exactly 64 characters, each a valid hex digit.
    ///      Empty strings and arbitrary text are rejected.
    function _decodeDigest(string memory attestation) internal pure returns (bytes32) {
        bytes memory b = bytes(attestation);
        require(b.length != 0, "Empty attestation");
        require(b.length == 64, "Attestation must be 64 hex chars");
        uint256 value = 0;
        for (uint256 i = 0; i < 64; i++) {
            value = (value << 4) | uint256(_fromHexChar(b[i]));
        }
        return bytes32(value);
    }

    function _fromHexChar(bytes1 c) internal pure returns (uint8) {
        uint8 v = uint8(c);
        if (v >= 48 && v <= 57) return v - 48; // 0-9
        if (v >= 97 && v <= 102) return v - 87; // a-f
        if (v >= 65 && v <= 70) return v - 55; // A-F
        revert("Invalid hex in attestation");
    }

    function _hexChar(uint8 v) internal pure returns (bytes1) {
        return v < 10 ? bytes1(uint8(48 + v)) : bytes1(uint8(87 + v));
    }

    /// @dev Lowercase 40-char hex of an address (no 0x), as bytes.
    function _lowerHexBytes(address a) internal pure returns (bytes memory out) {
        out = new bytes(40);
        uint160 value = uint160(a);
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(value >> (8 * (19 - i)));
            out[i * 2] = _hexChar(b >> 4);
            out[i * 2 + 1] = _hexChar(b & 0x0f);
        }
    }

    /// @dev EIP-55 checksummed "0x..." address, matching GenLayer Address.as_hex.
    function _checksumHex(address a) internal pure returns (string memory) {
        bytes memory lower = _lowerHexBytes(a);
        bytes32 h = keccak256(lower);
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 40; i++) {
            bytes1 c = lower[i];
            uint8 nibble = i % 2 == 0 ? uint8(h[i / 2]) >> 4 : uint8(h[i / 2]) & 0x0f;
            if (c >= "a" && c <= "f" && nibble >= 8) {
                out[i + 2] = bytes1(uint8(c) - 32);
            } else {
                out[i + 2] = c;
            }
        }
        return string(out);
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
