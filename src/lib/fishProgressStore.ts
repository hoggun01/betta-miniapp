// src/lib/fishProgressStore.ts
import fs from "fs";
import path from "path";

export type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPIRIT";

export type FishProgress = {
  tokenId: string;
  rarity: Rarity;
  level: number;
  exp: number;
  lastFeedAt: number; // unix ms
};

type DBShape = {
  fish: Record<string, FishProgress>;
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "fish-progress.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const empty: DBShape = { fish: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(empty, null, 2), "utf8");
  }
}

function loadDb(): DBShape {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.fish) {
      return { fish: {} };
    }
    return parsed as DBShape;
  } catch {
    return { fish: {} };
  }
}

function saveDb(db: DBShape) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

// MAX LEVEL PER RARITY (LOCKED)
const MAX_LEVEL: Record<Rarity, number> = {
  LEGENDARY: 50,
  EPIC: 40,
  RARE: 30,
  SPIRIT: 25,
  UNCOMMON: 20,
  COMMON: 15,
};

// EXP NEEDED PER LEVEL (L ? L+1)
export function expNeeded(level: number): number {
  return 50 * level;
}

export function getOrCreateProgress(tokenId: string, rarity: Rarity): FishProgress {
  const db = loadDb();
  const existing = db.fish[tokenId];

  if (existing) {
    // kalau rarity berubah, update (misal future)
    if (existing.rarity !== rarity) {
      existing.rarity = rarity;
      saveDb(db);
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

  db.fish[tokenId] = created;
  saveDb(db);

  return created;
}

export function saveProgress(progress: FishProgress) {
  const db = loadDb();
  db.fish[progress.tokenId] = progress;
  saveDb(db);
}

export function getMaxLevelForRarity(rarity: Rarity): number {
  return MAX_LEVEL[rarity];
}
