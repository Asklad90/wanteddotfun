import React from 'react'
import { ArrowRightIcon } from './Icons'

interface PillButtonProps {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'yellow' | 'pink' | 'lime' | 'ink' | 'cyan'
  showArrow?: boolean
  type?: 'button' | 'submit' | 'reset'
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const VARIANT_STYLES: Record<string, { bg: string; text: string }> = {
  yellow: { bg: '#FFE600', text: '#111111' },
  pink:   { bg: '#FF3E9A', text: '#111111' },
  lime:   { bg: '#C6F23A', text: '#111111' },
  ink:    { bg: '#111111', text: '#FFFDF0' },
  cyan:   { bg: '#7FF3F0', text: '#111111' },
}

const SIZE_STYLES = {
  sm: 'px-3 py-1.5 text-[11px]',
  md: 'px-5 py-2.5 text-[13px]',
  lg: 'px-7 py-3.5 text-[15px]',
}

export function PillButton({
  children,
  onClick,
  disabled = false,
  loading = false,
  variant = 'yellow',
  showArrow = true,
  type = 'button',
  className = '',
  size = 'md',
}: PillButtonProps) {
  const { bg, text } = VARIANT_STYLES[variant]
  const sizeClass = SIZE_STYLES[size]

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        inline-flex items-center gap-2 rounded-full border-[3px] border-[#111]
        font-mono-bold uppercase tracking-wider shadow-hard btn-press
        transition-opacity
        ${sizeClass}
        ${disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      style={{ backgroundColor: bg, color: text }}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          {children}
        </span>
      ) : (
        <>
          {children}
          {showArrow && <ArrowRightIcon size={14} />}
        </>
      )}
    </button>
  )
}
