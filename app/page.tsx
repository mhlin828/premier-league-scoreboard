"use client";

import { useEffect, useRef, useState} from "react";
import { 
  useRive, 
  useViewModel,
  useViewModelInstance,
  useViewModelInstanceList,
  useViewModelInstanceTrigger,
  ViewModelInstance,
  Layout, Fit, Alignment, decodeImage

} from "@rive-app/react-webgl2";

export default function Home() {
  const { rive, RiveComponent } = useRive({
    src: "/scoreboard.riv",
    artboard: "ScoreBoard",
    stateMachines: "State Machine 1",
    layout: new Layout({ 
      fit: Fit.Layout,
      alignment: Alignment.TopCenter
    }),
    autoplay: true,
    autoBind: false,
    useOffscreenRenderer: true,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [currentRoundNum, setCurrentRoundNum] = useState<number>(24);
  
  // 🔥 修正：使用 useRef 保存最新的 currentRoundNum 值
  const currentRoundNumRef = useRef(24);

  // --- 新增：用來存放卡片實例的 State ---
  const [cardInstances, setCardInstances] = useState<ViewModelInstance[]>([]);

  // 1. 宣告 ViewModel
  const scoreBoardVM = useViewModel(rive, { name: "ScoreBoardVM" });
  const scoreBoardVmi = useViewModelInstance(scoreBoardVM, { rive });
  const scoreCardVM = useViewModel(rive, { name: "ScoreCardVM" });
  const playerCardVM = useViewModel(rive, { name: "PlayerCardVM" });

  // 2. 取得 List 控制權
  const { addInstance, length, removeInstanceAt } = useViewModelInstanceList("scoreCardList", scoreBoardVmi);

  // 🔥 修正：每次 currentRoundNum 更新時同步到 ref
  useEffect(() => {
    currentRoundNumRef.current = currentRoundNum;
  }, [currentRoundNum]);

  // 3. 圖片處理函式
  const fetchAndDecodeImage = async (url: string) => {
    try {
      //const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
      //const response = await fetch(proxyUrl);

      // 呼叫你剛寫好的 API Route
      const response = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
      if (!response.ok) throw new Error("Proxy fetch failed");

      const buffer = await response.arrayBuffer();
      return await decodeImage(new Uint8Array(buffer));
    } catch (e) {
      console.error("圖片抓取失敗:", e);
      return null;
    }
  };

  // 這個鎖會跟隨 Home 組件的生命週期，只會初始化一次
  const hasDataBeenAdded = useRef(false);
  const activeInstancesCount = useRef(0);
  // [Bug #2 修正] 用於保存上一次 loadRound 的清理函式
  const previousCleanupRef = useRef<(() => void) | null>(null);

  // --- 修正後的 loadRound 函式 ---
  const loadRound = async (roundName: string) => {
    // 0. 安全檢查與鎖定
    if (!rive || !scoreCardVM || !scoreBoardVmi) return;
    
    // [Bug #2 修正] 執行上一次的清理函式（取消所有待處理的圖片載入）
    if (previousCleanupRef.current) {
      previousCleanupRef.current();
      previousCleanupRef.current = null;
    }
    
    setIsLoading(true); // [修正] 開始讀取，鎖住按鈕
    
    // 1. [Bug #3 修正] 使用 try-catch 保護計數器，確保即使刪除失敗也能正確追蹤
    const toRemove = activeInstancesCount.current;
    let successfullyRemoved = 0;
    
    for (let j = 0; j < toRemove; j++) {
      try {
        removeInstanceAt(0); // 永遠刪除第 0 個
        successfullyRemoved++;
      } catch (error) {
        console.error(`刪除實例 ${j} 失敗:`, error);
        // 即使失敗也繼續嘗試刪除其他實例
      }
    }

    // 根據實際刪除數量更新計數器
    activeInstancesCount.current = Math.max(0, activeInstancesCount.current - successfullyRemoved);
    
    // 清空 React 陣列
    setCardInstances([]);

    // 給 DOM 一點時間反應
    //await sleep(20);

    scoreBoardVmi!.boolean("isDataLoaded").value = false;

    try {

      // 2. Fetch API 資料（經過 server-side API route）
      const response = await fetch(`/api/football/fixtures?round=${encodeURIComponent(roundName)}`);
      if (!response.ok) throw new Error(`Fixtures fetch failed: ${response.status}`);
      const data = await response.json();
      const matches = data.response;

      if (!matches || matches.length === 0) {
        console.warn("查無賽事資料");
        setIsLoading(false); 
        return;
      }

      scoreBoardVmi.boolean("isDataLoaded").value = true;

      const newInstances: ViewModelInstance[] = [];
      // [Bug #2 修正] 用於追蹤需要清理的圖片和取消標記
      const imageCleanupTasks: Array<() => void> = [];

      // [時間差優化] 方案 A：先預載入所有圖片
      //console.log("開始預載入圖片...");
      const imagePromises = matches.map(match => 
        Promise.all([
          fetchAndDecodeImage(match.teams.home.logo),
          fetchAndDecodeImage(match.teams.away.logo)
        ]).catch(err => {
          console.error(`圖片預載入失敗 (fixture ${match.fixture.id}):`, err);
          return [null, null]; // 失敗時返回 null
        })
      );
      
      const allImages = await Promise.all(imagePromises);
      //console.log("圖片預載入完成");

      // 3. 生成新卡片 (現在圖片已在記憶體中，時間差會非常平均)
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const [hImg, aImg] = allImages[i];
        
        const newCardVmi = scoreCardVM.instance();
        if (newCardVmi) {
          // 文字設定
          newCardVmi.string("fixtureId").value = String(match.fixture.id);
          newCardVmi.string("venueName").value = match.fixture.venue.name || "Unknown Venue";
          newCardVmi.string("date").value = match.fixture.date.split('T')[0];

          const time = match.fixture.date.match(/T(\d{2}:\d{2})/);
          newCardVmi.string("time").value = time ? time[1] : "";
          newCardVmi.string("matchStatus").value = match.fixture.status.long;

          // 1. 取得 API 原始狀態與時間數據
          const status = match.fixture.status.short;
          const elapsed = match.fixture.status.elapsed;
          const extra = match.fixture.status.extra;

          let isLive = false;
          let liveDisplay = "";

          // 2. 判斷是否為「進行中」相關狀態 (包含半場、中場、延長賽、點球)
          const liveStatuses = ["1H", "2H", "HT", "ET", "P", "BT"];
          if (liveStatuses.includes(status)) {
            isLive = true;

            if (["1H", "2H", "ET"].includes(status)) {
              // 處理常規與延長賽時間 (含補時顯示)
              liveDisplay = extra ? `LIVE ${elapsed}+${extra}'` : `LIVE ${elapsed}'`;
            } else if (status === "HT") {
              liveDisplay = "LIVE HT";
            } else if (status === "P") {
              liveDisplay = "LIVE PEN";
            } else if (status === "BT") {
              liveDisplay = "LIVE BT";
            }
          } else { // 非進行中狀態，維持預設
          }

          // 針對新屬性進行賦值
          if (newCardVmi.boolean("isLive")) {
            newCardVmi.boolean("isLive").value = isLive;
            newCardVmi.string("liveDisplay").value = liveDisplay;
          }





          newCardVmi.string("homeTeam").value = match.teams.home.name;
          newCardVmi.string("awayTeam").value = match.teams.away.name;

          newCardVmi.number("homeScore").value = match.goals.home === null ? 0 : Number(match.goals.home);
          newCardVmi.number("awayScore").value = match.goals.away === null ? 0 : Number(match.goals.away);
          
          // [Bug #3 修正] 使用 try-catch 保護 addInstance
          try {
            addInstance(newCardVmi);
            activeInstancesCount.current += 1; // [手動加 1]
          } catch (error) {
            console.error("新增實例失敗:", error);
            continue; // 跳過此卡片
          }

          // 加入列表
          newInstances.push(newCardVmi);

          // [時間差優化] 圖片已預載入，直接設定（同步操作）
          let isCancelled = false;
          let homeImage = hImg;
          let awayImage = aImg;

          // 註冊清理函式
          const cleanup = () => {
            isCancelled = true;
            if (homeImage) {
              try { homeImage.unref(); } catch (e) { console.error("釋放主隊圖片失敗:", e); }
            }
            if (awayImage) {
              try { awayImage.unref(); } catch (e) { console.error("釋放客隊圖片失敗:", e); }
            }
          };
          imageCleanupTasks.push(cleanup);

          // 設定圖片到 VMI
          if (hImg && newCardVmi && !isCancelled) {
            const prop = newCardVmi.image("homeTeamBadge");
            if (prop) { 
              prop.value = hImg; 
              homeImage = null;
              hImg.unref(); 
            }
          }
          
          if (aImg && newCardVmi && !isCancelled) {
            const prop = newCardVmi.image("awayTeamBadge");
            if (prop) { 
              prop.value = aImg; 
              awayImage = null;
              aImg.unref(); 
            }
          }

          // 清理未設定的圖片
          if (homeImage) homeImage.unref();
          if (awayImage) awayImage.unref();

          // [關鍵] 平均的時間差（因為圖片已在記憶體中，這個延遲非常準確）
          await sleep(50);
        }
      }

      // 4. 更新 React State（包含清理函式）
      setCardInstances(newInstances);
      
      // [Bug #2 修正] 當下一次 loadRound 被呼叫時，清理所有待處理的圖片任務
      // 這個會在函式開頭被執行（下次切換輪次時）
      const cleanup = () => {
        imageCleanupTasks.forEach(task => task());
      };
      previousCleanupRef.current = cleanup;
      
    } catch (error) {
      console.error("Load Round Failed:", error);
    } finally {
      setIsLoading(false); // [修正] 無論成功失敗，最後都要解鎖
    }
  };


  // 🔥 修正：使用 currentRoundNumRef.current 取得最新值
  useViewModelInstanceTrigger('clickPrevious', scoreBoardVmi, {
    onTrigger: () => {
      if (isLoading) return; // 防止連點
      const nextRound = currentRoundNumRef.current - 1; // 使用 ref 取得最新值
      if (nextRound < 1) return;

      setCurrentRoundNum(nextRound);
      currentRoundNumRef.current = nextRound; // 立即同步到 ref
      scoreBoardVmi.string("subtitle").value = `Matchweek ${nextRound}`;
      loadRound(`Regular Season - ${nextRound}`);
    }
  });

  // 🔥 修正：使用 currentRoundNumRef.current 取得最新值
  useViewModelInstanceTrigger('clickNext', scoreBoardVmi, {
    onTrigger: () => {
      if (isLoading) return; // 防止連點
      const nextRound = currentRoundNumRef.current + 1; // 使用 ref 取得最新值
      if (nextRound > 38) return;

      setCurrentRoundNum(nextRound);
      currentRoundNumRef.current = nextRound; // 立即同步到 ref
      scoreBoardVmi.string("subtitle").value = `Matchweek ${nextRound}`;
      loadRound(`Regular Season - ${nextRound}`);
    }
  });


  useEffect(() => {
    const init = async () => {
      if (!rive || !scoreCardVM || !scoreBoardVmi || hasDataBeenAdded.current) return;
      
      try {
        hasDataBeenAdded.current = true; // 上鎖

        // 1. 抓取 API 預設輪次（經過 server-side API route）
        const roundResponse = await fetch("/api/football/rounds?current=true");
        if (!roundResponse.ok) throw new Error(`Rounds fetch failed: ${roundResponse.status}`);
        const roundData = await roundResponse.json();
        const currentRoundName = roundData.response[0];
        const weekNum = parseInt(currentRoundName.split(' - ')[1]);

        // 2. 初始化 UI
        setCurrentRoundNum(weekNum);
        currentRoundNumRef.current = weekNum; // 🔥 同步到 ref
        scoreBoardVmi.string("subtitle").value = `Matchweek ${weekNum}`;

        // 3. 執行第一次載入
        await loadRound(currentRoundName);

      } catch (err) {
        console.error("初始化失敗:", err);
        hasDataBeenAdded.current = false;
      }
    };

    init();
  }, [rive, scoreCardVM, scoreBoardVmi]); // <-- 注意：這裡移除了 currentRoundNum，防止連鎖反應

  return (
    <main className="fixed inset-0 bg-black"> 
      <div className="w-full h-full">
        <RiveComponent />

        {cardInstances.map((vmi) => {
          // 從 vmi 實例中取出我們塞進去的 fixtureId 作為唯一的 Key
          const id = vmi.string("fixtureId")?.value || Math.random().toString();
          
          return (
            <ScoreCard 
              key={id} 
              instance={vmi} 
              playerFactory={playerCardVM}
            />
          );
        })}

      </div>
    </main>
  );
}

// 子組件：每一張卡片的邏輯控制器
function ScoreCard({ 
  instance, 
  playerFactory,
}: { 
  instance: any; 
  playerFactory: any; 
}) {
  const homeList = useViewModelInstanceList("homePlayerCardList", instance);
  const awayList = useViewModelInstanceList("awayPlayerCardList", instance);
/*
  useViewModelInstanceTrigger('clickLineups', instance, {
    onTrigger: async () => {
    }
  }
);
*/
  const formatPlayerName = (fullName: string) => {
    if (!fullName) return "";
    const names = fullName.trim().split(/\s+/);
    
    // 如果大於一個單字，去掉第一個 (通常是 First Name)
    if (names.length > 1) {
      return names.slice(1).join(" ");
    }
    
    // 只有一個單字則保留
    return fullName;
  };


  // --- 修正後的 X 軸與 Y 軸邏輯 ---
  const mapGridToPos = (
    grid: string, 
    isHome: boolean, 
    rowCounts: Map<number, number>, 
    maxRow: number
  ) => {
    const [rowStr, colStr] = grid.split(':');
    const row = parseInt(rowStr);
    let col = parseInt(colStr);
    const countInRow = rowCounts.get(row) || 1;

    // --- 關鍵修正：如果是客隊，反轉 col 的順序 ---
    // 這樣能確保客隊的 col 1 也是從上方開始排列
    if (!isHome && countInRow > 1) {
      col = countInRow - col + 1;
    }

    // --- Y 軸動態邊界邏輯 ---
    let yMin = 10;
    let yMax = 90;

    if (countInRow === 1) {
      return { 
        x: isHome ? (5 + (row - 1) * (40 / (maxRow - 1 || 1))) : (95 - (row - 1) * (40 / (maxRow - 1 || 1))),
        y: 50 
      };
    } 
    
    // 根據人數調整邊界：人數越少，邊界縮得越窄
    if (countInRow === 2) {
      yMin = 30; // 讓 2 個人大約在 30% 和 70%
      yMax = 70;
    } else if (countInRow === 3) {
      yMin = 20; // 讓 3 個人在 20%, 50%, 80%
      yMax = 80;
    } else {
      // 4 人以上，大膽撐開
      yMin = 10;
      yMax = 90;
    }

    const yRange = yMax - yMin;
    const y = yMin + ((col - 1) / (countInRow - 1)) * yRange;

    // --- X 軸邏輯 (維持總排數平分) ---
    const xStep = 40 / (maxRow > 1 ? maxRow - 1 : 1);
    const x = isHome ? (5 + (row - 1) * xStep) : (95 - (row - 1) * xStep);

    return { x, y };
  };

  // --- 在 updateNodes 執行前，先計算每一排的人數 ---
  const getRowCounts = (startXI: any[]) => {
    const counts = new Map<number, number>();
    startXI.forEach(item => {
      const row = parseInt(item.player.grid.split(':')[0]);
      counts.set(row, (counts.get(row) || 0) + 1);
    });
    return counts;
  };


  // --- 1. 將核心資料邏輯抽離成獨立函式 ---
  const loadMatchData = async () => {
    // 檢查鎖：如果資料已經載入過，就不要再浪費資源去 Fetch
    // 這確保了不管用戶先點 Lineup 還是 Formation，第二次點擊時都會直接用現有資料
    if (instance.boolean("isDataLoaded").value) return;

    const fixtureId = instance.string("fixtureId")?.value;
    if (!fixtureId) return;

    // 清空舊資料防呆
    while (homeList.length > 0) homeList.removeInstanceAt(homeList.length - 1);
    while (awayList.length > 0) awayList.removeInstanceAt(awayList.length - 1);

    try {
      // API 請求（經過 server-side API route，一次抓取 lineups + events）
      const matchRes = await fetch(`/api/football/match?fixtureId=${fixtureId}`);
      if (!matchRes.ok) throw new Error(`Match fetch failed: ${matchRes.status}`);
      const matchData = await matchRes.json();

      const lineupData = matchData.lineups;
      const eventData = matchData.events;
      
      instance.boolean("isDataLoaded").value = true; // 標記資料已讀取
      if (!lineupData || lineupData.length < 2) return;
      instance.boolean("isDataAvailable").value = true; // 標記資料已載入

      instance.string("homeFormation").value = lineupData[0].formation;
      instance.string("awayFormation").value = lineupData[1].formation;

      // 初始化主隊 11 人
      // 建立主客隊的「實例暫存陣列」 (這 11 個就是我們唯一的卡片)
      const homePlayerInstances: any[] = [];
      const awayPlayerInstances: any[] = [];
      const playerNumberMap = new Map<number, number>();

      // A. 初始化 22 個 PlayerCardVM 實例 (用於列表)
      [0, 1].forEach(teamIdx => {
        const isHome = teamIdx === 0;
        const targetList = isHome ? homePlayerInstances : awayPlayerInstances;
        
        lineupData[teamIdx].startXI.forEach((item: any) => {
          playerNumberMap.set(item.player.id, item.player.number);
          const pVmi = playerFactory.instance();
          if (pVmi) {
            pVmi.boolean("isHome").value = isHome;
            pVmi.number("startPlayerId").value = item.player.id;
            pVmi.number("startPlayerNum").value = item.player.number;
            pVmi.string("startPlayerName").value = item.player.name;
            targetList.push(pVmi);
          }
        });
        lineupData[teamIdx].substitutes.forEach((item: any) => 
          playerNumberMap.set(item.player.id, item.player.number)
        );
      });

      // B. 處理比賽事件 (紅黃牌、進球、換人)
      const homeTeamId = lineupData[0].team.id;
      eventData.forEach((event: any) => {
        const teamId = event.team.id;
        const playerId = event.player.id;
        const targetInstances = (teamId === homeTeamId) ? homePlayerInstances : awayPlayerInstances;
        const targetVmi = targetInstances.find(vmi => 
          vmi.number("startPlayerId").value === playerId || 
          (vmi.boolean("subst").value && vmi.number("substPlayerId").value === playerId)
        );

        if (event.type === "subst") {
          const playerOutId = event.player.id;
          const outVmi = targetInstances.find(vmi => vmi.number("startPlayerId").value === playerOutId);
          if (outVmi) {
            outVmi.boolean("subst").value = true;
            outVmi.number("substPlayerId").value = event.assist.id;
            outVmi.string("substPlayerName").value = event.assist.name;
            outVmi.number("substPlayerNum").value = playerNumberMap.get(event.assist.id) || 0;
          }
        }
        if (event.type === "Goal" && event.detail !== "Own Goal" && targetVmi) {
          const isStart = targetVmi.number("startPlayerId").value === playerId;
          targetVmi.number(isStart ? "startPlayerGoals" : "substPlayerGoals").value += 1;
        }
        if (event.type === "Card" && targetVmi) {
          const isStart = targetVmi.number("startPlayerId").value === playerId;
          const yellowProp = isStart ? "startPlayerYellowCards" : "substPlayerYellowCards";
          const redProp = isStart ? "startPlayerIsRed" : "substPlayerIsRed";
          if (event.detail === "Yellow Card") targetVmi.number(yellowProp).value += 1;
          else { targetVmi.boolean(redProp).value = true; if(event.detail.includes("Second")) targetVmi.number(yellowProp).value = 2; }
        }
      });

      // C. 更新 22 個 PlayerNodeVM (巢狀屬性存取)
      [0, 1].forEach(teamIdx => {
        const isHome = teamIdx === 0;
        const teamData = lineupData[teamIdx];
        const rowCounts = getRowCounts(teamData.startXI);
        const maxRow = Math.max(...Array.from(rowCounts.keys()));
        const cardInstances = isHome ? homePlayerInstances : awayPlayerInstances;
        const prefix = isHome ? "homeInstance" : "awayInstance";

        const teamId = lineupData[teamIdx].team.id; // 從 API 取得 ID
        const teamColor = TEAMS_CONFIG[teamId.toString()] || { primary: "FFFFFF", secondary: "CCCCCC", number: "000000" };

        teamData.startXI.forEach((item: any, idx: number) => {
          const nodeVmi = instance.viewModel(prefix + (idx + 1)); // 使用官方建議方式：instance.viewModel("name") 
          const sourceCard = cardInstances[idx];

          if (nodeVmi && sourceCard) {
            nodeVmi.string("row").value = item.player.grid.split(':')[0];

            // 傳入 rowCounts 來計算正確的 Y
            const { x, y } = mapGridToPos(item.player.grid, isHome, rowCounts, maxRow);

            // 設置座標
            nodeVmi.number("x").value = x;
            nodeVmi.number("y").value = y;

            // 設置資訊
            nodeVmi.number("playerId").value = item.player.id;
            nodeVmi.number("playerNum").value = item.player.number;
            //nodeVmi.string("playerName").value = item.player.name;
            nodeVmi.string("playerName").value = formatPlayerName(item.player.name);

            // 設置顏色，修正顏色設定：補上 Alpha 通道 (0xFF...)
            //const isGK = item.player.grid?.startsWith("1:");
            //const teamColors = isGK ? teamData.team.colors.goalkeeper : teamData.team.colors.player;
            //nodeVmi.color("primaryColor").value = parseInt(`FF${teamColors.primary}`, 16);
            //nodeVmi.color("numberColor").value = parseInt(`FF${teamColors.number}`, 16);
            //nodeVmi.color("borderColor").value = parseInt(`FF${teamColors.border}`, 16);

            // 關鍵修改：直接從 TEAMS_CONFIG 獲取顏色，不再區分 GK
            nodeVmi.color("primaryColor").value = parseInt(`FF${teamColor.primary}`, 16);
            nodeVmi.color("borderColor").value = parseInt(`FF${teamColor.secondary}`, 16); 
            nodeVmi.color("numberColor").value = parseInt(`FF${teamColor.number}`, 16);       

            // 同步比賽狀態
            nodeVmi.number("playerYellowCards").value = sourceCard.number("startPlayerYellowCards").value;
            nodeVmi.boolean("playerIsRed").value = sourceCard.boolean("startPlayerIsRed").value;
            nodeVmi.number("playerGoals").value = sourceCard.number("startPlayerGoals").value;
            nodeVmi.boolean("isSubst").value = sourceCard.boolean("subst").value;
          }
        });
      });

      // D. 加入 List 並對齊視覺
      for (let i = 0; i < 11; i++) {
        const hVmi = homePlayerInstances[i];
        const aVmi = awayPlayerInstances[i];
        const hasH = hVmi.boolean("subst").value;
        const hasA = aVmi.boolean("subst").value;
        if (hasH || hasA) {
          hVmi.boolean("subst").value = aVmi.boolean("subst").value = true;
          hVmi.boolean("substShow").value = hasH;
          aVmi.boolean("substShow").value = hasA;
        }
        homeList.addInstance(hVmi);
        awayList.addInstance(aVmi);
        //await sleep(5);
      }

    } catch (error) {
      console.error("處理資料失敗:", error);
      instance.boolean("isDataLoaded").value = false;
    }
  };

  // 監聽兩個 Trigger，都執行 loadMatchData
  useViewModelInstanceTrigger('clickLineups', instance, { onTrigger: loadMatchData });
  useViewModelInstanceTrigger('clickFormations', instance, { onTrigger: loadMatchData });

  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 2025/26 英超球隊顏色配置 (完全取代 API 資料)
// 統一球員與守門員配色 (僅保留 Primary, Secondary, Number)
const TEAMS_CONFIG: Record<string, { primary: string; secondary: string; number: string }> = {
  "33": { "primary": "d00028", "secondary": "", "number": "FFFFFF" }, // Man United
  "34": { "primary": "2eb2fd", "secondary": "", "number": "FFFFFF" }, // Newcastle
  "35": { "primary": "020101", "secondary": "", "number": "FFFFFF" }, // Bournemouth
  "36": { "primary": "090808", "secondary": "", "number": "FFFFFF" }, // Fulham
  "39": { "primary": "FDB913", "secondary": "", "number": "FFFFFF" }, // Wolves
  "40": { "primary": "d11325", "secondary": "", "number": "FFFFFF" }, // Liverpool
  "42": { "primary": "fd0018", "secondary": "", "number": "FFFFFF" }, // Arsenal
  "44": { "primary": "6f193d", "secondary": "", "number": "FFFFFF" }, // Burnley
  "45": { "primary": "233fa4", "secondary": "", "number": "FFFFFF" }, // Everton
  "47": { "primary": "10204a", "secondary": "", "number": "FFFFFF" }, // Tottenham
  "48": { "primary": "530c1b", "secondary": "", "number": "FFFFFF" }, // West Ham
  "49": { "primary": "063781", "secondary": "", "number": "FFFFFF" }, // Chelsea
  "50": { "primary": "6CABDD", "secondary": "", "number": "FFFFFF" }, // Man City
  "51": { "primary": "0057B8", "secondary": "", "number": "FFFFFF" }, // Brighton
  "52": { "primary": "2f66b6", "secondary": "", "number": "FFFFFF" }, // Crystal Palace
  "55": { "primary": "e00014", "secondary": "", "number": "FFFFFF" }, // Brentford
  "63": { "primary": "04266d", "secondary": "", "number": "FFFFFF" }, // Leeds
  "65": { "primary": "a1000b", "secondary": "", "number": "FFFFFF" }, // Nottingham Forest
  "66": { "primary": "480024", "secondary": "", "number": "FFFFFF" }, // Aston Villa
 "746": { "primary": "d90023", "secondary": "", "number": "FFFFFF" } // Sunderland
};