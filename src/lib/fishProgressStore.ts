// src/lib/fishProgressStore.ts

import fs from "node:fs";
import path from "node:path";

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

const MAX_LEVEL_BY_RARITY: Record<Rarity, number> = {
  COMMON: 15,
  UNCOMMON: 20,
  RARE: 30,
  SPIRIT: 25,
  EPIC: 40,
  LEGENDARY: 50,
};

// Simple JSON file on disk for persistence (VPS friendly)
const DATA_FILE = path.join(process.cwd(), "data", "fish-progress.json");

// In-memory cache
const progressStore = new Map<string, FishProgress>();
let loadedFromDisk = false;

function makeKey(tokenId: string, rarity: Rarity): string {
  return `${tokenId}:${rarity}`;
}

/**
 * EXP needed to go from level L to L+1
 * Formula (locked): 100 + (L - 1) * 40
 */
export function expNeeded(level: number): number {
  if (level < 1) return 100;
  return 100 + (level - 1) * 40;
}

export function getMaxLevelForRarity(rarity: Rarity): number {
  return MAX_LEVEL_BY_RARITY[rarity] ?? 1;
}

function ensureLoaded() {
  if (loadedFromDisk) return;
  loadedFromDisk = true;

  try {
    if (!fs.existsSync(DATA_FILE)) {
      return;
    }
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    if (!raw.trim()) return;

    const parsed = JSON.parse(raw) as FishProgress[];
    for (const p of parsed) {
      if (!p || !p.tokenId || !p.rarity) continue;
      const safe: FishProgress = {
        tokenId: String(p.tokenId),
        rarity: p.rarity,
        level: typeof p.level === "number" && p.level > 0 ? p.level : 1,
        exp: typeof p.exp === "number" && p.exp >= 0 ? p.exp : 0,
        lastFeedAt:
          typeof p.lastFeedAt === "number" && p.lastFeedAt > 0 ? p.lastFeedAt : 0,
      };
      const key = makeKey(safe.tokenId, safe.rarity);
      progressStore.set(key, safe);
    }
  } catch (err) {
    console.error("[fishProgressStore] Failed to load from disk:", err);
  }
}

function persistToDisk() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const all = Array.from(progressStore.values());
    fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), "utf8");
  } catch (err) {
    console.error("[fishProgressStore] Failed to write to disk:", err);
  }
}

export function getOrCreateProgress(
  tokenId: string,
  rarity: Rarity
): FishProgress {
  ensureLoaded();
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
  persistToDisk();
  return created;
}

export function saveProgress(progress: FishProgress): void {
  ensureLoaded();
  const key = makeKey(progress.tokenId, progress.rarity);
  progressStore.set(key, progress);
  persistToDisk();
}

/**
 * Batch-read existing progress for many tokenIds/rarities.
 * Used by /api/progress to restore state on reload.
 */
export function getManyProgress(
  items: { tokenId: string; rarity: Rarity }[]
): FishProgress[] {
  ensureLoaded();
  const results: FishProgress[] = [];
  for (const item of items) {
    const key = makeKey(item.tokenId, item.rarity);
    const existing = progressStore.get(key);
    if (existing) {
      results.push(existing);
    }
  }
  return results;
}
