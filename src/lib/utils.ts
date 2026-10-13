import { formatUnits } from 'viem'
import { USDC_DECIMALS } from '../bounty-config'

// ─── USDC formatting ──────────────────────────────────────────────────────────
export function formatUsdc(raw: bigint | number | undefined): string {
  if (raw === undefined || raw === null) return '0.00'
  const n = typeof raw === 'number' ? BigInt(raw) : raw
  return parseFloat(formatUnits(n, USDC_DECIMALS)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// ─── Address shortening ───────────────────────────────────────────────────────
export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// ─── Time left ────────────────────────────────────────────────────────────────
export function timeLeft(deadline: bigint | number | undefined): string {
  if (!deadline) return '—'
  const ts = typeof deadline === 'bigint' ? Number(deadline) : deadline
  const diff = ts * 1000 - Date.now()
  if (diff <= 0) return 'EXPIRED'
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ─── Bounty status ────────────────────────────────────────────────────────────
export type BountyStatusType = 'OPEN' | 'FULL' | 'EXPIRED' | 'CANCELLED'

export function bountyStatus(b: {
  winnersApproved: bigint | number
  maxWinners: bigint | number
  deadline: bigint | number
  cancelled: boolean
  reclaimedUnused?: boolean
}): BountyStatusType {
  if (b.cancelled) return 'CANCELLED'
  const now = Date.now() / 1000
  const dl = typeof b.deadline === 'bigint' ? Number(b.deadline) : b.deadline
  if (now > dl) return 'EXPIRED'
  const approved = typeof b.winnersApproved === 'bigint' ? Number(b.winnersApproved) : b.winnersApproved
  const max = typeof b.maxWinners === 'bigint' ? Number(b.maxWinners) : b.maxWinners
  if (approved >= max) return 'FULL'
  return 'OPEN'
}

// ─── Title bar colour by bounty id ────────────────────────────────────────────
const BAR_COLORS = ['#FF3E9A', '#A78BFA', '#7FF3F0', '#C6F23A', '#FF6B57', '#FFE600']
export function barColor(id: number): string {
  return BAR_COLORS[id % BAR_COLORS.length]
}

// ─── Loading bar colour ───────────────────────────────────────────────────────
export function winnerBarColor(id: number): string {
  return id % 2 === 0 ? '#C6F23A' : '#FFE600'
}

// ─── onchain error parser ─────────────────────────────────────────────────────
export function parseOnchainError(error: unknown): string {
  const msg: string = (error as { message?: string })?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaction cancelled.'
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) return 'Insufficient balance.'
  if (msg.includes('invalidtitle')) return 'Title is too long (max 80 chars).'
  if (msg.includes('invaliddescription')) return 'Description is too long (max 500 chars).'
  if (msg.includes('invalidcontent')) return 'Submission is too long (max 300 chars).'
  if (msg.includes('invalidreward')) return 'Reward must be greater than zero.'
  if (msg.includes('invalidmaxwinners')) return 'Winners must be between 1 and 50.'
  if (msg.includes('invaliddeadline')) return 'Deadline must be in the future.'
  if (msg.includes('depositmismatch')) return 'Deposit mismatch — check your USDC allowance.'
  if (msg.includes('alreadysubmitted')) return 'You already submitted to this bounty.'
  if (msg.includes('postercannotsubmit')) return 'The poster cannot submit to their own bounty.'
  if (msg.includes('bountycancelled')) return 'This bounty has been cancelled.'
  if (msg.includes('deadlinepassedforsubmit')) return 'The deadline has passed.'
  if (msg.includes('approvalwindowclosed')) return 'The approval window has closed.'
  if (msg.includes('alreadywinner')) return 'This address is already a winner.'
  if (msg.includes('bountyfull')) return 'All winner slots are full.'
  if (msg.includes('notposter')) return 'Only the poster can do this.'
  if (msg.includes('notpendinpayout') || msg.includes('notpendingpayout')) return 'No pending payout to claim.'
  if (msg.includes('hassubmissions')) return 'Cannot cancel — there are submissions.'
  if (msg.includes('reviewwindowactive')) return 'Review window is still active.'
  if (msg.includes('alreadyreclaimed')) return 'Escrow already reclaimed.'
  if (msg.includes('nothingtorclaim') || msg.includes('nothingtorceclaim') || msg.includes('nothingtore')) return 'Nothing to reclaim.'
  if (msg.includes('reverted')) return 'Transaction failed. Check your inputs.'
  if (msg.includes('network') || msg.includes('timeout')) return 'Network error — try again.'
  return 'Something went wrong. Please try again.'
}

// ─── bytes <-> string helpers ─────────────────────────────────────────────────
export function encodeText(text: string): `0x${string}` {
  const bytes = new TextEncoder().encode(text)
  return ('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

export function decodeBytes(hex: string | undefined): string {
  if (!hex || hex === '0x') return ''
  try {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex
    const bytes = new Uint8Array(clean.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}
