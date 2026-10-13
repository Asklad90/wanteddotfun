/**
 * SubmissionViewer — renders offchain submission content
 * Detects URLs, images, YouTube embeds, and plain text.
 */
import { useState } from 'react'
import type { OffchainSubmission } from '../lib/submissions-api'
import { formatAddress } from '../lib/utils'
import { PillButton } from './PillButton'

// ── Media detection ──────────────────────────────────────────────────────────

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|avif)(\?.*)?$/i
const VIDEO_EXT = /\.(mp4|webm|ogg|mov)(\?.*)?$/i
const YT_REGEX = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/

function extractUrls(text: string): string[] {
  try {
    return [...text.matchAll(/https?:\/\/[^\s<>"']+/g)].map(m => m[0])
  } catch {
    return []
  }
}

function isImageUrl(url: string) { return IMAGE_EXT.test(url) }
function isVideoUrl(url: string) { return VIDEO_EXT.test(url) }
function ytId(url: string) { return url.match(YT_REGEX)?.[1] ?? null }

// ── Render helpers ───────────────────────────────────────────────────────────

function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g)
  return (
    <p className="font-body text-[14px] leading-relaxed text-[#111]/85 whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer"
              className="text-[#1A1AE6] underline underline-offset-2 break-all hover:text-[#FF3E9A]">
              {part}
            </a>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </p>
  )
}

function MediaEmbeds({ text }: { text: string }) {
  const urls = extractUrls(text)
  if (urls.length === 0) return null

  const embeds: React.ReactNode[] = []

  for (const url of urls) {
    const vid = ytId(url)
    if (vid) {
      embeds.push(
        <div key={url} className="border-[3px] border-[#111] rounded-lg overflow-hidden aspect-video">
          <iframe
            src={`https://www.youtube.com/embed/${vid}`}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title="YouTube embed"
          />
        </div>
      )
    } else if (isImageUrl(url)) {
      embeds.push(
        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt="submission image"
            className="border-[3px] border-[#111] rounded-lg max-h-64 object-contain bg-white w-full"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </a>
      )
    } else if (isVideoUrl(url)) {
      embeds.push(
        <video key={url} controls
          className="border-[3px] border-[#111] rounded-lg max-h-64 w-full bg-black">
          <source src={url} />
        </video>
      )
    }
  }

  if (embeds.length === 0) return null
  return <div className="flex flex-col gap-3">{embeds}</div>
}

// ── Main component ───────────────────────────────────────────────────────────

interface SubmissionViewerProps {
  sub: OffchainSubmission
  bountyId: bigint
  isPoster: boolean
  rewardPerWinner: bigint
  canApprove: boolean
  onApprove: (submitter: string) => void
  approveLoading: boolean
  approveSuccess: boolean
  approveError?: string
  winnerStatus: number | undefined  // 0=none, 1=pending, 2=paid
}

const PAYOUT_PENDING = 1
const PAYOUT_PAID = 2

export function SubmissionViewer({
  sub, isPoster, rewardPerWinner, canApprove,
  onApprove, approveLoading, approveSuccess, approveError, winnerStatus,
}: SubmissionViewerProps) {
  const [expanded, setExpanded] = useState(false)
  const isWinner = winnerStatus !== undefined && winnerStatus > 0
  const isPending = winnerStatus === PAYOUT_PENDING
  const isPaid = winnerStatus === PAYOUT_PAID
  const { formatUsdc } = useFormatUsdc()

  return (
    <div className={`border-[3px] border-[#111] rounded-lg overflow-hidden ${isWinner ? 'bg-[#C6F23A]/15' : 'bg-white'}`}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 flex-wrap border-b-[2px] border-[#111]/10">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono-bold text-[10px] uppercase tracking-wider text-[#111]">
            {formatAddress(sub.submitter)}
          </span>
          {isPaid && (
            <span className="font-mono-bold text-[10px] uppercase bg-[#C6F23A] border-[2px] border-[#111] px-2 py-0.5 rounded-full">
              PAID {formatUsdc(rewardPerWinner)} USDC
            </span>
          )}
          {isPending && (
            <span className="font-mono-bold text-[10px] uppercase bg-[#FFE600] border-[2px] border-[#111] px-2 py-0.5 rounded-full">
              PAYOUT PENDING
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isPoster && !isWinner && canApprove && !approveSuccess && (
            <PillButton size="sm" variant="lime" onClick={() => onApprove(sub.submitter)} loading={approveLoading} showArrow={false}>
              Approve &amp; pay →
            </PillButton>
          )}
          <button
            onClick={() => setExpanded(v => !v)}
            className="font-mono-bold text-[10px] uppercase tracking-wider border-[2px] border-[#111] px-2 py-1 rounded-full hover:bg-[#FFE600] transition-colors"
          >
            {expanded ? 'Collapse ▲' : 'View work ▼'}
          </button>
        </div>
      </div>

      {/* Expandable body */}
      {expanded && (
        <div className="p-3 flex flex-col gap-3">
          <RichText text={sub.content} />
          <MediaEmbeds text={sub.content} />
          {approveError && (
            <div className="font-mono-bold text-[11px] text-[#FF6B57] border-[2px] border-[#FF6B57] rounded-lg px-3 py-2">
              {approveError}
            </div>
          )}
          {approveSuccess && (
            <div className="font-mono-bold text-[11px] text-[#111] bg-[#C6F23A] border-[2px] border-[#111] rounded-lg px-3 py-2">
              Winner approved &amp; paid!
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// tiny local hook so we don't import formatUsdc at module level
function useFormatUsdc() {
  return { formatUsdc: (v: bigint) => (Number(v) / 1e6).toFixed(2) }
}
