// /src/app/api/feed/route.ts
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

// === CONFIG HARUS SAMA DENGAN FRONTEND ===
const EXP_PER_FEED = 20;
const FEED_COOLDOWN_MS = 30 * 60 * 1000; // 30 menit
const DB_FILE = path.join(process.cwd(), "data", "database-fish.json");

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
    // file belum ada ? buat kosong
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

async function writeDb(db: DbSchema): Promise<void> {
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    const tokenId = body?.tokenId as string | undefined;
    const rarity = body?.rarity as Rarity | undefined;
    const walletAddress = body?.walletAddress as string | undefined;

    if (!tokenId || !rarity || !walletAddress) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PARAMS" },
        { status: 400 }
      );
    }

    const db = await readDb();
    const now = Date.now();

    let fish = db.fishes.find((f) => f.tokenId === tokenId);

    // kalau belum ada record ? buat baru
    if (!fish) {
      fish = {
        tokenId,
        rarity,
        level: 1,
        exp: 0,
        lastFeedAt: null,
      };
      db.fishes.push(fish);
    } else {
      // sinkronkan rarity jika berubah (misal upgrade)
      fish.rarity = rarity;
    }

    const maxLevel = MAX_LEVEL_BY_RARITY[rarity];

    // cooldown check
    if (fish.lastFeedAt != null) {
      const diff = now - fish.lastFeedAt;
      if (diff < FEED_COOLDOWN_MS) {
        const remainingMs = FEED_COOLDOWN_MS - diff;
        return NextResponse.json(
          {
            ok: false,
            error: "ON_COOLDOWN",
            remainingMs,
          },
          { status: 429 }
        );
      }
    }

    // tambah EXP
    let level = fish.level;
    let exp = fish.exp + EXP_PER_FEED;

    // naik level kalau cukup EXP
    while (true) {
      const needed = expNeededForLevel(level, rarity);
      if (needed === 0) break; // sudah max level
      if (exp < needed) break;

      exp -= needed;
      level += 1;

      if (level >= maxLevel) {
        level = maxLevel;
        exp = 0; // atau clamp, tapi di UI nanti "MAX"
        break;
      }
    }

    // clamp di max level
    if (level >= maxLevel) {
      level = maxLevel;
      exp = 0;
    }

    fish.level = level;
    fish.exp = exp;
    fish.lastFeedAt = now;

    await writeDb(db);

    const expNeededNext = expNeededForLevel(level, rarity);
    const isMax = level >= maxLevel;

    return NextResponse.json({
      ok: true,
      tokenId,
      rarity,
      level,
      exp,
      expNeededNext,
      isMax,
      cooldownMs: FEED_COOLDOWN_MS,
    });
  } catch (err) {
    console.error("FEED route error:", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
