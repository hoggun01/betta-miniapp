// /src/app/api/progress/route.ts
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPIRIT";

type FishRecord = {
  tokenId: string;
  rarity: Rarity;
  level: number;
  exp: number;
  lastFeedAt: number | null;
};

type DbSchema = {
  fishes: FishRecord[];
};

const DB_FILE = path.join(process.cwd(), "data", "database-fish.json");

// HARUS sama seperti di feed + frontend
const MAX_LEVEL_BY_RARITY: Record<Rarity, number> = {
  COMMON: 15,
  UNCOMMON: 20,
  RARE: 30,
  SPIRIT: 25,
  EPIC: 40,
  LEGENDARY: 50,
};

function expNeededForLevel(level: number, rarity: Rarity): number {
  const max = MAX_LEVEL_BY_RARITY[rarity];
  if (level >= max) return 0;
  const BASE = 100;
  const STEP = 40;
  return BASE + STEP * (level - 1);
}

async function ensureDbFile(): Promise<void> {
  const dir = path.dirname(DB_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
  try {
    await fs.access(DB_FILE);
  } catch {
    const empty: DbSchema = { fishes: [] };
    await fs.writeFile(DB_FILE, JSON.stringify(empty, null, 2), "utf8");
  }
}

async function readDb(): Promise<DbSchema> {
  await ensureDbFile();
  const raw = await fs.readFile(DB_FILE, "utf8");
  if (!raw.trim()) return { fishes: [] };
  try {
    const json = JSON.parse(raw);
    if (Array.isArray(json.fishes)) {
      return { fishes: json.fishes as FishRecord[] };
    }
    if (Array.isArray(json)) {
      return { fishes: json as FishRecord[] };
    }
    return { fishes: [] };
  } catch {
    return { fishes: [] };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const fishes = body?.fishes as
      | { tokenId: string; rarity: Rarity }[]
      | undefined;

    if (!Array.isArray(fishes) || fishes.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_FISHES" },
        { status: 400 }
      );
    }

    const db = await readDb();
    const progressByToken: Record<
      string,
      { level: number; exp: number; expNeededNext: number; isMax: boolean }
    > = {};

    for (const f of fishes) {
      const tokenId = String(f.tokenId);
      const rarity = f.rarity;
      const maxLevel = MAX_LEVEL_BY_RARITY[rarity];

      const record =
        db.fishes.find((r) => r.tokenId === tokenId) ??
        ({
          tokenId,
          rarity,
          level: 1,
          exp: 0,
          lastFeedAt: null,
        } as FishRecord);

      const level = record.level ?? 1;
      const exp = record.exp ?? 0;
      const expNeededNext = expNeededForLevel(level, rarity);
      const isMax = level >= maxLevel;

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
    console.error("PROGRESS route error:", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
