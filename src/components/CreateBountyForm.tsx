import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { WindowCard } from './WindowCard'
import { PillButton } from './PillButton'
import { TxStatus } from './TxStatus'
import { LockIcon } from './Icons'
import { BOUNTY_BOARD_ABI } from '../bounty-abi'
import { CHAIN_ID, CONTRACT_ADDRESS, USDC_ADDRESS, USDC_DECIMALS, CONTRACT_DEPLOYED } from '../bounty-config'
import { parseOnchainError, encodeText } from '../lib/utils'
import { parseUnits } from 'viem'


// Deadline minimum: 1 hour from module load
const MIN_DEADLINE_DATE: string = new Date(Date.now() + 3600_000).toISOString().slice(0, 16)

const MAX_TITLE = 80
const MAX_DESC = 500

interface CreateBountyFormProps {
  onClose?: () => void
  onSuccess?: () => void
}

export function CreateBountyForm({ onClose, onSuccess }: CreateBountyFormProps) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [rewardPerWinner, setRewardPerWinner] = useState('')
  const [maxWinners, setMaxWinners] = useState('1')
  const [deadlineDate, setDeadlineDate] = useState('')

  // Approve USDC
  const { writeContract: approveUsdc, data: approveHash, isPending: approvePending, error: approveErr, reset: resetApprove } = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash })

  // Create bounty
  const { writeContract: createBounty, data: createHash, isPending: createPending, error: createErr, reset: resetCreate } = useWriteContract()
  const { isLoading: createConfirming, isSuccess: createSuccess } = useWaitForTransactionReceipt({ hash: createHash })

  const rewardRaw = rewardPerWinner ? parseUnits(rewardPerWinner, USDC_DECIMALS) : 0n
  const maxWinnersNum = Math.max(1, Math.min(50, parseInt(maxWinners) || 1))
  const totalEscrow = rewardRaw * BigInt(maxWinnersNum)
  const totalEscrowDisplay = rewardPerWinner ? (parseFloat(rewardPerWinner) * maxWinnersNum).toFixed(2) : '0.00'
  const deadlineTs = deadlineDate ? BigInt(Math.floor(new Date(deadlineDate).getTime() / 1000)) : 0n

  const isWrongChain = chainId !== CHAIN_ID
  const titleBytes = new TextEncoder().encode(title).length
  const descBytes = new TextEncoder().encode(description).length

  const canApprove = !!(
    address &&
    title.trim() &&
    titleBytes <= MAX_TITLE &&
    description.trim() &&
    descBytes <= MAX_DESC &&
    rewardPerWinner &&
    parseFloat(rewardPerWinner) > 0 &&
    maxWinnersNum >= 1 &&
    deadlineDate
  )

  function handleApprove() {
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    if (!CONTRACT_DEPLOYED) { toast.error('Contract not yet deployed.'); return }
    resetApprove()
    approveUsdc(
      { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [CONTRACT_ADDRESS, totalEscrow], chainId: CHAIN_ID },
      { onError: (err) => toast.error(parseOnchainError(err)) }
    )
  }

  function handleCreate() {
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    resetCreate()
    createBounty(
      {
        address: CONTRACT_ADDRESS,
        abi: BOUNTY_BOARD_ABI,
        functionName: 'createBounty',
        args: [encodeText(title), encodeText(description), rewardRaw, BigInt(maxWinnersNum), deadlineTs],
        chainId: CHAIN_ID,
      },
      {
        onSuccess: () => toast.success('Bounty posted — prize locked in escrow!'),
        onError: (err) => toast.error(parseOnchainError(err)),
      }
    )
  }

  if (createSuccess) {
    return (
      <WindowCard title="BOUNTY_POSTED.EXE" titleBarColor="#C6F23A" onClose={onClose}>
        <div className="flex flex-col gap-4 items-center text-center py-4">
          <div className="font-heading text-[40px] font-extrabold">IT'S LIVE!</div>
          <div className="font-mono-bold text-[12px] uppercase tracking-wider text-[#111]/70">
            Prize is locked in escrow. Workers can now submit.
          </div>
          <TxStatus hash={createHash} isPending={false} isConfirming={false} isSuccess isError={false} successMessage="Prize locked!" />
          <PillButton variant="lime" onClick={() => { onSuccess?.(); onClose?.() }}>View wall →</PillButton>
        </div>
      </WindowCard>
    )
  }

  return (
    <WindowCard title="NEW_BOUNTY.EXE" titleBarColor="#FF3E9A" onClose={onClose}>
      <div className="flex flex-col gap-4">

        {/* Trust notice */}
        <div className="border-[3px] border-[#111] rounded-lg bg-[#C6F23A]/40 px-3 py-3 flex items-start gap-2">
          <LockIcon size={16} className="shrink-0 mt-0.5 text-[#111]" />
          <p className="font-mono-bold text-[11px] text-[#111] leading-relaxed uppercase tracking-wide">
            Your bounty goes live <strong>only after the prize is locked in escrow.</strong> Workers can never submit to an unfunded bounty.
          </p>
        </div>

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="font-mono-bold text-[11px] uppercase tracking-widest text-[#111]">Title *</label>
            <span className={`font-mono-ui text-[10px] ${titleBytes > MAX_TITLE ? 'text-[#FF6B57]' : 'text-[#111]/40'}`}>{titleBytes}/{MAX_TITLE}</span>
          </div>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Write a blog post about Arc"
            maxLength={MAX_TITLE}
            className="border-[3px] border-[#111] rounded-lg px-3 py-2.5 text-[15px] font-body bg-white focus:outline-none focus:bg-[#FFFDF0] w-full"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="font-mono-bold text-[11px] uppercase tracking-widest text-[#111]">Description *</label>
            <span className={`font-mono-ui text-[10px] ${descBytes > MAX_DESC ? 'text-[#FF6B57]' : 'text-[#111]/40'}`}>{descBytes}/{MAX_DESC}</span>
          </div>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe what workers need to do and how to submit. What does good work look like?"
            rows={4}
            className="border-[3px] border-[#111] rounded-lg px-3 py-2.5 text-[15px] font-body bg-white focus:outline-none focus:bg-[#FFFDF0] w-full resize-none"
          />
        </div>

        {/* Reward + winners */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono-bold text-[11px] uppercase tracking-widest text-[#111]">Reward / winner (USDC) *</label>
            <input type="number" value={rewardPerWinner} onChange={e => setRewardPerWinner(e.target.value)}
              placeholder="25" min="0.000001" step="0.000001"
              className="border-[3px] border-[#111] rounded-lg px-3 py-2.5 text-[15px] font-heading font-bold bg-white focus:outline-none focus:bg-[#FFFDF0] w-full tabular-nums"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono-bold text-[11px] uppercase tracking-widest text-[#111]">Max winners (1–50) *</label>
            <input type="number" value={maxWinners} onChange={e => setMaxWinners(e.target.value)}
              placeholder="1" min="1" max="50" step="1"
              className="border-[3px] border-[#111] rounded-lg px-3 py-2.5 text-[15px] font-heading font-bold bg-white focus:outline-none focus:bg-[#FFFDF0] w-full tabular-nums"
            />
          </div>
        </div>

        {/* Deadline */}
        <div className="flex flex-col gap-1.5">
          <label className="font-mono-bold text-[11px] uppercase tracking-widest text-[#111]">Deadline *</label>
          <input type="datetime-local" value={deadlineDate} onChange={e => setDeadlineDate(e.target.value)}
            min={MIN_DEADLINE_DATE}
            className="border-[3px] border-[#111] rounded-lg px-3 py-2.5 text-[15px] font-body bg-white focus:outline-none focus:bg-[#FFFDF0] w-full"
          />
        </div>

        {/* Total escrow preview */}
        {canApprove && (
          <div className="border-[3px] border-[#111] rounded-lg bg-[#7FF3F0]/40 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="font-mono-bold text-[11px] uppercase tracking-widest text-[#111]">Total to lock in escrow</span>
              <span className="font-heading text-[28px] font-extrabold text-[#111] tabular-nums" style={{ letterSpacing: '-0.02em' }}>
                {totalEscrowDisplay} USDC
              </span>
            </div>
            <div className="font-mono-ui text-[10px] text-[#111]/50 mt-1">
              {rewardPerWinner} USDC × {maxWinnersNum} winner{maxWinnersNum > 1 ? 's' : ''} = {totalEscrowDisplay} USDC locked upfront
            </div>
          </div>
        )}

        {/* CTA flow */}
        {!address ? (
          <div className="font-mono-ui text-[12px] text-[#111]/60 text-center py-2">Connect your wallet to post a bounty</div>
        ) : isWrongChain ? (
          <PillButton variant="pink" onClick={() => switchChain({ chainId: CHAIN_ID })} showArrow={false}>Switch Network</PillButton>
        ) : !approveSuccess ? (
          <div className="flex flex-col gap-3">
            <TxStatus hash={approveHash} isPending={approvePending} isConfirming={approveConfirming}
              isSuccess={approveSuccess} isError={!!approveErr}
              error={approveErr ? parseOnchainError(approveErr) : undefined}
              successMessage="USDC approved!"
            />
            <PillButton onClick={handleApprove} disabled={!canApprove} loading={approvePending || approveConfirming} variant="yellow">
              Step 1: Approve USDC
            </PillButton>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="border-2 border-[#C6F23A] border-dashed rounded-lg px-3 py-2 bg-[#C6F23A]/20">
              <span className="font-mono-bold text-[11px] uppercase tracking-wider text-[#111]">USDC approved. Ready to lock prize.</span>
            </div>
            <TxStatus hash={createHash} isPending={createPending} isConfirming={createConfirming}
              isSuccess={createSuccess} isError={!!createErr}
              error={createErr ? parseOnchainError(createErr) : undefined}
              successMessage="Prize locked & bounty live!"
            />
            <PillButton onClick={handleCreate} loading={createPending || createConfirming} variant="lime">
              Step 2: Lock prize &amp; publish →
            </PillButton>
          </div>
        )}

        {/* Permanent notice */}
        <p className="font-mono-ui text-[10px] text-[#111]/40 text-center">
          Text posted onchain is permanent and public.
        </p>
      </div>
    </WindowCard>
  )
}
