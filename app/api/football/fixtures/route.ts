/**
 * app/api/football/fixtures/route.ts
 * 
 * GET /api/football/fixtures?round=Regular+Season+-+24
 * 
 * 對應原本的：fixtures?league=39&season=2025&round=...
 */

import { NextResponse } from "next/server";
import { footballGet } from "@/utils/footballApi";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const round = url.searchParams.get("round");

    if (!round) {
      return NextResponse.json({ error: "缺少 round 參數" }, { status: 400 });
    }

    const data = await footballGet(`/fixtures?league=39&season=2025&round=${encodeURIComponent(round)}`);
    return NextResponse.json(data);

  } catch (error) {
    console.error("Fixtures API 錯誤:", error);
    return NextResponse.json({ error: "Failed to fetch fixtures" }, { status: 500 });
  }
}
