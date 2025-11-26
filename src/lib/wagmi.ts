// src/lib/wagmi.ts
import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// Use a public RPC URL for clients
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";

export const wagmiConfig = createConfig({
  chains: [base],
  ssr: true,
  connectors: [injected()],
  // NOTE: property name must be "transports" for wagmi v1
  transports: {
    [base.id]: http(rpcUrl),
  },
});
