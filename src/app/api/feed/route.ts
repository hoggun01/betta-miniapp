import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const backend = process.env.NEXT_PUBLIC_BETTA_BACKEND_URL;
    if (!backend) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BACKEND_URL" },
        { status: 500 }
      );
    }

    const body = await req.json();

    const r = await fetch(`${backend}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: "BACKEND_INVALID_JSON", raw: text };
    }

    return NextResponse.json(data, { status: r.status });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
