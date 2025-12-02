// /src/app/api/progress/route.ts
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
  lastFeedAt: number;
};

type FishDB = Record<string, FishEntry>;

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "database-fish.json");

const BASE_EXP = 100;
const EXP_STEP = 40;

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
    console.error("loadDB (progress) error:", err);
    return {};
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

function expNeededForNext(level: number, rarity: Rarity): number {
  const max = getMaxLevel(rarity);
  if (level >= max) return 0;
  return BASE_EXP + (level - 1) * EXP_STEP;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || !Array.isArray(body.fishes)) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const fishes = body.fishes as { tokenId: string; rarity: Rarity }[];

    const db = loadDB();

    const progressByToken: Record<
      string,
      { level: number; exp: number; expNeededNext: number; isMax: boolean }
    > = {};

    for (const f of fishes) {
      if (!f || !f.tokenId) continue;

      const tokenId = String(f.tokenId);
      const rarity = f.rarity;

      const existing = db[tokenId];

      const level = existing?.level ?? 1;
      const exp = existing?.exp ?? 0;

      const maxLevel = getMaxLevel(rarity);
      const isMax = level >= maxLevel;
      const expNeededNext = expNeededForNext(level, rarity);

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
    console.error("PROGRESS route INTERNAL_ERROR:", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
