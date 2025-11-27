// src/app/api/tx-result/route.ts
import { NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  decodeEventLog,
} from "viem";
import { base } from "viem/chains";

const RPC_URL = process.env.RPC_URL;
const BETTA_CONTRACT_ADDRESS = process.env
  .NEXT_PUBLIC_BETTA_CONTRACT as `0x${string}` | undefined;

if (!RPC_URL) {
  console.warn("[TX_RESULT] Missing RPC_URL in env");
}
if (!BETTA_CONTRACT_ADDRESS) {
  console.warn("[TX_RESULT] Missing NEXT_PUBLIC_BETTA_CONTRACT in env");
}

const publicClient = RPC_URL
  ? createPublicClient({
      chain: base,
      transport: http(RPC_URL),
    })
  : null;

// ABI event Minted
const BETTA_HATCHERY_ABI = [
  {
    type: "event",
    anonymous: false,
    name: "Minted",
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "tokenId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "fid",
        type: "uint256",
      },
      {
        indexed: false,
        // enum BettaHatcheryV2.Rarity ? uint8
        internalType: "uint8",
        name: "rarity",
        type: "uint8",
      },
    ],
  },
] as const;

// GET /api/tx-result?hash=0x...
export async function GET(req: Request) {
  try {
    if (!publicClient || !BETTA_CONTRACT_ADDRESS) {
      return NextResponse.json(
        {
          ok: false,
          error: "SERVER_NOT_CONFIGURED",
        },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const hash = searchParams.get("hash");

    if (!hash || !hash.startsWith("0x")) {
      return NextResponse.json(
        { ok: false, error: "MISSING_OR_INVALID_HASH" },
        { status: 400 }
      );
    }

    const receipt = await publicClient.getTransactionReceipt({
      hash: hash as `0x${string}`,
    });

    let rarityIndex: number | null = null;

    for (const log of receipt.logs) {
      if (
        log.address.toLowerCase() !== BETTA_CONTRACT_ADDRESS.toLowerCase()
      ) {
        continue;
      }

      try {
        const decoded = decodeEventLog({
          abi: BETTA_HATCHERY_ABI,
          data: log.data,
          topics: log.topics,
        });

        if (decoded.eventName === "Minted") {
          const args = decoded.args as any;
          rarityIndex = Number(args.rarity);
          break;
        }
      } catch (_) {
        // ignore non-matching logs
      }
    }

    if (rarityIndex === null) {
      return NextResponse.json(
        {
          ok: false,
          error: "MINT_EVENT_NOT_FOUND",
        },
        { status: 200 }
      );
    }

    const rarityMap = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"] as const;
    const rarity =
      rarityIndex >= 0 && rarityIndex < rarityMap.length
        ? rarityMap[rarityIndex]
        : "COMMON";

    return NextResponse.json(
      {
        ok: true,
        rarity,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("TX_RESULT_ERROR", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.shortMessage || error?.message || "TX_RESULT_ERROR",
      },
      { status: 500 }
    );
  }
}
