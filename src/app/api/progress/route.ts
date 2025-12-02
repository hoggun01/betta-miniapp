// src/app/api/progress/route.ts

import { NextRequest, NextResponse } from "next/server";
import {
  getManyProgress,
  expNeeded,
  getMaxLevelForRarity,
  type Rarity,
} from "@/lib/fishProgressStore";

type ProgressItem = {
  tokenId: string;
  rarity: Rarity;
};

type ProgressBody = {
  items?: ProgressItem[];
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ProgressBody;
    const items = body.items || [];

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_ITEMS" },
        { status: 400 }
      );
    }

    const normalizedItems: ProgressItem[] = items
      .map((i) => ({
        tokenId: i.tokenId?.toString(),
        rarity: i.rarity,
      }))
      .filter((i) => i.tokenId && i.rarity) as ProgressItem[];

    if (normalizedItems.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_VALID_ITEMS" },
        { status: 400 }
      );
    }

    const rows = getManyProgress(normalizedItems);

    const payload = rows.map((p) => {
      const maxLevel = getMaxLevelForRarity(p.rarity);
      const level = p.level;
      const exp = p.exp;
      const expNeededNext = level >= maxLevel ? 0 : expNeeded(level);

      return {
        tokenId: p.tokenId,
        rarity: p.rarity,
        level,
        exp,
        expNeededNext,
        isMax: level >= maxLevel,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        progress: payload,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[/api/progress] INTERNAL_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
