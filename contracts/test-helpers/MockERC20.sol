// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Minimal ERC-20 mock for WantedEscrow unit tests.
 *
 *  - `setTransferShouldFail(true)`: makes transfer/transferFrom return false
 *    WITHOUT reverting, so we can exercise the pending-payout path.
 *  - `mint(address, uint256)`: freely issue tokens (no access control).
 *
 * All functions are `virtual` so subclasses (e.g. MockERC20Reentrant) can
 * override them without compiler errors.
 */
contract MockERC20 {
    string public name;
    string public symbol;
    uint8  public decimals;

    bool public transferShouldFail;

    mapping(address => uint256) internal _balances;
    mapping(address => mapping(address => uint256)) internal _allowances;
    uint256 internal _totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name     = name_;
        symbol   = symbol_;
        decimals = decimals_;
    }

    // ── test helpers ─────────────────────────────────────────────────────────

    function setTransferShouldFail(bool fail) external virtual {
        transferShouldFail = fail;
    }

    function mint(address to, uint256 amount) external virtual {
        _balances[to] += amount;
        _totalSupply   += amount;
        emit Transfer(address(0), to, amount);
    }

    // ── ERC-20 ───────────────────────────────────────────────────────────────

    function totalSupply() external view virtual returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view virtual returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner_, address spender) external view virtual returns (uint256) {
        return _allowances[owner_][spender];
    }

    function approve(address spender, uint256 amount) external virtual returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        if (transferShouldFail) return false;
        require(_balances[msg.sender] >= amount, "MockERC20: insufficient balance");
        _balances[msg.sender] -= amount;
        _balances[to]         += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        if (transferShouldFail) return false;
        require(_balances[from] >= amount, "MockERC20: insufficient balance");
        require(_allowances[from][msg.sender] >= amount, "MockERC20: insufficient allowance");
        _allowances[from][msg.sender] -= amount;
        _balances[from]               -= amount;
        _balances[to]                 += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
