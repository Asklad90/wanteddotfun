/**
 * Deterministic pixel-art block avatar generated from an Ethereum address.
 * Inline SVG only — no external images, no canvas.
 */

interface PixelAvatarProps {
  address: string
  size?: number
}

function hashAddress(addr: string): number[] {
  // Produce 32 pseudo-random bytes from the address hex chars
  const hex = addr.toLowerCase().replace('0x', '').padEnd(64, '0')
  const bytes: number[] = []
  for (let i = 0; i < 32; i++) {
    bytes.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0)
  }
  return bytes
}

const PALETTE = ['#FF3E9A', '#7FF3F0', '#C6F23A', '#FFE600', '#8B5CF6', '#FF6B57', '#1A1AE6', '#1FB5A5']

export function PixelAvatar({ address, size = 48 }: PixelAvatarProps) {
  const bytes = hashAddress(address)
  const GRID = 5 // 5×5 mirrored grid
  const cellSize = size / GRID

  // Pick 2 colours from address
  const bg = '#FFFDF0'
  const fg = PALETTE[bytes[0] % PALETTE.length]
  const accent = PALETTE[(bytes[1] + 3) % PALETTE.length]

  // Build mirrored 5×5 grid — only generate left 3 cols, mirror to right 2
  const cells: { x: number; y: number; color: string }[] = []
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < 3; col++) {
      const byteIdx = row * 3 + col
      const val = bytes[byteIdx % bytes.length]
      if (val > 100) {
        const color = val > 180 ? accent : fg
        // Left col
        cells.push({ x: col * cellSize, y: row * cellSize, color })
        // Mirror right col
        if (col < 2) {
          cells.push({ x: (GRID - 1 - col) * cellSize, y: row * cellSize, color })
        }
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block', imageRendering: 'pixelated' }}
    >
      <rect width={size} height={size} fill={bg} />
      {cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={cellSize} height={cellSize} fill={c.color} />
      ))}
    </svg>
  )
}
