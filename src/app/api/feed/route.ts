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

// EXP per feed sesuai rules
const EXP_PER_FEED = 20;

// Cooldown feed: FIX 30 menit (bukan dari .env)
const FEED_COOLDOWN_MIN = 30;
const FEED_COOLDOWN_MS = FEED_COOLDOWN_MIN * 60 * 1000;

const MAX_LEVEL_BY_RARITY: Record<Rarity, number> = {
  COMMON: 15,
  UNCOMMON: 20,
  RARE: 30,
  SPIRIT: 25,
  EPIC: 40,
  LEGENDARY: 50,
};

// Rumus resmi: 100 + (level-1) * 40 (semua rarity, beda cuma max level)
function expNeededForLevel(rarity: Rarity, level: number): number {
  const maxLevel = MAX_LEVEL_BY_RARITY[rarity];
  if (level >= maxLevel) return 0;

  const safeLevel = Math.max(1, Math.min(level, maxLevel));
  return 100 + (safeLevel - 1) * 40;
}

function applyExpGain(
  rarity: Rarity,
  currentLevel: number,
  currentExp: number,
  gain: number
): FishProgress {
  const maxLevel = MAX_LEVEL_BY_RARITY[rarity];
  let level = Math.max(1, Math.min(currentLevel || 1, maxLevel));
  let exp = Math.max(0, currentExp || 0);
  let remainingGain = gain;

  while (remainingGain > 0 && level < maxLevel) {
    const needed = expNeededForLevel(rarity, level);
    if (needed <= 0) {
      level = maxLevel;
      exp = 0;
      break;
    }

    const missing = needed - exp;

    if (remainingGain < missing) {
      exp += remainingGain;
      remainingGain = 0;
      break;
    }

    // Naik level
    remainingGain -= missing;
    level += 1;
    exp = 0;
  }

  const expNeededNext = expNeededForLevel(rarity, level);
  const isMax = level >= maxLevel || expNeededNext === 0;

  return {
    level,
    exp: isMax ? 0 : exp,
    expNeededNext: isMax ? 0 : expNeededNext,
    isMax,
  };
}

async function loadDb(): Promise<DbShape> {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as DbShape;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      // Belum ada DB ? anggap kosong
      return {};
    }
    console.error("[feed] Failed to read DB:", err);
    return {};
  }
}

async function saveDb(db: DbShape): Promise<void> {
  try {
    await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("[feed] Failed to write DB:", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const tokenIdRaw = body?.tokenId;
    const rarity = body?.rarity as Rarity | undefined;
    const walletAddress = body?.walletAddress as string | undefined;

    if (!tokenIdRaw || !rarity || !walletAddress) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY" },
        { status: 400 }
      );
    }

    const tokenKey = String(tokenIdRaw);

    const db = await loadDb();
    const now = Date.now();

    const existing = db[tokenKey] || { level: 1, exp: 0 };

    const lastFeedAt = existing.lastFeedAt ?? 0;
    const sinceLast = now - lastFeedAt;

    // Cek cooldown server
    if (sinceLast < FEED_COOLDOWN_MS) {
      const remainingMs = FEED_COOLDOWN_MS - sinceLast;
      return NextResponse.json(
        {
          ok: false,
          error: "ON_COOLDOWN",
          remainingMs,
        },
        { status: 429 }
      );
    }

    const beforeLevel = Number.isFinite(existing.level) ? existing.level : 1;
    const beforeExp = Number.isFinite(existing.exp) ? existing.exp : 0;

    const updated = applyExpGain(
      rarity,
      beforeLevel,
      beforeExp,
      EXP_PER_FEED
    );

    db[tokenKey] = {
      level: updated.level,
      exp: updated.isMax ? 0 : updated.exp,
      lastFeedAt: now,
      rarity,
    };

    await saveDb(db);

    return NextResponse.json(
      {
        ok: true,
        level: updated.level,
        exp: updated.exp,
        expNeededNext: updated.expNeededNext,
        isMax: updated.isMax,
        cooldownMs: FEED_COOLDOWN_MS,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[feed] Unexpected error:", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
