# Wanted.fun

## WantedEscrow v2 (with profile) — Arc Testnet (current)
- Address: `0x804f81d88e42e8a63ee419b3faf98d055d2255b8`
- Explorer: https://explorer.testnet.arc.io/address/0x804f81d88e42e8a63ee419b3faf98d055d2255b8
- Constructor: `usdc=0x3600000000000000000000000000000000000000`, `reviewWindow=300` (5 min for testing)
- Deployed: 2026-10-12
- 57/57 Foundry tests pass (unit + fuzz + invariant)
- Adds: getPostedBounties, getSubmittedBounties, getEarnings, getMyStatus, per-address bookkeeping

## WantedEscrow v1 — Arc Testnet (deprecated)
- Address: `0xadfd672aade3bd34907154b07f995f0654169b6d`
- Explorer: https://explorer.testnet.arc.io/address/0xadfd672aade3bd34907154b07f995f0654169b6d
- Constructor: `usdc=0x3600000000000000000000000000000000000000`, `reviewWindow=300` (5 min for testing; use 604800 for 7-day mainnet)
- Deployed: 2026-10-11
- All 45 Foundry tests pass (43 unit + 2 invariant)

## BountyBoard — Arc Testnet (deprecated)

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

A USDC-powered bounty board on Arc Testnet. Posters escrow USDC, workers submit, poster approves winners, winners claim. Neobrutalist / retro OS visual style.

## Deployed Contracts

| Contract | Chain | Address |
|---|---|---|
| BountyBoard | Arc Testnet | `0x1238e27e6574eb6fd36d364ac20a1e3e1358a3fd` |

Constructor arg: USDC address `0x3600000000000000000000000000000000000000`

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
