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
  x: number; // 0-100 (horizontal, %)
  y: number; // 0-100 (vertical, %)
  vx: number;
  vy: number;
  facing: "left" | "right";
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

// Map rarity to local PNG in /public
const RARITY_SPRITES: Record<Rarity, string> = {
  COMMON: "/common.png",
  UNCOMMON: "/uncommon.png",
  RARE: "/rare.png",
  EPIC: "/epic.png",
  LEGENDARY: "/legendary.png",
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
  facing: "left" | "right";
} {
  const x = 15 + ((index * 20) % 60) + Math.random() * 6;
  const y = 25 + ((index * 12) % 40) + (Math.random() * 8 - 4);

  const base = 0.09 + Math.random() * 0.05;
  const vx = (Math.random() > 0.5 ? 1 : -1) * base;
  const vy = (Math.random() > 0.5 ? 1 : -1) * (0.04 + Math.random() * 0.03);

  return {
    x,
    y,
    vx,
    vy,
    facing: vx >= 0 ? "right" : "left",
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
        if (ctxFid) {
          setFid(ctxFid);
        }

        if (!BETTA_CONTRACT_ADDRESS) {
          setError("Betta contract address is not configured.");
          setIsLoading(false);
          await sdk.actions.ready();
          return;
        }

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

  // Random movement using requestAnimationFrame, with slight wander
  useEffect(() => {
    let frame: number;

    const animate = () => {
      setFish((prev) =>
        prev.map((fish) => {
          let { x, y, vx, vy, facing } = fish;

          // add small random wander to velocity
          const wanderStrengthX = 0.01;
          const wanderStrengthY = 0.008;

          vx += (Math.random() - 0.5) * wanderStrengthX;
          vy += (Math.random() - 0.5) * wanderStrengthY;

          const minVx = 0.04;
          const maxVx = 0.16;
          const minVy = 0.02;
          const maxVy = 0.1;

          if (Math.abs(vx) < minVx) {
            vx = (vx >= 0 ? 1 : -1) * minVx;
          } else if (Math.abs(vx) > maxVx) {
            vx = (vx >= 0 ? 1 : -1) * maxVx;
          }

          if (Math.abs(vy) < minVy) {
            vy = (vy >= 0 ? 1 : -1) * minVy;
          } else if (Math.abs(vy) > maxVy) {
            vy = (vy >= 0 ? 1 : -1) * maxVy;
          }

          x += vx;
          y += vy;

          const minX = 10;
          const maxX = 90;
          const minY = 18;
          const maxY = 82;

          if (x < minX) {
            x = minX;
            vx = Math.abs(vx);
            facing = "right";
          } else if (x > maxX) {
            x = maxX;
            vx = -Math.abs(vx);
            facing = "left";
          }

          if (y < minY) {
            y = minY;
            vy = Math.abs(vy);
          } else if (y > maxY) {
            y = maxY;
            vy = -Math.abs(vy);
          }

          return { ...fish, x, y, vx, vy, facing };
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

        {/* Tank with custom background image */}
        <section
          className={
            "relative w-full max-w-md aspect-[3/4] mx-auto rounded-3xl overflow-hidden shadow-[0_0_40px_rgba(56,189,248,0.6)] border border-sky-500/40" +
            (isFeeding ? " feed-mode" : "")
          }
          style={{
            backgroundImage: 'url("/aquarium.png")',
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="relative w-full h-full">
            {/* Shadow fish layer (behind bubbles & main fish) */}
            <div className="shadow-layer">
              <img
                src="/shadow-fish.png"
                className="shadow-fish shadow-fish-1"
                alt="shadow fish"
                draggable={false}
              />
              <img
                src="/shadow-fish.png"
                className="shadow-fish shadow-fish-2"
                alt="shadow fish"
                draggable={false}
              />
              <img
                src="/shadow-fish.png"
                className="shadow-fish shadow-fish-3"
                alt="shadow fish"
                draggable={false}
              />
              <img
                src="/shadow-fish.png"
                className="shadow-fish shadow-fish-4"
                alt="shadow fish"
                draggable={false}
              />
            </div>

            {/* Bubble layer */}
            <div className="bubble-layer">
              <div className="bubble bubble-1" />
              <div className="bubble bubble-2" />
              <div className="bubble bubble-3" />
              <div className="bubble bubble-4" />
              <div className="bubble bubble-5" />
              <div className="bubble bubble-6" />
              <div className="bubble bubble-7" />
              <div className="bubble bubble-8" />
              <div className="bubble bubble-9" />
              <div className="bubble bubble-10" />
            </div>

            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-sky-100 bg-slate-900/40">
                <div className="h-10 w-10 rounded-full border-2 border-sky-400/60 border-t-transparent animate-spin" />
                <span>Loading your fish...</span>
              </div>
            )}

            {!isLoading && error && (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-red-200 bg-slate-900/40">
                {error}
              </div>
            )}

            {!isLoading && !error && !fish.length && (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-sm text-slate-50 bg-slate-900/40">
                <p>Your aquarium is empty for now.</p>
                <p className="mt-1 text-xs text-slate-200">
                  Hatch or buy a Betta NFT to see it swim here.
                </p>
              </div>
            )}

            {/* Fishes */}
            {!isLoading &&
              !error &&
              fish.map((f) => (
                <div
                  key={f.tokenId.toString()}
                  className="absolute"
                  style={{
                    left: `${f.x}%`,
                    top: `${f.y}%`,
                    transform: "translate(-50%, -50%)",
                    zIndex: 2,
                  }}
                >
                  <div
                    className={
                      "fish-wrapper" +
                      (f.facing === "left" ? " fish-facing-left" : " fish-facing-right")
                    }
                  >
                    <img
                      src={f.imageUrl}
                      alt={f.rarity + " Betta #" + f.tokenId.toString()}
                      className="fish-img"
                      draggable={false}
                    />
                  </div>
                </div>
              ))}

            {isFeeding && (
              <>
                <div className="pellet" style={{ left: "30%", top: "6%" }} />
                <div className="pellet" style={{ left: "50%", top: "4%" }} />
                <div className="pellet" style={{ left: "65%", top: "7%" }} />
                <div className="pellet" style={{ left: "40%", top: "3%" }} />
              </>
            )}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-950/95 via-slate-950/70 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 px-4 pb-4 pt-2 text-[10px] text-slate-200">
              <div className="flex items-center justify-between gap-2">
                <span className="uppercase tracking-[0.16em] text-slate-200 drop-shadow">
                  Rarity
                </span>
                <span className="text-slate-200 drop-shadow">
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
            Fish move randomly across the tank. Feeding adds a short glow.
          </span>
        </div>
      </div>

      <style jsx global>{`
        /* Transparent wrapper: only flips direction */
        .fish-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          width: auto;
          height: auto;
          background: transparent;
          box-shadow: none;
        }

        .fish-facing-right {
          transform: scaleX(1);
        }

        .fish-facing-left {
          transform: scaleX(-1);
        }

        /* static size & glow; movement comes ONLY from JS (x,y) */
        .fish-img {
          width: 4.5rem;
          height: 4.5rem;
          object-fit: contain;
          image-rendering: auto;
          filter: drop-shadow(0 0 18px rgba(56, 189, 248, 0.9));
          transform: none;
        }

        .feed-mode .fish-img {
          filter: drop-shadow(0 0 24px rgba(250, 204, 21, 0.95));
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

        /* SHADOW FISH PNG (behind bubbles & front fish) */
        .shadow-layer {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 0;
        }

        .shadow-fish {
          position: absolute;
          width: 130px;
          opacity: 0;
          filter: blur(2px);
          transform: translateX(-130%);
          animation: shadowSwim 24s linear infinite;
        }

        .shadow-fish-1 {
          top: 30%;
          animation-delay: 4s;
        }

        .shadow-fish-2 {
          top: 52%;
          animation-delay: 11s;
          animation-direction: reverse;
        }

        .shadow-fish-3 {
          top: 40%;
          animation-delay: 18s;
        }

        .shadow-fish-4 {
          top: 70%;
          animation-delay: 25s;
          animation-direction: reverse;
        }

        @keyframes shadowSwim {
          0% {
            transform: translateX(-130%);
            opacity: 0;
          }
          10% {
            opacity: 0.35;
          }
          50% {
            opacity: 0.6;
          }
          90% {
            opacity: 0.35;
          }
          100% {
            transform: translateX(135%);
            opacity: 0;
          }
        }

        /* BUBBLES */
        .bubble-layer {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 1;
        }

        .bubble {
          position: absolute;
          bottom: -40px;
          width: 12px;
          height: 12px;
          border-radius: 9999px;
          border: 2px solid rgba(191, 219, 254, 0.75);
          background: rgba(191, 219, 254, 0.18);
          opacity: 0;
          animation-name: bubbleUp;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }

        .bubble-1 {
          left: 12%;
          animation-duration: 9s;
          animation-delay: 1s;
        }

        .bubble-2 {
          left: 22%;
          animation-duration: 11s;
          animation-delay: 4s;
        }

        .bubble-3 {
          left: 32%;
          animation-duration: 8s;
          animation-delay: 7s;
        }

        .bubble-4 {
          left: 45%;
          animation-duration: 10s;
          animation-delay: 2s;
        }

        .bubble-5 {
          left: 55%;
          animation-duration: 12s;
          animation-delay: 6s;
        }

        .bubble-6 {
          left: 65%;
          animation-duration: 9.5s;
          animation-delay: 3s;
        }

        .bubble-7 {
          left: 75%;
          animation-duration: 7.5s;
          animation-delay: 8s;
        }

        .bubble-8 {
          left: 82%;
          animation-duration: 10.5s;
          animation-delay: 5s;
        }

        .bubble-9 {
          left: 18%;
          animation-duration: 8.5s;
          animation-delay: 9s;
        }

        .bubble-10 {
          left: 50%;
          animation-duration: 7s;
          animation-delay: 11s;
        }

        @keyframes bubbleUp {
          0% {
            transform: translateY(0) scale(0.7);
            opacity: 0;
          }
          12% {
            opacity: 0.9;
          }
          80% {
            opacity: 0.9;
          }
          100% {
            transform: translateY(-130vh) scale(1);
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
