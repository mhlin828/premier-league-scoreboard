/**
 * app/utils/footballApi.ts
 * 
 * 統一的 api-football 請求 helper
 * - key 從 env 讀取（server-side only）
 * - 集中處理 header、錯誤、回傳格式
 */

const BASE_URL = "https://v3.football.api-sports.io";

export async function footballGet(path: string): Promise<any> {
  const apiKey = process.env.FOOTBALL_API_KEY;

  if (!apiKey) {
    throw new Error("FOOTBALL_API_KEY 未設定，請檢查 .env.local");
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: {
      "x-apisports-key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`api-football 回傳錯誤: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
