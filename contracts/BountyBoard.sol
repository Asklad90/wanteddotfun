// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract BountyBoard is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Bounty {
        uint256 id;
        address poster;
        string title;
        string description;
        uint256 rewardPerWinner;
        uint256 maxWinners;
        uint256 winnersCount;
        uint64 deadline;
        uint256 totalEscrowed;
        uint256 totalClaimed;
        bool cancelled;
    }

    struct Submission {
        uint256 id;
        address submitter;
        uint256 bountyId;
        string text;
        bool approved;
    }

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed poster,
        string title,
        string description,
        uint256 rewardPerWinner,
        uint256 maxWinners,
        uint64 deadline,
        uint256 totalEscrowed
    );

    event WorkSubmitted(
        uint256 indexed bountyId,
        uint256 indexed submissionId,
        address indexed submitter,
        string submissionText
    );

    event SubmissionApproved(uint256 indexed bountyId, uint256 indexed submissionId, address indexed winner);
    event RewardClaimed(uint256 indexed bountyId, address indexed winner, uint256 amount);
    event EscrowReclaimed(uint256 indexed bountyId, address indexed poster, uint256 amount);

    error ZeroAddress();
    error InvalidDeadline();
    error InvalidReward();
    error InvalidMaxWinners();
    error BountyNotFound();
    error SubmissionNotFound();
    error AlreadySubmitted();
    error NotPoster();
    error BountyFull();
    error AlreadyApproved();
    error NotWinner();
    error AlreadyClaimed();
    error DeadlineNotReached();
    error NoUnclaimedEscrow();

    IERC20 public immutable usdc;

    uint256 private _bountyCount;
    uint256 private _totalUsdcEscrowed;
    uint256 private _totalWinnersPaid;

    mapping(uint256 => Bounty) private _bounties;
    mapping(uint256 => mapping(uint256 => Submission)) private _submissions;
    mapping(uint256 => uint256) private _submissionCounts;

    mapping(uint256 => mapping(address => bool)) private _submitted;
    mapping(uint256 => mapping(address => bool)) private _winners;
    mapping(uint256 => mapping(address => bool)) private _claimed;

    mapping(uint256 => address[]) private _winnerAddresses;
    mapping(address => uint256[]) private _bountiesByPoster;
    mapping(address => uint256[]) private _bountiesBySubmitter;

    constructor(address usdcToken) {
        if (usdcToken == address(0)) revert ZeroAddress();
        usdc = IERC20(usdcToken);
    }

    function createBounty(
        string calldata title,
        string calldata description,
        uint256 rewardPerWinner,
        uint256 maxWinners,
        uint64 deadline
    ) external nonReentrant {
        if (rewardPerWinner == 0) revert InvalidReward();
        if (maxWinners == 0) revert InvalidMaxWinners();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        uint256 totalEscrow = rewardPerWinner * maxWinners;

        _bountyCount++;
        uint256 bountyId = _bountyCount;

        _bounties[bountyId] = Bounty({
            id: bountyId,
            poster: msg.sender,
            title: title,
            description: description,
            rewardPerWinner: rewardPerWinner,
            maxWinners: maxWinners,
            winnersCount: 0,
            deadline: deadline,
            totalEscrowed: totalEscrow,
            totalClaimed: 0,
            cancelled: false
        });

        _bountiesByPoster[msg.sender].push(bountyId);
        _totalUsdcEscrowed += totalEscrow;

        usdc.safeTransferFrom(msg.sender, address(this), totalEscrow);

        emit BountyCreated(
            bountyId,
            msg.sender,
            title,
            description,
            rewardPerWinner,
            maxWinners,
            deadline,
            totalEscrow
        );
    }

    function submitWork(uint256 bountyId, string calldata submissionText) external {
        Bounty storage bounty = _bounties[bountyId];
        if (bounty.id == 0) revert BountyNotFound();
        if (_submitted[bountyId][msg.sender]) revert AlreadySubmitted();

        _submissionCounts[bountyId]++;
        uint256 submissionId = _submissionCounts[bountyId];

        _submissions[bountyId][submissionId] = Submission({
            id: submissionId,
            submitter: msg.sender,
            bountyId: bountyId,
            text: submissionText,
            approved: false
        });

        _submitted[bountyId][msg.sender] = true;
        _bountiesBySubmitter[msg.sender].push(bountyId);

        emit WorkSubmitted(bountyId, submissionId, msg.sender, submissionText);
    }

    function approveSubmission(uint256 bountyId, uint256 submissionId) external {
        Bounty storage bounty = _bounties[bountyId];
        if (bounty.id == 0) revert BountyNotFound();
        if (msg.sender != bounty.poster) revert NotPoster();
        if (bounty.winnersCount >= bounty.maxWinners) revert BountyFull();

        Submission storage submission = _submissions[bountyId][submissionId];
        if (submission.id == 0) revert SubmissionNotFound();
        if (submission.approved) revert AlreadyApproved();

        submission.approved = true;
        bounty.winnersCount += 1;
        _winners[bountyId][submission.submitter] = true;
        _winnerAddresses[bountyId].push(submission.submitter);

        emit SubmissionApproved(bountyId, submissionId, submission.submitter);
    }

    function claimReward(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = _bounties[bountyId];
        if (bounty.id == 0) revert BountyNotFound();
        if (!_winners[bountyId][msg.sender]) revert NotWinner();
        if (_claimed[bountyId][msg.sender]) revert AlreadyClaimed();

        uint256 amount = bounty.rewardPerWinner;

        _claimed[bountyId][msg.sender] = true;
        bounty.totalClaimed += amount;
        _totalWinnersPaid += amount;

        usdc.safeTransfer(msg.sender, amount);

        emit RewardClaimed(bountyId, msg.sender, amount);
    }

    function reclaimExpiredEscrow(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = _bounties[bountyId];
        if (bounty.id == 0) revert BountyNotFound();
        if (msg.sender != bounty.poster) revert NotPoster();
        if (block.timestamp <= bounty.deadline) revert DeadlineNotReached();

        uint256 remaining = bounty.totalEscrowed - bounty.totalClaimed;
        if (remaining == 0) revert NoUnclaimedEscrow();

        bounty.totalClaimed = bounty.totalEscrowed;

        usdc.safeTransfer(bounty.poster, remaining);

        emit EscrowReclaimed(bountyId, bounty.poster, remaining);
    }

    function totalBounties() external view returns (uint256) {
        return _bountyCount;
    }

    function totalUsdcEscrowed() external view returns (uint256) {
        return _totalUsdcEscrowed;
    }

    function totalWinnersPaid() external view returns (uint256) {
        return _totalWinnersPaid;
    }

    function getBounty(uint256 id) external view returns (Bounty memory) {
        return _bounties[id];
    }

    function getSubmission(uint256 bountyId, uint256 submissionId) external view returns (Submission memory) {
        return _submissions[bountyId][submissionId];
    }

    function getSubmissionCount(uint256 bountyId) external view returns (uint256) {
        return _submissionCounts[bountyId];
    }

    function getWinnerAddresses(uint256 bountyId) external view returns (address[] memory) {
        return _winnerAddresses[bountyId];
    }

    function hasSubmitted(uint256 bountyId, address user) external view returns (bool) {
        return _submitted[bountyId][user];
    }

    function isWinner(uint256 bountyId, address user) external view returns (bool) {
        return _winners[bountyId][user];
    }

    function hasClaimed(uint256 bountyId, address user) external view returns (bool) {
        return _claimed[bountyId][user];
    }

    function getBountiesByPoster(address poster) external view returns (uint256[] memory) {
        return _bountiesByPoster[poster];
    }

    function getBountiesBySubmitter(address submitter) external view returns (uint256[] memory) {
        return _bountiesBySubmitter[submitter];
    }
}
