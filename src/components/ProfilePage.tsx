import { useState, useCallback } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useWaitForTransactionReceipt as useWaitForWrite } from 'wagmi'
import { useSwitchChain } from 'wagmi'
import { isAddress, parseUnits } from 'viem'
import { BOUNTY_BOARD_ABI } from '../bounty-abi'
import { USDC_ADDRESS, USDC_DECIMALS, CONTRACT_ADDRESS, CHAIN_ID, getTxUrl, getAddressUrl } from '../bounty-config'
import { formatUsdc, formatAddress, parseOnchainError, decodeBytes, bountyStatus, timeLeft } from '../lib/utils'
import { WindowCard } from './WindowCard'
import { StatusTag } from './StatusTag'
import { PixelAvatar } from './PixelAvatar'
import { QRCode } from './QRCode'
import { TxStatus } from './TxStatus'

// ─── MyStatus enum (mirrors Solidity) ────────────────────────────────────────
const MY_STATUS_NONE = 0
const MY_STATUS_SUBMITTED = 1
const MY_STATUS_WINNER_PENDING = 2
const MY_STATUS_WINNER_PAID = 3
const MY_STATUS_NOT_SELECTED = 4

const MY_STATUS_LABELS: Record<number, { label: string; color: string }> = {
  [MY_STATUS_NONE]: { label: 'NONE', color: '#FFFDF0' },
  [MY_STATUS_SUBMITTED]: { label: 'SUBMITTED', color: '#7FF3F0' },
  [MY_STATUS_WINNER_PENDING]: { label: 'WINNER (PENDING)', color: '#FFE600' },
  [MY_STATUS_WINNER_PAID]: { label: 'PAID', color: '#C6F23A' },
  [MY_STATUS_NOT_SELECTED]: { label: 'NOT SELECTED', color: '#e5e7eb' },
}

// Minimal ERC-20 ABI for balance + transfer
const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
] as const

const PAGE_SIZE = 10n

interface ProfilePageProps {
  address: `0x${string}`
  onBack: () => void
  onSelectBounty: (id: bigint) => void
}

type ProfileTab = 'participating' | 'past' | 'posted'

// ─── Copy button ──────────────────────────────────────────────────────────────
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}
      className="font-mono-bold text-[10px] uppercase tracking-widest border-[2px] border-[#111] rounded-full px-2 py-0.5 bg-[#FFE600] text-[#111] hover:shadow-hard-sm transition-shadow btn-press"
    >
      {copied ? 'COPIED!' : label}
    </button>
  )
}

// ─── Stat chip ────────────────────────────────────────────────────────────────
function StatChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="border-[3px] border-[#111] rounded-lg p-3 flex flex-col gap-0.5 shadow-hard-sm" style={{ backgroundColor: color }}>
      <span className="font-heading text-[22px] font-extrabold tabular-nums leading-none text-[#111]">{value}</span>
      <span className="font-mono-ui text-[10px] uppercase tracking-widest text-[#111]/60">{label}</span>
    </div>
  )
}

// ─── Send modal ───────────────────────────────────────────────────────────────
interface SendModalProps {
  balance: bigint
  onClose: () => void
}
function SendModal({ balance, onClose }: SendModalProps) {
  const { chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const isWrongChain = chainId !== CHAIN_ID
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const [toErr, setToErr] = useState('')
  const [amountErr, setAmountErr] = useState('')

  const { writeContract, data: txHash, isPending, error: txErr, isSuccess } = useWriteContract()
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForWrite({ hash: txHash })

  function validate() {
    let ok = true
    if (!isAddress(to) || to === '0x0000000000000000000000000000000000000000') {
      setToErr('Invalid recipient address'); ok = false
    } else { setToErr('') }
    let parsed: bigint
    try { parsed = parseUnits(amount || '0', USDC_DECIMALS) } catch { parsed = -1n }
    if (parsed <= 0n) { setAmountErr('Amount must be greater than 0'); ok = false }
    else if (parsed > balance) { setAmountErr('Insufficient USDC balance'); ok = false }
    else { setAmountErr('') }
    return ok
  }

  function handleReview() { if (validate()) setStep('confirm') }

  function handleSend() {
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    const parsed = parseUnits(amount, USDC_DECIMALS)
    writeContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'transfer', args: [to as `0x${string}`, parsed], chainId: CHAIN_ID })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#111]/60" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-sm">
        <WindowCard title="SEND_USDC.EXE" titleBarColor="#FF3E9A" onClose={onClose}>
          {confirmed ? (
            <div className="flex flex-col gap-3 items-center text-center">
              <span className="font-heading text-[20px] font-extrabold text-[#111]">Sent!</span>
              {txHash && <a href={getTxUrl(txHash)} target="_blank" rel="noopener noreferrer" className="font-mono-bold text-[11px] uppercase tracking-widest text-[#1A1AE6] underline">View on explorer</a>}
              <button onClick={onClose} className="font-mono-bold text-[12px] uppercase tracking-widest bg-[#C6F23A] border-[3px] border-[#111] rounded-full px-4 py-2 shadow-hard-sm btn-press">Done</button>
            </div>
          ) : step === 'confirm' ? (
            <div className="flex flex-col gap-4">
              <p className="font-mono-bold text-[12px] uppercase tracking-widest text-[#111]/60">Confirm send</p>
              <div className="border-[2px] border-[#111] rounded-lg p-3 bg-[#FFFDF0] font-mono-ui text-[12px] text-[#111] break-all">
                <div><span className="text-[#111]/50">TO: </span>{to}</div>
                <div className="mt-1"><span className="text-[#111]/50">AMOUNT: </span><strong>{amount} USDC</strong></div>
              </div>
              {txErr && <p className="font-mono-bold text-[11px] text-[#FF3E9A]">{parseOnchainError(txErr)}</p>}
              <TxStatus hash={txHash} isPending={isPending} isConfirming={confirming} isSuccess={isSuccess} isError={!!txErr} error={txErr ? parseOnchainError(txErr) : undefined} successMessage="Transfer sent!" />
              <div className="flex gap-2">
                <button onClick={() => setStep('form')} disabled={isPending || confirming} className="flex-1 font-mono-bold text-[12px] uppercase tracking-widest bg-[#FFFDF0] border-[3px] border-[#111] rounded-full px-4 py-2.5 shadow-hard-sm btn-press disabled:opacity-40">Back</button>
                <button onClick={handleSend} disabled={isPending || confirming} className="flex-1 font-mono-bold text-[12px] uppercase tracking-widest bg-[#FFE600] border-[3px] border-[#111] rounded-full px-4 py-2.5 shadow-hard-sm btn-press disabled:opacity-40">
                  {isWrongChain ? 'Switch chain' : isPending ? 'Confirm in wallet...' : confirming ? 'Confirming...' : 'Send →'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="font-mono-bold text-[11px] uppercase tracking-widest text-[#111]">Recipient address</label>
                <input value={to} onChange={e => setTo(e.target.value)} placeholder="0x..." className="border-[3px] border-[#111] rounded-lg p-3 font-mono-ui text-[13px] bg-[#FFFDF0] focus:outline-none focus:ring-2 focus:ring-[#FF3E9A]" />
                {toErr && <p className="font-mono-bold text-[10px] text-[#FF3E9A]">{toErr}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono-bold text-[11px] uppercase tracking-widest text-[#111]">Amount (USDC)</label>
                <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" type="number" min="0" step="0.01" className="border-[3px] border-[#111] rounded-lg p-3 font-body text-[16px] bg-[#FFFDF0] focus:outline-none focus:ring-2 focus:ring-[#FF3E9A]" />
                {amountErr && <p className="font-mono-bold text-[10px] text-[#FF3E9A]">{amountErr}</p>}
              </div>
              <button onClick={handleReview} className="font-mono-bold text-[13px] uppercase tracking-widest bg-[#FFE600] border-[3px] border-[#111] rounded-full px-4 py-3 shadow-hard-sm btn-press">Review →</button>
            </div>
          )}
        </WindowCard>
      </div>
    </div>
  )
}

// ─── Receive modal ────────────────────────────────────────────────────────────
function ReceiveModal({ address, onClose }: { address: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#111]/60" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-sm">
        <WindowCard title="RECEIVE_USDC.EXE" titleBarColor="#7FF3F0" onClose={onClose}>
          <div className="flex flex-col items-center gap-4">
            <div className="border-[3px] border-[#111] rounded-lg overflow-hidden shadow-hard-sm">
              <QRCode value={address} size={180} />
            </div>
            <div className="w-full border-[2px] border-[#111] rounded-lg p-3 bg-[#FFFDF0] font-mono-ui text-[11px] text-[#111] break-all text-center">
              {address}
            </div>
            <CopyButton text={address} label="Copy address" />
            <p className="font-mono-ui text-[10px] uppercase tracking-widest text-[#111]/50 text-center">USDC on Arc Testnet only</p>
          </div>
        </WindowCard>
      </div>
    </div>
  )
}

// Module-level timestamp snapshot — avoids impure Date.now() inside render
const _rowNowSec = (): number => Date.now() / 1000

// ─── Bounty row in profile tabs ───────────────────────────────────────────────
function BountyRow({ bountyId, profileAddr, onSelect, tabMode }: {
  bountyId: bigint
  profileAddr: `0x${string}`
  onSelect: (id: bigint) => void
  tabMode: 'participating' | 'past' | 'posted'
}) {
  const { data: bounty } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'getBounty',
    args: [bountyId], chainId: CHAIN_ID,
  }) as { data: { title: `0x${string}`; rewardPerWinner: bigint; deadline: bigint; winnersApproved: bigint; maxWinners: bigint; cancelled: boolean; escrowRemaining: bigint; reclaimedUnused: boolean } | undefined }

  const { data: myStatusRaw } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'getMyStatus',
    args: [bountyId, profileAddr], chainId: CHAIN_ID,
  }) as { data: number | undefined }

  if (!bounty) return (
    <div className="border-[2px] border-[#111]/20 rounded-lg p-3 bg-[#FFFDF0]/50 animate-pulse h-14" />
  )

  const isOpen = !bounty.cancelled && Number(bounty.deadline) > Math.floor(_rowNowSec()) && Number(bounty.winnersApproved) < Number(bounty.maxWinners)

  // Filter by tab: participating = open bounties, past = closed
  if (tabMode === 'participating' && !isOpen) return null
  if (tabMode === 'past' && isOpen) return null

  const titleStr = decodeBytes(bounty.title)
  const status = bountyStatus(bounty)
  const myStatus = myStatusRaw ?? MY_STATUS_NONE
  const myStatusInfo = MY_STATUS_LABELS[myStatus] ?? MY_STATUS_LABELS[MY_STATUS_NONE]

  return (
    <button
      onClick={() => onSelect(bountyId)}
      className="w-full text-left border-[3px] border-[#111] rounded-lg p-3 bg-[#FFFDF0] shadow-hard-sm hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-hard transition-transform flex items-center justify-between gap-2"
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="font-heading text-[14px] font-bold text-[#111] truncate">{titleStr || '(untitled)'}</span>
        <span className="font-mono-ui text-[10px] uppercase tracking-wider text-[#111]/50">
          {formatUsdc(bounty.rewardPerWinner)} USDC · {timeLeft(bounty.deadline)}
        </span>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <StatusTag status={status} />
        {myStatus !== MY_STATUS_NONE && (
          <span
            className="font-mono-bold text-[9px] uppercase tracking-widest border-[2px] border-[#111] rounded-full px-1.5 py-0.5"
            style={{ backgroundColor: myStatusInfo.color }}
          >{myStatusInfo.label}</span>
        )}
      </div>
    </button>
  )
}

// ─── Main ProfilePage ─────────────────────────────────────────────────────────
export function ProfilePage({ address, onBack, onSelectBounty }: ProfilePageProps) {
  const { address: connectedAddr } = useAccount()
  const isOwn = connectedAddr?.toLowerCase() === address.toLowerCase()

  const [tab, setTab] = useState<ProfileTab>('participating')
  const [showSend, setShowSend] = useState(false)
  const [showReceive, setShowReceive] = useState(false)

  // Earnings
  const { data: earningsRaw } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'getEarnings',
    args: [address], chainId: CHAIN_ID,
  }) as { data: [bigint, bigint, bigint] | undefined }
  const earned = earningsRaw?.[0] ?? 0n
  const pendingEarnings = earningsRaw?.[1] ?? 0n
  const wins = earningsRaw?.[2] ?? 0n

  // Paginated lists
  const [submittedOffset] = useState(0n)
  const [postedOffset] = useState(0n)

  const { data: submittedIds } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'getSubmittedBounties',
    args: [address, submittedOffset, PAGE_SIZE], chainId: CHAIN_ID,
  }) as { data: readonly bigint[] | undefined }

  const { data: postedIds } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'getPostedBounties',
    args: [address, postedOffset, PAGE_SIZE], chainId: CHAIN_ID,
  }) as { data: readonly bigint[] | undefined }

  const { data: totalPosted } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'getBountiesByPoster',
    args: [address], chainId: CHAIN_ID,
  }) as { data: readonly bigint[] | undefined }

  // USDC balance (only read if own profile)
  const { data: balanceRaw, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'balanceOf',
    args: [address], chainId: CHAIN_ID,
    query: { enabled: isOwn },
  }) as { data: bigint | undefined; refetch: () => void }
  const balance = balanceRaw ?? 0n

  // Profile URL
  const profileUrl = `${window.location.origin}${window.location.pathname}#/profile/${address}`

  const handleSendClose = useCallback(() => { setShowSend(false); refetchBalance() }, [refetchBalance])

  const submittedList: readonly bigint[] = submittedIds ?? []
  const postedList: readonly bigint[] = postedIds ?? []

  // Both tabs get the same submitted list; BountyRow filters itself by deadline/status
  const participatingIds = submittedList
  const pastIds = submittedList

  // Pending claim bounties — items where the contract reports WinnerPending for this address
  // We can only know this after BountyRow fetches each, so PendingClaimRow handles its own visibility.
  // We show the PendingClaimsWindow whenever pendingEarnings > 0 (contract-level aggregate).
  const hasPendingClaims = pendingEarnings > 0n && isOwn

  const TABS: { id: ProfileTab; label: string; color: string }[] = [
    { id: 'participating', label: 'PARTICIPATING', color: '#7FF3F0' },
    { id: 'past', label: 'PAST', color: '#8B5CF6' },
    { id: 'posted', label: 'POSTED', color: '#FF3E9A' },
  ]

  return (
    <div className="flex flex-col gap-5">
      <button onClick={onBack} className="font-mono-bold text-[12px] uppercase tracking-widest text-[#1A1AE6] hover:underline self-start">← Back</button>

      {/* ── Header window ─────────────────────────────────────────────────── */}
      <WindowCard title="PROFILE.EXE" titleBarColor="#FF3E9A" bodyClassName="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          {/* Pixel avatar */}
          <div className="border-[3px] border-[#111] rounded-lg overflow-hidden shadow-hard-sm shrink-0">
            <PixelAvatar address={address} size={64} />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-heading text-[18px] font-extrabold text-[#111] truncate">{formatAddress(address)}</span>
              <CopyButton text={address} label="Copy" />
            </div>
            <a href={getAddressUrl(address)} target="_blank" rel="noopener noreferrer" className="font-mono-bold text-[10px] uppercase tracking-widest text-[#1A1AE6] underline">Explorer →</a>
          </div>
        </div>
        {/* Shareable link */}
        <div className="flex items-center gap-2 border-[2px] border-[#111] rounded-lg p-2 bg-[#FFFDF0]">
          <span className="font-mono-ui text-[10px] text-[#111]/50 flex-1 truncate">{profileUrl}</span>
          <CopyButton text={profileUrl} label="Share" />
        </div>
      </WindowCard>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatChip label="Total earned" value={`${formatUsdc(earned)} USDC`} color="#C6F23A" />
        <StatChip label="Pending" value={`${formatUsdc(pendingEarnings)} USDC`} color="#FFE600" />
        <StatChip label="Wins" value={wins.toString()} color="#7FF3F0" />
        <StatChip label="Bounties posted" value={(totalPosted?.length ?? 0).toString()} color="#FF3E9A" />
      </div>

      {/* ── Wallet window ─────────────────────────────────────────────────── */}
      {isOwn && (
        <WindowCard title="WALLET.EXE" titleBarColor="#C6F23A" bodyClassName="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="font-mono-bold text-[10px] uppercase tracking-widest text-[#111]/50">USDC Balance</p>
              <p className="font-heading text-[28px] font-extrabold tabular-nums text-[#111]">{formatUsdc(balance)} <span className="text-[16px]">USDC</span></p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowReceive(true)} className="font-mono-bold text-[12px] uppercase tracking-widest bg-[#7FF3F0] border-[3px] border-[#111] rounded-full px-4 py-2.5 shadow-hard-sm btn-press">Receive</button>
              <button onClick={() => setShowSend(true)} className="font-mono-bold text-[12px] uppercase tracking-widest bg-[#FFE600] border-[3px] border-[#111] rounded-full px-4 py-2.5 shadow-hard-sm btn-press">Send →</button>
            </div>
          </div>
          <p className="font-mono-ui text-[10px] uppercase tracking-widest text-[#111]/40">Your connected wallet is your Wanted.fun wallet. Keys never leave your wallet app.</p>
        </WindowCard>
      )}

      {/* ── Pending claims ────────────────────────────────────────────────── */}
      {hasPendingClaims && submittedList.length > 0 && (
        <PendingClaimsWindow bountyIds={[...submittedList]} profileAddr={address} />
      )}

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex gap-0 border-[3px] border-[#111] rounded-t-lg overflow-hidden w-fit">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="px-3 py-2 font-mono-bold text-[10px] uppercase tracking-widest text-[#111] border-r-[3px] border-[#111] last:border-r-0 transition-colors"
              style={{ backgroundColor: tab === t.id ? t.color : '#FFFDF0' }}
            >{t.label}</button>
          ))}
        </div>
        <div className="border-[3px] border-t-0 border-[#111] rounded-b-lg rounded-tr-lg p-4 bg-[#FFFDF0]">
          {tab === 'participating' && (
            <BountyList ids={participatingIds as bigint[]} profileAddr={address} onSelect={onSelectBounty} emptyMsg="No active submissions yet." tabMode="participating" />
          )}
          {tab === 'past' && (
            <BountyList ids={pastIds as bigint[]} profileAddr={address} onSelect={onSelectBounty} emptyMsg="No past bounties yet." tabMode="past" />
          )}
          {tab === 'posted' && (
            <BountyList ids={postedList as bigint[]} profileAddr={address} onSelect={onSelectBounty} emptyMsg="No bounties posted yet." tabMode="posted" />
          )}
        </div>
      </div>

      {showSend && <SendModal balance={balance} onClose={handleSendClose} />}
      {showReceive && <ReceiveModal address={address} onClose={() => setShowReceive(false)} />}
    </div>
  )
}

// ─── Bounty list ──────────────────────────────────────────────────────────────
function BountyList({ ids, profileAddr, onSelect, emptyMsg, tabMode }: {
  ids: bigint[]
  profileAddr: `0x${string}`
  onSelect: (id: bigint) => void
  emptyMsg: string
  tabMode: 'participating' | 'past' | 'posted'
}) {
  if (ids.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3" style={{
        backgroundImage: 'repeating-conic-gradient(#7FF3F0 0% 25%, #1FB5A5 0% 50%)',
        backgroundSize: '16px 16px',
        borderRadius: '8px',
      }}>
        <span className="font-mono-bold text-[12px] uppercase tracking-widest text-[#111] bg-[#FFFDF0] border-[2px] border-[#111] px-3 py-1.5 rounded-lg">{emptyMsg}</span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {ids.map(id => (
        <BountyRow key={id.toString()} bountyId={id} profileAddr={profileAddr} onSelect={onSelect} tabMode={tabMode} />
      ))}
    </div>
  )
}

// ─── Pending claims window ────────────────────────────────────────────────────
function PendingClaimsWindow({ bountyIds, profileAddr }: { bountyIds: bigint[]; profileAddr: `0x${string}` }) {
  return (
    <WindowCard title="PENDING_CLAIMS.EXE" titleBarColor="#FFE600" bodyClassName="flex flex-col gap-3">
      <p className="font-mono-bold text-[11px] uppercase tracking-widest text-[#111]/60">You have unclaimed rewards</p>
      {bountyIds.map(id => (
        <PendingClaimRow key={id.toString()} bountyId={id} profileAddr={profileAddr} />
      ))}
    </WindowCard>
  )
}

function PendingClaimRow({ bountyId, profileAddr }: { bountyId: bigint; profileAddr: `0x${string}` }) {
  const { chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const isWrongChain = chainId !== CHAIN_ID

  const { data: myStatusRaw } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'getMyStatus',
    args: [bountyId, profileAddr], chainId: CHAIN_ID,
  }) as { data: number | undefined }

  const { data: bounty } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'getBounty',
    args: [bountyId], chainId: CHAIN_ID,
  }) as { data: { title: `0x${string}`; rewardPerWinner: bigint } | undefined }

  const { writeContract: claim, data: claimHash, isPending: claiming, error: claimErr, isSuccess: claimSuccess } = useWriteContract()
  const { isLoading: claimConfirming, isSuccess: claimConfirmed } = useWaitForTransactionReceipt({ hash: claimHash })

  if (myStatusRaw !== MY_STATUS_WINNER_PENDING || !bounty) return null

  return (
    <div className="border-[2px] border-[#111] rounded-lg p-3 bg-[#FFE600]/20 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-mono-bold text-[12px] text-[#111]">{decodeBytes(bounty.title) || `Bounty #${bountyId}`}</span>
        <span className="font-heading text-[16px] font-extrabold text-[#111]">{formatUsdc(bounty.rewardPerWinner)} USDC</span>
      </div>
      {!claimConfirmed && (
        <button
          onClick={() => { if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }; claim({ address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'claim', args: [bountyId], chainId: CHAIN_ID }) }}
          disabled={claiming || claimConfirming}
          className="font-mono-bold text-[12px] uppercase tracking-widest bg-[#FFE600] border-[3px] border-[#111] rounded-full px-4 py-2.5 shadow-hard-sm btn-press disabled:opacity-40 w-full"
        >
          {isWrongChain ? 'Switch chain' : claiming ? 'Confirm...' : claimConfirming ? 'Confirming...' : `Claim ${formatUsdc(bounty.rewardPerWinner)} USDC →`}
        </button>
      )}
      <TxStatus hash={claimHash} isPending={claiming} isConfirming={claimConfirming} isSuccess={claimSuccess} isError={!!claimErr} error={claimErr ? parseOnchainError(claimErr) : undefined} successMessage="Claimed!" />
    </div>
  )
}
