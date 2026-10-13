type Status = 'OPEN' | 'FULL' | 'EXPIRED' | 'CANCELLED'

const STATUS_STYLES: Record<Status, { bg: string; label: string }> = {
  OPEN:      { bg: '#C6F23A', label: 'OPEN' },
  FULL:      { bg: '#FF3E9A', label: 'FULL' },
  EXPIRED:   { bg: '#CCCCCC', label: 'EXPIRED' },
  CANCELLED: { bg: '#FFE600', label: 'CANCELLED' },
}

export function StatusTag({ status }: { status: Status }) {
  const { bg, label } = STATUS_STYLES[status]
  return (
    <span
      className="font-mono-bold text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border-2 border-[#111]"
      style={{ backgroundColor: bg }}
    >
      {label}
    </span>
  )
}
