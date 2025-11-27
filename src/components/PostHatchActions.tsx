"use client";

import Link from "next/link";

type PostHatchActionsProps = {
  /** Farcaster username for the Follow button (without @), e.g. "hoggun" */
  farcasterUsername?: string;
  /** FID for deep link follow (optional) */
  farcasterFid?: number;
  /** OpenSea collection URL */
  openseaUrl?: string;
  /** Aquarium route (Next.js route path) */
  aquariumPath?: string;
};

const DEFAULT_OPENSEA =
  "https://opensea.io/collection/betta-hatchery-322178410";

export function PostHatchActions({
  farcasterUsername = "aconx", // TODO: change to your Farcaster username
  farcasterFid = 250139, // TODO: change to your FID
  openseaUrl = DEFAULT_OPENSEA,
  aquariumPath = "/aquarium",
}: PostHatchActionsProps) {
  // Share text for Farcaster composer
  const shareText = encodeURIComponent(
    "I just hatched a Betta on Base! ????\nhttps://bettahatchery.xyz"
  );

  const warpcastComposeUrl = `https://warpcast.com/~/compose?text=${shareText}`;
  const warpcastProfileUrl = `https://warpcast.com/${farcasterUsername}`;
  const warpcastProfileDeepLink = `warpcast://profiles/${farcasterFid}`;

  const handleFollowClick = () => {
    // Deep link for Warpcast apps
    if (typeof window !== "undefined") {
      // open deep link
      window.location.href = warpcastProfileDeepLink;

      // Fallback to web profile if deep link is not handled
      setTimeout(() => {
        window.open(warpcastProfileUrl, "_blank");
      }, 400);
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-3">
      {/* Share on Farcaster */}
      <a
        href={warpcastComposeUrl}
        target="_blank"
        rel="noreferrer"
        className="w-full rounded-xl border border-cyan-300/70 bg-cyan-500/90 px-4 py-3 text-center text-sm font-semibold text-slate-950 shadow-md shadow-cyan-500/40 transition hover:translate-y-0.5 hover:bg-cyan-400"
      >
        Share on Farcaster
      </a>

      {/* Follow creator */}
      <button
        type="button"
        onClick={handleFollowClick}
        className="w-full rounded-xl border border-indigo-300/70 bg-indigo-500/90 px-4 py-3 text-center text-sm font-semibold text-slate-50 shadow-md shadow-indigo-500/40 transition hover:translate-y-0.5 hover:bg-indigo-400"
      >
        Follow Creator
      </button>

      {/* View on OpenSea */}
      <a
        href={openseaUrl}
        target="_blank"
        rel="noreferrer"
        className="w-full rounded-xl border border-amber-300/70 bg-amber-400/90 px-4 py-3 text-center text-sm font-semibold text-slate-900 shadow-md shadow-amber-400/40 transition hover:translate-y-0.5 hover:bg-amber-300"
      >
        View on OpenSea
      </a>

      {/* PLAY ? Aquarium */}
      <Link
        href={aquariumPath}
        className="w-full rounded-xl border border-emerald-300/80 bg-emerald-500/90 px-4 py-3 text-center text-sm font-semibold uppercase tracking-wide text-slate-900 shadow-md shadow-emerald-500/40 transition hover:translate-y-0.5 hover:bg-emerald-400"
      >
        PLAY – Go to Aquarium
      </Link>
    </div>
  );
}
