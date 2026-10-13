import React from 'react'

interface WindowCardProps {
  title: string
  titleBarColor?: string
  children: React.ReactNode
  className?: string
  onClose?: () => void
  bodyClassName?: string
}

export function WindowCard({
  title,
  titleBarColor = '#FF3E9A',
  children,
  className = '',
  onClose,
  bodyClassName = '',
}: WindowCardProps) {
  return (
    <div
      className={`rounded-lg border-[3px] border-[#111] shadow-hard animate-bounce-in bg-white ${className}`}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 py-2 rounded-t-[7px] border-b-[3px] border-[#111]"
        style={{ backgroundColor: titleBarColor }}
      >
        <span
          className="font-mono-bold text-[11px] uppercase tracking-widest text-[#111] truncate pr-2"
          style={{ letterSpacing: '0.1em' }}
        >
          {title}
        </span>
        <div className="flex gap-1.5 shrink-0">
          <button className="w-4 h-4 rounded-sm border-2 border-[#111] bg-white/60 hover:bg-white/90 text-[8px] flex items-center justify-center font-mono-bold">_</button>
          <button className="w-4 h-4 rounded-sm border-2 border-[#111] bg-white/60 hover:bg-white/90 text-[8px] flex items-center justify-center font-mono-bold">□</button>
          <button
            onClick={onClose}
            className="w-4 h-4 rounded-sm border-2 border-[#111] bg-white/60 hover:bg-[#FF6B57] text-[8px] flex items-center justify-center font-mono-bold"
          >
            ×
          </button>
        </div>
      </div>
      {/* Body */}
      <div className={`p-4 ${bodyClassName}`}>
        {children}
      </div>
    </div>
  )
}
