import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectButton } from './components/ConnectButton'
import { WallPage } from './components/WallPage'
import { BountyPage } from './components/BountyPage'
import { CreateBountyForm } from './components/CreateBountyForm'
import { ProfilePage } from './components/ProfilePage'
import { CHAIN_NAME } from './bounty-config'

type View = 'wall' | 'bounty' | 'create' | 'profile'

export default function App() {
  const { address: connectedAddr } = useAccount()
  const [view, setView] = useState<View>('wall')
  const [activeBountyId, setActiveBountyId] = useState<bigint | null>(null)
  const [activeProfileAddr, setActiveProfileAddr] = useState<`0x${string}` | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  function openBounty(id: bigint) { setActiveBountyId(id); setView('bounty') }
  function openProfile(addr: `0x${string}`) { setActiveProfileAddr(addr); setView('profile') }
  function goBack() { setView('wall'); setActiveBountyId(null); setActiveProfileAddr(null) }
  function openCreate() { setView('create') }
  function onCreated() { setRefreshKey(k => k + 1); setView('wall')  }

  return (
    <div className="min-h-dvh flex flex-col">
      {/* ─── Header ───────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b-[3px] border-[#111] bg-[#111] px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          {/* Logo */}
          <button
            onClick={() => { setView('wall') }}
            className="flex items-center gap-1 select-none"
            aria-label="Wanted.fun home"
          >
            <span style={{
              display: 'inline-block',
              color: '#000000',
              backgroundColor: '#FF3E9A',
              border: '3px solid white',
              borderRadius: '8px',
              padding: '5px 10px',
              letterSpacing: '0.08em',
              lineHeight: 1,
              transform: 'rotate(-8deg)',
              boxShadow: '3px 3px 0 white, 5px 5px 0 #FF3E9A',
              fontFamily: '"Space Mono", monospace',
              fontWeight: 900,
              fontSize: '18px',
              textTransform: 'uppercase',
            }}>
              WANTED
            </span>
            <span style={{
              fontFamily: '"Fredoka One", "Space Grotesk", sans-serif',
              fontWeight: 400,
              fontSize: '34px',
              lineHeight: 1,
              color: '#A78BFA',
              WebkitTextStroke: '3px #111111',
              paintOrder: 'stroke fill',
              letterSpacing: '-0.01em',
              marginLeft: '4px',
              display: 'inline-block',
            }}>
              .fun
            </span>
          </button>

          {/* Right: chain label + my profile + connect */}
          <div className="flex items-center gap-2">
            <span className="font-mono-ui text-[10px] uppercase tracking-widest text-[#FFFDF0]/50 hidden sm:block">
              {CHAIN_NAME}
            </span>
            {connectedAddr && (
              <button
                onClick={() => openProfile(connectedAddr)}
                className="hidden sm:flex items-center gap-1.5 font-mono-bold text-[11px] uppercase tracking-widest bg-[#C6F23A] text-[#111] border-[2px] border-[#FFFDF0]/40 rounded-full px-3 py-1.5 hover:border-[#C6F23A] transition-colors shadow-hard-sm btn-press"
              >
                My Profile →
              </button>
            )}
            <ConnectButton onProfileClick={connectedAddr ? () => openProfile(connectedAddr) : undefined} />
          </div>
        </div>
      </header>

      {/* ─── Main ─────────────────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        {view === 'profile' && activeProfileAddr ? (
          <ProfilePage
            address={activeProfileAddr}
            onBack={goBack}
            onSelectBounty={openBounty}
          />
        ) : view === 'bounty' && activeBountyId !== null ? (
          <BountyPage
            bountyId={activeBountyId}
            onBack={goBack}
            onDataChange={() => setRefreshKey(k => k + 1)}
          />
        ) : view === 'create' ? (
          <div className="max-w-lg mx-auto">
            <CreateBountyForm onClose={() => setView('wall')} onSuccess={onCreated} />
          </div>
        ) : (
          <WallPage onSelectBounty={openBounty} onCreateBounty={openCreate} refreshKey={refreshKey} />
        )}
      </main>

      {/* ─── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t-[3px] border-[#111] bg-[#111] px-4 py-4 mt-auto">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <span className="font-mono-ui text-[11px] text-[#FFFDF0]/50 uppercase tracking-wider">
            Text posted onchain is permanent and public. Review before submitting.
          </span>
          <span className="font-mono-ui text-[11px] text-[#FFFDF0]/30">
            Wanted.fun · {CHAIN_NAME} · USDC
          </span>
        </div>
      </footer>
    </div>
  )
}
