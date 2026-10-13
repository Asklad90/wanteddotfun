import { useAccount, useReadContract } from 'wagmi'
import { BountyCard, BountyData } from './BountyCard'
import { WindowCard } from './WindowCard'
import { PillButton } from './PillButton'
import { TrophyIcon, FolderIcon } from './Icons'
import { BOUNTY_BOARD_ABI } from '../bounty-abi'
import { CHAIN_ID, CONTRACT_ADDRESS } from '../bounty-config'

interface MyBountiesProps {
  onSelectBounty: (id: bigint) => void
  onCreateBounty: () => void
}

function useBounty(id: bigint) {
  const { data } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'getBounty',
    args: [id], chainId: CHAIN_ID,
  })
  return data as BountyData | undefined
}

function BountyItem({ id, onSelect }: { id: bigint; onSelect: (id: bigint) => void }) {
  const bounty = useBounty(id)
  if (!bounty) return <div className="border-[3px] border-[#111] rounded-lg bg-[#FFFDF0] animate-pulse h-52" />
  return <BountyCard bounty={bounty} onClick={() => onSelect(id)} />
}

export function MyBounties({ onSelectBounty, onCreateBounty }: MyBountiesProps) {
  const { address } = useAccount()

  const { data: ids } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'getBountiesByPoster',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    chainId: CHAIN_ID, query: { enabled: !!address },
  }) as { data: bigint[] | undefined }

  if (!address) return (
    <WindowCard title="MY_BOUNTIES.EXE" titleBarColor="#FF3E9A">
      <div className="font-mono-bold text-[12px] uppercase tracking-widest text-[#111]/60 text-center py-8">Connect wallet to see your bounties</div>
    </WindowCard>
  )

  const list = ids ?? []

  if (list.length === 0) return (
    <WindowCard title="MY_BOUNTIES.EXE" titleBarColor="#FF3E9A">
      <div className="checkerboard rounded-lg py-12 flex flex-col items-center gap-4">
        <TrophyIcon size={40} />
        <div className="font-mono-bold text-[12px] uppercase tracking-widest text-[#111]/60">You haven't posted any bounties yet</div>
        <PillButton onClick={onCreateBounty} variant="yellow">Post a bounty →</PillButton>
      </div>
    </WindowCard>
  )

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-heading text-[18px] font-bold text-[#111]">My Bounties ({list.length})</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[...list].reverse().map(id => <BountyItem key={id.toString()} id={id} onSelect={onSelectBounty} />)}
      </div>
    </div>
  )
}

interface MySubmissionsProps {
  onSelectBounty: (id: bigint) => void
}

export function MySubmissions({ onSelectBounty }: MySubmissionsProps) {
  const { address } = useAccount()

  const { data: ids } = useReadContract({
    address: CONTRACT_ADDRESS, abi: BOUNTY_BOARD_ABI, functionName: 'getBountiesBySubmitter',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    chainId: CHAIN_ID, query: { enabled: !!address },
  }) as { data: bigint[] | undefined }

  if (!address) return (
    <WindowCard title="MY_SUBMISSIONS.EXE" titleBarColor="#A78BFA">
      <div className="font-mono-bold text-[12px] uppercase tracking-widest text-[#111]/60 text-center py-8">Connect wallet to see your submissions</div>
    </WindowCard>
  )

  const list = ids ?? []

  if (list.length === 0) return (
    <WindowCard title="MY_SUBMISSIONS.EXE" titleBarColor="#A78BFA">
      <div className="checkerboard rounded-lg py-12 flex flex-col items-center gap-4">
        <FolderIcon size={40} />
        <div className="font-mono-bold text-[12px] uppercase tracking-widest text-[#111]/60">No submissions yet</div>
      </div>
    </WindowCard>
  )

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-heading text-[18px] font-bold text-[#111]">My Submissions ({list.length})</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[...list].reverse().map(id => <BountyItem key={id.toString()} id={id} onSelect={onSelectBounty} />)}
      </div>
    </div>
  )
}
