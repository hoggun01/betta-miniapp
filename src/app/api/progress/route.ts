import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPIRIT";

type DbRecord = {
  level: number;
  exp: number;
  lastFedAt: number;
};

type DbShape = {
  [tokenId: string]: DbRecord;
};

type FishProgress = {
  level: number;
  exp: number;
  expNeededNext: number;
  isMax: boolean;
};

const MAX_LEVEL_BY_RARITY: Record<Rarity, number> = {
  COMMON: 15,
  UNCOMMON: 20,
  RARE: 30,
  SPIRIT: 25,
  EPIC: 40,
  LEGENDARY: 50,
};

const DB_PATH = path.join(process.cwd(), "data", "betta-progress.json");

function ensureDbFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({}), "utf8");
  }
}

function loadDb(): DbShape {
  try {
    ensureDbFile();
    const raw = fs.readFileSync(DB_PATH, "utf8");
    return raw ? (JSON.parse(raw) as DbShape) : {};
  } catch (err) {
    console.error("Failed to load db file", err);
    return {};
  }
}

// Rumus sama dengan feed
function expNeededForLevel(rarity: Rarity, level: number): number {
  const maxLevel = MAX_LEVEL_BY_RARITY[rarity];
  if (level >= maxLevel) return 0;
  const base = 100;
  const increment = 40;
  return base + (level - 1) * increment;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const fishes = Array.isArray(body.fishes) ? body.fishes : [];

    const db = loadDb();
    const progressByToken: Record<string, FishProgress> = {};

    for (const item of fishes) {
      const tokenId = String(item.tokenId ?? "").trim();
      const rarity = String(item.rarity ?? "").toUpperCase() as Rarity;

      if (!tokenId) continue;
      if (!(rarity in MAX_LEVEL_BY_RARITY)) continue;

      const record = db[tokenId];
      const level = record?.level ?? 1;
      const exp = record?.exp ?? 0;
      const maxLevel = MAX_LEVEL_BY_RARITY[rarity];
      const expNeededNext = expNeededForLevel(rarity, level);
      const isMax = level >= maxLevel || expNeededNext === 0;

      progressByToken[tokenId] = {
        level,
        exp,
        expNeededNext,
        isMax,
      };
    }

    return NextResponse.json({
      ok: true,
      progressByToken,
    });
  } catch (err) {
    console.error("Progress API error", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
