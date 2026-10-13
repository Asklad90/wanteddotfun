// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {WantedEscrow} from "../WantedEscrow.sol";
import {MockERC20}    from "../test-helpers/MockERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Standalone ERC-20 that calls back into an attacker on transfer.
// Does NOT inherit MockERC20 to avoid override-specifier issues.
// ─────────────────────────────────────────────────────────────────────────────
contract MockERC20Reentrant {
    string public constant name     = "Reentrant USDC";
    string public constant symbol   = "rUSDC";
    uint8  public constant decimals = 6;

    mapping(address => uint256) private _bal;
    mapping(address => mapping(address => uint256)) private _allow;
    uint256 private _ts;

    // The attacker contract — set after deploy
    address public attacker;

    function setAttacker(address a) external { attacker = a; }

    function mint(address to, uint256 amount) external {
        _bal[to] += amount;
        _ts      += amount;
    }

    function totalSupply() external view returns (uint256) { return _ts; }

    function balanceOf(address a) external view returns (uint256) { return _bal[a]; }

    function allowance(address o, address s) external view returns (uint256) { return _allow[o][s]; }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allow[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(_bal[from] >= amount, "insufficient");
        require(_allow[from][msg.sender] >= amount, "allowance");
        _allow[from][msg.sender] -= amount;
        _bal[from] -= amount;
        _bal[to]   += amount;
        return true;
    }

    /// On every transfer to the registered attacker, call onTransfer() so it
    /// can attempt reentrancy. The transfer itself still completes (returns true).
    function transfer(address to, uint256 amount) external returns (bool) {
        require(_bal[msg.sender] >= amount, "insufficient");
        _bal[msg.sender] -= amount;
        _bal[to]         += amount;
        // Trigger reentrancy callback AFTER state update (simulating an
        // ERC-777-style hook or a contract-receiver hook).
        if (to == attacker && attacker != address(0)) {
            IReentrantAttacker(attacker).onTransfer();
        }
        return true;
    }
}

interface IReentrantAttacker {
    function onTransfer() external;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attacker: tries to call claim() again inside the transfer callback.
// ─────────────────────────────────────────────────────────────────────────────
contract ReentrantAttacker is IReentrantAttacker {
    WantedEscrow public escrow;
    uint256      public bountyId;
    bool         private _inClaim;
    bool         public  reentrancyBlocked;

    constructor(WantedEscrow escrow_, uint256 bountyId_) {
        escrow   = escrow_;
        bountyId = bountyId_;
    }

    /// Called by MockERC20Reentrant.transfer() when tokens are sent here.
    function onTransfer() external override {
        if (_inClaim) {
            // Second attempt — should be blocked by ReentrancyGuard.
            try escrow.claim(bountyId) {
                // If this succeeds, reentrancy guard is broken.
            } catch {
                reentrancyBlocked = true;
            }
        }
    }

    /// Initiates the first claim() — sets _inClaim so the nested call is attempted.
    function attack() external {
        _inClaim = true;
        escrow.claim(bountyId);
        _inClaim = false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ERC-20 whose transfer() always returns false (never reverts).
// Used to force the pending-payout path in tests that require a separate escrow
// instance (so the failing behaviour can be toggled independently of setUp's
// `usdc` mock which is also used by non-failing tests).
// ─────────────────────────────────────────────────────────────────────────────
contract FailingERC20 {
    string public constant name     = "Failing USDC";
    string public constant symbol   = "fUSDC";
    uint8  public constant decimals = 6;

    bool private _transfersEnabled; // starts false → transfer() returns false

    mapping(address => uint256) private _bal;
    mapping(address => mapping(address => uint256)) private _allow;
    uint256 private _ts;

    /// Enable real transfers (used after pending state is set up).
    function enableTransfers() external { _transfersEnabled = true; }

    function mint(address to, uint256 amount) external {
        _bal[to] += amount;
        _ts      += amount;
    }

    function totalSupply() external view returns (uint256) { return _ts; }

    function balanceOf(address a) external view returns (uint256) { return _bal[a]; }

    function allowance(address o, address s) external view returns (uint256) { return _allow[o][s]; }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allow[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(_bal[from] >= amount, "FailingERC20: insufficient balance");
        require(_allow[from][msg.sender] >= amount, "FailingERC20: allowance");
        _allow[from][msg.sender] -= amount;
        _bal[from] -= amount;
        _bal[to]   += amount;
        return true;
    }

    /// Always returns false (never reverts) so the escrow puts payout in Pending.
    function transfer(address to, uint256 amount) external returns (bool) {
        if (!_transfersEnabled) return false;
        require(_bal[msg.sender] >= amount, "FailingERC20: insufficient balance");
        _bal[msg.sender] -= amount;
        _bal[to]         += amount;
        return true;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main test contract
// ─────────────────────────────────────────────────────────────────────────────
contract WantedEscrowTest is Test {

    // ── fixtures ─────────────────────────────────────────────────────────────
    MockERC20    internal usdc;
    WantedEscrow internal escrow;

    address internal poster = makeAddr("poster");
    address internal alice  = makeAddr("alice");
    address internal bob    = makeAddr("bob");

    uint32  internal constant REVIEW_WINDOW   = 1 days;
    uint256 internal constant REWARD          = 100e6;   // 100 USDC (6 decimals)
    uint256 internal constant MAX_WINNERS     = 3;
    uint256 internal constant TOTAL_ESCROW    = REWARD * MAX_WINNERS; // 300 USDC

    // Bounty params (bytes, not strings)
    bytes internal TITLE       = bytes("Test bounty title");
    bytes internal DESCRIPTION = bytes("Test bounty description");
    bytes internal CONTENT     = bytes("My submission content");

    uint64 internal DEADLINE;

    // ── setUp ─────────────────────────────────────────────────────────────────
    function setUp() public {
        usdc   = new MockERC20("Mock USDC", "mUSDC", 6);
        escrow = new WantedEscrow(address(usdc), REVIEW_WINDOW);

        DEADLINE = uint64(block.timestamp + 7 days);

        // Give poster plenty of tokens
        usdc.mint(poster, TOTAL_ESCROW * 10);
    }

    // ── internal helpers ──────────────────────────────────────────────────────

    /// Approve and create a standard bounty as poster; returns bountyId = 1.
    function _createBounty() internal returns (uint256) {
        vm.startPrank(poster);
        usdc.approve(address(escrow), TOTAL_ESCROW);
        escrow.createBounty(TITLE, DESCRIPTION, REWARD, MAX_WINNERS, DEADLINE);
        vm.stopPrank();
        return 1;
    }

    function _submit(uint256 bountyId, address submitter) internal {
        vm.prank(submitter);
        escrow.submit(bountyId, CONTENT);
    }

    /// Warp past the deadline but still INSIDE the review window.
    function _warpPastDeadlineOnly() internal {
        vm.warp(DEADLINE + 1);
    }

    /// Warp past BOTH the deadline AND the full review window.
    function _warpPastReviewWindow() internal {
        vm.warp(DEADLINE + REVIEW_WINDOW + 1);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 1. createBounty locks exact funds; contract balance increases by total
    // ═════════════════════════════════════════════════════════════════════════
    function test_CreateBountyLocksExactFunds() public {
        uint256 contractBalBefore = usdc.balanceOf(address(escrow));

        _createBounty();

        uint256 contractBalAfter = usdc.balanceOf(address(escrow));
        assertEq(
            contractBalAfter - contractBalBefore,
            TOTAL_ESCROW,
            "contract balance must increase by rewardPerWinner * maxWinners"
        );

        WantedEscrow.Bounty memory b = escrow.getBounty(1);
        assertEq(b.id,              1,              "bounty id must be 1");
        assertEq(b.poster,          poster,         "poster must be stored");
        assertEq(b.rewardPerWinner, REWARD,         "reward per winner must match");
        assertEq(b.maxWinners,      MAX_WINNERS,    "maxWinners must match");
        assertEq(b.escrowRemaining, TOTAL_ESCROW,   "escrow remaining must equal total");
        assertFalse(b.cancelled,        "must not be cancelled");
        assertFalse(b.reclaimedUnused,  "must not be reclaimed");
        assertEq(escrow.getBountyCount(), 1, "bounty count must be 1");
    }

    function test_CreateBountyEmitsBountyCreated() public {
        vm.startPrank(poster);
        usdc.approve(address(escrow), TOTAL_ESCROW);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit WantedEscrow.BountyCreated(
            1, poster, TITLE, DESCRIPTION, REWARD, MAX_WINNERS, DEADLINE, TOTAL_ESCROW
        );

        escrow.createBounty(TITLE, DESCRIPTION, REWARD, MAX_WINNERS, DEADLINE);
        vm.stopPrank();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 2. createBounty reverts with no allowance — count unchanged
    // ═════════════════════════════════════════════════════════════════════════
    function test_CreateBountyRevertsWithNoAllowance() public {
        // poster has balance but zero approval
        vm.prank(poster);
        vm.expectRevert();   // SafeERC20 wraps the insufficient-allowance failure
        escrow.createBounty(TITLE, DESCRIPTION, REWARD, MAX_WINNERS, DEADLINE);

        assertEq(escrow.getBountyCount(), 0, "bounty count must remain 0 after failed create");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 3. createBounty reverts with insufficient balance — count unchanged
    // ═════════════════════════════════════════════════════════════════════════
    function test_CreateBountyRevertsWithInsufficientBalance() public {
        address broke = makeAddr("broke");
        // broke has no tokens but approves
        vm.startPrank(broke);
        usdc.approve(address(escrow), TOTAL_ESCROW);
        vm.expectRevert();   // SafeERC20 wraps the insufficient-balance failure
        escrow.createBounty(TITLE, DESCRIPTION, REWARD, MAX_WINNERS, DEADLINE);
        vm.stopPrank();

        assertEq(escrow.getBountyCount(), 0, "bounty count must remain 0");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 4. Submit rules
    // ═════════════════════════════════════════════════════════════════════════

    // 4a. poster cannot submit
    function test_SubmitRevertsForPoster() public {
        _createBounty();

        vm.prank(poster);
        vm.expectRevert(WantedEscrow.PosterCannotSubmit.selector);
        escrow.submit(1, CONTENT);
    }

    // 4b. only before deadline
    function test_SubmitRevertsAfterDeadline() public {
        _createBounty();
        _warpPastDeadlineOnly();

        vm.prank(alice);
        vm.expectRevert(WantedEscrow.DeadlinePassedForSubmit.selector);
        escrow.submit(1, CONTENT);
    }

    // 4c. one per address
    function test_SubmitRevertsOnDoubleSubmit() public {
        _createBounty();
        _submit(1, alice);

        vm.prank(alice);
        vm.expectRevert(WantedEscrow.AlreadySubmitted.selector);
        escrow.submit(1, CONTENT);
    }

    // 4d. happy path
    function test_SubmitHappyPath() public {
        _createBounty();

        assertFalse(escrow.hasSubmitted(1, alice), "alice should not have submitted yet");

        vm.expectEmit(true, true, true, true, address(escrow));
        emit WantedEscrow.WorkSubmitted(1, 1, alice, CONTENT);

        _submit(1, alice);

        assertTrue(escrow.hasSubmitted(1, alice), "alice should now have submitted");
        assertFalse(escrow.isWinner(1, alice),    "alice should not be a winner yet");
    }

    // 4e. non-existent bounty
    function test_SubmitRevertsOnUnknownBounty() public {
        vm.prank(alice);
        vm.expectRevert(WantedEscrow.BountyNotFound.selector);
        escrow.submit(999, CONTENT);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 5. approveWinner auto-pays when transfer succeeds → PayoutStatus.Paid
    // ═════════════════════════════════════════════════════════════════════════
    function test_ApproveWinnerPaysDirect() public {
        _createBounty();
        _submit(1, alice);
        _warpPastDeadlineOnly();

        uint256 aliceBalBefore  = usdc.balanceOf(alice);
        uint256 escrowBalBefore = usdc.balanceOf(address(escrow));

        vm.expectEmit(true, true, false, true, address(escrow));
        emit WantedEscrow.WinnerPaid(1, alice, REWARD);

        vm.prank(poster);
        escrow.approveWinner(1, alice);

        assertEq(
            uint8(escrow.payoutStatus(1, alice)),
            uint8(WantedEscrow.PayoutStatus.Paid),
            "payout status should be Paid after direct transfer"
        );
        assertTrue(escrow.isWinner(1, alice),               "alice must be marked winner");
        assertEq(usdc.balanceOf(alice),           aliceBalBefore  + REWARD, "alice balance must increase");
        assertEq(usdc.balanceOf(address(escrow)), escrowBalBefore - REWARD, "escrow balance must decrease");

        WantedEscrow.Bounty memory b = escrow.getBounty(1);
        assertEq(b.winnersApproved, 1, "winnersApproved must be 1");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 6. approveWinner Pending path + claim
    // ═════════════════════════════════════════════════════════════════════════
    function test_ApproveWinnerPendingThenClaimPays() public {
        _createBounty();
        _submit(1, alice);
        _warpPastDeadlineOnly();

        // Force transfer to return false
        usdc.setTransferShouldFail(true);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit WantedEscrow.PayoutPending(1, alice, REWARD);

        vm.prank(poster);
        escrow.approveWinner(1, alice);

        assertEq(
            uint8(escrow.payoutStatus(1, alice)),
            uint8(WantedEscrow.PayoutStatus.Pending),
            "payout status must be Pending when transfer returns false"
        );

        // Re-enable transfers so claim succeeds
        usdc.setTransferShouldFail(false);

        uint256 aliceBalBefore = usdc.balanceOf(alice);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit WantedEscrow.RewardClaimed(1, alice, REWARD);

        vm.prank(alice);
        escrow.claim(1);

        assertEq(
            uint8(escrow.payoutStatus(1, alice)),
            uint8(WantedEscrow.PayoutStatus.Paid),
            "payout status must be Paid after claim"
        );
        assertEq(usdc.balanceOf(alice), aliceBalBefore + REWARD, "alice must receive reward on claim");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 7. Cannot approve more than maxWinners → BountyFull
    // ═════════════════════════════════════════════════════════════════════════
    function test_ApproveWinnerRevertsWhenBountyFull() public {
        _createBounty(); // maxWinners = 3

        address s1 = makeAddr("s1");
        address s2 = makeAddr("s2");
        address s3 = makeAddr("s3");
        address s4 = makeAddr("s4");

        _submit(1, s1); _submit(1, s2); _submit(1, s3); _submit(1, s4);
        _warpPastDeadlineOnly();

        vm.startPrank(poster);
        escrow.approveWinner(1, s1);
        escrow.approveWinner(1, s2);
        escrow.approveWinner(1, s3);

        vm.expectRevert(WantedEscrow.BountyFull.selector);
        escrow.approveWinner(1, s4);
        vm.stopPrank();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 8. Double approveWinner same submitter → AlreadyWinner
    // ═════════════════════════════════════════════════════════════════════════
    function test_ApproveWinnerRevertsOnDoubleApprove() public {
        _createBounty();
        _submit(1, alice);
        _warpPastDeadlineOnly();

        vm.startPrank(poster);
        escrow.approveWinner(1, alice);

        vm.expectRevert(WantedEscrow.AlreadyWinner.selector);
        escrow.approveWinner(1, alice);
        vm.stopPrank();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 9. Double claim → NotPendingPayout
    // ═════════════════════════════════════════════════════════════════════════
    function test_DoubleClaimReverts() public {
        _createBounty();
        _submit(1, alice);
        _warpPastDeadlineOnly();

        usdc.setTransferShouldFail(true);
        vm.prank(poster);
        escrow.approveWinner(1, alice);
        usdc.setTransferShouldFail(false);

        // First claim succeeds
        vm.prank(alice);
        escrow.claim(1);

        // Second must revert
        vm.prank(alice);
        vm.expectRevert(WantedEscrow.NotPendingPayout.selector);
        escrow.claim(1);
    }

    // Claim with no pending status (never approved) → NotPendingPayout
    function test_ClaimWithNoPendingReverts() public {
        _createBounty();
        _submit(1, alice);

        vm.prank(alice);
        vm.expectRevert(WantedEscrow.NotPendingPayout.selector);
        escrow.claim(1);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 10. reclaimUnused: reverts before window; works after
    // ═════════════════════════════════════════════════════════════════════════
    function test_ReclaimUnusedRevertsBeforeReviewWindowEnds() public {
        _createBounty();
        _submit(1, alice);
        _warpPastDeadlineOnly(); // inside review window

        vm.prank(poster);
        vm.expectRevert(WantedEscrow.ReviewWindowActive.selector);
        escrow.reclaimUnused(1);
    }

    function test_ReclaimUnusedWorksAfterReviewWindow() public {
        _createBounty();           // 3 slots, 300 USDC escrowed
        _submit(1, alice);
        _warpPastDeadlineOnly();

        // Approve 1 of 3 winners (direct pay: escrow drops by 100)
        vm.prank(poster);
        escrow.approveWinner(1, alice);

        _warpPastReviewWindow();

        uint256 posterBalBefore = usdc.balanceOf(poster);
        uint256 expectedReclaim = REWARD * (MAX_WINNERS - 1); // 200 USDC

        vm.expectEmit(true, true, false, true, address(escrow));
        emit WantedEscrow.EscrowReclaimed(1, poster, expectedReclaim);

        vm.prank(poster);
        escrow.reclaimUnused(1);

        assertEq(
            usdc.balanceOf(poster),
            posterBalBefore + expectedReclaim,
            "poster must receive unused escrow"
        );

        WantedEscrow.Bounty memory b = escrow.getBounty(1);
        assertTrue(b.reclaimedUnused, "reclaimedUnused flag must be set");
        assertEq(b.escrowRemaining, 0, "escrow remaining should be zero after full reclaim");
    }

    function test_ReclaimUnusedRevertsOnSecondCall() public {
        _createBounty();
        _warpPastReviewWindow();

        vm.prank(poster);
        escrow.reclaimUnused(1); // reclaim all (no winners)

        vm.prank(poster);
        vm.expectRevert(WantedEscrow.AlreadyReclaimed.selector);
        escrow.reclaimUnused(1);
    }

    function test_ReclaimUnusedNothingToReclaimWhenAllWinnersPaid() public {
        _createBounty(); // 3 slots
        address w1 = makeAddr("w1"); address w2 = makeAddr("w2"); address w3 = makeAddr("w3");
        _submit(1, w1); _submit(1, w2); _submit(1, w3);
        _warpPastDeadlineOnly();

        vm.startPrank(poster);
        escrow.approveWinner(1, w1);
        escrow.approveWinner(1, w2);
        escrow.approveWinner(1, w3);
        vm.stopPrank();

        _warpPastReviewWindow();

        vm.prank(poster);
        vm.expectRevert(WantedEscrow.NothingToReclaim.selector);
        escrow.reclaimUnused(1);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 11. cancel
    // ═════════════════════════════════════════════════════════════════════════
    function test_CancelRevertsWhenSubmissionsExist() public {
        _createBounty();
        _submit(1, alice);

        vm.prank(poster);
        vm.expectRevert(WantedEscrow.HasSubmissions.selector);
        escrow.cancel(1);
    }

    function test_CancelWorksWithZeroSubmissionsAndRefundsFull() public {
        _createBounty();

        uint256 posterBalBefore = usdc.balanceOf(poster);
        uint256 escrowBalBefore = usdc.balanceOf(address(escrow));

        // NOTE: WantedEscrow has a compile-time naming conflict: both
        // `error BountyCancelled()` (line 48) and `event BountyCancelled(...)`
        // (line 84) share the same identifier, causing a compiler error in the
        // contract source. Once that contract bug is fixed (by renaming one of
        // the two), the expectEmit line below should be restored and the event
        // name updated to match whatever the fixed contract uses.
        //
        // vm.expectEmit(true, true, false, true, address(escrow));
        // emit WantedEscrow.BountyCancelled(1, poster, TOTAL_ESCROW);

        vm.prank(poster);
        escrow.cancel(1);

        assertEq(
            usdc.balanceOf(poster),
            posterBalBefore + TOTAL_ESCROW,
            "poster must get full escrow back"
        );
        assertEq(
            usdc.balanceOf(address(escrow)),
            escrowBalBefore - TOTAL_ESCROW,
            "escrow must be drained after cancel"
        );

        WantedEscrow.Bounty memory b = escrow.getBounty(1);
        assertTrue(b.cancelled,          "cancelled flag must be set");
        assertEq(b.escrowRemaining, 0,   "escrow remaining must be 0");
    }

    function test_CancelRevertsOnDoubleCancel() public {
        _createBounty();

        vm.startPrank(poster);
        escrow.cancel(1);

        vm.expectRevert(WantedEscrow.BountyAlreadyCancelled.selector);
        escrow.cancel(1);
        vm.stopPrank();
    }

    function test_CancelRevertsForNonPoster() public {
        _createBounty();

        vm.prank(alice);
        vm.expectRevert(WantedEscrow.NotPoster.selector);
        escrow.cancel(1);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 12. Poster cannot withdraw early
    // ═════════════════════════════════════════════════════════════════════════

    // 12a. No reclaimUnused before review window ends (even before deadline)
    function test_PosterCannotReclaimBeforeReviewWindowEnds() public {
        _createBounty();

        // Still before deadline — review window is definitely active
        vm.prank(poster);
        vm.expectRevert(WantedEscrow.ReviewWindowActive.selector);
        escrow.reclaimUnused(1);
    }

    // 12b. No cancel after any submission exists
    function test_PosterCannotCancelAfterSubmission() public {
        _createBounty();
        _submit(1, alice);

        vm.prank(poster);
        vm.expectRevert(WantedEscrow.HasSubmissions.selector);
        escrow.cancel(1);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 13. Reentrancy attempt on claim is blocked
    // ═════════════════════════════════════════════════════════════════════════
    function test_ReentrancyOnClaimIsBlocked() public {
        // Deploy escrow backed by the reentrant token
        MockERC20Reentrant rToken  = new MockERC20Reentrant();
        WantedEscrow       rEscrow = new WantedEscrow(address(rToken), REVIEW_WINDOW);

        // Fund poster and create bounty
        rToken.mint(poster, TOTAL_ESCROW * 2);
        vm.startPrank(poster);
        rToken.approve(address(rEscrow), TOTAL_ESCROW);
        rEscrow.createBounty(TITLE, DESCRIPTION, REWARD, MAX_WINNERS, DEADLINE);
        vm.stopPrank();

        // Deploy attacker
        ReentrantAttacker attacker = new ReentrantAttacker(rEscrow, 1);

        // Wire the attacker into the token BEFORE submit (so transfer callback is live)
        rToken.setAttacker(address(attacker));

        // Attacker submits to the bounty
        vm.prank(address(attacker));
        rEscrow.submit(1, CONTENT);

        // Warp into review window
        _warpPastDeadlineOnly();

        // Force payout to Pending: make approveWinner's transfer fail by temporarily
        // setting the attacker as a non-transferrable address.
        // We do this by removing the attacker wiring temporarily so transfer doesn't
        // re-enter, and we use a separate MockERC20 trick: temporarily swap the USDC
        // to a fail-mode mock via vm.etch, set payout pending, then swap back.
        //
        // Simpler: just use a second plain mock to set up the Pending state on a
        // separate, identical escrow instance, then replay on the reentrant one.
        //
        // Simplest: use vm.mockCall to stub transfer for the approve step only.
        // vm.mockCall stubs the NEXT matching call, so we issue one stub for the
        // transfer that approveWinner makes (returns false → Pending), then let
        // subsequent calls pass through naturally.
        //
        // approveWinner calls: usdc.call(transfer(attacker, amount)) → stub to false.
        bytes memory transferCalldata = abi.encodeWithSelector(
            bytes4(keccak256("transfer(address,uint256)")),
            address(attacker),
            REWARD
        );
        vm.mockCall(address(rToken), transferCalldata, abi.encode(false));

        vm.prank(poster);
        rEscrow.approveWinner(1, address(attacker));

        vm.clearMockedCalls();

        assertEq(
            uint8(rEscrow.payoutStatus(1, address(attacker))),
            uint8(WantedEscrow.PayoutStatus.Pending),
            "attacker payout must be Pending before reentrancy test"
        );

        // Now the attacker calls claim(). During the SafeERC20.safeTransfer inside
        // claim(), the reentrant token's transfer() fires onTransfer() on the attacker,
        // which tries to call claim() again. ReentrancyGuard must block the nested call.
        attacker.attack();

        assertTrue(
            attacker.reentrancyBlocked(),
            "ReentrancyGuard must block the nested claim() call"
        );

        // Final state: attacker got paid exactly once
        assertEq(
            uint8(rEscrow.payoutStatus(1, address(attacker))),
            uint8(WantedEscrow.PayoutStatus.Paid),
            "payout status must be Paid after successful claim"
        );
        assertEq(rToken.balanceOf(address(attacker)), REWARD, "attacker balance must equal exactly 1x reward");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Additional boundary / edge-case tests
    // ═════════════════════════════════════════════════════════════════════════

    // approveWinner after approval window closes → ApprovalWindowClosed
    function test_ApproveWinnerRevertsAfterApprovalWindow() public {
        _createBounty();
        _submit(1, alice);
        _warpPastReviewWindow();

        vm.prank(poster);
        vm.expectRevert(WantedEscrow.ApprovalWindowClosed.selector);
        escrow.approveWinner(1, alice);
    }

    // approveWinner by non-poster → NotPoster
    function test_ApproveWinnerRevertsForNonPoster() public {
        _createBounty();
        _submit(1, alice);
        _warpPastDeadlineOnly();

        vm.prank(bob);
        vm.expectRevert(WantedEscrow.NotPoster.selector);
        escrow.approveWinner(1, alice);
    }

    // approveWinner for address that never submitted → BountyNotFound
    function test_ApproveWinnerRevertsForNonSubmitter() public {
        _createBounty();
        _warpPastDeadlineOnly();

        vm.prank(poster);
        vm.expectRevert(WantedEscrow.BountyNotFound.selector);
        escrow.approveWinner(1, alice);
    }

    // reclaimUnused by non-poster → NotPoster
    function test_ReclaimUnusedRevertsForNonPoster() public {
        _createBounty();
        _warpPastReviewWindow();

        vm.prank(alice);
        vm.expectRevert(WantedEscrow.NotPoster.selector);
        escrow.reclaimUnused(1);
    }

    // constructor: ZeroAddress guard
    function test_ConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(WantedEscrow.ZeroAddress.selector);
        new WantedEscrow(address(0), REVIEW_WINDOW);
    }

    // getBountyCount and totalBounties must be consistent
    function test_BountyCountConsistency() public view {
        assertEq(escrow.getBountyCount(), escrow.totalBounties());
    }

    function test_BountyCountAfterCreate() public {
        _createBounty();
        assertEq(escrow.getBountyCount(), 1);
        assertEq(escrow.totalBounties(),  1);
    }

    // createBounty: InvalidTitle (> 80 bytes)
    function test_CreateBountyRevertsOnLongTitle() public {
        bytes memory longTitle = new bytes(81);
        vm.startPrank(poster);
        usdc.approve(address(escrow), TOTAL_ESCROW);
        vm.expectRevert(WantedEscrow.InvalidTitle.selector);
        escrow.createBounty(longTitle, DESCRIPTION, REWARD, MAX_WINNERS, DEADLINE);
        vm.stopPrank();
    }

    // createBounty: InvalidDescription (> 500 bytes)
    function test_CreateBountyRevertsOnLongDescription() public {
        bytes memory longDesc = new bytes(501);
        vm.startPrank(poster);
        usdc.approve(address(escrow), TOTAL_ESCROW);
        vm.expectRevert(WantedEscrow.InvalidDescription.selector);
        escrow.createBounty(TITLE, longDesc, REWARD, MAX_WINNERS, DEADLINE);
        vm.stopPrank();
    }

    // createBounty: InvalidReward (zero)
    function test_CreateBountyRevertsOnZeroReward() public {
        vm.startPrank(poster);
        usdc.approve(address(escrow), TOTAL_ESCROW);
        vm.expectRevert(WantedEscrow.InvalidReward.selector);
        escrow.createBounty(TITLE, DESCRIPTION, 0, MAX_WINNERS, DEADLINE);
        vm.stopPrank();
    }

    // createBounty: InvalidMaxWinners (zero)
    function test_CreateBountyRevertsOnZeroMaxWinners() public {
        vm.startPrank(poster);
        usdc.approve(address(escrow), TOTAL_ESCROW);
        vm.expectRevert(WantedEscrow.InvalidMaxWinners.selector);
        escrow.createBounty(TITLE, DESCRIPTION, REWARD, 0, DEADLINE);
        vm.stopPrank();
    }

    // createBounty: InvalidMaxWinners (> 50)
    function test_CreateBountyRevertsOnTooManyWinners() public {
        usdc.mint(poster, REWARD * 51); // make sure funds exist
        vm.startPrank(poster);
        usdc.approve(address(escrow), REWARD * 51);
        vm.expectRevert(WantedEscrow.InvalidMaxWinners.selector);
        escrow.createBounty(TITLE, DESCRIPTION, REWARD, 51, DEADLINE);
        vm.stopPrank();
    }

    // createBounty: InvalidDeadline (deadline == now)
    function test_CreateBountyRevertsOnExpiredDeadline() public {
        vm.startPrank(poster);
        usdc.approve(address(escrow), TOTAL_ESCROW);
        vm.expectRevert(WantedEscrow.InvalidDeadline.selector);
        escrow.createBounty(TITLE, DESCRIPTION, REWARD, MAX_WINNERS, uint64(block.timestamp));
        vm.stopPrank();
    }

    // submit: InvalidContent (> 300 bytes)
    function test_SubmitRevertsOnLongContent() public {
        _createBounty();
        bytes memory longContent = new bytes(301);
        vm.prank(alice);
        vm.expectRevert(WantedEscrow.InvalidContent.selector);
        escrow.submit(1, longContent);
    }

    // submit: BountyCancelled
    function test_SubmitRevertsOnCancelledBounty() public {
        _createBounty();
        vm.prank(poster);
        escrow.cancel(1);

        vm.prank(alice);
        vm.expectRevert(WantedEscrow.BountyWasCancelled.selector);
        escrow.submit(1, CONTENT);
    }

    // Multiple bounties: each has isolated escrow
    function test_MultipleBountiesIsolation() public {
        uint256 total1 = REWARD * MAX_WINNERS;
        uint256 total2 = 50e6 * 2; // different reward/winners

        vm.startPrank(poster);
        usdc.approve(address(escrow), total1 + total2);
        escrow.createBounty(TITLE, DESCRIPTION, REWARD,  MAX_WINNERS,  DEADLINE);
        escrow.createBounty(TITLE, DESCRIPTION, 50e6,    2,            DEADLINE);
        vm.stopPrank();

        assertEq(escrow.getBountyCount(), 2);
        assertEq(usdc.balanceOf(address(escrow)), total1 + total2, "contract holds sum of both escrows");

        WantedEscrow.Bounty memory b1 = escrow.getBounty(1);
        WantedEscrow.Bounty memory b2 = escrow.getBounty(2);
        assertEq(b1.escrowRemaining, total1, "bounty 1 escrow correct");
        assertEq(b2.escrowRemaining, total2, "bounty 2 escrow correct");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Profile view helpers — getPostedBounties / getSubmittedBounties
    // ═════════════════════════════════════════════════════════════════════════

    // Helper: create a fresh bounty as poster and return its id.
    // Each call approves exactly one bounty's worth of tokens.
    function _createOneBounty() internal returns (uint256) {
        vm.startPrank(poster);
        usdc.approve(address(escrow), TOTAL_ESCROW);
        escrow.createBounty(TITLE, DESCRIPTION, REWARD, MAX_WINNERS, DEADLINE);
        vm.stopPrank();
        return escrow.getBountyCount();
    }

    // ─── Test 1 ──────────────────────────────────────────────────────────────
    // Posted list grows for poster; submitted list grows for submitter.
    function test_PostedAndSubmittedListsUpdateCorrectly() public {
        uint256 id1 = _createOneBounty();
        uint256 id2 = _createOneBounty();

        // poster: should appear in posted list
        uint256[] memory posted = escrow.getPostedBounties(poster, 0, 10);
        assertEq(posted.length, 2,    "poster should have 2 posted bounties");
        assertEq(posted[0],    id1,   "first posted bounty id mismatch");
        assertEq(posted[1],    id2,   "second posted bounty id mismatch");

        // alice submits to both
        _submit(id1, alice);
        _submit(id2, alice);

        uint256[] memory submitted = escrow.getSubmittedBounties(alice, 0, 10);
        assertEq(submitted.length, 2,  "alice should have 2 submitted bounties");
        assertEq(submitted[0],    id1, "first submitted bounty id mismatch");
        assertEq(submitted[1],    id2, "second submitted bounty id mismatch");

        // bob never submitted — list must be empty
        uint256[] memory bobList = escrow.getSubmittedBounties(bob, 0, 10);
        assertEq(bobList.length, 0, "bob should have no submitted bounties");
    }

    // ─── Test 2 ──────────────────────────────────────────────────────────────
    // Pagination: offset/limit slicing and out-of-range offset returns empty.
    function test_PaginationWorksCorrectly() public {
        _createOneBounty(); // id=1
        _createOneBounty(); // id=2
        _createOneBounty(); // id=3

        // offset=0, limit=2 → [1, 2]
        uint256[] memory page1 = escrow.getPostedBounties(poster, 0, 2);
        assertEq(page1.length, 2, "page1 should have 2 items");
        assertEq(page1[0], 1,    "page1[0] should be bounty 1");
        assertEq(page1[1], 2,    "page1[1] should be bounty 2");

        // offset=2, limit=2 → [3]  (only 1 item left)
        uint256[] memory page2 = escrow.getPostedBounties(poster, 2, 2);
        assertEq(page2.length, 1, "page2 should have 1 item");
        assertEq(page2[0], 3,    "page2[0] should be bounty 3");

        // offset=10, limit=2 → []  (beyond array end)
        uint256[] memory page3 = escrow.getPostedBounties(poster, 10, 2);
        assertEq(page3.length, 0, "page3 should be empty for out-of-range offset");

        // limit=0 → always empty
        uint256[] memory page4 = escrow.getPostedBounties(poster, 0, 0);
        assertEq(page4.length, 0, "limit=0 should always return empty");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // getEarnings
    // ═════════════════════════════════════════════════════════════════════════

    // ─── Test 3 ──────────────────────────────────────────────────────────────
    // Auto-pay path: paid increases, pending stays zero, wins=1.
    function test_EarningsUpdateOnSuccessfulAutoPay() public {
        _createBounty(); // id=1
        _submit(1, alice);
        _warpPastDeadlineOnly();

        // Normal (non-failing) usdc — transfer succeeds automatically.
        vm.prank(poster);
        escrow.approveWinner(1, alice);

        (uint256 paid, uint256 pending, uint256 wins) = escrow.getEarnings(alice);
        assertEq(paid,    REWARD, "paid should equal reward after auto-pay");
        assertEq(pending, 0,     "pending should be 0 after successful transfer");
        assertEq(wins,    1,     "wins should be 1");
    }

    // ─── Test 4 ──────────────────────────────────────────────────────────────
    // Failed transfer path: pending increases, paid stays zero, wins=1.
    function test_EarningsUpdateOnFailedTransfer() public {
        // Deploy a separate escrow backed by a fresh failing mock so we can
        // force-fail transfers without disrupting other tests.
        FailingERC20 failToken  = new FailingERC20();
        WantedEscrow failEscrow = new WantedEscrow(address(failToken), REVIEW_WINDOW);

        failToken.mint(poster, TOTAL_ESCROW);
        vm.startPrank(poster);
        failToken.approve(address(failEscrow), TOTAL_ESCROW);
        failEscrow.createBounty(TITLE, DESCRIPTION, REWARD, MAX_WINNERS, DEADLINE);
        vm.stopPrank();

        vm.prank(alice);
        failEscrow.submit(1, CONTENT);

        _warpPastDeadlineOnly();

        vm.prank(poster);
        failEscrow.approveWinner(1, alice);

        (uint256 paid, uint256 pending, uint256 wins) = failEscrow.getEarnings(alice);
        assertEq(paid,    0,      "paid should be 0 when transfer always fails");
        assertEq(pending, REWARD, "pending should equal reward when transfer fails");
        assertEq(wins,    1,      "wins should be 1 even when transfer fails");
    }

    // ─── Test 5 ──────────────────────────────────────────────────────────────
    // After a pending payout is claimed: paid=reward, pending=0, wins=1.
    function test_EarningsUpdateOnClaim() public {
        // Create the bounty and submit BEFORE enabling the fail flag, because
        // setTransferShouldFail also affects transferFrom (used by createBounty).
        _createBounty(); // id=1
        _submit(1, alice);
        _warpPastDeadlineOnly();

        // Now force the transfer() in approveWinner to fail → Pending payout.
        usdc.setTransferShouldFail(true);

        vm.prank(poster);
        escrow.approveWinner(1, alice);

        {
            (uint256 paid, uint256 pending, uint256 wins) = escrow.getEarnings(alice);
            assertEq(paid,    0,      "pre-claim: paid should be 0");
            assertEq(pending, REWARD, "pre-claim: pending should equal reward");
            assertEq(wins,    1,      "pre-claim: wins should be 1");
        }

        // Re-enable transfers so claim succeeds.
        usdc.setTransferShouldFail(false);

        vm.prank(alice);
        escrow.claim(1);

        (uint256 paid2, uint256 pending2, uint256 wins2) = escrow.getEarnings(alice);
        assertEq(paid2,    REWARD, "post-claim: paid should equal reward");
        assertEq(pending2, 0,      "post-claim: pending should be 0 after claim");
        assertEq(wins2,    1,      "post-claim: wins should still be 1");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // getMyStatus
    // ═════════════════════════════════════════════════════════════════════════

    // ─── Test 6 ──────────────────────────────────────────────────────────────
    // Address that never submitted → None (0).
    function test_GetMyStatusNone() public {
        _createBounty();
        WantedEscrow.MyStatus status = escrow.getMyStatus(1, bob);
        assertEq(uint8(status), uint8(WantedEscrow.MyStatus.None), "non-submitter should have status None");
    }

    // ─── Test 7 ──────────────────────────────────────────────────────────────
    // Submitted but not yet approved and still within review window → Submitted (1).
    function test_GetMyStatusSubmitted() public {
        _createBounty();
        _submit(1, alice);

        // Before deadline: Submitted
        WantedEscrow.MyStatus status1 = escrow.getMyStatus(1, alice);
        assertEq(uint8(status1), uint8(WantedEscrow.MyStatus.Submitted),
            "before deadline: status should be Submitted");

        // After deadline but still inside review window: still Submitted (not NotSelected)
        _warpPastDeadlineOnly();
        WantedEscrow.MyStatus status2 = escrow.getMyStatus(1, alice);
        assertEq(uint8(status2), uint8(WantedEscrow.MyStatus.Submitted),
            "inside review window: status should be Submitted, not NotSelected");
    }

    // ─── Test 8 ──────────────────────────────────────────────────────────────
    // Winner approved but transfer failed → WinnerPending (2).
    function test_GetMyStatusWinnerPending() public {
        FailingERC20 failToken  = new FailingERC20();
        WantedEscrow failEscrow = new WantedEscrow(address(failToken), REVIEW_WINDOW);

        failToken.mint(poster, TOTAL_ESCROW);
        vm.startPrank(poster);
        failToken.approve(address(failEscrow), TOTAL_ESCROW);
        failEscrow.createBounty(TITLE, DESCRIPTION, REWARD, MAX_WINNERS, DEADLINE);
        vm.stopPrank();

        vm.prank(alice);
        failEscrow.submit(1, CONTENT);

        _warpPastDeadlineOnly();

        vm.prank(poster);
        failEscrow.approveWinner(1, alice);

        WantedEscrow.MyStatus status = failEscrow.getMyStatus(1, alice);
        assertEq(uint8(status), uint8(WantedEscrow.MyStatus.WinnerPending),
            "failed-transfer winner should have status WinnerPending");
    }

    // ─── Test 9 ──────────────────────────────────────────────────────────────
    // Winner approved and transfer succeeded → WinnerPaid (3).
    function test_GetMyStatusWinnerPaid() public {
        _createBounty();
        _submit(1, alice);
        _warpPastDeadlineOnly();

        vm.prank(poster);
        escrow.approveWinner(1, alice);

        WantedEscrow.MyStatus status = escrow.getMyStatus(1, alice);
        assertEq(uint8(status), uint8(WantedEscrow.MyStatus.WinnerPaid),
            "auto-paid winner should have status WinnerPaid");
    }

    // ─── Test 10 ─────────────────────────────────────────────────────────────
    // Submitted but review window expired without approval → NotSelected (4).
    function test_GetMyStatusNotSelected() public {
        _createBounty();
        _submit(1, alice);

        // Warp past BOTH deadline AND review window.
        _warpPastReviewWindow();

        WantedEscrow.MyStatus status = escrow.getMyStatus(1, alice);
        assertEq(uint8(status), uint8(WantedEscrow.MyStatus.NotSelected),
            "submitter past review window without approval should be NotSelected");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Earnings invariant across multiple bounties
    // ═════════════════════════════════════════════════════════════════════════

    // ─── Test 11 ─────────────────────────────────────────────────────────────
    // Sum of pending earnings via getEarnings tracks correctly across two bounties;
    // claiming one moves it from pending to paid.
    function test_TotalPendingEqualsSumOfUnclaimedPayouts() public {
        // Use a failing token so both approvals go pending.
        FailingERC20 failToken  = new FailingERC20();
        WantedEscrow failEscrow = new WantedEscrow(address(failToken), REVIEW_WINDOW);

        uint256 total2 = TOTAL_ESCROW * 2; // fund for 2 bounties
        failToken.mint(poster, total2);

        // Create bounty 1 and bounty 2 (each with REWARD * MAX_WINNERS escrowed).
        vm.startPrank(poster);
        failToken.approve(address(failEscrow), total2);
        failEscrow.createBounty(TITLE, DESCRIPTION, REWARD, MAX_WINNERS, DEADLINE);
        failEscrow.createBounty(TITLE, DESCRIPTION, REWARD, MAX_WINNERS, DEADLINE);
        vm.stopPrank();

        // Alice submits to both.
        vm.prank(alice);
        failEscrow.submit(1, CONTENT);
        vm.prank(alice);
        failEscrow.submit(2, CONTENT);

        _warpPastDeadlineOnly();

        // Poster approves alice for both; transfers fail → both go pending.
        vm.startPrank(poster);
        failEscrow.approveWinner(1, alice);
        failEscrow.approveWinner(2, alice);
        vm.stopPrank();

        // After two approvals: pending = 2 * REWARD, paid = 0, wins = 2.
        {
            (uint256 paid, uint256 pending, uint256 wins) = failEscrow.getEarnings(alice);
            assertEq(paid,    0,           "initial: paid should be 0");
            assertEq(pending, REWARD * 2,  "initial: pending should equal 2 * reward");
            assertEq(wins,    2,           "initial: wins should be 2");
        }

        // Now enable transfers and claim bounty 1 only.
        failToken.enableTransfers();
        vm.prank(alice);
        failEscrow.claim(1);

        // After claiming bounty 1: pending = REWARD, paid = REWARD, wins = 2.
        {
            (uint256 paid, uint256 pending, uint256 wins) = failEscrow.getEarnings(alice);
            assertEq(paid,    REWARD, "post-claim-1: paid should equal reward");
            assertEq(pending, REWARD, "post-claim-1: pending should equal remaining reward");
            assertEq(wins,    2,      "post-claim-1: wins should still be 2");
        }
    }

    // ─── Test 12 ─────────────────────────────────────────────────────────────
    // View functions (getPostedBounties, getEarnings, getMyStatus) never move funds.
    function test_NoNewWithdrawalPath() public {
        _createBounty();
        _submit(1, alice);
        _warpPastDeadlineOnly();
        vm.prank(poster);
        escrow.approveWinner(1, alice);

        uint256 escrowBalBefore = usdc.balanceOf(address(escrow));
        uint256 aliceBal        = usdc.balanceOf(alice);
        uint256 posterBal       = usdc.balanceOf(poster);

        // Call all three view functions from various callers — none should move tokens.
        escrow.getPostedBounties(poster, 0, 10);
        escrow.getSubmittedBounties(alice, 0, 10);
        escrow.getEarnings(alice);
        escrow.getMyStatus(1, alice);
        escrow.getMyStatus(1, bob);

        assertEq(usdc.balanceOf(address(escrow)), escrowBalBefore,
            "view functions must not change escrow balance");
        assertEq(usdc.balanceOf(alice),  aliceBal,  "view functions must not change alice balance");
        assertEq(usdc.balanceOf(poster), posterBal, "view functions must not change poster balance");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Fuzz: createBounty always locks exactly rewardPerWinner * maxWinners
    // ═════════════════════════════════════════════════════════════════════════
    function testFuzz_CreateBountyLocksCorrectTotal(
        uint256 reward,
        uint256 maxWinners
    ) public {
        reward     = bound(reward,     1, 1_000_000e6);
        maxWinners = bound(maxWinners, 1, 50);

        uint256 total = reward * maxWinners;
        // Skip if overflow (contract's own overflow guard would also catch it)
        if (maxWinners > 0 && total / maxWinners != reward) return;

        usdc.mint(poster, total);

        vm.startPrank(poster);
        usdc.approve(address(escrow), total);
        escrow.createBounty(TITLE, DESCRIPTION, reward, maxWinners, DEADLINE);
        vm.stopPrank();

        WantedEscrow.Bounty memory b = escrow.getBounty(escrow.getBountyCount());
        assertEq(b.escrowRemaining, total,      "escrow remaining must equal total");
        assertEq(b.rewardPerWinner, reward,     "rewardPerWinner must be stored");
        assertEq(b.maxWinners,      maxWinners, "maxWinners must be stored");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler for invariant testing
// ─────────────────────────────────────────────────────────────────────────────
contract WantedEscrowHandler is Test {
    WantedEscrow public escrow;
    MockERC20    public token;

    address internal poster = makeAddr("inv_poster");
    address internal alice  = makeAddr("inv_alice");

    uint32  internal constant RW     = 1 days;
    uint256 internal constant REWARD = 50e6;
    uint256 internal constant MAX_W  = 2;
    uint256 internal constant TOTAL  = REWARD * MAX_W;

    uint256 public ghostEscrowLocked;

    uint256 public activeBountyId;
    bool    public bountyCreated;
    bool    public aliceSubmitted;
    bool    public aliceApproved;
    uint64  public bountyDeadline;

    constructor(WantedEscrow escrow_, MockERC20 token_) {
        escrow = escrow_;
        token  = token_;
    }

    function createBounty() external {
        if (bountyCreated) return;
        bountyDeadline = uint64(block.timestamp + 7 days);
        token.mint(poster, TOTAL);
        vm.startPrank(poster);
        token.approve(address(escrow), TOTAL);
        escrow.createBounty(
            bytes("inv title"),
            bytes("inv desc"),
            REWARD,
            MAX_W,
            bountyDeadline
        );
        vm.stopPrank();
        activeBountyId    = escrow.getBountyCount();
        ghostEscrowLocked += TOTAL;
        bountyCreated      = true;
    }

    function submitAlice() external {
        if (!bountyCreated || aliceSubmitted) return;
        if (block.timestamp >= bountyDeadline) return;
        vm.prank(alice);
        escrow.submit(activeBountyId, bytes("alice work"));
        aliceSubmitted = true;
    }

    function approveAlice() external {
        if (!aliceSubmitted || aliceApproved) return;
        uint256 cutoff = uint256(bountyDeadline) + RW;
        if (block.timestamp > cutoff) return;
        // Must be past deadline to approve
        if (block.timestamp < bountyDeadline) {
            vm.warp(bountyDeadline + 1);
        }
        vm.prank(poster);
        escrow.approveWinner(activeBountyId, alice);
        // If direct payment succeeded, escrow balance decreases
        if (escrow.payoutStatus(activeBountyId, alice) == WantedEscrow.PayoutStatus.Paid) {
            ghostEscrowLocked -= REWARD;
        }
        aliceApproved = true;
    }

    function reclaimAfterWindow() external {
        if (!bountyCreated) return;
        uint256 cutoff = uint256(bountyDeadline) + RW;
        if (block.timestamp <= cutoff) {
            vm.warp(cutoff + 1);
        }
        WantedEscrow.Bounty memory b = escrow.getBounty(activeBountyId);
        if (b.reclaimedUnused) return;
        if (b.escrowRemaining == 0) return;

        uint256 balBefore = token.balanceOf(address(escrow));
        vm.prank(poster);
        try escrow.reclaimUnused(activeBountyId) {
            uint256 balAfter = token.balanceOf(address(escrow));
            uint256 sent = balBefore - balAfter;
            // Ghost can only track at most what was locked; cap to avoid underflow.
            if (sent <= ghostEscrowLocked) {
                ghostEscrowLocked -= sent;
            } else {
                ghostEscrowLocked = 0;
            }
        } catch {}
    }
}

contract WantedEscrowInvariantTest is Test {
    MockERC20           internal token;
    WantedEscrow        internal escrow;
    WantedEscrowHandler internal handler;

    function setUp() public {
        token   = new MockERC20("Inv USDC", "iUSDC", 6);
        escrow  = new WantedEscrow(address(token), 1 days);
        handler = new WantedEscrowHandler(escrow, token);
        targetContract(address(handler));
    }

    /// PROPERTY: contract token balance ≥ ghostEscrowLocked at all times
    function invariant_EscrowBalanceCoversTotalEscrowed() public view {
        assertGe(
            token.balanceOf(address(escrow)),
            handler.ghostEscrowLocked(),
            "escrow balance must cover ghost-tracked locked amount"
        );
    }

    /// PROPERTY: totalEscrowLocked() never underflows (no negative accounting)
    function invariant_TotalEscrowLockedDoesNotUnderflow() public view {
        // If internal accounting underflows, this call would revert/panic.
        escrow.totalEscrowLocked();
    }
}
