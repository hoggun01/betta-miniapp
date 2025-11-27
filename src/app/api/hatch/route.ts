// src/app/api/hatch/route.ts
import { NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  encodePacked,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// ABI includes mintPrice + usedFid
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
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "usedFid",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Env
const RPC_URL = process.env.RPC_URL;
const BETTA_CONTRACT_ADDRESS = process.env
  .NEXT_PUBLIC_BETTA_CONTRACT as `0x${string}` | undefined;
const TRUSTED_SIGNER_PRIVATE_KEY = process.env
  .TRUSTED_SIGNER_PRIVATE_KEY as `0x${string}` | undefined;

if (!RPC_URL) {
  console.warn("[HATCH] Missing RPC_URL in env");
}
if (!BETTA_CONTRACT_ADDRESS) {
  console.warn("[HATCH] Missing NEXT_PUBLIC_BETTA_CONTRACT in env");
}
if (!TRUSTED_SIGNER_PRIVATE_KEY) {
  console.warn("[HATCH] Missing TRUSTED_SIGNER_PRIVATE_KEY in env");
}

// Clients
const publicClient = RPC_URL
  ? createPublicClient({
      chain: base,
      transport: http(RPC_URL),
    })
  : null;

const signerAccount = TRUSTED_SIGNER_PRIVATE_KEY
  ? privateKeyToAccount(TRUSTED_SIGNER_PRIVATE_KEY)
  : undefined;

// POST /api/hatch -> returns signature + mintPrice
export async function POST(req: Request) {
  try {
    if (!publicClient || !signerAccount || !BETTA_CONTRACT_ADDRESS) {
      return NextResponse.json(
        {
          ok: false,
          error: "SERVER_NOT_CONFIGURED",
          debug: {
            hasRpcUrl: !!RPC_URL,
            hasContractAddress: !!BETTA_CONTRACT_ADDRESS,
            hasTrustedKey: !!TRUSTED_SIGNER_PRIVATE_KEY,
          },
        },
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
        { ok: false, error: "MISSING_ADDRESS" },
        { status: 400 }
      );
    }

    if (!addressRaw.match(/^0x[0-9a-fA-F]{40}$/)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ADDRESS" },
        { status: 400 }
      );
    }

    const fid = BigInt(fidRaw);
    const userAddress = addressRaw as `0x${string}`;

    // Check if FID already used onchain
    const alreadyUsed = (await publicClient.readContract({
      address: BETTA_CONTRACT_ADDRESS,
      abi: BETTA_HATCHERY_ABI,
      functionName: "usedFid",
      args: [fid],
    })) as boolean;

    if (alreadyUsed) {
      return NextResponse.json(
        {
          ok: false,
          code: "FID_ALREADY_USED",
          error: "This FID has already minted.",
        },
        { status: 200 }
      );
    }

    // Read mintPrice
    const mintPrice = (await publicClient.readContract({
      address: BETTA_CONTRACT_ADDRESS,
      abi: BETTA_HATCHERY_ABI,
      functionName: "mintPrice",
    })) as bigint;

    // messageHash = keccak256(abi.encodePacked(address(this), msg.sender, fid))
    const messageHash = keccak256(
      encodePacked(
        ["address", "address", "uint256"],
        [BETTA_CONTRACT_ADDRESS, userAddress, fid]
      )
    );

    // Sign as trustedSigner (EIP-191 personal_sign of 32-byte hash)
    const signature = await signerAccount.signMessage({
      message: { raw: messageHash },
    });

    return NextResponse.json(
      {
        ok: true,
        fid: fid.toString(),
        address: userAddress,
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

// Simple health check
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Hatch route is running (sign-only, user wallet sends tx).",
  });
}
