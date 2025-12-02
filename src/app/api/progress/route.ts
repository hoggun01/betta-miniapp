// src/app/api/progress/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateProgress,
  expNeeded,
  getMaxLevelForRarity,
  type Rarity,
} from "@/lib/fishProgressStore";

type FishInput = {
  tokenId: string;
  rarity: Rarity;
};

type ProgressPayload = {
  level: number;
  exp: number;
  expNeededNext: number;
  isMax: boolean;
};

export async function POST(req: NextRequest) {
  let body: any = null;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const fishes = body?.fishes as FishInput[] | undefined;
  if (!Array.isArray(fishes) || fishes.length === 0) {
    return NextResponse.json(
      { ok: false, error: "NO_FISHES" },
      { status: 400 }
    );
  }

  const progressByToken: Record<string, ProgressPayload> = {};

  for (const item of fishes) {
    if (!item || !item.tokenId || !item.rarity) continue;

    const prog = getOrCreateProgress(item.tokenId, item.rarity);
    const maxLevel = getMaxLevelForRarity(prog.rarity);
    const isMax = prog.level >= maxLevel;
    const expNext = isMax ? 0 : expNeeded(prog.level);

    progressByToken[item.tokenId] = {
      level: prog.level,
      exp: prog.exp,
      expNeededNext: expNext,
      isMax,
    };
  }

  return NextResponse.json({
    ok: true,
    progressByToken,
  });
}
