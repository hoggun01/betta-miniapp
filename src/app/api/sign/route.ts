import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return NextResponse.json(
    {
      ok: false,
      error: "Sign endpoint not implemented yet.",
    },
    { status: 501 }
  );
}

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      message: "Sign route placeholder is running.",
    },
    { status: 200 }
  );
}
