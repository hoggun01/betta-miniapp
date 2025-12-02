// src/app/api/feed/route.ts

import { NextRequest, NextResponse } from "next/server";
import {
  expNeeded,
  getMaxLevelForRarity,
  getOrCreateProgress,
  saveProgress,
  type Rarity,
} from "@/lib/fishProgressStore";

// Keep server-side cooldown in sync with client
const DEFAULT_COOLDOWN_MINUTES = 1;
const FEED_COOLDOWN_MIN =
  Number(process.env.FEED_COOLDOWN_MIN) > 0
    ? Number(process.env.FEED_COOLDOWN_MIN)
    : DEFAULT_COOLDOWN_MINUTES;
const COOLDOWN_MS = FEED_COOLDOWN_MIN * 1 * 1000;

// EXP per feed (locked)
const EXP_PER_FEED = 20;

type FeedBody = {
  tokenId?: string;
  rarity?: Rarity;
  walletAddress?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as FeedBody;

    const tokenId = body.tokenId?.toString();
    const rarity = body.rarity;
    const wallet = body.walletAddress;

    if (!tokenId || !rarity || !wallet) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PARAMS" },
        { status: 400 }
      );
    }

    const now = Date.now();

    // Load or create base progress
    const progress = getOrCreateProgress(tokenId, rarity);

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
            level: progress.level,
            exp: progress.exp,
            expNeededNext:
              progress.level >= getMaxLevelForRarity(rarity)
                ? 0
                : expNeeded(progress.level),
            isMax: progress.level >= getMaxLevelForRarity(rarity),
          },
          { status: 429 }
        );
      }
    }

    const maxLevel = getMaxLevelForRarity(rarity);

    // Kalau sudah max level, cuma refresh cooldown (EXP tidak nambah)
    if (progress.level >= maxLevel) {
      progress.lastFeedAt = now;
      saveProgress(progress);

      return NextResponse.json(
        {
          ok: true,
          level: progress.level,
          exp: progress.exp,
          expNeededNext: 0,
          isMax: true,
          cooldownMs: COOLDOWN_MS,
        },
        { status: 200 }
      );
    }

    // Tambah EXP
    let level = progress.level;
    let exp = progress.exp + EXP_PER_FEED;

    // Level-up loop dengan rumus 100 + (L - 1) * 40
    let needed = expNeeded(level);
    while (level < maxLevel && exp >= needed) {
      exp -= needed;
      level += 1;
      needed = expNeeded(level);
    }

    // Clamp di max level, sisa EXP dibuang
    if (level >= maxLevel) {
      level = maxLevel;
      exp = 0;
    }

    progress.level = level;
    progress.exp = exp;
    progress.lastFeedAt = now;

    saveProgress(progress);

    const expNeededNext = level >= maxLevel ? 0 : expNeeded(level);

    return NextResponse.json(
      {
        ok: true,
        level,
        exp,
        expNeededNext,
        isMax: level >= maxLevel,
        cooldownMs: COOLDOWN_MS,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[/api/feed] INTERNAL_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
