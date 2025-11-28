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

type TrailPoint = {
  x: number; // 0-100 (%)
  y: number; // 0-100 (%)
  life: number; // 0-1 (dipakai untuk opacity & scale)
};

type MovingFish = FishToken & {
  x: number; // 0-100 (horizontal, %)
  y: number; // 0-100 (vertical, %)
  vx: number;
  vy: number;
  facing: "left" | "right";
  trail: TrailPoint[];
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

        const balanceNum = Number(balance);

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
        let found = 0;

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
              trail: [],
              ...motion,
            });

            found += 1;
            if (found >= balanceNum) {
              break;
            }
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

  // Random movement + aura tail trail
  useEffect(() => {
    let frame: number;

    const animate = () => {
      setFish((prev) =>
        prev.map((fish) => {
          let { x, y, vx, vy, facing } = fish;

          // wander kecil
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

          // --- MOTION TRAIL (AURA EKOR) ---
          const MAX_TRAIL_POINTS = 16;
          const DECAY = 0.07;

          // semakin besar offsetMultiplier → ekor lebih panjang di belakang
          const offsetMultiplier = 30;

          const trailHeadX = x - vx * offsetMultiplier;
          const trailHeadY = y - vy * offsetMultiplier;

          const clampedTrailHeadX = Math.min(Math.max(trailHeadX, minX), maxX);
          const clampedTrailHeadY = Math.min(Math.max(trailHeadY, minY), maxY);

          const newTrail: TrailPoint[] = [
            {
              x: clampedTrailHeadX,
              y: clampedTrailHeadY,
              life: 1,
            },
            ...fish.trail
              .map((p) => ({ ...p, life: p.life - DECAY }))
              .filter((p) => p.life > 0.05),
          ].slice(0, MAX_TRAIL_POINTS);

          return {
            ...fish,
            x,
            y,
            vx,
            vy,
            facing,
            trail: newTrail,
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

  const handleMyFishClick = () => {
    console.log("MY FISH clicked");
  };

  const handleBattleClick = () => {
    console.log("BATTLE clicked");
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
    <div className="min-h-screen flex items-start justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 px-4 pb-6 pt-3">
      <div className="w-full max-w-md space-y-3">
        <header className="space-y-0.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight leading-tight">
            Betta Aquarium
          </h1>
          <p className="text-[11px] text-slate-400 leading-tight">
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
            "relative w-full max-w-md aspect-[3/5] mx-auto rounded-3xl overflow-hidden neon-frame" +
            (isFeeding ? " feed-mode" : "")
          }
          style={{
            backgroundImage: 'url("/aquarium.png")',
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="relative w-full h-full">
            <div className="shadow-layer">
              <img
                src="/shadowfish.png"
                className="shadow-fish shadow-fish-ltr"
                alt="shadow fish"
                draggable={false}
              />
            </div>

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

            {/* AURA TAIL TRAIL: deretan blur bulat di jalur belakang ikan */}
            {!isLoading &&
              !error &&
              fish.map((f) =>
                f.trail.map((p, idx) => {
                  const rarityTrailClass =
                    f.rarity === "COMMON"
                      ? "trail-common"
                      : f.rarity === "UNCOMMON"
                      ? "trail-uncommon"
                      : f.rarity === "RARE"
                      ? "trail-rare"
                      : f.rarity === "EPIC"
                      ? "trail-epic"
                      : "trail-legendary";

                  const scale = 0.4 + 0.6 * p.life;

                  return (
                    <div
                      key={`${f.tokenId.toString()}-trail-${idx}`}
                      className={`trail-dot ${rarityTrailClass}`}
                      style={{
                        left: `${p.x}%`,
                        top: `${p.y}%`,
                        opacity: 0.6 * p.life,
                        transform: `translate(-50%, -50%) scale(${scale})`,
                      }}
                    />
                  );
                })
              )}

            {/* IKAN UTAMA */}
            {!isLoading &&
              !error &&
              fish.map((f) => {
                const rarityClass =
                  f.rarity === "COMMON"
                    ? "rarity-common"
                    : f.rarity === "UNCOMMON"
                    ? "rarity-uncommon"
                    : f.rarity === "RARE"
                    ? "rarity-rare"
                    : f.rarity === "EPIC"
                    ? "rarity-epic"
                    : "rarity-legendary";

                return (
                  <div
                    key={f.tokenId.toString()}
                    className="absolute"
                    style={{
                      left: `${f.x}%`,
                      top: `${f.y}%`,
                      transform: "translate(-50%, -50%)",
                      zIndex: 3,
                    }}
                  >
                    <div
                      className={
                        "fish-wrapper " +
                        rarityClass +
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
                );
              })}

            {isFeeding && (
              <>
                <div className="pellet" style={{ left: "30%", top: "6%" }} />
                <div className="pellet" style={{ left: "42%", top: "4%" }} />
                <div className="pellet" style={{ left: "54%", top: "5%" }} />
                <div className="pellet" style={{ left: "66%", top: "7%" }} />
                <div className="pellet" style={{ left: "48%", top: "3%" }} />
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

        <div className="flex items-center justify-center mt-4 gap-4">
          <button
            type="button"
            onClick={handleFeedClick}
            className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-sky-500 to-cyan-400 px-8 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/40 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isLoading || !!error || !fish.length}
          >
            FEED
          </button>
          <button
            type="button"
            onClick={handleMyFishClick}
            className="inline-flex items-center justify-center rounded-full bg-slate-800/90 px-7 py-2.5 text-sm font-semibold text-slate-100 border border-slate-600/80 shadow-md shadow-slate-900/40 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isLoading || !!error || !fish.length}
          >
            MY FISH
          </button>
          <button
            type="button"
            onClick={handleBattleClick}
            className="inline-flex items-center justify-center rounded-full bg-fuchsia-600/90 px-7 py-2.5 text-sm font-semibold text-slate-50 shadow-md shadow-fuchsia-500/40 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isLoading || !!error || !fish.length}
          >
            BATTLE
          </button>
        </div>
      </div>

      <style jsx global>{`
        .neon-frame {
          border: 3px solid rgba(56, 189, 248, 0.85);
          box-shadow:
            0 0 12px rgba(56, 189, 248, 0.9),
            0 0 25px rgba(56, 189, 248, 0.6),
            0 0 40px rgba(56, 189, 248, 0.45);
          backdrop-filter: blur(1px);
        }

        .fish-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .fish-facing-right {
          transform: scaleX(1);
        }

        .fish-facing-left {
          transform: scaleX(-1);
        }

        .fish-img {
          width: 4.5rem;
          height: 4.5rem;
          object-fit: contain;
          image-rendering: auto;
          transform: none;
        }

        /* OUTER LINE SESUAI RARITY (outline ngikut bentuk ikan) */
        .rarity-common .fish-img {
          filter:
            drop-shadow(0 0 3px rgba(148, 163, 184, 1))
            drop-shadow(0 0 8px rgba(148, 163, 184, 0.9));
        }

        .rarity-uncommon .fish-img {
          filter:
            drop-shadow(0 0 4px rgba(52, 211, 153, 1))
            drop-shadow(0 0 10px rgba(52, 211, 153, 0.95));
        }

        .rarity-rare .fish-img {
          filter:
            drop-shadow(0 0 4px rgba(168, 85, 247, 1))
            drop-shadow(0 0 12px rgba(168, 85, 247, 0.98));
        }

        .rarity-epic .fish-img {
          filter:
            drop-shadow(0 0 5px rgba(239, 68, 68, 1))
            drop-shadow(0 0 14px rgba(248, 113, 113, 0.98));
        }

        .rarity-legendary .fish-img {
          filter:
            drop-shadow(0 0 2px rgba(255, 255, 255, 0.95))
            drop-shadow(0 0 10px rgba(236, 72, 153, 0.95))
            drop-shadow(0 0 14px rgba(250, 204, 21, 0.95))
            drop-shadow(0 0 18px rgba(59, 130, 246, 0.95));
        }

        .feed-mode .fish-img {
          filter:
            drop-shadow(0 0 4px rgba(250, 250, 250, 0.95))
            drop-shadow(0 0 16px rgba(250, 204, 21, 0.98));
        }

        /* AURA TRAIL DOTS (ekor) */
        .trail-dot {
          position: absolute;
          width: 3.4rem;
          height: 3.4rem;
          border-radius: 9999px;
          pointer-events: none;
          z-index: 2;
          filter: blur(10px);
        }

        /* warna tail per rarity */
        .trail-common {
          background: radial-gradient(
            circle,
            rgba(148, 163, 184, 0.85) 0%,
            rgba(148, 163, 184, 0) 70%
          );
        }

        .trail-uncommon {
          background: radial-gradient(
            circle,
            rgba(52, 211, 153, 0.9) 0%,
            rgba(52, 211, 153, 0) 72%
          );
        }

        .trail-rare {
          background: radial-gradient(
            circle,
            rgba(168, 85, 247, 0.92) 0%,
            rgba(168, 85, 247, 0) 74%
          );
        }

        .trail-epic {
          background: radial-gradient(
            circle,
            rgba(239, 68, 68, 0.95) 0%,
            rgba(239, 68, 68, 0) 74%
          );
        }

        .trail-legendary {
          background: conic-gradient(
              from 0deg,
              rgba(236, 72, 153, 0.95),
              rgba(249, 115, 22, 0.95),
              rgba(250, 204, 21, 0.95),
              rgba(34, 197, 94, 0.95),
              rgba(59, 130, 246, 0.95),
              rgba(168, 85, 247, 0.95),
              rgba(236, 72, 153, 0.95)
            );
          mask-image: radial-gradient(circle, white 0%, transparent 70%);
          -webkit-mask-image: radial-gradient(circle, white 0%, transparent 70%);
        }

        .feed-mode .trail-dot {
          filter: blur(12px);
        }

        .pellet {
          position: absolute;
          width: 10px;
          height: 10px;
          border-radius: 9999px;
          background: #facc15;
          box-shadow: 0 0 10px rgba(250, 204, 21, 0.9);
          border: 1px solid rgba(250, 250, 210, 0.8);
          opacity: 0;
          animation: pelletDrop 1.6s ease-out forwards;
        }

        @keyframes pelletDrop {
          0% {
            transform: translateY(-10px);
            opacity: 0;
          }
          20% {
            opacity: 1;
          }
          80% {
            opacity: 1;
          }
          100% {
            transform: translateY(130px);
            opacity: 0;
          }
        }

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
          filter: blur(3px);
        }

        .shadow-fish-ltr {
          top: 50%;
          animation: shadowSwimLeftToRight 60s linear infinite;
          animation-delay: 12s;
        }

        @keyframes shadowSwimLeftToRight {
          0% {
            transform: translateX(-25%) scaleX(1);
            opacity: 0;
          }
          10% {
            opacity: 0.25;
          }
          50% {
            opacity: 0.55;
          }
          90% {
            opacity: 0.25;
          }
          100% {
            transform: translateX(115%) scaleX(1);
            opacity: 0;
          }
        }

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
  let dotColorClass = "bg-slate-400";

  const lower = label.toLowerCase();
  if (lower === "uncommon") {
    dotColorClass = "bg-emerald-400";
  } else if (lower === "rare") {
    dotColorClass = "bg-sky-400";
  } else if (lower === "epic") {
    dotColorClass = "bg-amber-400";
  } else if (lower === "legendary") {
    dotColorClass = "bg-red-500";
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-slate-900/70 px-2.5 py-1 border border-slate-700/70">
      <span className={`w-1.5 h-1.5 rounded-full ${dotColorClass}`} />
      <span className="uppercase tracking-[0.18em] text-[9px] text-slate-300">
        {label}
      </span>
      <span className="text-[10px] text-slate-100 font-semibold">{value}</span>
    </div>
  );
}
