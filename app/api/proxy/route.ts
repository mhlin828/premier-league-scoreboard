import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return new NextResponse("URL is required", { status: 400 });
  }

  try {
    const response = await fetch(imageUrl, {
      headers: {
        // 偽裝成一般瀏覽器，避免被 API 伺服器拒絕
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        // 保持原始的檔案類型 (image/png, image/jpeg 等)
        "Content-Type": response.headers.get("Content-Type") || "image/png",
        // 讓瀏覽器快取這張圖片 24 小時，減少重複請求
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return new NextResponse("Error fetching image", { status: 500 });
  }
}