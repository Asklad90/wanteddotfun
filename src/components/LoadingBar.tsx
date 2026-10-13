interface LoadingBarProps {
  current: number
  max: number
  label?: string
  color?: string
}

export function LoadingBar({
  current,
  max,
  label,
  color = '#FFE600',
}: LoadingBarProps) {
  const pct = max === 0 ? 0 : Math.min(100, (current / max) * 100)
  const segments = Array.from({ length: max }, (_, i) => i < current)

  return (
    <div>
      {label && (
        <div className="font-mono-bold text-[10px] uppercase tracking-widest text-[#111] mb-1" style={{ letterSpacing: '0.08em' }}>
          {label}
        </div>
      )}
      {max <= 10 ? (
        // Segmented bar for small counts
        <div className="flex gap-1">
          {segments.map((filled, i) => (
            <div
              key={i}
              className="h-4 flex-1 border-2 border-[#111] rounded-sm"
              style={{ backgroundColor: filled ? color : '#FFFDF0' }}
            />
          ))}
        </div>
      ) : (
        // Continuous bar for larger counts
        <div className="h-4 w-full border-2 border-[#111] rounded-sm bg-[#FFFDF0] overflow-hidden">
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
      )}
    </div>
  )
}
