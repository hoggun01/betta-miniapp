import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

// You can override these with .env.local if you want
const CONTRACT_ADDRESS = (process.env.BETTA_CONTRACT_ADDRESS ??
  "0x48a8443f006729729439f9bc529f905c05380bb7") as `0x${string}`;

const RPC_URL =
  process.env.BETTA_RPC_URL ||
  process.env.NEXT_PUBLIC_BASE_RPC_URL ||
  "https://mainnet.base.org";

const bettaAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner_", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextTokenId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "rarityOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

const client = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

function rarityIndexToName(index: number): "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY" {
  if (index === 0) return "COMMON";
  if (index === 1) return "UNCOMMON";
  if (index === 2) return "RARE";
  if (index === 3) return "EPIC";
  return "LEGENDARY";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      { ok: false, error: "MISSING_ADDRESS" },
      { status: 400 }
    );
  }

  try {
    const [balance, nextTokenId] = await Promise.all([
      client.readContract({
        address: CONTRACT_ADDRESS,
        abi: bettaAbi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }),
      client.readContract({
        address: CONTRACT_ADDRESS,
        abi: bettaAbi,
        functionName: "nextTokenId",
        args: [],
      }),
    ]);

    if (balance === BigInt(0)) {
      return NextResponse.json({ ok: true, rarities: [] });
    }

    // We brute-force all tokenIds 1..nextTokenId-1 (supply is small)
    const maxId = Number(nextTokenId);
    const tokenIds: bigint[] = [];
    for (let i = 1; i < maxId; i++) {
      tokenIds.push(BigInt(i));
    }

    if (tokenIds.length === 0) {
      return NextResponse.json({ ok: true, rarities: [] });
    }

    const ownerCalls = tokenIds.map((id) => ({
      address: CONTRACT_ADDRESS,
      abi: bettaAbi,
      functionName: "ownerOf" as const,
      args: [id],
    }));

    const rarityCalls = tokenIds.map((id) => ({
      address: CONTRACT_ADDRESS,
      abi: bettaAbi,
      functionName: "rarityOf" as const,
      args: [id],
    }));

    const [ownerResults, rarityResults] = await Promise.all([
      client.multicall({ contracts: ownerCalls, allowFailure: true }),
      client.multicall({ contracts: rarityCalls, allowFailure: true }),
    ]);

    const lowerAddr = address.toLowerCase();
    const rarities: Array<"COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY"> = [];

    for (let i = 0; i < tokenIds.length; i++) {
      const ownerRes = ownerResults[i];
      if (ownerRes.status !== "success") continue;

      const ownerAddr = (ownerRes.result as string).toLowerCase();
      if (ownerAddr !== lowerAddr) continue;

      const rarityRes = rarityResults[i];
      if (rarityRes.status !== "success") continue;

      const rarityIndex = Number(rarityRes.result);
      const rarityName = rarityIndexToName(rarityIndex);
      rarities.push(rarityName);
    }

    return NextResponse.json({ ok: true, rarities });
  } catch (error) {
    console.error("Aquarium API error:", error);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
