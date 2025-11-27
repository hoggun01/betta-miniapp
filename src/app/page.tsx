"use client";

import { useState, useEffect } from "react";
import { sdk } from "@farcaster/miniapp-sdk";

type Phase = "idle" | "hatching" | "revealed" | "error";
type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";

type RarityConfig = {
  label: string;
  description: string;
  badgeClass: string;
  glowClass: string;
  imageUrl: string;
};

const RARITY_CONFIG: Record<Rarity, RarityConfig> = {
  COMMON: {
    label: "Common",
    description: "A basic Betta, still adorable.",
    badgeClass: "bg-sky-900/70 text-sky-50 border border-sky-300/70",
    glowClass: "shadow-[0_0_40px_rgba(125,211,252,0.7)]",
    imageUrl:
      "https://ipfs.io/ipfs/bafybeigqco3p2wghywrvogldw75twvn53z2vsoaqxyjsncqskn4jlt6p7u/common.png",
  },
  UNCOMMON: {
    label: "Uncommon",
    description: "A Betta with unique fin patterns.",
    badgeClass: "bg-teal-700/80 text-teal-50 border border-teal-300/80",
    glowClass: "shadow-[0_0_45px_rgba(45,212,191,0.95)]",
    imageUrl:
      "https://ipfs.io/ipfs/bafybeigqco3p2wghywrvogldw75twvn53z2vsoaqxyjsncqskn4jlt6p7u/uncommon.png",
  },
  RARE: {
    label: "Rare",
    description: "A galaxy Betta with vibrant colors.",
    badgeClass: "bg-cyan-800/90 text-cyan-50 border border-cyan-300/80",
    glowClass: "shadow-[0_0_55px_rgba(56,189,248,1)]",
    imageUrl:
      "https://ipfs.io/ipfs/bafybeigqco3p2wghywrvogldw75twvn53z2vsoaqxyjsncqskn4jlt6p7u/rare.png",
  },
  EPIC: {
    label: "Epic",
    description: "A Dragon Betta with thick scales and aura.",
    badgeClass: "bg-emerald-700/95 text-emerald-50 border border-emerald-300/80",
    glowClass: "shadow-[0_0_60px_rgba(16,185,129,1)]",
    imageUrl:
      "https://ipfs.io/ipfs/bafybeigqco3p2wghywrvogldw75twvn53z2vsoaqxyjsncqskn4jlt6p7u/epic.png",
  },
  LEGENDARY: {
    label: "Legendary",
    description: "A Legendary Spirit Betta with glowing energy.",
    badgeClass: "bg-indigo-900/95 text-indigo-50 border border-indigo-300/80",
    glowClass: "shadow-[0_0_80px_rgba(129,140,248,1)]",
    imageUrl:
      "https://ipfs.io/ipfs/bafybeigqco3p2wghywrvogldw75twvn53z2vsoaqxyjsncqskn4jlt6p7u/legendary.png",
  },
};

function pickRandomRarity(): Rarity {
  const roll = Math.random() * 100;
  if (roll < 55) return "COMMON";
  if (roll < 80) return "UNCOMMON";
  if (roll < 93) return "RARE";
  if (roll < 98) return "EPIC";
  return "LEGENDARY";
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [rarity, setRarity] = useState<Rarity | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isHatching = phase === "hatching";
  const displayProgress = phase === "revealed" ? 100 : Math.round(progress);

  // Tell Warpcast that the mini app UI is ready, so it can hide the splash screen
  useEffect(() => {
    sdk
      .ready()
      .catch((err) => {
        console.error("Miniapp ready() failed", err);
      });
  }, []);

  // Farcaster + OpenSea config
  const farcasterUsername = "aconx";
  const farcasterFid = 250139;
  const warpcastProfileUrl = `https://warpcast.com/${farcasterUsername}`;
  const warpcastProfileDeepLink = `warpcast://profiles/${farcasterFid}`;
  const shareText = encodeURIComponent(
    "I just hatched a Betta on Base! 🐟💙\nhttps://bettahatchery.xyz"
  );
  const warpcastComposeUrl = `https://warpcast.com/~/compose?text=${shareText}`;
  const openseaUrl =
    "https://opensea.io/collection/betta-hatchery-322178410";

  function handleFollowCreator() {
    if (typeof window !== "undefined") {
      window.location.href = warpcastProfileDeepLink;
      setTimeout(() => {
        window.open(warpcastProfileUrl, "_blank");
      }, 400);
    }
  }

  async function handleHatch() {
    if (isHatching || phase === "revealed") return;

    setError(null);
    setTxHash(null);
    setRarity(null);

    try {
      const inMiniApp = await sdk.isInMiniApp();
      if (!inMiniApp) {
        setError("This miniapp must be opened inside Warpcast.");
        setPhase("error");
        setProgress(0);
        return;
      }

      // Await context to get user fid
      const context = await sdk.context;
      const fid = context.user?.fid;
      if (!fid) {
        setError("Cannot read FID from Farcaster context.");
        setPhase("error");
        setProgress(0);
        return;
      }

      setPhase("hatching");
      setProgress(100);

      const res = await fetch("/api/hatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fid,
          // Temporary placeholder signature.
          // Replace with a real Farcaster / wallet signature flow later.
          signature: "0x",
        }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        setError("Hatch failed: invalid server response.");
        setPhase("error");
        setProgress(0);
        return;
      }

      if (!data || data.ok === false) {
        const msg: string =
          (typeof data?.error === "string" && data.error) || "Hatch failed.";

        if (
          msg.includes("Wallet already minted") ||
          data.code === "WALLET_ALREADY_MINTED"
        ) {
          setError(
            "This wallet has already minted a Betta. Each FID can only hatch once."
          );
        } else if (data.code === "SERVER_NOT_CONFIGURED") {
          setError("Hatch server is not configured correctly.");
        } else {
          setError(msg);
        }

        setPhase("error");
        setProgress(0);
        return;
      }

      const hash =
        (data.tx && (data.tx.hash || data.tx)) || data.hash || null;
      if (hash) {
        setTxHash(String(hash));
      }

      const picked = pickRandomRarity();
      setRarity(picked);
      setPhase("revealed");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Unexpected error.");
      setPhase("error");
      setProgress(0);
    }
  }

  const rarityConfig = rarity ? RARITY_CONFIG[rarity] : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 text-cyan-50">
      <div className="relative max-w-5xl w-full">
        <div className="relative z-10 rounded-[32px] border border-cyan-200/40 bg-transparent backdrop-blur-sm overflow-hidden">
          <div className="pointer-events-none absolute inset-0 rounded-[32px] border-2 border-white/60 shadow-[0_0_65px_rgba(248,250,252,0.9)]" />

          <div className="relative grid md:grid-cols-2 md:items-center gap-6 md:gap-10 p-6 md:p-10">
            {/* LEFT SIDE */}
            <div className="flex flex-col justify-center space-y-6">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-teal-100/90 mb-2">
                  BETTA HATCHERY
                </p>
                <h1 className="text-3xl md:text-4xl font-semibold leading-tight text-sky-100">
                  Hatch your{" "}
                  <span className="text-teal-200 drop-shadow-[0_0_18px_rgba(45,212,191,0.55)]">
                    Betta Egg
                  </span>
                </h1>
                <p className="mt-4 text-sm md:text-base text-cyan-50/90">
                  Open this miniapp from Warpcast, then hatch your Betta egg
                  using your Farcaster wallet. Each FID is allowed to hatch only
                  once.
                </p>
              </div>

              {/* progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] md:text-xs text-sky-100/85">
                  <span>
                    {phase === "idle" && "Ready to hatch"}
                    {phase === "hatching" && "Hatching your Betta..."}
                    {phase === "revealed" && "Hatch complete"}
                    {phase === "error" && "Hatch failed"}
                  </span>
                  <span>{displayProgress}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-sky-900/60 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-teal-300 via-cyan-300 to-sky-200 transition-[width] duration-150"
                    style={{ width: `${displayProgress}%` }}
                  />
                </div>
              </div>

              {/* button, tx, error */}
              <div className="flex flex-col gap-3">
                {phase !== "revealed" && (
                  <button
                    onClick={handleHatch}
                    disabled={isHatching}
                    className={`relative inline-flex items-center justify-center rounded-2xl px-6 py-3 text-sm md:text-base font-semibold tracking-wide transition
                      ${
                        isHatching
                          ? "bg-sky-700/80 text-sky-100 cursor-wait"
                          : "bg-cyan-300 hover:bg-cyan-200 text-sky-950 shadow-[0_12px_40px_rgba(34,211,238,0.6)]"
                      }`}
                  >
                    {isHatching ? "Hatching..." : "Hatch your Betta"}
                  </button>
                )}

                {txHash && (
                  <div className="text-[11px] md:text-xs text-sky-100/90">
                    Tx:{" "}
                    <a
                      href={`https://basescan.org/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-teal-200/80 hover:text-teal-100"
                    >
                      {txHash.slice(0, 10)}...{txHash.slice(-6)}
                    </a>
                  </div>
                )}

                {error && (
                  <div className="text-[11px] md:text-xs text-rose-50 bg-rose-900/60 border border-rose-400/70 rounded-xl px-3 py-2">
                    {error}
                  </div>
                )}
              </div>

              <p className="text-[10px] md:text-xs text-cyan-50/75">
                Hint: This miniapp is meant to run inside Warpcast. If you see
                <span className="font-mono ml-1">Unauthorized</span>, it means
                no Farcaster session was detected.
              </p>
            </div>

            {/* RIGHT SIDE */}
            <div className="relative flex items-center justify-center">
              {/* EGG STATE */}
              {phase !== "revealed" && (
                <div className="relative flex flex-col items-center gap-5">
                  <div className="relative">
                    <div className="absolute inset-[-28px] rounded-full bg-cyan-300/18 blur-3xl" />
                    <div
                      className={`egg-wrapper ${
                        isHatching ? "egg-shake" : ""
                      }`}
                      style={{ width: 180, height: 250 }}
                    >
                      <img
                        src="/egg.png"
                        alt="Egg"
                        className="w-full h-full object-contain select-none"
                      />
                    </div>
                  </div>

                  {!rarityConfig && (
                    <p className="mt-1 text-xs md:text-sm text-cyan-50/85 text-center max-w-xs">
                      Press{" "}
                      <span className="font-semibold text-teal-200">
                        Hatch
                      </span>{" "}
                      to reveal which Betta is hiding inside this underwater
                      egg.
                    </p>
                  )}
                </div>
              )}

              {/* CARD STATE */}
              {rarityConfig && phase === "revealed" && (
                <div className="relative flex flex-col items-center justify-center">
                  <div className="confetti-layer">
                    <div className="confetti-piece confetti-1" />
                    <div className="confetti-piece confetti-2" />
                    <div className="confetti-piece confetti-3" />
                    <div className="confetti-piece confetti-4" />
                    <div className="confetti-piece confetti-5" />
                    <div className="confetti-piece confetti-6" />
                  </div>

                  <div
                    className={`w-full max-w-xs rounded-3xl border border-cyan-200/70 bg-sky-950/60 p-4 backdrop-blur-xl
                      flex flex-col items-center gap-4 transform transition-all duration-500 surprise-in
                      ${rarityConfig.glowClass}`}
                  >
                    <div className="w-full aspect-[4/3] rounded-2xl overflow-hidden bg-sky-950/80 border border-sky-700/80 flex items-center justify-center">
                      <img
                        src={rarityConfig.imageUrl}
                        alt={rarityConfig.label}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>

                    <div className="flex flex-col items-center gap-1 text-center">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${rarityConfig.badgeClass}`}
                      >
                        {rarityConfig.label}
                      </span>
                      <p className="text-xs md:text-sm text-cyan-50/90">
                        {rarityConfig.description}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = "/aquarium";
                      }}
                      className="mt-3 inline-flex items-center justify-center rounded-2xl px-6 py-2.5 text-sm md:text-base font-semibold tracking-wide bg-emerald-300 text-sky-950 shadow-[0_8px_28px_rgba(16,185,129,0.8)] hover:bg-emerald-200 transition-transform duration-150 active:translate-y-[1px]"
                    >
                      PLAY
                    </button>

                    <div className="mt-4 w-full flex flex-col gap-2">
                      <a
                        href={warpcastComposeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full rounded-xl border border-cyan-300/70 bg-cyan-500/90 px-4 py-2.5 text-center text-xs font-semibold text-slate-950 shadow-md shadow-cyan-500/40 transition hover:translate-y-0.5 hover:bg-cyan-400"
                      >
                        Share on Farcaster
                      </a>

                      <button
                        type="button"
                        onClick={handleFollowCreator}
                        className="w-full rounded-xl border border-indigo-300/70 bg-indigo-500/90 px-4 py-2.5 text-center text-xs font-semibold text-slate-50 shadow-md shadow-indigo-500/40 transition hover:translate-y-0.5 hover:bg-indigo-400"
                      >
                        Follow Creator
                      </button>

                      <a
                        href={openseaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full rounded-xl border border-amber-300/70 bg-amber-400/90 px-4 py-2.5 text-center text-xs font-semibold text-slate-900 shadow-md shadow-amber-400/40 transition hover:translate-y-0.5 hover:bg-amber-300"
                      >
                        View on OpenSea
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
