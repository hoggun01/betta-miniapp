"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { sdk } from "@farcaster/miniapp-sdk";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";

type Fish = {
  id: string;
  imageUrl: string;
  rarity: Rarity;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: "left" | "right";
};

export default function AquariumPage() {
  const [fid, setFid] = useState<number | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [fishList, setFishList] = useState<Fish[]>([]);
  const [isFeeding, setIsFeeding] = useState(false);
  const [feedCount, setFeedCount] = useState(0);

  // Load Farcaster context (FID + wallet)
  useEffect(() => {
    let isMounted = true;

    const loadContext = async () => {
      try {
        const context = await sdk.context;
        if (!isMounted) return;

        const anyContext = context as any;

        const userFid = anyContext.user?.fid ?? null;
        const address = anyContext.wallet?.address ?? null;

        setFid(userFid);
        setWalletAddress(address);
      } catch (error) {
        console.error("Failed to load Farcaster context:", error);
      }
    };

    loadContext();
    return () => {
      isMounted = false;
    };
  }, []);

  // Initialize 1 demo fish (replace imageUrl with your new PNG later)
  useEffect(() => {
    setFishList([
      {
        id: "fish-1",
        imageUrl:
          "https://ipfs.io/ipfs/bafybeigqco3p2wghywrvogldw75twvn53z2vsoaqxyjsncqskn4jlt6p7u/common.png",
        rarity: "COMMON",
        x: 50,
        y: 40,
        vx: 0.12,
        vy: 0.08,
        facing: "right",
      },
    ]);
  }, []);

  // Swimming animation
  useEffect(() => {
    let frame: number;

    const animate = () => {
      setFishList((prev) =>
        prev.map((fish) => {
          let { x, y, vx, vy, facing } = fish;

          x += vx;
          y += vy;

          const minX = 5;
          const maxX = 95;
          const minY = 10;
          const maxY = 90;

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
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleFeed = () => {
    setFeedCount((c) => c + 1);
    setIsFeeding(true);
    setTimeout(() => setIsFeeding(false), 400);
  };

  const formatAddress = (addr: string | null) => {
    if (!addr) return "-";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-black text-sky-50 px-3 py-4">
      <div className="w-[360px] sm:w-[390px] h-[720px] rounded-[32px] bg-gradient-to-b from-[#051625] via-[#020818] to-[#01030a] shadow-[0_0_80px_rgba(56,189,248,0.45)] border border-cyan-600/40 overflow-hidden relative">
        {/* Header */}
        <div className="pt-6 pb-2 text-center space-y-1">
          <h1 className="text-2xl font-black tracking-[0.16em] text-sky-50 drop-shadow-[0_0_20px_rgba(56,189,248,0.8)]">
            BETTA AQUARIUM
          </h1>
          <div className="text-[10px] uppercase tracking-[0.18em] text-sky-200/70 flex items-center justify-center gap-3">
            <span>FID {fid ?? "–"}</span>
            <span className="opacity-70">
              {walletAddress ? formatAddress(walletAddress) : "No wallet"}
            </span>
          </div>
        </div>

        {/* Tank */}
        <div className="px-4 mt-4">
          <div
            className={`relative w-full h-[420px] rounded-[28px] border border-cyan-300/30 bg-gradient-to-b from-[#051626] via-[#020717] to-[#00010a] overflow-hidden transition-shadow ${
              isFeeding
                ? "shadow-[0_0_50px_rgba(56,189,248,0.85)]"
                : "shadow-[0_0_40px_rgba(15,23,42,0.9)]"
            }`}
          >
            <div className="absolute inset-0">
              {fishList.map((fish) => (
                <div
                  key={fish.id}
                  className="absolute transition-transform"
                  style={{
                    left: `${fish.x}%`,
                    top: `${fish.y}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-[24px] bg-gradient-to-b from-sky-500/20 via-sky-400/10 to-sky-900/5 flex items-center justify-center shadow-[0_0_35px_rgba(56,189,248,0.65)]">
                    <div
                      className={`relative w-24 h-24 sm:w-28 sm:h-28 ${
                        fish.facing === "left" ? "scale-x-[-1]" : ""
                      }`}
                    >
                      <Image
                        src={fish.imageUrl}
                        alt={fish.rarity}
                        fill
                        priority
                        className="object-contain"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom info */}
            <div className="absolute bottom-0 left-0 right-0 px-4 pb-3 pt-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent backdrop-blur-[14px]">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-sky-200/70 mb-2">
                <span>Rarity</span>
                <span>{fishList.length} Fish Total</span>
              </div>

              <div className="flex flex-wrap gap-2 text-[10px]">
                <span className="px-3 py-1 rounded-full bg-sky-900/60 border border-sky-400/70 text-sky-50">
                  ● Common {fishList.filter((f) => f.rarity === "COMMON").length}
                </span>
                <span className="px-3 py-1 rounded-full bg-sky-900/40 border border-sky-300/40 text-sky-100/80">
                  ● Uncommon {fishList.filter((f) => f.rarity === "UNCOMMON").length}
                </span>
                <span className="px-3 py-1 rounded-full bg-sky-900/40 border border-sky-300/40 text-sky-100/80">
                  ● Rare {fishList.filter((f) => f.rarity === "RARE").length}
                </span>
                <span className="px-3 py-1 rounded-full bg-sky-900/40 border border-sky-300/40 text-sky-100/80">
                  ● Epic {fishList.filter((f) => f.rarity === "EPIC").length}
                </span>
                <span className="px-3 py-1 rounded-full bg-sky-900/40 border border-sky-300/40 text-sky-100/80">
                  ● Legendary {fishList.filter((f) => f.rarity === "LEGENDARY").length}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Feed button */}
        <div className="px-4 mt-5">
          <button
            onClick={handleFeed}
            className="w-full h-12 rounded-full bg-gradient-to-r from-sky-400 to-cyan-400 text-slate-950 font-semibold text-sm tracking-[0.16em] uppercase shadow-[0_0_30px_rgba(56,189,248,0.9)] border border-sky-100/80 active:scale-[0.97] transition-transform"
          >
            Feed {feedCount > 0 ? `(${feedCount})` : ""}
          </button>

          <p className="mt-3 text-[10px] text-center text-sky-100/70 tracking-[0.16em] uppercase">
            Fish move in soft loops. Feeding adds a short glow.
          </p>
        </div>
      </div>
    </div>
  );
}
