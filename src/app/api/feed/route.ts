// src/app/api/feed/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateProgress,
  saveProgress,
  getMaxLevelForRarity,
  expNeeded,
} from "@/lib/fishProgressStore";
import type { Rarity } from "@/lib/fishProgressStore";

const COOLDOWN_MS = 3600 * 1000; // 1 jam
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

    // Optional: verify wallet owner via onchain nanti
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

    // Kalau sudah max level: cuma refresh cooldown
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

    // Tambah EXP
    let level = progress.level;
    let exp = progress.exp + EXP_PER_FEED;

    // Level up loop
    while (true) {
      const needed = expNeeded(level);
      if (exp >= needed && level < maxLevel) {
        exp -= needed;
        level += 1;
      } else {
        break;
      }
    }

    // Clamp kalau sudah max
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
  } catch (e) {
    console.error("FEED API error", e);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
