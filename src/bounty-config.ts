/**
 * Bounty Board — onchain configuration
 *
 * All chain/contract settings come from env vars so you can switch
 * Arc Testnet → Arc Mainnet without touching this file:
 *
 *   VITE_CHAIN_ID=5042          # Arc Mainnet
 *   VITE_CONTRACT_ADDRESS=0x... # deployed BountyBoard on that chain
 *
 * Defaults to Arc Testnet (5042002) with a placeholder contract address
 * that is replaced after deploy.
 */

import { requireChain, getUsdc, buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'

// ─── Chain ────────────────────────────────────────────────────────────────────
export const CHAIN_ID: number = import.meta.env.VITE_CHAIN_ID
  ? Number(import.meta.env.VITE_CHAIN_ID)
  : 5042002 // Arc Testnet

export const CHAIN = requireChain(CHAIN_ID)

// ─── USDC ─────────────────────────────────────────────────────────────────────
const _usdc = getUsdc(CHAIN_ID)
if (!_usdc) throw new Error(`USDC not deployed on chain ${CHAIN_ID}`)
export const USDC_ADDRESS = _usdc.address as `0x${string}`
export const USDC_DECIMALS = _usdc.decimals // 6

// ─── Contract ─────────────────────────────────────────────────────────────────
export const CONTRACT_ADDRESS: `0x${string}` = (
  import.meta.env.VITE_CONTRACT_ADDRESS ?? '0x0000000000000000000000000000000000000000'
) as `0x${string}`

export const CONTRACT_DEPLOYED = CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000'

// ─── Explorer helpers ─────────────────────────────────────────────────────────
export const getTxUrl = (hash: string) => buildTxExplorerUrl(CHAIN_ID, hash)
export const getAddressUrl = (addr: string) => buildAddressExplorerUrl(CHAIN_ID, addr)

// ─── Labels ───────────────────────────────────────────────────────────────────
export const CHAIN_NAME = CHAIN.name          // "Arc Testnet"
export const EXPLORER_BASE = CHAIN.explorerBase
