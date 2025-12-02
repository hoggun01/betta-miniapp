// src/lib/fishProgressStore.ts

export type Rarity =
  | "COMMON"
  | "UNCOMMON"
  | "RARE"
  | "EPIC"
  | "LEGENDARY"
  | "SPIRIT";

export type FishProgress = {
  tokenId: string;
  rarity: Rarity;
  level: number;
  exp: number;
  lastFeedAt: number; // unix ms
};

// Simple in-memory store (reset kalau server restart)
const store: Record<string, FishProgress> = {};

// MAX LEVEL PER RARITY (LOCKED DESIGN)
const MAX_LEVEL: Record<Rarity, number> = {
  LEGENDARY: 50,
  EPIC: 40,
  RARE: 30,
  SPIRIT: 25,
  UNCOMMON: 20,
  COMMON: 15,
};

// EXP NEEDED PER LEVEL (L -> L+1)
export function expNeeded(level: number): number {
  return 50 * level;
}

export function getOrCreateProgress(
  tokenId: string,
  rarity: Rarity
): FishProgress {
  const existing = store[tokenId];
  if (existing) {
    // kalau suatu saat rarity bisa berubah (misalnya spirit), update di sini
    if (existing.rarity !== rarity) {
      existing.rarity = rarity;
    }
    return existing;
  }

  const created: FishProgress = {
    tokenId,
    rarity,
    level: 1,
    exp: 0,
    lastFeedAt: 0,
  };

  store[tokenId] = created;
  return created;
}

export function saveProgress(progress: FishProgress) {
  store[progress.tokenId] = progress;
}

export function getMaxLevelForRarity(rarity: Rarity): number {
  return MAX_LEVEL[rarity];
}
