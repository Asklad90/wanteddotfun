import { ConnectKitButton } from 'connectkit'
import { WalletIcon } from './Icons'

interface ConnectButtonProps {
  onProfileClick?: () => void
}

export function ConnectButton({ onProfileClick }: ConnectButtonProps) {
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, show, address }) => (
        <div className="flex items-center gap-2">
          {isConnected && onProfileClick && (
            <button
              onClick={onProfileClick}
              className="sm:hidden font-mono-bold text-[10px] uppercase tracking-widest text-[#FFFDF0]/70 border-[2px] border-[#FFFDF0]/30 rounded-full px-2 py-1"
            >
              Profile
            </button>
          )}
          <button
            onClick={show}
            className="inline-flex flex-col items-center gap-1 rounded-full border-[3px] border-[#111] shadow-hard-sm btn-press
                       bg-[#FFE600] px-4 py-2 font-mono-bold uppercase tracking-widest text-[#111] cursor-pointer"
          >
            <span className="text-[11px] leading-none">
              {isConnected && address
                ? `${address.slice(0, 6)}...${address.slice(-4)}`
                : 'CONNECT WALLET'}
            </span>
            <WalletIcon size={18} />
          </button>
        </div>
      )}
    </ConnectKitButton.Custom>
  )
}
