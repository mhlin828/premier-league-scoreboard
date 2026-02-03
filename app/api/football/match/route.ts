/**
 * app/api/football/match/route.ts
 * 
 * GET /api/football/match?fixtureId=123456
 * 
 * 一次回傳 lineups + events，減少 client 發出的請求數
 * 對應原本的：fixtures/lineups + fixtures/events
 */

import { NextResponse } from "next/server";
import { footballGet } from "@/utils/footballApi";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const fixtureId = url.searchParams.get("fixtureId");

    if (!fixtureId) {
      return NextResponse.json({ error: "缺少 fixtureId 參數" }, { status: 400 });
    }

    // 並行請求 lineups + events
    const [lineupData, eventData] = await Promise.all([
      footballGet(`/fixtures/lineups?fixture=${fixtureId}`),
      footballGet(`/fixtures/events?fixture=${fixtureId}`),
    ]);

    return NextResponse.json({
      lineups: lineupData.response,
      events: eventData.response,
    });

  } catch (error) {
    console.error("Match API 錯誤:", error);
    return NextResponse.json({ error: "Failed to fetch match data" }, { status: 500 });
  }
}
