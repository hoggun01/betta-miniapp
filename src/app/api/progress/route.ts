// src/app/api/progress/route.ts

import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateProgress,
  getMaxLevelForRarity,
  expNeeded,
  type Rarity,
} from "@/lib/fishProgressStore";

type InputFish = {
  tokenId: string;
  rarity: Rarity;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fishes = (body?.fishes ?? []) as InputFish[];

    if (!Array.isArray(fishes) || fishes.length === 0) {
      return NextResponse.json({ ok: true, progressByToken: {} });
    }

    const progressByToken: Record<
      string,
      {
        level: number;
        exp: number;
        expNeededNext: number;
        isMax: boolean;
      }
    > = {};

    for (const f of fishes) {
      if (!f?.tokenId || !f?.rarity) continue;

      const prog = getOrCreateProgress(f.tokenId, f.rarity);
      const maxLevel = getMaxLevelForRarity(prog.rarity);
      const isMax = prog.level >= maxLevel;
      const expNext = isMax ? 0 : expNeeded(prog.level);

      progressByToken[f.tokenId] = {
        level: prog.level,
        exp: prog.exp,
        expNeededNext: expNext,
        isMax,
      };
    }

    return NextResponse.json({ ok: true, progressByToken });
  } catch (err) {
    console.error("/api/progress error", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
