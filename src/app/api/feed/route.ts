// /src/app/api/feed/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPIRIT";

type FishEntry = {
  tokenId: string;
  rarity: Rarity;
  level: number;
  exp: number;
  lastFeedAt: number; // timestamp ms
};

type FishDB = Record<string, FishEntry>;

const EXP_PER_FEED = 20;
const FEED_COOLDOWN_MS = 30 * 60 * 1000; // 30 menit

// ====== PATH DATABASE ======
const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "database-fish.json");

// ====== UTIL DB ======
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadDB(): FishDB {
  try {
    ensureDataDir();
    if (!fs.existsSync(DB_PATH)) {
      return {};
    }
    const raw = fs.readFileSync(DB_PATH, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw) as FishDB;
  } catch (err) {
    console.error("loadDB error:", err);
    return {};
  }
}

function saveDB(db: FishDB) {
  try {
    ensureDataDir();
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("saveDB error:", err);
  }
}

function getMaxLevel(rarity: Rarity): number {
  switch (rarity) {
    case "COMMON":
      return 15;
    case "UNCOMMON":
      return 20;
    case "RARE":
      return 30;
    case "SPIRIT":
      return 25;
    case "EPIC":
      return 40;
    case "LEGENDARY":
      return 50;
    default:
      return 15;
  }
}

// rumus EXP: base 100, tambah 40 per level
// level sekarang -> butuh berapa untuk naik ke level berikutnya
function expNeededForNext(level: number, rarity: Rarity): number {
  const max = getMaxLevel(rarity);
  if (level >= max) return 0;
  const BASE = 100;
  const STEP = 40;
  return BASE + (level - 1) * STEP;
}

function applyFeed(entry: FishEntry): {
  entry: FishEntry;
  expNeededNext: number;
  isMax: boolean;
} {
  const rarity = entry.rarity;
  const maxLevel = getMaxLevel(rarity);

  let level = entry.level || 1;
  let exp = entry.exp || 0;

  let totalExp = exp + EXP_PER_FEED;

  while (true) {
    const need = expNeededForNext(level, rarity);
    if (need === 0) {
      // sudah max level
      exp = 0;
      break;
    }

    if (totalExp >= need && level < maxLevel) {
      totalExp -= need;
      level += 1;
      if (level >= maxLevel) {
        exp = 0;
        break;
      }
    } else {
      exp = totalExp;
      break;
    }
  }

  const isMax = level >= maxLevel;
  const expNeededNext = expNeededForNext(level, rarity);

  return {
    entry: {
      ...entry,
      level,
      exp,
    },
    expNeededNext,
    isMax,
  };
}

// ====== HANDLER ======
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (
      !body ||
      typeof body.tokenId !== "string" ||
      !body.tokenId ||
      !body.rarity
    ) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const tokenId = body.tokenId as string;
    const rarity = body.rarity as Rarity;

    const now = Date.now();
    const db = loadDB();

    let existing = db[tokenId];
    if (!existing) {
      existing = {
        tokenId,
        rarity,
        level: 1,
        exp: 0,
        lastFeedAt: 0,
      };
    } else {
      // kalau rarity di DB beda dengan request terbaru, update saja
      existing.rarity = rarity;
    }

    const lastFeedAt = existing.lastFeedAt || 0;
    const nextAllowed = lastFeedAt + FEED_COOLDOWN_MS;
    if (now < nextAllowed) {
      const remaining = nextAllowed - now;
      return NextResponse.json(
        {
          ok: false,
          error: "ON_COOLDOWN",
          remainingMs: remaining,
        },
        { status: 429 }
      );
    }

    const { entry: updated, expNeededNext, isMax } = applyFeed(existing);
    updated.lastFeedAt = now;

    db[tokenId] = updated;
    saveDB(db);

    return NextResponse.json({
      ok: true,
      tokenId,
      rarity,
      level: updated.level,
      exp: updated.exp,
      expNeededNext,
      isMax,
      cooldownMs: FEED_COOLDOWN_MS,
    });
  } catch (err) {
    console.error("FEED route INTERNAL_ERROR:", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
