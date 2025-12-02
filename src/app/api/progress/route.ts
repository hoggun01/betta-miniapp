import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPIRIT";

type FishProgress = {
  level: number;
  exp: number;
  expNeededNext: number;
  isMax: boolean;
};

type RawDbRecord = {
  level: number;
  exp: number;
  lastFeedAt?: number;
  rarity?: Rarity;
};

type DbShape = Record<string, RawDbRecord>;

const DB_PATH = path.join(process.cwd(), "database-fish.json");

const MAX_LEVEL_BY_RARITY: Record<Rarity, number> = {
  COMMON: 15,
  UNCOMMON: 20,
  RARE: 30,
  SPIRIT: 25,
  EPIC: 40,
  LEGENDARY: 50,
};

// Sama persis rumusnya: 100 + (level-1)*40
function expNeededForLevel(rarity: Rarity, level: number): number {
  const maxLevel = MAX_LEVEL_BY_RARITY[rarity];
  if (level >= maxLevel) return 0;

  const safeLevel = Math.max(1, Math.min(level, maxLevel));
  return 100 + (safeLevel - 1) * 40;
}

async function loadDb(): Promise<DbShape> {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as DbShape;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return {};
    }
    console.error("[progress] Failed to read DB:", err);
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fishes = body?.fishes as
      | { tokenId: string | number; rarity: Rarity }[]
      | undefined;

    if (!Array.isArray(fishes) || fishes.length === 0) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY" },
        { status: 400 }
      );
    }

    const db = await loadDb();
    const progressByToken: Record<string, FishProgress> = {};

    for (const f of fishes) {
      const tokenKey = String(f.tokenId);
      const rarity = f.rarity;

      const dbRec = db[tokenKey];

      const maxLevel = MAX_LEVEL_BY_RARITY[rarity];
      const baseLevel =
        dbRec && Number.isFinite(dbRec.level) ? dbRec.level : 1;
      const baseExp = dbRec && Number.isFinite(dbRec.exp) ? dbRec.exp : 0;

      const level = Math.max(1, Math.min(baseLevel, maxLevel));

      let exp = baseExp;
      let expNeededNext = expNeededForLevel(rarity, level);
      let isMax = level >= maxLevel || expNeededNext === 0;

      if (isMax) {
        // Kalau sudah max, EXP dikunci di 0
        exp = 0;
        expNeededNext = 0;
      } else if (exp >= expNeededNext) {
        // Safety clamp kalau DB pernah simpan exp kebanyakan
        exp = Math.max(0, expNeededNext - 1);
      }

      progressByToken[tokenKey] = {
        level,
        exp,
        expNeededNext,
        isMax,
      };
    }

    return NextResponse.json(
      { ok: true, progressByToken },
      { status: 200 }
    );
  } catch (err) {
    console.error("[progress] Unexpected error:", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
