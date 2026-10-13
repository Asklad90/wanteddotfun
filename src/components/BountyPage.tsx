import { useState, useEffect, useCallback } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { toast } from 'sonner'
import { WindowCard } from './WindowCard'
import { PillButton } from './PillButton'
import { StatusTag } from './StatusTag'
import { LoadingBar } from './LoadingBar'
import { TxStatus } from './TxStatus'
import { ClockIcon, TrophyIcon, LockIcon, CoinIcon, FolderIcon } from './Icons'
import { SubmissionViewer } from './SubmissionViewer'
import { BOUNTY_BOARD_ABI } from '../bounty-abi'
import { CHAIN_ID, CONTRACT_ADDRESS } from '../bounty-config'
import { barColor, formatUsdc, formatAddress, timeLeft, bountyStatus, parseOnchainError, decodeBytes } from '../lib/utils'
import { BountyData } from './BountyCard'
import {
  getSubmissions, getMySubmission, postSubmission,
  setSubmissionVisibility, registerBounty,
  type OffchainSubmission, type SubmissionsResponse,
} from '../lib/submissions-api'

// Snapshot current unix seconds outside render to satisfy lint purity rule
const _getNowSec = (): number => Date.now() / 1000

// PayoutStatus enum mirrors contract: 0=None, 1=Pending, 2=Paid
const PAYOUT_PENDING = 1
const PAYOUT_PAID = 2

interface BountyPageProps {
  bountyId: bigint
  onBack: () => void
  onDataChange?: () => void
}

export function BountyPage({ bountyId, onBack, onDataChange }: BountyPageProps) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const isWrongChain = chainId !== CHAIN_ID

  // ── Onchain reads ──────────────────────────────────────────────────────────
  const { data: bounty, refetch: refetchBounty } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'getBounty',
    args: [bountyId], chainId: CHAIN_ID,
  }) as { data: BountyData | undefined; refetch: () => void }

  const { data: userPayoutStatus, refetch: refetchPayoutStatus } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'payoutStatus',
    args: [bountyId, address ?? '0x0000000000000000000000000000000000000000'],
    chainId: CHAIN_ID, query: { enabled: !!address },
  }) as { data: number | undefined; refetch: () => void }

  const { data: reviewWindowRaw } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'reviewWindow',
    chainId: CHAIN_ID,
  }) as { data: number | undefined }

  // ── Off-chain submissions state ────────────────────────────────────────────
  const [subsData, setSubsData] = useState<SubmissionsResponse | null>(null)
  const [mySubmission, setMySubmission] = useState<OffchainSubmission | null>(null)
  const [subsLoading, setSubsLoading] = useState(true)

  const bountyIdStr = bountyId.toString()

  const loadSubs = useCallback(async () => {
    setSubsLoading(true)
    try {
      const [sr, mine] = await Promise.all([
        getSubmissions(bountyIdStr, address ?? ''),
        address ? getMySubmission(bountyIdStr, address) : Promise.resolve(null),
      ])
      setSubsData(sr)
      setMySubmission(mine)
    } catch {
      // backend may not be up yet — ignore silently
    } finally {
      setSubsLoading(false)
    }
  }, [bountyIdStr, address])

  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { loadSubs().catch(() => {}) }, [loadSubs])

  // ── Submit form state ──────────────────────────────────────────────────────
  const [submissionText, setSubmissionText] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitDone, setSubmitDone] = useState(false)

  async function handleSubmit() {
    if (!address) { toast.error('Connect your wallet first.'); return }
    if (!submissionText.trim()) { toast.error('Please write your submission.'); return }
    if (submissionText.length > 5000) { toast.error('Submission too long (max 5000 chars).'); return }
    setSubmitLoading(true)
    try {
      await postSubmission(bountyIdStr, address, submissionText.trim())
      toast.success('Submission posted!')
      setSubmitDone(true)
      setSubmissionText('')
      await loadSubs()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Submission failed'
      toast.error(msg)
    } finally {
      setSubmitLoading(false)
    }
  }

  // ── Visibility toggle ──────────────────────────────────────────────────────
  const [visLoading, setVisLoading] = useState(false)

  async function handleToggleVisibility() {
    if (!address || !subsData) return
    const newVal = !subsData.publicSubs
    setVisLoading(true)
    try {
      await setSubmissionVisibility(bountyIdStr, address, newVal)
      toast.success(newVal ? 'Submissions are now public.' : 'Submissions are now private.')
      await loadSubs()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to update visibility'
      toast.error(msg)
    } finally {
      setVisLoading(false)
    }
  }

  // ── Onchain writes ─────────────────────────────────────────────────────────
  const { writeContract: claimReward, data: claimHash, isPending: claimPending, error: claimErr } = useWriteContract()
  const { isLoading: claimConfirming, isSuccess: claimSuccess } = useWaitForTransactionReceipt({ hash: claimHash })

  const { writeContract: reclaimUnused, data: reclaimHash, isPending: reclaimPending, error: reclaimErr } = useWriteContract()
  const { isLoading: reclaimConfirming, isSuccess: reclaimSuccess } = useWaitForTransactionReceipt({ hash: reclaimHash })

  const { writeContract: cancelBounty, data: cancelHash, isPending: cancelPending, error: cancelErr } = useWriteContract()
  const { isLoading: cancelConfirming, isSuccess: cancelSuccess } = useWaitForTransactionReceipt({ hash: cancelHash })

  // Per-submission approve hooks (keyed by submitter)
  const { writeContract: approve, data: approveHash, isPending: approvePending, error: approveErr } = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash })
  const [approvingSubmitter, setApprovingSubmitter] = useState<string | null>(null)

  function refetchAll() {
    refetchBounty(); refetchPayoutStatus(); void loadSubs(); onDataChange?.()
  }

  function handleClaim() {
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    claimReward(
      { address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'claim', args: [bountyId], chainId: CHAIN_ID },
      { onSuccess: () => { toast.success('Payout claimed!'); refetchAll() }, onError: (e) => toast.error(parseOnchainError(e)) }
    )
  }

  function handleReclaim() {
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    reclaimUnused(
      { address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'reclaimUnused', args: [bountyId], chainId: CHAIN_ID },
      { onSuccess: () => { toast.success('Unused escrow reclaimed!'); refetchAll() }, onError: (e) => toast.error(parseOnchainError(e)) }
    )
  }

  function handleCancel() {
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    cancelBounty(
      { address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'cancel', args: [bountyId], chainId: CHAIN_ID },
      { onSuccess: () => { toast.success('Bounty cancelled, escrow refunded.'); refetchAll() }, onError: (e) => toast.error(parseOnchainError(e)) }
    )
  }

  function handleApprove(submitterAddr: string) {
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    setApprovingSubmitter(submitterAddr)
    approve(
      { address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'approveWinner', args: [bountyId, submitterAddr as `0x${string}`], chainId: CHAIN_ID },
      {
        onSuccess: () => { toast.success('Winner approved & paid!'); refetchAll() },
        onError: (e) => { toast.error(parseOnchainError(e)); setApprovingSubmitter(null) },
      }
    )
  }

  // Register bounty settings on first load (idempotent)
  useEffect(() => {
    if (bounty && address && bounty.poster.toLowerCase() === address.toLowerCase()) {
      void registerBounty(bountyIdStr, address).catch(() => undefined)
    }
  }, [bounty, address, bountyIdStr])

  if (!bounty) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="font-mono-bold text-[13px] uppercase tracking-widest text-[#111]/60 animate-pulse">Loading bounty...</div>
      </div>
    )
  }

  const status = bountyStatus({ winnersApproved: bounty.winnersApproved, maxWinners: bounty.maxWinners, deadline: bounty.deadline, cancelled: bounty.cancelled })
  const isPoster = !!(address && address.toLowerCase() === bounty.poster.toLowerCase())
  const idNum = Number(bounty.id)
  const titleStr = decodeBytes(bounty.title) || `Bounty #${idNum}`
  const descStr = decodeBytes(bounty.description)
  const now = Math.floor(_getNowSec())
  const reviewWindowSec = reviewWindowRaw ?? 0
  const approvalCutoff = Number(bounty.deadline) + reviewWindowSec
  const afterReviewWindow = now > approvalCutoff
  const totalPrize = bounty.rewardPerWinner * bounty.maxWinners
  const paidOut = totalPrize - bounty.escrowRemaining
  const subCount = subsData?.count ?? 0
  const submissions = subsData?.submissions ?? []
  const isPublic = subsData?.publicSubs ?? false
  const hasSubmitted = !!mySubmission

  return (
    <div className="flex flex-col gap-5 max-w-2xl mx-auto">
      <button onClick={onBack} className="font-mono-bold text-[12px] uppercase tracking-widest text-[#1A1AE6] hover:underline self-start">← Back to wall</button>

      {/* Main bounty window */}
      <WindowCard title={`BOUNTY_${String(idNum).padStart(3, '0')}.EXE`} titleBarColor={barColor(idNum)} bodyClassName="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <StatusTag status={status} />
          <div className="flex items-center gap-1.5 text-[#111]/60">
            <ClockIcon size={13} />
            <span className="font-mono-bold text-[10px] uppercase tracking-wider">{timeLeft(bounty.deadline)}</span>
          </div>
        </div>
        <h1 className="font-heading text-[26px] font-extrabold leading-tight text-[#111]">{titleStr}</h1>
        <p className="font-body text-[14px] leading-relaxed text-[#111]/80 whitespace-pre-wrap">{descStr}</p>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="border-[3px] border-[#111] rounded-lg p-3 bg-[#FFE600]/30 flex flex-col gap-1">
            <CoinIcon size={14} />
            <div className="font-heading text-[20px] font-extrabold tabular-nums">{formatUsdc(bounty.rewardPerWinner)}</div>
            <div className="font-mono-ui text-[10px] uppercase tracking-wider text-[#111]/60">USDC / winner</div>
          </div>
          <div className="border-[3px] border-[#111] rounded-lg p-3 bg-[#7FF3F0]/30 flex flex-col gap-1">
            <TrophyIcon size={14} />
            <div className="font-heading text-[20px] font-extrabold tabular-nums">{bounty.winnersApproved.toString()}/{bounty.maxWinners.toString()}</div>
            <div className="font-mono-ui text-[10px] uppercase tracking-wider text-[#111]/60">Winners</div>
          </div>
          <div className="border-[3px] border-[#111] rounded-lg p-3 bg-[#C6F23A]/30 flex flex-col gap-1">
            <FolderIcon size={14} />
            <div className="font-heading text-[20px] font-extrabold tabular-nums">{subCount}</div>
            <div className="font-mono-ui text-[10px] uppercase tracking-wider text-[#111]/60">Submissions</div>
          </div>
        </div>

        {/* Escrow panel */}
        <div className="border-[3px] border-[#111] rounded-lg p-3 bg-[#C6F23A]/20 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <LockIcon size={14} className="text-[#111]" />
            <span className="font-mono-bold text-[11px] uppercase tracking-widest text-[#111]">Escrow</span>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex flex-col">
              <span className="font-mono-bold text-[10px] uppercase text-[#111]/50">Locked</span>
              <span className="font-heading text-[18px] font-extrabold tabular-nums">{formatUsdc(bounty.escrowRemaining)} USDC</span>
            </div>
            <div className="flex flex-col">
              <span className="font-mono-bold text-[10px] uppercase text-[#111]/50">Paid out</span>
              <span className="font-heading text-[18px] font-extrabold tabular-nums">{formatUsdc(paidOut)} USDC</span>
            </div>
          </div>
        </div>

        <LoadingBar current={Number(bounty.winnersApproved)} max={Number(bounty.maxWinners)} label={`Winners ${bounty.winnersApproved}/${bounty.maxWinners}`} color="#FF3E9A" />
        <div className="font-mono-ui text-[11px] text-[#111]/50">
          Posted by <span className="text-[#1A1AE6]">{formatAddress(bounty.poster)}</span>
        </div>
      </WindowCard>

      {/* Pending payout claim */}
      {userPayoutStatus === PAYOUT_PENDING && (
        <WindowCard title="CLAIM_REWARD.EXE" titleBarColor="#C6F23A">
          <div className="flex flex-col gap-3">
            <div className="font-heading text-[22px] font-extrabold">You have a pending payout!</div>
            <div className="font-body text-[14px] text-[#111]/70">The automatic transfer failed. Claim your reward manually.</div>
            <TxStatus hash={claimHash} isPending={claimPending} isConfirming={claimConfirming} isSuccess={claimSuccess} isError={!!claimErr} error={claimErr ? parseOnchainError(claimErr) : undefined} successMessage="Payout claimed!" />
            {!claimSuccess && <PillButton onClick={handleClaim} loading={claimPending || claimConfirming} variant="lime">Claim {formatUsdc(bounty.rewardPerWinner)} USDC →</PillButton>}
          </div>
        </WindowCard>
      )}

      {/* Auto-paid notice */}
      {userPayoutStatus === PAYOUT_PAID && (
        <WindowCard title="YOU_WON.EXE" titleBarColor="#C6F23A">
          <div className="font-heading text-[20px] font-extrabold">Paid! {formatUsdc(bounty.rewardPerWinner)} USDC sent to your wallet.</div>
        </WindowCard>
      )}

      {/* Submit form — no gas, free */}
      {!isPoster && status === 'OPEN' && !hasSubmitted && !submitDone && (
        <WindowCard title="SUBMIT_WORK.EXE" titleBarColor="#A78BFA">
          <div className="flex flex-col gap-3">
            <div className="font-mono-ui text-[11px] text-[#111]/60 border-2 border-[#111] rounded-lg p-2 bg-[#FFE600]/20">
              Share your work as text, links, image URLs or a YouTube link. <strong>Free — no gas required.</strong>
            </div>
            {!address && (
              <div className="font-mono-bold text-[12px] uppercase tracking-wider text-center text-[#111]/60 py-2">
                Connect your wallet to submit
              </div>
            )}
            {address && (
              <>
                <textarea
                  value={submissionText}
                  onChange={e => setSubmissionText(e.target.value)}
                  placeholder="Paste links, describe your work, share a YouTube URL or image URL..."
                  rows={6}
                  className="border-[3px] border-[#111] rounded-lg px-3 py-2.5 text-[15px] font-body bg-white focus:outline-none focus:bg-[#FFFDF0] w-full resize-none"
                />
                <div className={`font-mono-ui text-[10px] text-right ${submissionText.length > 5000 ? 'text-[#FF6B57]' : 'text-[#111]/40'}`}>
                  {submissionText.length}/5000
                </div>
                <div className="font-mono-ui text-[10px] text-[#111]/40 border-t border-[#111]/10 pt-2">
                  Text posted here is stored off-chain but is visible to the bounty poster.
                </div>
                <PillButton onClick={() => { void handleSubmit() }} loading={submitLoading} disabled={!submissionText.trim() || submissionText.length > 5000}>
                  Submit work — free →
                </PillButton>
              </>
            )}
          </div>
        </WindowCard>
      )}

      {/* Already submitted */}
      {!isPoster && (hasSubmitted || submitDone) && userPayoutStatus !== PAYOUT_PENDING && userPayoutStatus !== PAYOUT_PAID && (
        <WindowCard title="SUBMITTED.EXE" titleBarColor="#7FF3F0">
          <div className="flex flex-col gap-3">
            <div className="font-mono-bold text-[12px] uppercase tracking-wider text-[#111]/70">
              Your submission is in. Waiting for the poster to review.
            </div>
            {mySubmission && (
              <div className="border-[3px] border-[#111] rounded-lg p-3 bg-[#7FF3F0]/20">
                <div className="font-mono-bold text-[10px] uppercase tracking-wider text-[#111]/50 mb-1">Your submission:</div>
                <p className="font-body text-[13px] text-[#111]/80 whitespace-pre-wrap break-words leading-relaxed">{mySubmission.content}</p>
              </div>
            )}
          </div>
        </WindowCard>
      )}

      {/* Poster actions */}
      {isPoster && (
        <>
          {/* Visibility toggle */}
          <WindowCard title="SETTINGS.EXE" titleBarColor="#FFE600">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono-bold text-[12px] uppercase tracking-wider text-[#111]">Submission visibility</span>
                <span className="font-body text-[12px] text-[#111]/60">
                  {isPublic ? 'All users can see every submission' : 'Only you and each submitter can see their own work'}
                </span>
              </div>
              <button
                onClick={() => { void handleToggleVisibility() }}
                disabled={visLoading}
                className={`relative inline-flex h-7 w-12 items-center rounded-full border-[3px] border-[#111] transition-colors ${isPublic ? 'bg-[#C6F23A]' : 'bg-[#111]/20'} ${visLoading ? 'opacity-50' : ''}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full border-[2px] border-[#111] bg-white transition-transform ${isPublic ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </WindowCard>

          {/* Reclaim after review window */}
          {afterReviewWindow && !bounty.reclaimedUnused && bounty.escrowRemaining > 0n && (
            <WindowCard title="RECLAIM_UNUSED.EXE" titleBarColor="#FF6B57">
              <div className="flex flex-col gap-3">
                <div className="font-body text-[14px]">Review window ended. Reclaim unclaimed prize slots ({formatUsdc(bounty.escrowRemaining)} USDC).</div>
                <TxStatus hash={reclaimHash} isPending={reclaimPending} isConfirming={reclaimConfirming} isSuccess={reclaimSuccess} isError={!!reclaimErr} error={reclaimErr ? parseOnchainError(reclaimErr) : undefined} successMessage="Escrow reclaimed!" />
                {!reclaimSuccess && <PillButton onClick={handleReclaim} loading={reclaimPending || reclaimConfirming} variant="pink">Reclaim unused prize →</PillButton>}
              </div>
            </WindowCard>
          )}

          {/* Cancel — only with 0 submissions */}
          {subCount === 0 && !bounty.cancelled && (
            <WindowCard title="CANCEL_BOUNTY.EXE" titleBarColor="#CCCCCC">
              <div className="flex flex-col gap-3">
                <div className="font-body text-[14px]">No submissions yet. You can cancel and get your full escrow back.</div>
                <TxStatus hash={cancelHash} isPending={cancelPending} isConfirming={cancelConfirming} isSuccess={cancelSuccess} isError={!!cancelErr} error={cancelErr ? parseOnchainError(cancelErr) : undefined} successMessage="Bounty cancelled, escrow refunded." />
                {!cancelSuccess && <PillButton onClick={handleCancel} loading={cancelPending || cancelConfirming} variant="ink" showArrow={false}>Cancel bounty</PillButton>}
              </div>
            </WindowCard>
          )}
        </>
      )}

      {/* Submissions list */}
      <WindowCard title={`SUBMISSIONS.EXE${subCount > 0 ? ` (${subCount})` : ''}`} titleBarColor="#7FF3F0">
        {subsLoading ? (
          <div className="py-6 flex flex-col gap-2">
            {[1, 2].map(i => <div key={i} className="border-[2px] border-[#111]/10 rounded-lg h-12 animate-pulse bg-[#111]/5" />)}
          </div>
        ) : submissions.length === 0 ? (
          <div className="checkerboard rounded-lg py-10 flex flex-col items-center gap-3">
            <FolderIcon size={36} />
            <div className="font-mono-bold text-[12px] uppercase tracking-widest text-[#111]/50">
              {subCount > 0 && !isPoster ? 'Connect wallet or wait for poster to make submissions public' : 'No submissions yet'}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {submissions.map(sub => (
              <SubmissionViewer
                key={sub.id}
                sub={sub}
                bountyId={bountyId}
                isPoster={isPoster}
                rewardPerWinner={bounty.rewardPerWinner}
                canApprove={!afterReviewWindow}
                onApprove={handleApprove}
                approveLoading={(approvePending || approveConfirming) && approvingSubmitter === sub.submitter}
                approveSuccess={approveSuccess && approvingSubmitter === sub.submitter}
                approveError={approveErr && approvingSubmitter === sub.submitter ? parseOnchainError(approveErr) : undefined}
                winnerStatus={undefined}
              />
            ))}
          </div>
        )}
      </WindowCard>
    </div>
  )
}
