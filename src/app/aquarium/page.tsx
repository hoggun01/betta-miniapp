"use client";

import { useEffect, useMemo, useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPIRIT";

type FishToken = {
  tokenId: bigint;
  rarity: Rarity;
  imageUrl: string; // sprite used in aquarium
  nftImageUrl?: string; // original NFT image from metadata
};

type MovingFish = FishToken & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: "left" | "right";
};

type FishProgress = {
  level: number;
  exp: number;
  expNeededNext: number;
  isMax: boolean;
};

type BattleStats = {
  hp: number;
  str: number;
  def: number;
  agi: number;
  crit: number;
  dodge: number;
};

const BETTA_CONTRACT_ADDRESS = process.env
  .NEXT_PUBLIC_BETTA_CONTRACT as `0x${string}` | undefined;

const RPC_URL =
  process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";

// Minimal ABI
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

// Map rarity to PNG in /public
const RARITY_SPRITES: Record<Rarity, string> = {
  COMMON: "/common.png",
  UNCOMMON: "/uncommon.png",
  RARE: "/rare.png",
  EPIC: "/epic.png",
  LEGENDARY: "/legendary.png",
  SPIRIT: "/spirit.png",
};

// EXP per feed (must match backend)
const EXP_PER_FEED = 20;

// ✅ FIXED: feed cooldown 30 menit (bisa kamu ubah nanti di sini)
const FEED_COOLDOWN_MIN = 30;
const FEED_COOLDOWN_MS = FEED_COOLDOWN_MIN * 60 * 1000;

// LocalStorage key untuk cooldown client-side
const LAST_FEED_STORAGE_KEY = "betta_last_feed_at_v1";

// Max level per rarity (harus sama dengan backend)
const MAX_LEVEL_BY_RARITY: Record<Rarity, number> = {
  COMMON: 15,
  UNCOMMON: 20,
  RARE: 30,
  SPIRIT: 25,
  EPIC: 40,
  LEGENDARY: 50,
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
  if (normalized === "SPIRIT") return "SPIRIT";
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

  const baseSpeed = 0.09 + Math.random() * 0.05;
  const vx = (Math.random() > 0.5 ? 1 : -1) * baseSpeed;
  const vy = (Math.random() > 0.5 ? 1 : -1) * (0.04 + Math.random() * 0.03);

  return {
    x,
    y,
    vx,
    vy,
    facing: vx >= 0 ? "right" : "left",
  };
}

function loadNextFeedFromStorage(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_FEED_STORAGE_KEY);
    if (!raw) return null;
    const last = Number(raw);
    if (Number.isNaN(last)) return null;
    const nextAt = last + FEED_COOLDOWN_MS;
    if (nextAt <= Date.now()) return null;
    return nextAt;
  } catch (err) {
    console.error("Failed to read last feed time from storage", err);
    return null;
  }
}

function persistNextFeedAt(nextFeedAt: number | null) {
  if (typeof window === "undefined") return;
  try {
    if (nextFeedAt === null) {
      window.localStorage.removeItem(LAST_FEED_STORAGE_KEY);
      return;
    }
    const lastAt = nextFeedAt - FEED_COOLDOWN_MS;
    window.localStorage.setItem(LAST_FEED_STORAGE_KEY, String(lastAt));
  } catch (err) {
    console.error("Failed to save last feed time to storage", err);
  }
}

// Basic stat formula for battle status
function computeStats(rarity: Rarity, level: number): BattleStats {
  const rarityMultiplier = {
    COMMON: { hp: 1.0, str: 1.0, def: 1.0, agi: 1.0 },
    UNCOMMON: { hp: 1.1, str: 1.1, def: 1.05, agi: 1.05 },
    RARE: { hp: 1.25, str: 1.25, def: 1.15, agi: 1.15 },
    SPIRIT: { hp: 1.3, str: 1.3, def: 1.2, agi: 1.2 },
    EPIC: { hp: 1.45, str: 1.45, def: 1.3, agi: 1.3 },
    LEGENDARY: { hp: 1.6, str: 1.6, def: 1.4, agi: 1.4 },
  }[rarity];

  const baseHp = 100;
  const baseStr = 20;
  const baseDef = 15;
  const baseAgi = 10;

  const hp = Math.round((baseHp + level * 12) * rarityMultiplier.hp);
  const str = Math.round((baseStr + level * 3) * rarityMultiplier.str);
  const def = Math.round((baseDef + level * 2.5) * rarityMultiplier.def);
  const agi = Math.round((baseAgi + level * 2) * rarityMultiplier.agi);

  const baseCrit = 3;
  const baseDodge = 3;

  const rarityCritBonus = {
    COMMON: 0,
    UNCOMMON: 1,
    RARE: 2,
    SPIRIT: 3,
    EPIC: 4,
    LEGENDARY: 5,
  }[rarity];

  const crit = Math.min(50, baseCrit + level * 0.4 + rarityCritBonus);
  const dodge = Math.min(
    40,
    baseDodge + level * 0.35 + Math.max(0, rarityCritBonus - 1)
  );

  return { hp, str, def, agi, crit, dodge };
}

// 🔹 Load progress dari backend untuk semua ikan
async function fetchProgressForFishes(
  fishes: MovingFish[]
): Promise<Record<string, FishProgress>> {
  try {
    if (!fishes.length) return {};

    const res = await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fishes: fishes.map((f) => ({
          tokenId: f.tokenId.toString(),
          rarity: f.rarity,
        })),
      }),
    });

    if (!res.ok) {
      console.warn("Failed to fetch progress, status:", res.status);
      return {};
    }

    const data = await res.json();

    if (!data || !data.ok || !data.progressByToken) {
      return {};
    }

    return data.progressByToken as Record<string, FishProgress>;
  } catch (err) {
    console.error("fetchProgressForFishes error", err);
    return {};
  }
}

export default function AquariumPage() {
  const [isInMiniApp, setIsInMiniApp] = useState<boolean | null>(null);
  const [fid, setFid] = useState<number | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [fish, setFish] = useState<MovingFish[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFeeding, setIsFeeding] = useState(false);

  const [nextFeedAt, setNextFeedAt] = useState<number | null>(null);
  const [cooldownLabel, setCooldownLabel] = useState<string | null>(null);
  const [isFeedLoading, setIsFeedLoading] = useState(false);

  const [showMyFish, setShowMyFish] = useState(false);
  const [progressByToken, setProgressByToken] = useState<
    Record<string, FishProgress>
  >({});

  const [expGain, setExpGain] = useState<number | null>(null);
  const [expGainFishId, setExpGainFishId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const mini = await sdk.isInMiniApp();
        if (cancelled) return;
        setIsInMiniApp(mini);

        if (!mini) {
          setError(
            "This page is intended to be opened inside a Farcaster Mini App."
          );
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
        const effectiveMax = maxTokenId > HARD_CAP ? HARD_CAP : maxTokenId;

        const tokenIds: bigint[] = [];
        for (let id = ONE; id <= effectiveMax; id = id + ONE) {
          tokenIds.push(id);
        }

        const fishes: MovingFish[] = [];
        let index = 0;
        let found = 0;
        let hitRateLimit = false;

        const BATCH_SIZE = 24;
        const scanStartedAt = Date.now();
        const MAX_SCAN_MS = 12000;

        const lowerAddress = address.toLowerCase();

        for (let i = 0; i < tokenIds.length; i += BATCH_SIZE) {
          if (Date.now() - scanStartedAt > MAX_SCAN_MS) break;

          const batchIds = tokenIds.slice(i, i + BATCH_SIZE);

          let ownerResults: any[];
          try {
            ownerResults = await client.multicall({
              contracts: batchIds.map((id) => ({
                address: BETTA_CONTRACT_ADDRESS,
                abi: BETTA_ABI,
                functionName: "ownerOf",
                args: [id],
              })),
              allowFailure: true,
            });
          } catch (err: any) {
            const code = err?.code;
            const message: string = err?.shortMessage || err?.message || "";
            if (code === -32016 || message.toLowerCase().includes("rate limit")) {
              console.warn("RPC rate limit during ownerOf multicall", err);
              hitRateLimit = true;
              break;
            }
            console.error("Error in ownerOf multicall", err);
            break;
          }

          const myTokenIds: bigint[] = [];
          ownerResults.forEach((res, idx) => {
            if (!res || res.status !== "success" || !res.result) return;
            const owner = (res.result as string).toLowerCase();
            if (owner === lowerAddress) {
              myTokenIds.push(batchIds[idx]);
            }
          });

          if (myTokenIds.length === 0) {
            if (found >= balanceNum) break;
            continue;
          }

          let uriResults: any[];
          try {
            uriResults = await client.multicall({
              contracts: myTokenIds.map((id) => ({
                address: BETTA_CONTRACT_ADDRESS,
                abi: BETTA_ABI,
                functionName: "tokenURI",
                args: [id],
              })),
              allowFailure: true,
            });
          } catch (err: any) {
            const code = err?.code;
            const message: string = err?.shortMessage || err?.message || "";
            if (code === -32016 || message.toLowerCase().includes("rate limit")) {
              console.warn("RPC rate limit during tokenURI multicall", err);
              hitRateLimit = true;
              break;
            }
            console.error("Error in tokenURI multicall", err);
            break;
          }

          for (let j = 0; j < myTokenIds.length; j++) {
            const tokenId = myTokenIds[j];
            const uriRes = uriResults[j];

            if (!uriRes || uriRes.status !== "success" || !uriRes.result)
              continue;

            const rawUri = uriRes.result as string;

            try {
              const metadataUrl = ipfsToHttp(rawUri);
              const res = await fetch(metadataUrl);
              const meta = res.ok ? await res.json() : null;

              const rarity = detectRarityFromMetadata(meta);
              const spriteUrl = RARITY_SPRITES[rarity];
              const nftImageUrl = ipfsToHttp(
                meta?.image || meta?.image_url || ""
              );

              const motion = createInitialMotion(index++);

              fishes.push({
                tokenId,
                rarity,
                imageUrl: spriteUrl,
                nftImageUrl,
                x: motion.x,
                y: motion.y,
                vx: motion.vx,
                vy: motion.vy,
                facing: motion.facing,
              });

              found += 1;
              if (found >= balanceNum) break;
            } catch (metaError) {
              console.error(
                "Error loading metadata for token",
                tokenId.toString(),
                metaError
              );
            }
          }

          if (found >= balanceNum || hitRateLimit) break;
        }

        // 🔹 Load progress awal dari backend
        let initialProgress: Record<string, FishProgress> = {};
        if (fishes.length > 0) {
          initialProgress = await fetchProgressForFishes(fishes);
        }

        if (!cancelled) {
          setFish(fishes);

          if (Object.keys(initialProgress).length > 0) {
            setProgressByToken(initialProgress);
          }

          if (balanceNum > 0 && fishes.length === 0 && hitRateLimit) {
            setError(
              "We hit an RPC rate limit while loading your fish. Please try reopening your aquarium in a moment."
            );
          }

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

  useEffect(() => {
    const storedNext = loadNextFeedFromStorage();
    if (storedNext) {
      setNextFeedAt(storedNext);
    }
  }, []);

  useEffect(() => {
    let frame: number;

    const animate = () => {
      setFish((prev) =>
        prev.map((fish) => {
          let { x, y, vx, vy, facing } = fish;

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

          return {
            ...fish,
            x,
            y,
            vx,
            vy,
            facing,
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

  useEffect(() => {
    if (!nextFeedAt) {
      setCooldownLabel(null);
      return;
    }

    const update = () => {
      const diff = nextFeedAt - Date.now();
      if (diff <= 0) {
        setNextFeedAt(null);
        setCooldownLabel(null);
        persistNextFeedAt(null);
        return;
      }

      const totalSec = Math.floor(diff / 1000);
      const minutes = Math.floor(totalSec / 60);
      const seconds = totalSec % 60;

      const mm = minutes.toString().padStart(2, "0");
      const ss = seconds.toString().padStart(2, "0");
      setCooldownLabel(`${mm}:${ss}`);
    };

    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [nextFeedAt]);

  const raritySummary = useMemo(() => {
    const counts: Record<Rarity, number> = {
      COMMON: 0,
      UNCOMMON: 0,
      RARE: 0,
      EPIC: 0,
      LEGENDARY: 0,
      SPIRIT: 0,
    };
    for (const f of fish) {
      counts[f.rarity] += 1;
    }
    return counts;
  }, [fish]);

  const handleFeedClick = async () => {
    if (!fish.length || !walletAddress || isFeedLoading) return;
    if (nextFeedAt && nextFeedAt > Date.now()) return;

    const firstFish = fish[0];
    setIsFeedLoading(true);

    try {
      const res = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: firstFish.tokenId.toString(),
          rarity: firstFish.rarity,
          walletAddress,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "ON_COOLDOWN" && typeof data.remainingMs === "number") {
          const endAt = Date.now() + data.remainingMs;
          setNextFeedAt(endAt);
          persistNextFeedAt(endAt);
        }
        console.warn("Feed error:", data);
        return;
      }

      let endAt: number | null = null;
      if (typeof data.cooldownMs === "number") {
        endAt = Date.now() + data.cooldownMs;
      } else if (typeof data.remainingMs === "number") {
        endAt = Date.now() + data.remainingMs;
      } else {
        endAt = Date.now() + FEED_COOLDOWN_MS;
      }

      if (endAt !== null) {
        setNextFeedAt(endAt);
        persistNextFeedAt(endAt);
      }

      if (
        typeof data.level === "number" &&
        typeof data.exp === "number" &&
        typeof data.expNeededNext === "number" &&
        typeof data.isMax === "boolean"
      ) {
        const key = firstFish.tokenId.toString();
        setProgressByToken((prev) => ({
          ...prev,
          [key]: {
            level: data.level,
            exp: data.exp,
            expNeededNext: data.expNeededNext,
            isMax: data.isMax,
          },
        }));
      }

      setIsFeeding(true);
      setExpGain(EXP_PER_FEED);
      setExpGainFishId(firstFish.tokenId.toString());

      window.setTimeout(() => {
        setExpGain(null);
        setExpGainFishId(null);
      }, 1200);
    } catch (err) {
      console.error("Feed request failed", err);
    } finally {
      setIsFeedLoading(false);
    }
  };

  const handleMyFishClick = () => {
    if (!fish.length) return;
    setShowMyFish((prev) => !prev);
  };

  const handleBattleClick = () => {
    console.log("BATTLE clicked");
  };

  const isOnCooldown = nextFeedAt !== null && nextFeedAt > Date.now();

  if (isInMiniApp === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-slate-100 px-6">
        <p className="text-center text-sm">
          Please open this page from your Farcaster Mini App to see your Betta
          aquarium.
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
                    : f.rarity === "LEGENDARY"
                    ? "rarity-legendary"
                    : "rarity-spirit";

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
                        (f.facing === "left"
                          ? " fish-facing-left"
                          : " fish-facing-right")
                      }
                    >
                      <img
                        src={f.imageUrl}
                        alt={f.rarity + " Betta #" + f.tokenId.toString()}
                        className="fish-img"
                        draggable={false}
                      />
                      {expGain !== null &&
                        expGainFishId === f.tokenId.toString() && (
                          <div className="exp-float">+{expGain} EXP</div>
                        )}
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
                <Badge label="Spirit" value={raritySummary.SPIRIT} />
              </div>
            </div>
          </div>
        </section>

        <div className="flex flex-col items-center justify-center mt-4 gap-1.5">
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={handleFeedClick}
              className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-sky-500 to-cyan-400 px-8 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/40 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={
                isLoading ||
                !!error ||
                !fish.length ||
                isFeedLoading ||
                isOnCooldown
              }
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

          {cooldownLabel && (
            <p className="text-[10px] text-slate-200 text-center tracking-[0.16em] uppercase">
              NEXT FEED AVAILABLE IN {cooldownLabel}
            </p>
          )}
        </div>

        {/* MY FISH PAGE SECTION */}
        {showMyFish && !!fish.length && (
          <section className="mt-3 w-full rounded-2xl bg-slate-900/80 border border-slate-700/80 px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-[0.18em] uppercase text-slate-200">
                My Fish Status
              </h2>
              <span className="text-[10px] text-slate-400">
                Feed gives +{EXP_PER_FEED} EXP
              </span>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {fish.map((f) => {
                const key = f.tokenId.toString();
                const p = progressByToken[key];
                const maxLevel = MAX_LEVEL_BY_RARITY[f.rarity];
                const level = p?.level ?? 1;
                const stats = computeStats(f.rarity, level);

                const levelText = `Level ${level} / ${maxLevel}`;
                let expText = "No EXP yet. Feed this fish to start.";
                let barPercent = 0;

                if (p) {
                  if (p.isMax || p.expNeededNext === 0) {
                    expText = "MAX level reached.";
                    barPercent = 100;
                  } else {
                    barPercent =
                      p.expNeededNext > 0
                        ? Math.min(
                            100,
                            Math.round((p.exp / p.expNeededNext) * 100)
                          )
                        : 0;
                    expText = `${p.exp} / ${p.expNeededNext} EXP`;
                  }
                }

                return (
                  <div
                    key={key}
                    className="rounded-xl bg-slate-900/90 border border-slate-700/80 px-3 py-3 text-[11px] space-y-2"
                  >
                    <div className="flex gap-3">
                      <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-slate-800 flex items-center justify-center">
                        {f.nftImageUrl ? (
                          <img
                            src={f.nftImageUrl}
                            alt={`NFT #${key}`}
                            className="w-full h-full object-cover"
                            draggable={false}
                          />
                        ) : (
                          <span className="text-[10px] text-slate-400 text-center px-1">
                            NFT image not found
                          </span>
                        )}
                        <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full border border-slate-700 overflow-hidden bg-slate-900">
                          <img
                            src={f.imageUrl}
                            alt="Sprite"
                            className="w-full h-full object-contain"
                            draggable={false}
                          />
                        </div>
                      </div>

                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded-md bg-slate-800 text-[10px] text-slate-200">
                              #{key}
                            </span>
                            <span className="uppercase tracking-[0.16em] text-[9px] text-slate-400">
                              {f.rarity}
                            </span>
                          </div>
                          <span className="text-[11px] text-sky-200 font-semibold">
                            {levelText}
                          </span>
                        </div>

                        <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800/90 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-300 to-yellow-400"
                            style={{ width: `${barPercent}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-slate-300 mt-0.5">
                          {expText}
                        </p>

                        <div className="grid grid-cols-3 gap-x-3 gap-y-1 mt-1.5 text-[10px] text-slate-200">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">HP</span>
                            <span className="font-semibold">{stats.hp}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">STR</span>
                            <span className="font-semibold">{stats.str}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">DEF</span>
                            <span className="font-semibold">{stats.def}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">AGI</span>
                            <span className="font-semibold">{stats.agi}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">CRIT</span>
                            <span className="font-semibold">
                              {stats.crit.toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">DODGE</span>
                            <span className="font-semibold">
                              {stats.dodge.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
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
        }

        .exp-float {
          position: absolute;
          top: -16px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 10px;
          font-weight: 700;
          color: #facc15;
          text-shadow: 0 0 6px rgba(0, 0, 0, 0.9);
          opacity: 0;
          animation: expFloat 1s ease-out forwards;
          pointer-events: none;
        }

        @keyframes expFloat {
          0% {
            transform: translate(-50%, 4px);
            opacity: 0;
          }
          20% {
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -18px);
            opacity: 0;
          }
        }

        .rarity-common .fish-img {
          filter:
            drop-shadow(0 0 2px rgba(148, 163, 184, 0.9))
            drop-shadow(0 0 6px rgba(148, 163, 184, 0.6));
        }

        .rarity-uncommon .fish-img {
          filter:
            drop-shadow(0 0 2px rgba(52, 211, 153, 0.95))
            drop-shadow(0 0 7px rgba(52, 211, 153, 0.7));
        }

        .rarity-rare .fish-img {
          filter:
            drop-shadow(0 0 2px rgba(168, 85, 247, 0.95))
            drop-shadow(0 0 8px rgba(168, 85, 247, 0.75));
        }

        .rarity-epic .fish-img {
          filter:
            drop-shadow(0 0 2px rgba(239, 68, 68, 0.95))
            drop-shadow(0 0 9px rgba(248, 113, 113, 0.8));
        }

        .rarity-legendary .fish-img {
          filter:
            drop-shadow(0 0 2px rgba(255, 255, 255, 0.9))
            drop-shadow(0 0 8px rgba(236, 72, 153, 0.85))
            drop-shadow(0 0 10px rgba(250, 204, 21, 0.85))
            drop-shadow(0 0 12px rgba(59, 130, 246, 0.85));
        }

        .rarity-spirit .fish-img {
          filter:
            drop-shadow(0 0 2px rgba(129, 140, 248, 0.95))
            drop-shadow(0 0 9px rgba(56, 189, 248, 0.8));
        }

        .feed-mode .fish-img {
          filter:
            drop-shadow(0 0 3px rgba(250, 250, 250, 0.95))
            drop-shadow(0 0 10px rgba(250, 204, 21, 0.95));
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
  } else if (lower === "spirit") {
    dotColorClass = "bg-indigo-400";
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-slate-900/70 px-2.5 py-1 border border-slate-700/70">
      <span className={`w-1.5 h-1.5 rounded-full ${dotColorClass}`} />
      <span className="uppercase tracking-[0.18em] text-[9px] text-slate-300">
        {label}
      </span>
      <span className="text-[10px] text-slate-100 font-semibold">
        {value}
      </span>
    </div>
  );
}
