import { NextResponse } from "next/server";
import { getFarcasterSession } from "@/lib/minikit";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodePacked,
  hexToBytes,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Fixed contract address (BettaHatcheryV2 on Base mainnet)
const BETTA_CONTRACT_ADDRESS =
  "0x48a8443f006729729439f9bc529f905c05380bb7" as const;

// Environment variables (supports both server-only and NEXT_PUBLIC names)
const BASE_RPC_URL =
  process.env.BASE_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;

const BETTA_TRUSTED_SIGNER_PRIVATE_KEY = (process.env
  .BETTA_TRUSTED_SIGNER_PRIVATE_KEY ??
  process.env.SIGNER_PRIVATE_KEY) as `0x${string}` | undefined;

// Dev-only fallback vars (for testing without Farcaster MiniKit)
const DEV_FID = process.env.DEV_FID;
const DEV_WALLET = process.env.DEV_WALLET as `0x${string}` | undefined;

// Minimal ABI for reading + building mint tx
const BETTA_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [
      { name: "fid", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "mintPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "hasMinted",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "usedFid",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function generateFakeHash() {
  return (
    "0x" +
    [...Array(64)]
      .map(() => Math.floor(Math.random() * 16).toString(16))
      .join("")
  );
}

export async function POST() {
  try {
    if (!BASE_RPC_URL || !BETTA_TRUSTED_SIGNER_PRIVATE_KEY) {
      return NextResponse.json(
        {
          ok: false,
          error: "SERVER_NOT_CONFIGURED",
          details:
            "Missing BASE_RPC_URL/NEXT_PUBLIC_RPC_URL or BETTA_TRUSTED_SIGNER_PRIVATE_KEY/SIGNER_PRIVATE_KEY env vars",
        },
        { status: 500 }
      );
    }

    // 1. Try to get Farcaster MiniKit session
    let session = await getFarcasterSession();

    // 2. Dev fallback: when no session and not in production,
    //    use DEV_FID and DEV_WALLET for local testing.
    if (!session && process.env.NODE_ENV !== "production") {
      if (!DEV_FID || !DEV_WALLET) {
        return NextResponse.json(
          {
            ok: false,
            error: "NOT_AUTHENTICATED",
            details:
              "No Farcaster session and missing DEV_FID/DEV_WALLET for dev fallback",
          },
          { status: 401 }
        );
      }

      session = {
        // minimal fake session structure
        fid: Number(DEV_FID),
        walletAddress: DEV_WALLET,
      } as any;
    }

    // 3. If still no session (real prod usage without MiniKit), block
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED" },
        { status: 401 }
      );
    }

    // 4. Extract FID and wallet address from session (real or dev-fallback)
    const anySession = session as any;

    const fidRaw: number | string | undefined =
      anySession.fid ??
      anySession.user?.fid ??
      anySession.user?.id ??
      anySession.profile?.fid;

    const userAddress: string | undefined =
      anySession.walletAddress ??
      anySession.address ??
      anySession.connectedAddress ??
      anySession.verifiedAddresses?.ethAddresses?.[0];

    if (!fidRaw || !userAddress) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_FID_OR_WALLET",
        },
        { status: 400 }
      );
    }

    const fid = BigInt(fidRaw);

    // 5. Read on-chain state (mintPrice, hasMinted, usedFid) from Base
    const publicClient = createPublicClient({
      chain: base,
      transport: http(BASE_RPC_URL),
    });

    const [walletAlreadyMinted, fidAlreadyUsed, mintPrice] = await Promise.all([
      publicClient.readContract({
        address: BETTA_CONTRACT_ADDRESS,
        abi: BETTA_ABI,
        functionName: "hasMinted",
        args: [userAddress as `0x${string}`],
      }) as Promise<boolean>,
      publicClient.readContract({
        address: BETTA_CONTRACT_ADDRESS,
        abi: BETTA_ABI,
        functionName: "usedFid",
        args: [fid],
      }) as Promise<boolean>,
      publicClient.readContract({
        address: BETTA_CONTRACT_ADDRESS,
        abi: BETTA_ABI,
        functionName: "mintPrice",
      }) as Promise<bigint>,
    ]);

    if (walletAlreadyMinted) {
      return NextResponse.json(
        {
          ok: false,
          error: "WALLET_ALREADY_MINTED",
        },
        { status: 400 }
      );
    }

    if (fidAlreadyUsed) {
      return NextResponse.json(
        {
          ok: false,
          error: "FID_ALREADY_USED",
        },
        { status: 400 }
      );
    }

    // 6. Build the same message hash as in the contract:
    //    bytes32 messageHash = keccak256(
    //        abi.encodePacked(address(this), msg.sender, fid)
    //    );
    const messageHash = keccak256(
      encodePacked(
        ["address", "address", "uint256"],
        [
          BETTA_CONTRACT_ADDRESS,
          userAddress as `0x${string}`,
          fid,
        ]
      )
    );

    // 7. Sign with the trusted signer private key.
    // Contract will call ECDSA.toEthSignedMessageHash(messageHash)
    // so here we sign the raw 32-byte hash using the standard
    // Ethereum Signed Message prefix (EIP-191).
    const signerAccount = privateKeyToAccount(BETTA_TRUSTED_SIGNER_PRIVATE_KEY);

    const signerClient = createWalletClient({
      account: signerAccount,
      chain: base,
      transport: http(BASE_RPC_URL),
    });

    const signature = await signerClient.signMessage({
      account: signerAccount,
      message: { raw: hexToBytes(messageHash) },
    });

    // 8. Prebuild calldata for mint(fid, signature)
    const calldata = encodeFunctionData({
      abi: BETTA_ABI,
      functionName: "mint",
      args: [fid, signature as `0x${string}`],
    });

    // 9. Return data the miniapp can use to:
    //    - Display UI (your current globals.css + page.tsx)
    //    - Build an onchain transaction from the user's Farcaster wallet
    const fakeHash = generateFakeHash();

    return NextResponse.json({
      ok: true,
      fid: fid.toString(),
      recipient: userAddress,
      contract: BETTA_CONTRACT_ADDRESS,
      chainId: base.id,
      mintPrice: mintPrice.toString(),
      signature,
      txRequest: {
        to: BETTA_CONTRACT_ADDRESS,
        data: calldata,
        value: mintPrice.toString(),
        chainId: base.id,
      },
      tx: {
        hash: fakeHash,
      },
    });
  } catch (error) {
    console.error("HATCH_ROUTE_ERROR", error);

    return NextResponse.json(
      {
        ok: false,
        error: "HATCH_ROUTE_ERROR",
      },
      { status: 500 }
    );
  }
}
