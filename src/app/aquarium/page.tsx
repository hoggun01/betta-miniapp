"use client";

import { useEffect, useMemo, useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";

type FishToken = {
  tokenId: bigint;
  rarity: Rarity;
  imageUrl: string;
};

type MovingFish = FishToken & {
  x: number; // 0 - 100 percentage (horizontal)
  y: number; // 0 - 100 percentage (vertical)
  vx: number; // delta per frame
  vy: number;
  phase: number; // wave phase
  phaseSpeed: number;
};

const BETTA_CONTRACT_ADDRESS = process.env
  .NEXT_PUBLIC_BETTA_CONTRACT as `0x${string}` | undefined;

const RPC_URL =
  process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";

// Minimal ABI: nextTokenId, balanceOf, ownerOf, tokenURI
const BETTA_ABI = [
  {
    type: "function",
    name: "nextTokenId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "uri", type: "string" }],
  },
] as const;

// Map rarity to local sprite in /public (transparent PNGs)
const RARITY_SPRITES: Record<Rarity, string> = {
  COMMON: "/common.png",
  UNCOMMON: "/uncommon.png",
  RARE: "/rare.png",
  EPIC: "/epic.png",
  LEGENDARY: "/legendary.png",
};

const RARITY_SCALE: Record<Rarity, number> = {
  COMMON: 0.9,
  UNCOMMON: 1.0,
  RARE: 1.05,
  EPIC: 1.12,
  LEGENDARY: 1.2,
};

function ipfsToHttp(uri: string): string {
  if (!uri) return uri;
  if (uri.startsWith("ipfs://")) {
    return "https://ipfs.io/ipfs/" + uri.replace("ipfs://", "");
  }
  return uri;
}

function detectRarityFromMetadata(meta: any): Rarity {
  if (!meta) return "COMMON";

  const attributeRarity = Array.isArray(meta.attributes)
    ? meta.attributes.find(
        (attr: any) =>
          String(attr?.trait_type).toLowerCase() === "rarity" && attr?.value
      )?.value
    : undefined;

  const raw =
    attributeRarity ??
    meta.rarity ??
    meta.Rarity ??
    (meta.attributes && (meta.attributes.Rarity as any)) ??
    "";

  const normalized = String(raw).toUpperCase();

  if (normalized === "UNCOMMON") return "UNCOMMON";
  if (normalized === "RARE") return "RARE";
  if (normalized === "EPIC") return "EPIC";
  if (normalized === "LEGENDARY") return "LEGENDARY";
  return "COMMON";
}

function createInitialMotion(index: number): {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  phaseSpeed: number;
} {
  const baseX = 20 + ((index * 18) % 60) + Math.random() * 5;
  const baseY = 25 + ((index * 10) % 40) + (Math.random() * 6 - 3);
  const direction = index % 2 === 0 ? 1 : -1;
  const speed = 0.07 + (index % 3) * 0.02;

  return {
    x: baseX,
    y: baseY,
    vx: speed * direction,
    vy: 0.04 * (direction > 0 ? 1 : -1),
    phase: Math.random() * Math.PI * 2,
    phaseSpeed: 0.05 + Math.random() * 0.03,
  };
}

export default function AquariumPage() {
  const [isInMiniApp, setIsInMiniApp] = useState<boolean | null>(null);
  const [fid, setFid] = useState<number | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [fish, setFish] = useState<MovingFish[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFeeding, setIsFeeding] = useState(false);

  // Bootstrapping: detect miniapp, wallet, NFTs
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const mini = await sdk.isInMiniApp();
        if (cancelled) return;
        setIsInMiniApp(mini);

        if (!mini) {
          setError("This page is intended to be opened inside a Farcaster Mini App.");
          setIsLoading(false);
          await sdk.actions.ready();
          return;
        }

        const ctx: any = await sdk.context;
        if (cancelled) return;
        const ctxFid = ctx?.user?.fid as number | undefined;
        if (ctxFid) setFid(ctxFid);

        if (!BETTA_CONTRACT_ADDRESS) {
          setError("Betta contract address is not configured.");
          setIsLoading(false);
          await sdk.actions.ready();
          return;
        }

        // Get wallet from Farcaster miniapp provider
        const provider = await sdk.wallet.getEthereumProvider();
        const accounts = (await (provider as any).request({
          method: "eth_accounts",
          params: [],
        })) as string[];

        let address = accounts && accounts[0];

        if (!address) {
          const requested = (await (provider as any).request({
            method: "eth_requestAccounts",
            params: [],
          })) as string[];
          address = requested && requested[0];
        }

        if (!address) {
          setError("No connected EVM wallet found in this Mini App.");
          setIsLoading(false);
          await sdk.actions.ready();
          return;
        }

        setWalletAddress(address);

        const client = createPublicClient({
          chain: base,
          transport: http(RPC_URL),
        });

        const ZERO = BigInt(0);

        // Quick check: if balanceOf == 0 -> aquarium empty
        const balance = (await client.readContract({
          address: BETTA_CONTRACT_ADDRESS,
          abi: BETTA_ABI,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        })) as bigint;

        if (balance === ZERO) {
          setFish([]);
          setIsLoading(false);
          await sdk.actions.ready();
          return;
        }

        // Get total minted via nextTokenId (public)
        const nextTokenIdValue = (await client.readContract({
          address: BETTA_CONTRACT_ADDRESS,
          abi: BETTA_ABI,
          functionName: "nextTokenId",
          args: [],
        })) as bigint;

        const ONE = BigInt(1);

        if (nextTokenIdValue <= ONE) {
          setFish([]);
          setIsLoading(false);
          await sdk.actions.ready();
          return;
        }

        const maxTokenId = nextTokenIdValue - ONE;

        // For safety, cap how many tokens we scan (e.g. first 500)
        const HARD_CAP = BigInt(500);
        const endTokenId = maxTokenId > HARD_CAP ? HARD_CAP : maxTokenId;

        const fishes: MovingFish[] = [];
        let index = 0;

        for (let id = ONE; id <= endTokenId; id = id + ONE) {
          try {
            const owner = (await client.readContract({
              address: BETTA_CONTRACT_ADDRESS,
              abi: BETTA_ABI,
              functionName: "ownerOf",
              args: [id],
            })) as string;

            if (owner.toLowerCase() !== address.toLowerCase()) {
              continue;
            }

            const rawUri = (await client.readContract({
              address: BETTA_CONTRACT_ADDRESS,
              abi: BETTA_ABI,
              functionName: "tokenURI",
              args: [id],
            })) as string;

            const metadataUrl = ipfsToHttp(rawUri);
            const res = await fetch(metadataUrl);
            const meta = res.ok ? await res.json() : null;

            const rarity = detectRarityFromMetadata(meta);
            const spriteUrl = RARITY_SPRITES[rarity];
            const motion = createInitialMotion(index++);

            fishes.push({
              tokenId: id,
              rarity,
              imageUrl: spriteUrl,
              ...motion,
            });
          } catch (perTokenError) {
            console.error("Error loading token", id.toString(), perTokenError);
          }
        }

        if (!cancelled) {
          setFish(fishes);
          setIsLoading(false);
        }

        await sdk.actions.ready();
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError("Something went wrong while loading your aquarium.");
          setIsLoading(false);
        }
        await sdk.actions.ready();
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  // Real swimming animation (move around aquarium with waves)
  useEffect(() => {
    let frame: number;

    const animate = () => {
      setFish((prev) =>
        prev.map((f) => {
          let { x, y, vx, vy, phase, phaseSpeed } = f;

          x += vx;
          y += vy;
          phase += phaseSpeed;

          const minX = 8;
          const maxX = 92;
          const minY = 18;
          const maxY = 88;

          if (x < minX) {
            x = minX;
            vx = Math.abs(vx);
          } else if (x > maxX) {
            x = maxX;
            vx = -Math.abs(vx);
          }

          if (y < minY) {
            y = minY;
            vy = Math.abs(vy);
          } else if (y > maxY) {
            y = maxY;
            vy = -Math.abs(vy);
          }

          return {
            ...f,
            x,
            y,
            vx,
            vy,
            phase,
          };
        })
      );

      frame = window.requestAnimationFrame(animate);
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!isFeeding) return;
    const id = setTimeout(() => setIsFeeding(false), 1500);
    return () => clearTimeout(id);
  }, [isFeeding]);

  const raritySummary = useMemo(() => {
    const counts: Record<Rarity, number> = {
      COMMON: 0,
      UNCOMMON: 0,
      RARE: 0,
      EPIC: 0,
      LEGENDARY: 0,
    };
    for (const f of fish) {
      counts[f.rarity] += 1;
    }
    return counts;
  }, [fish]);

  const handleFeedClick = () => {
    if (!fish.length) return;
    setIsFeeding(true);
  };

  if (isInMiniApp === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-slate-100 px-6">
        <p className="text-center text-sm">
          Please open this page from your Farcaster Mini App to see your Betta aquarium.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 px-4 pb-8 pt-6">
      <div className="w-full max-w-md space-y-4">
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Betta Aquarium</h1>
          <p className="text-xs text-slate-400">
            FID {fid ?? "-"}{" "}
            {walletAddress
              ? "• " +
                walletAddress.slice(0, 6) +
                "..." +
                walletAddress.slice(-4)
              : "• wallet not detected"}
          </p>
        </header>

        <section
          className={
            "relative w-full max-w-md aspect-[3/4] mx-auto rounded-3xl border border-sky-500/40 bg-gradient-to-b from-slate-900/90 via-slate-950/90 to-slate-900/90 overflow-hidden shadow-[0_0_40px_rgba(56,189,248,0.6)]" +
            (isFeeding ? " feed-mode" : "")
          }
        >
          {/* Background glow & circles */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.25),transparent_55%),radial-gradient(circle_at_bottom,_rgba(14,165,233,0.2),transparent_55%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-40 mix-blend-screen">
            <div className="absolute -left-10 bottom-0 w-32 h-32 rounded-full border border-sky-500/20" />
            <div className="absolute left-8 top-8 w-20 h-20 rounded-full border border-cyan-400/20" />
            <div className="absolute right-4 bottom-16 w-14 h-14 rounded-full border border-sky-300/30" />
          </div>

          <div className="relative w-full h-full">
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-sky-100">
                <div className="h-10 w-10 rounded-full border-2 border-sky-400/60 border-t-transparent animate-spin" />
                <span>Loading your fish...</span>
              </div>
            )}

            {!isLoading && error && (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-red-200">
                {error}
              </div>
            )}

            {!isLoading && !error && !fish.length && (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-sm text-slate-200">
                <p>Your aquarium is empty for now.</p>
                <p className="mt-1 text-xs text-slate-400">
                  Hatch or buy a Betta NFT to see it swim here.
                </p>
              </div>
            )}

            {/* Moving fish layer */}
            {!isLoading &&
              !error &&
              fish.map((f) => {
                const visualY = f.y + Math.sin(f.phase) * 2;
                const angle = Math.sin(f.phase * 1.6) * 5;
                const scale = RARITY_SCALE[f.rarity];

                const transform = `translate(-50%, -50%) rotate(${angle}deg) scale(${scale})`;

                return (
                  <div
                    key={f.tokenId.toString()}
                    className="absolute"
                    style={{
                      left: `${f.x}%`,
                      top: `${visualY}%`,
                      transform,
                    }}
                  >
                    <img
                      src={f.imageUrl}
                      alt={f.rarity + " Betta #" + f.tokenId.toString()}
                      className="w-24 h-24 object-contain drop-shadow-[0_0_20px_rgba(56,189,248,0.9)]"
                      draggable={false}
                    />
                  </div>
                );
              })}

            {/* Feed pellets */}
            {isFeeding && (
              <>
                <div className="pellet" style={{ left: "30%", top: "6%" }} />
                <div className="pellet" style={{ left: "50%", top: "4%" }} />
                <div className="pellet" style={{ left: "65%", top: "7%" }} />
                <div className="pellet" style={{ left: "40%", top: "3%" }} />
              </>
            )}

            {/* Bottom overlay + rarity summary */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-950/95 via-slate-950/70 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 px-4 pb-4 pt-2 text-[10px] text-slate-200">
              <div className="flex items-center justify-between gap-2">
                <span className="uppercase tracking-[0.16em] text-slate-400">
                  Rarity
                </span>
                <span className="text-slate-400">
                  {fish.length} fish total
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                <Badge label="Common" value={raritySummary.COMMON} />
                <Badge label="Uncommon" value={raritySummary.UNCOMMON} />
                <Badge label="Rare" value={raritySummary.RARE} />
                <Badge label="Epic" value={raritySummary.EPIC} />
                <Badge label="Legendary" value={raritySummary.LEGENDARY} />
              </div>
            </div>
          </div>
        </section>

        <div className="flex items-center justify-between mt-1">
          <button
            type="button"
            onClick={handleFeedClick}
            className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-sky-500 to-cyan-400 px-6 py-2 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/40 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isLoading || !!error || !fish.length}
          >
            Feed
          </button>
          <span className="text-[10px] text-slate-500">
            Fish move in looping waves. Feeding adds a short glow.
          </span>
        </div>
      </div>

      <style jsx global>{`
        .feed-mode img {
          filter: drop-shadow(0 0 22px rgba(250, 204, 21, 0.95));
        }

        .pellet {
          position: absolute;
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: #facc15;
          opacity: 0;
          animation: pelletDrop 1.2s ease-out forwards;
        }

        @keyframes pelletDrop {
          0% {
            transform: translateY(-10px);
            opacity: 0;
          }
          30% {
            opacity: 1;
          }
          100% {
            transform: translateY(40px);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

type BadgeProps = {
  label: string;
  value: number;
};

function Badge({ label, value }: BadgeProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-slate-900/70 px-2.5 py-1 border border-slate-700/70">
      <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
      <span className="uppercase tracking-[0.18em] text-[9px] text-slate-300">
        {label}
      </span>
      <span className="text-[10px] text-slate-100 font-semibold">{value}</span>
    </div>
  );
}
