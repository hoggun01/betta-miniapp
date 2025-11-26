// src/app/api/hatch/route.ts
import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
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
    if (!publicClient || !walletClient || !account) {
      return NextResponse.json(
        { ok: false, error: "SERVER_NOT_CONFIGURED" },
        { status: 500 }
      );
    }

    if (!BETTA_CONTRACT_ADDRESS) {
      return NextResponse.json(
        { ok: false, error: "MISSING_CONTRACT_ADDRESS" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({} as any));

    // Expect fid and signature from client for now
    const fidRaw = body?.fid;
    const signatureRaw = body?.signature;

    if (fidRaw === undefined || fidRaw === null) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FID" },
        { status: 400 }
      );
    }

    if (!signatureRaw || typeof signatureRaw !== "string") {
      return NextResponse.json(
        { ok: false, error: "MISSING_SIGNATURE" },
        { status: 400 }
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

    return NextResponse.json({
      ok: true,
      tx: hash,
      fid: fid.toString(),
      value: mintPrice.toString(),
    });
  } catch (error: any) {
    console.error("HATCH_ROUTE_ERROR", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.shortMessage || error?.message || "HATCH_ROUTE_ERROR",
      },
      { status: 500 }
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
