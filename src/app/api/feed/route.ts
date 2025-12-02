// src/app/api/feed/route.ts

import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateProgress,
  saveProgress,
  getMaxLevelForRarity,
  expNeeded,
} from "@/lib/fishProgressStore";
import type { Rarity } from "@/lib/fishProgressStore";

/**
 * FEED COOLDOWN (SERVER) pakai ENV, satuan MENIT
 *
 * NEXT_PUBLIC_FEED_COOLDOWN=1   -> 1 menit
 * NEXT_PUBLIC_FEED_COOLDOWN=10  -> 10 menit
 * NEXT_PUBLIC_FEED_COOLDOWN=60  -> 60 menit
 *
 * Jika ENV tidak ada / tidak valid -> fallback 60 menit.
 */
const FEED_COOLDOWN_MIN = (() => {
  const raw = process.env.NEXT_PUBLIC_FEED_COOLDOWN;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 60;
})();

const COOLDOWN_MS = FEED_COOLDOWN_MIN * 60 * 1000;

const EXP_PER_FEED = 10;

type FeedRequestBody = {
  tokenId?: string;
  rarity?: Rarity;
  walletAddress?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as FeedRequestBody;

    const tokenId = body.tokenId;
    const rarity = body.rarity;
    const walletAddress = body.walletAddress;

    if (!tokenId || !rarity) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PARAMS" },
        { status: 400 }
      );
    }

    // TODO (future): verify onchain that walletAddress owns tokenId

    const now = Date.now();
    const progress = getOrCreateProgress(tokenId, rarity);
    const maxLevel = getMaxLevelForRarity(rarity);

    // Cooldown check
    if (progress.lastFeedAt > 0) {
      const elapsed = now - progress.lastFeedAt;
      if (elapsed < COOLDOWN_MS) {
        const remainingMs = COOLDOWN_MS - elapsed;
        return NextResponse.json(
          {
            ok: false,
            error: "ON_COOLDOWN",
            remainingMs,
            now,
            lastFeedAt: progress.lastFeedAt,
          },
          { status: 429 }
        );
      }
    }

    // If already max level: just refresh cooldown
    if (progress.level >= maxLevel) {
      progress.lastFeedAt = now;
      saveProgress(progress);

      return NextResponse.json(
        {
          ok: true,
          tokenId: progress.tokenId,
          rarity: progress.rarity,
          level: progress.level,
          exp: progress.exp,
          expNeededNext: 0,
          lastFeedAt: progress.lastFeedAt,
          cooldownMs: COOLDOWN_MS,
          isMax: true,
        },
        { status: 200 }
      );
    }

    // Add EXP
    let level = progress.level;
    let exp = progress.exp + EXP_PER_FEED;

    // Level-up loop
    while (true) {
      const needed = expNeeded(level);
      if (exp >= needed && level < maxLevel) {
        exp -= needed;
        level += 1;
      } else {
        break;
      }
    }

    // Clamp when reaching max level
    if (level >= maxLevel) {
      level = maxLevel;
      exp = Math.min(exp, expNeeded(maxLevel));
    }

    progress.level = level;
    progress.exp = exp;
    progress.lastFeedAt = now;

    saveProgress(progress);

    const expNeededNext = level >= maxLevel ? 0 : expNeeded(level);

    return NextResponse.json(
      {
        ok: true,
        tokenId: progress.tokenId,
        rarity: progress.rarity,
        level: progress.level,
        exp: progress.exp,
        expNeededNext,
        lastFeedAt: progress.lastFeedAt,
        cooldownMs: COOLDOWN_MS,
        isMax: level >= maxLevel,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("FEED API error", e);
    return NextResponse.json(
      {
        ok: false,
        error: "INTERNAL_ERROR",
        detail: e?.message || String(e),
      },
      { status: 500 }
    );
  }
}
