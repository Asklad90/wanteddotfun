import { WindowCard } from './WindowCard'
import { StatusTag } from './StatusTag'
import { LoadingBar } from './LoadingBar'
import { LockIcon, FolderIcon, ClockIcon } from './Icons'
import { barColor, formatUsdc, timeLeft, bountyStatus, decodeBytes } from '../lib/utils'

export interface BountyData {
  id: bigint
  poster: string
  title: `0x${string}`
  description: `0x${string}`
  rewardPerWinner: bigint
  maxWinners: bigint
  winnersApproved: bigint
  deadline: bigint
  escrowRemaining: bigint
  reclaimedUnused: boolean
  cancelled: boolean
  // augmented client-side
  submissionCount?: bigint
}

interface BountyCardProps {
  bounty: BountyData
  onClick: () => void
}

export function BountyCard({ bounty, onClick }: BountyCardProps) {
  const idNum = Number(bounty.id)
  const titleStr = decodeBytes(bounty.title) || `Bounty #${idNum}`
  const status = bountyStatus({
    winnersApproved: bounty.winnersApproved,
    maxWinners: bounty.maxWinners,
    deadline: bounty.deadline,
    cancelled: bounty.cancelled,
    reclaimedUnused: bounty.reclaimedUnused,
  })
  const totalEscrow = bounty.rewardPerWinner * bounty.maxWinners
  const subCount = bounty.submissionCount !== undefined ? Number(bounty.submissionCount) : '?'

  return (
    <button
      onClick={onClick}
      className="text-left w-full hover:-translate-y-0.5 transition-transform"
    >
      <WindowCard
        title={`BOUNTY_${String(idNum).padStart(3, '0')}.EXE`}
        titleBarColor={barColor(idNum)}
        className="h-full"
      >
        {/* Top row: status + time */}
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <StatusTag status={status} />
          <div className="flex items-center gap-1 text-[#111]/50">
            <ClockIcon size={12} />
            <span className="font-mono-bold text-[10px] uppercase tracking-wider">{timeLeft(bounty.deadline)}</span>
          </div>
        </div>

        {/* Title */}
        <h3 className="font-heading text-[17px] font-bold leading-tight text-[#111] mb-3 line-clamp-2">
          {titleStr}
        </h3>

        {/* Reward — the hero number */}
        <div className="flex items-baseline gap-1.5 mb-1">
          <span className="font-heading text-[36px] font-extrabold tabular-nums text-[#111] leading-none" style={{ letterSpacing: '-0.02em' }}>
            {formatUsdc(bounty.rewardPerWinner)}
          </span>
          <span className="font-mono-bold text-[11px] text-[#111]/50 uppercase">USDC / winner</span>
        </div>

        {/* Prize locked pill */}
        <div className="inline-flex items-center gap-1 border-[2px] border-[#111] rounded-full px-2 py-0.5 bg-[#C6F23A] mb-3">
          <LockIcon size={11} />
          <span className="font-mono-bold text-[9px] uppercase tracking-wider text-[#111]">
            {formatUsdc(totalEscrow)} USDC locked
          </span>
        </div>

        {/* Winners progress bar */}
        <LoadingBar
          current={Number(bounty.winnersApproved)}
          max={Number(bounty.maxWinners)}
          label={`WINNERS ${bounty.winnersApproved}/${bounty.maxWinners}`}
          color="#FF3E9A"
        />

        {/* Footer: submissions */}
        <div className="flex items-center gap-1.5 mt-2 text-[#111]/40">
          <FolderIcon size={13} />
          <span className="font-mono-bold text-[10px] uppercase tracking-wider">{subCount} submission{subCount !== 1 ? 's' : ''}</span>
        </div>
      </WindowCard>
    </button>
  )
}
