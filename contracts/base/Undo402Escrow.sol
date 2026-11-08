// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Undo402Escrow — USDC escrow on Base (Sepolia / mainnet)
/// @notice Holds REAL stablecoin (USDC) for agentic payments.
///         GenLayer (Undo402) adjudicates the dispute; this contract only
///         holds and releases USDC based on the relay's verdict.
/// @dev Pattern: InternetCourt Agreement.sol (Base escrow + GenLayer jury).
///      Deploy to Base Sepolia for testnet, Base mainnet for production.
contract Undo402Escrow is Ownable {
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
    address public relay; // GenLayer relay wallet (executes verdicts)

    event EscrowCreated(string indexed paymentId, address indexed buyer, address indexed seller, uint256 amount);
    event EscrowReleased(string indexed paymentId, address indexed seller, uint256 amount, string attestation);
    event EscrowRefunded(string indexed paymentId, address indexed buyer, uint256 amount, string attestation);
    event EscrowPartial(string indexed paymentId, address indexed seller, uint256 sellerAmount, address indexed buyer, uint256 buyerAmount, string attestation);

    modifier onlyRelay() {
        require(msg.sender == relay || msg.sender == owner(), "Not relay/owner");
        _;
    }

    constructor(address _usdc) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        usdc = IERC20(_usdc);
        relay = msg.sender;
    }

    function setRelay(address _relay) external onlyOwner {
        relay = _relay;
    }

    /// @notice Create escrow: buyer approves USDC first, then calls this.
    /// @param ttlSeconds Buyer timeout window (e.g. 86400 = 1 day). After this,
    ///        buyer can claim refund directly even if relay is offline.
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
    function release(string calldata paymentId, string calldata attestation) external onlyRelay {
        Escrow storage e = escrows[paymentId];
        require(e.status == Status.FUNDED, "Not funded");
        e.status = Status.RELEASED;
        e.attestation = attestation;
        usdc.safeTransfer(e.seller, e.amount);
        emit EscrowReleased(paymentId, e.seller, e.amount, attestation);
    }

    /// @notice Refund USDC to buyer (GenLayer verdict: refund).
    function refund(string calldata paymentId, string calldata attestation) external onlyRelay {
        Escrow storage e = escrows[paymentId];
        require(e.status == Status.FUNDED, "Not funded");
        e.status = Status.REFUNDED;
        e.attestation = attestation;
        usdc.safeTransfer(e.buyer, e.amount);
        emit EscrowRefunded(paymentId, e.buyer, e.amount, attestation);
    }

    /// @notice Partial split (GenLayer verdict: partial).
    /// @param sellerPercent 0-100, seller share. Buyer gets the rest.
    function releasePartial(string calldata paymentId, uint256 sellerPercent, string calldata attestation) external onlyRelay {
        require(sellerPercent > 0 && sellerPercent < 100, "Percent 1-99");
        Escrow storage e = escrows[paymentId];
        require(e.status == Status.FUNDED, "Not funded");
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
}
