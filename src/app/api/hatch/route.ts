// src/app/api/hatch/route.ts
import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodePacked,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// === ENV ===
const RPC_URL = process.env.RPC_URL;
const BETTA_CONTRACT_ADDRESS = process.env
  .NEXT_PUBLIC_BETTA_CONTRACT as `0x${string}` | undefined;

// signer khusus backend (bisa pakai TRUSTED_SIGNER_PRIVATE_KEY atau PRIVATE_KEY)
const TRUSTED_SIGNER_PRIVATE_KEY = (process.env
  .TRUSTED_SIGNER_PRIVATE_KEY ||
  process.env.PRIVATE_KEY) as `0x${string}` | undefined;

if (!RPC_URL) {
  console.warn("[HATCH] Missing RPC_URL in env");
}
if (!BETTA_CONTRACT_ADDRESS) {
  console.warn("[HATCH] Missing NEXT_PUBLIC_BETTA_CONTRACT in env");
}
if (!TRUSTED_SIGNER_PRIVATE_KEY) {
  console.warn("[HATCH] Missing TRUSTED_SIGNER_PRIVATE_KEY / PRIVATE_KEY in env");
}

const account = TRUSTED_SIGNER_PRIVATE_KEY
  ? privateKeyToAccount(TRUSTED_SIGNER_PRIVATE_KEY)
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

// Minimal ABI (hanya yang dipakai di sini)
const BETTA_HATCHERY_ABI = [
  {
    inputs: [],
    name: "mintPrice",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// POST /api/hatch
export async function POST(req: Request) {
  try {
    if (!publicClient || !walletClient || !account) {
      return NextResponse.json(
        {
          ok: false,
          error: "SERVER_NOT_CONFIGURED",
          debug: {
            hasRpcUrl: !!RPC_URL,
            hasSignerKey: !!TRUSTED_SIGNER_PRIVATE_KEY,
            hasContractAddress: !!BETTA_CONTRACT_ADDRESS,
          },
        },
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
    const fidRaw = body?.fid;
    const addressRaw = body?.address as string | undefined;

    if (fidRaw === undefined || fidRaw === null) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FID" },
        { status: 400 }
      );
    }

    if (!addressRaw || typeof addressRaw !== "string") {
      return NextResponse.json(
        { ok: false, error: "MISSING_WALLET_ADDRESS" },
        { status: 400 }
      );
    }

    if (!addressRaw.startsWith("0x") || addressRaw.length !== 42) {
      return NextResponse.json(
        { ok: false, error: "INVALID_WALLET_ADDRESS" },
        { status: 400 }
      );
    }

    const fid = BigInt(fidRaw);
    const userAddress = addressRaw as `0x${string}`;

    // 1) Baca mintPrice dari kontrak
    const mintPrice = (await publicClient.readContract({
      address: BETTA_CONTRACT_ADDRESS,
      abi: BETTA_HATCHERY_ABI,
      functionName: "mintPrice",
    })) as bigint;

    // 2) Buat messageHash = keccak256(abi.encodePacked(address(this), user, fid))
    const messageHash = keccak256(
      encodePacked(
        ["address", "address", "uint256"],
        [BETTA_CONTRACT_ADDRESS, userAddress, fid]
      )
    );

    // 3) Sign messageHash dengan trusted signer (EIP-191)
    const signature = await walletClient.signMessage({
      account,
      message: { raw: messageHash },
    });

    return NextResponse.json(
      {
        ok: true,
        fid: fid.toString(),
        mintPrice: mintPrice.toString(),
        signature,
      },
      { status: 200 }
    );
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

// Optional health check
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Hatch signer route is running",
    debug: {
      hasRpcUrl: !!RPC_URL,
      hasSignerKey: !!TRUSTED_SIGNER_PRIVATE_KEY,
      hasContractAddress: !!BETTA_CONTRACT_ADDRESS,
    },
  });
}
