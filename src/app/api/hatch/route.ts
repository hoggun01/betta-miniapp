// src/app/api/hatch/route.ts
import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Minimal ABI for BettaHatcheryV2
const BETTA_HATCHERY_ABI = [
  {
    inputs: [
      { internalType: "uint256", name: "fid", type: "uint256" },
      { internalType: "bytes", name: "signature", type: "bytes" },
    ],
    name: "mint",
    outputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "mintPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Environment variables
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const BETTA_CONTRACT_ADDRESS = process.env
  .NEXT_PUBLIC_BETTA_CONTRACT as `0x${string}` | undefined;

if (!RPC_URL) {
  console.warn("[HATCH] Missing RPC_URL in env");
}
if (!PRIVATE_KEY) {
  console.warn("[HATCH] Missing PRIVATE_KEY in env");
}
if (!BETTA_CONTRACT_ADDRESS) {
  console.warn("[HATCH] Missing NEXT_PUBLIC_BETTA_CONTRACT in env");
}

const account = PRIVATE_KEY
  ? privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
  : undefined;

const publicClient = RPC_URL
  ? createPublicClient({
      chain: base,
      transport: http(RPC_URL),
    })
  : null;

const walletClient =
  RPC_URL && account
    ? createWalletClient({
        chain: base,
        transport: http(RPC_URL),
        account,
      })
    : null;

// POST /api/hatch
export async function POST(req: Request) {
  try {
    // Basic server config checks
    if (!publicClient || !walletClient || !account || !BETTA_CONTRACT_ADDRESS) {
      return NextResponse.json(
        {
          ok: false,
          code: "SERVER_NOT_CONFIGURED",
          error: "Hatch server is not fully configured.",
          debug: {
            hasRpcUrl: !!RPC_URL,
            hasPrivateKey: !!PRIVATE_KEY,
            hasContractAddress: !!BETTA_CONTRACT_ADDRESS,
            hasAccount: !!account,
            hasPublicClient: !!publicClient,
            hasWalletClient: !!walletClient,
          },
        },
        { status: 200 }
      );
    }

    const body = await req.json().catch(() => ({} as any));

    // Expect fid and signature from client for now
    const fidRaw = body?.fid;
    const signatureRaw = body?.signature;

    if (fidRaw === undefined || fidRaw === null) {
      return NextResponse.json(
        { ok: false, code: "MISSING_FID", error: "Missing fid in request body." },
        { status: 200 }
      );
    }

    if (!signatureRaw || typeof signatureRaw !== "string") {
      return NextResponse.json(
        {
          ok: false,
          code: "MISSING_SIGNATURE",
          error: "Missing signature in request body.",
        },
        { status: 200 }
      );
    }

    const fid = BigInt(fidRaw);
    const signature = signatureRaw as `0x${string}`;

    // Read mintPrice from contract
    const mintPrice = (await publicClient.readContract({
      address: BETTA_CONTRACT_ADDRESS,
      abi: BETTA_HATCHERY_ABI,
      functionName: "mintPrice",
    })) as bigint;

    // Simulate transaction
    const { request } = await publicClient.simulateContract({
      address: BETTA_CONTRACT_ADDRESS,
      abi: BETTA_HATCHERY_ABI,
      functionName: "mint",
      args: [fid, signature],
      account,
      value: mintPrice,
    });

    // Send real transaction
    const hash = await walletClient.writeContract(request);

    return NextResponse.json(
      {
        ok: true,
        tx: hash,
        fid: fid.toString(),
        value: mintPrice.toString(),
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("HATCH_ROUTE_ERROR", error);

    const msg: string =
      error?.shortMessage ||
      error?.message ||
      error?.cause?.shortMessage ||
      "HATCH_ROUTE_ERROR";

    // Friendly handling for "wallet already minted" revert
    if (msg.includes("Wallet already minted")) {
      return NextResponse.json(
        {
          ok: false,
          code: "WALLET_ALREADY_MINTED",
          error: "Wallet already minted",
        },
        { status: 200 }
      );
    }

    // Generic error for other cases
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL_ERROR",
        error: msg,
      },
      { status: 200 }
    );
  }
}

// Simple health check
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Hatch route is running (onchain, requires fid + signature)",
  });
}
