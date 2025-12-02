// src/lib/fishProgressStore.ts

export type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPIRIT";

export type FishProgress = {
  tokenId: string;       // tokenId as string
  rarity: Rarity;
  level: number;
  exp: number;           // current exp within current level
  lastFeedAt: number;    // timestamp in ms
};

// Max level per rarity (locked rules)
const MAX_LEVEL_BY_RARITY: Record<Rarity, number> = {
  COMMON: 15,
  UNCOMMON: 20,
  RARE: 30,
  SPIRIT: 25,
  EPIC: 40,
  LEGENDARY: 50,
};

// In-memory store for now (can be replaced with DB later)
const progressStore = new Map<string, FishProgress>();

function makeKey(tokenId: string, rarity: Rarity): string {
  return `${tokenId}:${rarity}`;
}

/**
 * EXP needed to go from level L to L+1
 * Formula: 100 + (L - 1) * 40
 *
 * Level 1 -> 2 = 100
 * Level 2 -> 3 = 140
 * Level 3 -> 4 = 180
 * ...
 */
export function expNeeded(level: number): number {
  if (level < 1) return 100;
  return 100 + (level - 1) * 40;
}

/**
 * Returns max level allowed for a given rarity.
 */
export function getMaxLevelForRarity(rarity: Rarity): number {
  return MAX_LEVEL_BY_RARITY[rarity] ?? 1;
}

/**
 * Get existing progress or create a new one if none exists.
 * New fish starts at level 1, exp 0, lastFeedAt = 0.
 */
export function getOrCreateProgress(tokenId: string, rarity: Rarity): FishProgress {
  const key = makeKey(tokenId, rarity);
  const existing = progressStore.get(key);
  if (existing) return existing;

  const created: FishProgress = {
    tokenId,
    rarity,
    level: 1,
    exp: 0,
    lastFeedAt: 0,
  };

  progressStore.set(key, created);
  return created;
}

/**
 * Save progress back into the store.
 */
export function saveProgress(progress: FishProgress): void {
  const key = makeKey(progress.tokenId, progress.rarity);
  progressStore.set(key, progress);
}
