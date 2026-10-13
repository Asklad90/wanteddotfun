import { getTxUrl } from '../bounty-config'

interface TxStatusProps {
  hash?: `0x${string}`
  isPending: boolean
  isConfirming: boolean
  isSuccess: boolean
  isError: boolean
  error?: string
  successMessage?: string
}

export function TxStatus({
  hash,
  isPending,
  isConfirming,
  isSuccess,
  isError,
  error,
  successMessage = 'Transaction confirmed!',
}: TxStatusProps) {
  if (!isPending && !isConfirming && !isSuccess && !isError) return null

  if (isPending) {
    return (
      <div className="border-[3px] border-[#111] rounded-lg p-3 bg-[#FFE600] shadow-hard-sm">
        <div className="font-mono-bold text-[11px] uppercase tracking-widest mb-2">TX PENDING.EXE</div>
        <div className="h-3 w-full border-2 border-[#111] rounded-sm bg-[#FFFDF0] overflow-hidden">
          <div className="h-full bg-[#111] animate-[pulse_1s_ease-in-out_infinite] w-1/2" />
        </div>
        <div className="font-mono-ui text-[11px] mt-1.5 text-[#111]">Waiting for wallet confirmation...</div>
      </div>
    )
  }

  if (isConfirming) {
    return (
      <div className="border-[3px] border-[#111] rounded-lg p-3 bg-[#7FF3F0] shadow-hard-sm">
        <div className="font-mono-bold text-[11px] uppercase tracking-widest mb-2">BROADCASTING.EXE</div>
        <div className="h-3 w-full border-2 border-[#111] rounded-sm bg-[#FFFDF0] overflow-hidden">
          <div className="h-full bg-[#1FB5A5] w-3/4 transition-all duration-1000" />
        </div>
        <div className="font-mono-ui text-[11px] mt-1.5 text-[#111]">Waiting for block confirmation...</div>
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div className="border-[3px] border-[#111] rounded-lg p-3 bg-[#C6F23A] shadow-hard-sm">
        <div className="font-mono-bold text-[11px] uppercase tracking-widest mb-1">SUCCESS.EXE</div>
        <div className="font-mono-ui text-[11px] text-[#111]">{successMessage}</div>
        {hash && (
          <a
            href={getTxUrl(hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono-ui text-[11px] text-[#1A1AE6] underline hover:no-underline mt-1 block"
          >
            View on explorer →
          </a>
        )}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="border-[3px] border-[#111] rounded-lg p-3 bg-[#FF6B57] shadow-hard-sm">
        <div className="font-mono-bold text-[11px] uppercase tracking-widest mb-1">ERROR.EXE</div>
        <div className="font-mono-ui text-[11px] text-[#111]">{error ?? 'Transaction failed.'}</div>
      </div>
    )
  }

  return null
}
