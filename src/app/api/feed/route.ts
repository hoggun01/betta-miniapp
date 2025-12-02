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

const EXP_PER_FEED = 20;

// ? FIXED: cooldown 30 menit
const FEED_COOLDOWN_MS = 30 * 60 * 1000;

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

function saveDb(db: DbShape) {
  try {
    ensureDbFile();
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save db file", err);
  }
}

// Rumus EXP: base 100, +40 tiap level berikutnya
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

    const tokenId = String(body.tokenId ?? "").trim();
    const rarity = String(body.rarity ?? "").toUpperCase() as Rarity;
    const walletAddress = String(body.walletAddress ?? "").toLowerCase();

    if (!tokenId || !walletAddress) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PARAMS" },
        { status: 400 }
      );
    }

    if (!(rarity in MAX_LEVEL_BY_RARITY)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_RARITY" },
        { status: 400 }
      );
    }

    const db = loadDb();
    // ? progress per token (tidak tergantung wallet), supaya tidak reset
    const key = tokenId;
    const now = Date.now();

    const existing = db[key];

    // Cek cooldown
    if (existing?.lastFedAt) {
      const elapsed = now - existing.lastFedAt;
      if (elapsed < FEED_COOLDOWN_MS) {
        const remainingMs = FEED_COOLDOWN_MS - elapsed;
        const level = existing.level ?? 1;
        const exp = existing.exp ?? 0;
        const expNeededNext = expNeededForLevel(rarity, level);
        const maxLevel = MAX_LEVEL_BY_RARITY[rarity];
        const isMax = level >= maxLevel || expNeededNext === 0;

        return NextResponse.json(
          {
            ok: false,
            error: "ON_COOLDOWN",
            remainingMs,
            level,
            exp,
            expNeededNext,
            isMax,
          },
          { status: 429 }
        );
      }
    }

    let level = existing?.level ?? 1;
    let exp = existing?.exp ?? 0;
    const maxLevel = MAX_LEVEL_BY_RARITY[rarity];

    // Kalau sudah max, tetap simpan & kirim isMax
    if (level >= maxLevel) {
      const expNeededNext = 0;
      db[key] = { level, exp, lastFedAt: now };
      saveDb(db);

      const result: FishProgress = {
        level,
        exp,
        expNeededNext,
        isMax: true,
      };

      return NextResponse.json({
        ok: true,
        ...result,
        cooldownMs: FEED_COOLDOWN_MS,
      });
    }

    // Tambah EXP
    exp += EXP_PER_FEED;

    // Handle level up (boleh multi-level kalau EXP cukup)
    let expNeededNext = expNeededForLevel(rarity, level);
    while (expNeededNext > 0 && exp >= expNeededNext && level < maxLevel) {
      exp -= expNeededNext;
      level += 1;
      expNeededNext = expNeededForLevel(rarity, level);
    }

    let isMax = false;
    if (level >= maxLevel) {
      level = maxLevel;
      isMax = true;
      expNeededNext = 0;
      // di UI bar akan 100%, jadi exp di sini tidak terlalu penting
      exp = 0;
    }

    db[key] = {
      level,
      exp,
      lastFedAt: now,
    };
    saveDb(db);

    const result: FishProgress = {
      level,
      exp,
      expNeededNext,
      isMax,
    };

    return NextResponse.json({
      ok: true,
      ...result,
      cooldownMs: FEED_COOLDOWN_MS,
    });
  } catch (err) {
    console.error("Feed API error", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
