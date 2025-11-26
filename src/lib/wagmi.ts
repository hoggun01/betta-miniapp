"use client";

import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";

export const wagmiConfig = createConfig({
  chains: [base],

  // No connectors because MiniApp uses Farcaster Wallet
  connectors: [],

  // Correct transport for Wagmi 1.x
  transport: {
    [base.id]: http(process.env.NEXT_PUBLIC_RPC_URL!),
  },

  ssr: true,
});
