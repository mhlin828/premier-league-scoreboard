/**
 * app/api/football/rounds/route.ts
 * 
 * GET /api/football/rounds?current=true
 * GET /api/football/rounds  （不傳 current 也可以，預設抓當前輪次）
 * 
 * 對應原本的：fixtures/rounds?league=39&season=2025&current=true
 */

import { NextResponse } from "next/server";
import { footballGet } from "@/utils/footballApi";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const current = url.searchParams.get("current"); // "true" or null

    const query = current === "true"
      ? "/fixtures/rounds?league=39&season=2025&current=true"
      : "/fixtures/rounds?league=39&season=2025";

    const data = await footballGet(query);
    return NextResponse.json(data);

  } catch (error) {
    console.error("Rounds API 錯誤:", error);
    return NextResponse.json({ error: "Failed to fetch rounds" }, { status: 500 });
  }
}
