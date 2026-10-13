/** Pixel-style flat inline SVG icons */

interface IconProps { size?: number; className?: string }

export function FolderIcon({ size = 20, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
      {/* tab */}
      <path d="M2 6h5l1.5 1.5H18V16H2V6z" fill="#60A5FA" stroke="#111" strokeWidth="1.5" strokeLinejoin="round"/>
      {/* subtle shine line */}
      <path d="M3 9h14" stroke="#fff" strokeWidth="1" strokeOpacity="0.4"/>
    </svg>
  )
}

export function CoinIcon({ size = 20, className = '' }: IconProps) {
  // USDC logo: blue circle, white "USDC" ring mark, white $ centre
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
      <circle cx="10" cy="10" r="9" fill="#2775CA"/>
      <circle cx="10" cy="10" r="9" stroke="#111" strokeWidth="1.2"/>
      {/* outer ring tick marks (simplified) */}
      <circle cx="10" cy="10" r="6.5" fill="#2775CA" stroke="white" strokeWidth="1"/>
      {/* $ symbol */}
      <text x="10" y="14.2" textAnchor="middle" fontSize="8.5" fill="white" fontWeight="900" fontFamily="Arial,sans-serif">$</text>
    </svg>
  )
}

export function LockIcon({ size = 20, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
      <rect x="4" y="9" width="12" height="9" rx="2" fill="currentColor" stroke="#111" strokeWidth="1.5"/>
      <path d="M7 9V6a3 3 0 016 0v3" stroke="#111" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="10" cy="14" r="1.5" fill="#111"/>
    </svg>
  )
}

export function TrophyIcon({ size = 20, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
      {/* cup body — gold */}
      <path d="M5 3h10v7a5 5 0 01-10 0V3z" fill="#F59E0B" stroke="#111" strokeWidth="1.5"/>
      {/* shine on cup */}
      <path d="M7 5h2" stroke="#FDE68A" strokeWidth="1.2" strokeLinecap="round"/>
      {/* handles */}
      <path d="M3 4H5M17 4h-2" stroke="#111" strokeWidth="1.5" strokeLinecap="round"/>
      {/* stem + base */}
      <path d="M10 15v2M7 18h6" stroke="#111" strokeWidth="1.5" strokeLinecap="round"/>
      {/* base plate — gold */}
      <rect x="7" y="17" width="6" height="1.5" rx="0.5" fill="#F59E0B" stroke="#111" strokeWidth="1"/>
    </svg>
  )
}

export function ClockIcon({ size = 20, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
      <circle cx="10" cy="10" r="8" fill="currentColor" stroke="#111" strokeWidth="1.5"/>
      <path d="M10 6v4l3 2" stroke="#111" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function WalletIcon({ size = 20, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
      <rect x="2" y="5" width="16" height="12" rx="2" fill="#C6F23A" stroke="#111" strokeWidth="1.5"/>
      <path d="M2 9h16" stroke="#111" strokeWidth="1.5"/>
      <rect x="12" y="11" width="4" height="4" rx="1" fill="#111"/>
    </svg>
  )
}

export function ArrowRightIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
