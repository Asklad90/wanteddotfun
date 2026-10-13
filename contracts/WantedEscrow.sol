// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract WantedEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Bounty {
        uint256 id;
        address poster;
        bytes title;
        bytes description;
        uint256 rewardPerWinner;
        uint256 maxWinners;
        uint256 winnersApproved;
        uint64 deadline;
        uint256 escrowRemaining;
        bool reclaimedUnused;
        bool cancelled;
    }

    struct Submission {
        uint256 id;
        address submitter;
        uint256 bountyId;
        bytes content;
    }

    enum PayoutStatus {
        None,
        Pending,
        Paid
    }

    enum MyStatus {
        None,
        Submitted,
        WinnerPending,
        WinnerPaid,
        NotSelected
    }

    error ZeroAddress();
    error InvalidTitle();
    error InvalidDescription();
    error InvalidContent();
    error InvalidReward();
    error InvalidMaxWinners();
    error InvalidDeadline();
    error BountyNotFound();
    error AlreadySubmitted();
    error PosterCannotSubmit();
    error BountyWasCancelled();
    error DeadlinePassedForSubmit();
    error ApprovalWindowClosed();
    error AlreadyWinner();
    error BountyFull();
    error NotPoster();
    error DepositMismatch();
    error NotPendingPayout();
    error BountyAlreadyCancelled();
    error HasSubmissions();
    error ReviewWindowActive();
    error AlreadyReclaimed();
    error NothingToReclaim();

    event BountyCreated(
        uint256 indexed id,
        address indexed poster,
        bytes title,
        bytes description,
        uint256 rewardPerWinner,
        uint256 maxWinners,
        uint64 deadline,
        uint256 total
    );

    event WorkSubmitted(
        uint256 indexed bountyId,
        uint256 indexed submissionId,
        address indexed submitter,
        bytes content
    );

    event WinnerPaid(uint256 indexed bountyId, address indexed submitter, uint256 amount);
    event PayoutPending(uint256 indexed bountyId, address indexed submitter, uint256 amount);
    event RewardClaimed(uint256 indexed bountyId, address indexed submitter, uint256 amount);
    event EscrowReclaimed(uint256 indexed bountyId, address indexed poster, uint256 amount);
    event BountyCancelled(uint256 indexed bountyId, address indexed poster, uint256 refundAmount);

    address public immutable usdc;
    uint32 public immutable reviewWindow;

    uint256 private _bountyCount;
    uint256 private _submissionCount;

    uint256 private _totalEscrowed;
    uint256 private _totalPaid;
    uint256 private _totalReclaimed;

    mapping(uint256 => Bounty) private _bounties;
    mapping(uint256 => Submission[]) private _submissions;
    mapping(uint256 => uint256) private _submissionCountByBounty;

    mapping(uint256 => mapping(address => bool)) private _hasSubmitted;
    mapping(uint256 => mapping(address => bool)) private _isWinner;
    mapping(uint256 => mapping(address => PayoutStatus)) private _payoutStatus;

    mapping(uint256 => uint256) private _pendingCount;

    mapping(address => uint256[]) private _posterBounties;
    mapping(address => uint256[]) private _submitterBounties;
    mapping(address => uint256) private _addrTotalPaid;
    mapping(address => uint256) private _addrTotalPending;
    mapping(address => uint256) private _addrWins;

    constructor(address usdc_, uint32 reviewWindow_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        reviewWindow = reviewWindow_;
    }

    function createBounty(
        bytes calldata title,
        bytes calldata description,
        uint256 rewardPerWinner,
        uint256 maxWinners,
        uint64 deadline
    ) external nonReentrant {
        if (title.length > 80) revert InvalidTitle();
        if (description.length > 500) revert InvalidDescription();
        if (rewardPerWinner == 0) revert InvalidReward();
        if (maxWinners == 0 || maxWinners > 50) revert InvalidMaxWinners();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        uint256 total;
        unchecked {
            total = rewardPerWinner * maxWinners;
        }
        if (total / maxWinners != rewardPerWinner) revert InvalidReward();

        IERC20 token = IERC20(usdc);
        uint256 balBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), total);
        uint256 balAfter = token.balanceOf(address(this));

        if (balAfter - balBefore != total) revert DepositMismatch();

        uint256 bountyId = _bountyCount + 1;
        _bountyCount = bountyId;

        _bounties[bountyId] = Bounty({
            id: bountyId,
            poster: msg.sender,
            title: title,
            description: description,
            rewardPerWinner: rewardPerWinner,
            maxWinners: maxWinners,
            winnersApproved: 0,
            deadline: deadline,
            escrowRemaining: total,
            reclaimedUnused: false,
            cancelled: false
        });

        _posterBounties[msg.sender].push(bountyId);
        _totalEscrowed += total;

        emit BountyCreated(bountyId, msg.sender, title, description, rewardPerWinner, maxWinners, deadline, total);
    }

    function submit(uint256 bountyId, bytes calldata content) external {
        if (content.length > 300) revert InvalidContent();

        Bounty storage bounty = _bounty(bountyId);
        if (bounty.cancelled) revert BountyWasCancelled();
        if (block.timestamp >= bounty.deadline) revert DeadlinePassedForSubmit();
        if (msg.sender == bounty.poster) revert PosterCannotSubmit();
        if (_hasSubmitted[bountyId][msg.sender]) revert AlreadySubmitted();

        uint256 submissionId = _submissionCount + 1;
        _submissionCount = submissionId;

        _submissions[bountyId].push(
            Submission({id: submissionId, submitter: msg.sender, bountyId: bountyId, content: content})
        );

        _hasSubmitted[bountyId][msg.sender] = true;
        _submissionCountByBounty[bountyId] += 1;
        _submitterBounties[msg.sender].push(bountyId);

        emit WorkSubmitted(bountyId, submissionId, msg.sender, content);
    }

    function approveWinner(uint256 bountyId, address submitter) external nonReentrant {
        Bounty storage bounty = _bounty(bountyId);

        if (msg.sender != bounty.poster) revert NotPoster();
        if (block.timestamp > _approvalCutoff(bounty.deadline)) revert ApprovalWindowClosed();
        if (!_hasSubmitted[bountyId][submitter]) revert BountyNotFound();
        if (_isWinner[bountyId][submitter]) revert AlreadyWinner();
        if (bounty.winnersApproved >= bounty.maxWinners) revert BountyFull();

        uint256 amount = bounty.rewardPerWinner;

        _isWinner[bountyId][submitter] = true;
        bounty.winnersApproved += 1;
        bounty.escrowRemaining -= amount;
        _payoutStatus[bountyId][submitter] = PayoutStatus.Pending;

        (bool ok, bytes memory data) = usdc.call(abi.encodeWithSelector(IERC20.transfer.selector, submitter, amount));
        bool transferOk;
        if (ok) {
            if (data.length == 0) {
                transferOk = true;
            } else if (data.length >= 32) {
                transferOk = abi.decode(data, (bool));
            }
        }

        if (transferOk) {
            _payoutStatus[bountyId][submitter] = PayoutStatus.Paid;
            _totalPaid += amount;
            _addrTotalPaid[submitter] += amount;
            _addrWins[submitter] += 1;
            emit WinnerPaid(bountyId, submitter, amount);
        } else {
            bounty.escrowRemaining += amount;
            _pendingCount[bountyId] += 1;
            _addrTotalPending[submitter] += amount;
            _addrWins[submitter] += 1;
            emit PayoutPending(bountyId, submitter, amount);
        }
    }

    function claim(uint256 bountyId) external nonReentrant {
        if (_payoutStatus[bountyId][msg.sender] != PayoutStatus.Pending) revert NotPendingPayout();

        Bounty storage bounty = _bounty(bountyId);
        uint256 amount = bounty.rewardPerWinner;

        _payoutStatus[bountyId][msg.sender] = PayoutStatus.Paid;
        _addrTotalPending[msg.sender] -= amount;
        _addrTotalPaid[msg.sender] += amount;
        _pendingCount[bountyId] -= 1;
        bounty.escrowRemaining -= amount;
        _totalPaid += amount;

        IERC20(usdc).safeTransfer(msg.sender, amount);

        emit RewardClaimed(bountyId, msg.sender, amount);
    }

    function reclaimUnused(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = _bounty(bountyId);

        if (msg.sender != bounty.poster) revert NotPoster();
        if (block.timestamp <= _approvalCutoff(bounty.deadline)) revert ReviewWindowActive();
        if (bounty.reclaimedUnused) revert AlreadyReclaimed();
        if (bounty.escrowRemaining == 0) revert NothingToReclaim();

        uint256 pendingValue = _pendingCount[bountyId] * bounty.rewardPerWinner;
        if (pendingValue > bounty.escrowRemaining) revert NothingToReclaim();

        uint256 reclaimable = bounty.escrowRemaining - pendingValue;
        if (reclaimable == 0) revert NothingToReclaim();

        bounty.reclaimedUnused = true;
        bounty.escrowRemaining = pendingValue;
        _totalReclaimed += reclaimable;

        IERC20(usdc).safeTransfer(bounty.poster, reclaimable);

        emit EscrowReclaimed(bountyId, bounty.poster, reclaimable);
    }

    function cancel(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = _bounty(bountyId);

        if (msg.sender != bounty.poster) revert NotPoster();
        if (_submissionCountByBounty[bountyId] != 0) revert HasSubmissions();
        if (bounty.cancelled) revert BountyAlreadyCancelled();

        uint256 refundAmount = bounty.escrowRemaining;

        bounty.cancelled = true;
        bounty.escrowRemaining = 0;
        _totalReclaimed += refundAmount;

        IERC20(usdc).safeTransfer(bounty.poster, refundAmount);

        emit BountyCancelled(bountyId, bounty.poster, refundAmount);
    }

    function getBounty(uint256 id) external view returns (Bounty memory) {
        return _bounty(id);
    }

    function getBountyCount() external view returns (uint256) {
        return _bountyCount;
    }

    function getSubmissions(uint256 bountyId, uint256 offset, uint256 limit) external view returns (Submission[] memory) {
        _requireBountyExists(bountyId);

        Submission[] storage all = _submissions[bountyId];
        uint256 len = all.length;

        if (offset >= len || limit == 0) {
            return new Submission[](0);
        }

        uint256 end = offset + limit;
        if (end > len) end = len;

        uint256 outLen = end - offset;
        Submission[] memory page = new Submission[](outLen);

        for (uint256 i = 0; i < outLen; i++) {
            page[i] = all[offset + i];
        }

        return page;
    }

    function isWinner(uint256 bountyId, address user) external view returns (bool) {
        return _isWinner[bountyId][user];
    }

    function payoutStatus(uint256 bountyId, address user) external view returns (PayoutStatus) {
        return _payoutStatus[bountyId][user];
    }

    function getBountiesByPoster(address poster) external view returns (uint256[] memory) {
        return _posterBounties[poster];
    }

    function getBountiesBySubmitter(address submitter) external view returns (uint256[] memory) {
        return _submitterBounties[submitter];
    }

    function getPostedBounties(address addr, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        uint256[] storage all = _posterBounties[addr];
        return _paginate(all, offset, limit);
    }

    function getSubmittedBounties(address addr, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        uint256[] storage all = _submitterBounties[addr];
        return _paginate(all, offset, limit);
    }

    function getEarnings(address addr) external view returns (uint256 paid, uint256 pending, uint256 wins) {
        return (_addrTotalPaid[addr], _addrTotalPending[addr], _addrWins[addr]);
    }

    function getMyStatus(uint256 bountyId, address addr) external view returns (MyStatus) {
        if (!_hasSubmitted[bountyId][addr]) return MyStatus.None;
        if (!_isWinner[bountyId][addr]) {
            Bounty storage bounty = _bounties[bountyId];
            if (bounty.id != 0 && block.timestamp > _approvalCutoff(bounty.deadline)) {
                return MyStatus.NotSelected;
            }
            return MyStatus.Submitted;
        }

        PayoutStatus ps = _payoutStatus[bountyId][addr];
        if (ps == PayoutStatus.Pending) return MyStatus.WinnerPending;
        return MyStatus.WinnerPaid;
    }

    function hasSubmitted(uint256 bountyId, address user) external view returns (bool) {
        return _hasSubmitted[bountyId][user];
    }

    function totalEscrowLocked() external view returns (uint256) {
        return _totalEscrowed - _totalPaid - _totalReclaimed;
    }

    function totalWinnersPaid() external view returns (uint256) {
        return _totalPaid;
    }

    function totalBounties() external view returns (uint256) {
        return _bountyCount;
    }

    function _approvalCutoff(uint64 deadline) internal view returns (uint256) {
        return uint256(deadline) + uint256(reviewWindow);
    }

    function _paginate(uint256[] storage all, uint256 offset, uint256 limit) internal view returns (uint256[] memory) {
        uint256 len = all.length;
        if (offset >= len || limit == 0) return new uint256[](0);

        uint256 end = offset + limit;
        if (end > len) end = len;

        uint256 outLen = end - offset;
        uint256[] memory page = new uint256[](outLen);
        for (uint256 i = 0; i < outLen; i++) {
            page[i] = all[offset + i];
        }

        return page;
    }

    function _requireBountyExists(uint256 bountyId) internal view {
        if (_bounties[bountyId].id == 0) revert BountyNotFound();
    }

    function _bounty(uint256 bountyId) internal view returns (Bounty storage bounty) {
        bounty = _bounties[bountyId];
        if (bounty.id == 0) revert BountyNotFound();
    }
}
