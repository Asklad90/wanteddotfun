/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected, walletConnect } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string

export const config = createConfig({
  chains: [arcTestnet, mainnet],
  connectors: [
    injected(),
    walletConnect({ projectId, showQrModal: false }),
  ],
  transports: {
    [arcTestnet.id]: http(),
    [mainnet.id]: http(),
  },
})
