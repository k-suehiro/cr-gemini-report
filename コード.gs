// --- 1. Webアプリ表示 ---
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('Gemini 利用状況ダッシュボード')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 全アカウント（メールアドレス）のリストを「外部の社員DBシート」から取得する関数
function getAllWorkspaceUsers() {
  const EXTERNAL_DB_ID = '1Q9Qdk7K1t_L0KcI0I_J7W62fFHO8i4SW9IZ1jb6L4-k';
  let allUsers = [];
  
  try {
    const accountListSheet = SpreadsheetApp.openById(EXTERNAL_DB_ID).getSheetByName('アカウントリスト');
    const empData = accountListSheet.getDataRange().getValues();
    
    const headers = empData[0];
    const emailIdx = headers.indexOf('メールアドレス');
    
    // 2行目から最終行までループしてメールアドレスを抽出
    for (let i = 1; i < empData.length; i++) {
      const email = String(empData[i][emailIdx] || "").toLowerCase().trim();
      if (email) {
        allUsers.push(email); // メールアドレスを配列に格納
      }
    }
  } catch(e) { 
    console.error("社員DBからのアカウント取得に失敗しました: " + e.message); 
  }
  
  return allUsers; 
}

// --- 2. ダッシュボード用データ取得 ---
function getDashboardData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cacheSheet = ss.getSheetByName('DashboardCache');
  if (!cacheSheet) return { users: [], error: "キャッシュシートが見つかりません" };
  const values = cacheSheet.getDataRange().getValues();
  if (values.length < 2) return { users: [], error: "データが未集計です" };
  
  const updatedAt = cacheSheet.getRange("Z1").getValue();
  const periodStr = cacheSheet.getRange("Z2").getValue();

  const users = values.slice(1).map(row => ({
    email: String(row[0]),
    kanji: String(row[1] || row[0]),
    iconUrl: String(row[2] || ""),
    dept: String(row[3] || "-"),
    usage: String(row[4] || "低"),
    daysUsed: Number(row[5] || 0),
    appUsage: row[6] ? JSON.parse(row[6]) : {},
    totalActions: Number(row[7] || 0),
    dailyDetail: row[8] ? JSON.parse(row[8]) : {} // 詳細履歴
  }));

  return { users, updatedAt: String(updatedAt), period: String(periodStr) };
}

// --- 3. 重い計算処理（JST時刻変換・詳細記録版） ---
function refreshDashboardCache() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('LogStorage');
  const cacheSheet = ss.getSheetByName('DashboardCache') || ss.insertSheet('DashboardCache');
  const EXTERNAL_DB_ID = '1Q9Qdk7K1t_L0KcI0I_J7W62fFHO8i4SW9IZ1jb6L4-k';
  
  const EXCLUDE_CATEGORY_SET = new Set(['協力会社', '退職者', '共有', '未設定', 'マインズ', 'パセイジ']);

  const empMap = {};
  try {
    const accountListSheet = SpreadsheetApp.openById(EXTERNAL_DB_ID).getSheetByName('アカウントリスト');
    const empData = accountListSheet.getDataRange().getValues();
    const headers = empData[0];
    const emailIdx = headers.indexOf('メールアドレス'), nameIdx = headers.indexOf('名前'), iconIdx = headers.indexOf('アイコンURL'), deptIdx = headers.indexOf('所属'), categoryIdx = headers.indexOf('区分');
    for (let i = 1; i < empData.length; i++) {
      const email = String(empData[i][emailIdx] || "").toLowerCase().trim();
      const name = String(empData[i][nameIdx] || "");
      const dept = String(empData[i][deptIdx] || "");
      const category = String(empData[i][categoryIdx] || "");
      if (email && !EXCLUDE_CATEGORY_SET.has(category)) {
        empMap[email] = { name: name, icon: empData[i][iconIdx], dept: dept };
      }
    }
  } catch(e) { console.error("社員DB取得失敗: " + e.message); }

  const lastRow = logSheet.getLastRow();
  const userStats = {};
  let minLogDate = null, maxLogDate = null;

  if (lastRow > 1) {
    const allData = logSheet.getRange(2, 1, lastRow - 1, 4).getValues();
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 27, 0, 0, 0);
    
    allData.forEach(row => {
      const logDate = new Date(row[0]);
      if (logDate >= startDate) {
        if (!minLogDate || logDate < minLogDate) minLogDate = logDate;
        if (!maxLogDate || logDate > maxLogDate) maxLogDate = logDate;

        const email = String(row[1]).toLowerCase().trim();
        const appName = row[3] || "その他";
        
        // 全て日本時間(JST)でフォーマット
        const dateStr = Utilities.formatDate(logDate, "JST", "yyyy/MM/dd");

        if (!userStats[email]) userStats[email] = { total: 0, apps: {}, dates: new Set(), daily: {} };
        
        userStats[email].total++;
        userStats[email].dates.add(dateStr);
        userStats[email].apps[appName] = (userStats[email].apps[appName] || 0) + 1;
        
        // 詳細履歴（日付 > アプリ > 回数）
        if (!userStats[email].daily[dateStr]) userStats[email].daily[dateStr] = {};
        if (!userStats[email].daily[dateStr][appName]) userStats[email].daily[dateStr][appName] = 0;

        // 配列に時間を追加するのではなく、シンプルに数値を +1 するだけ
        userStats[email].daily[dateStr][appName]++;
      }
    });
  }

  const usageCounts = Object.keys(empMap).map(email => userStats[email] ? userStats[email].total : 0).sort((a, b) => b - a);
  const top10Threshold = usageCounts.length > 0 ? usageCounts[Math.floor(usageCounts.length * 0.1)] : 999;
  const APP_LIST = ['Gmail', 'Google ドキュメント', 'Google スプレッドシート', 'Google スライド', 'Google ドライブ', 'Google Meet', 'Studio', 'Google Vids', 'Gemini App'];

  const rows = Object.keys(empMap).map(email => {
    const stats = userStats[email] || { total: 0, apps: {}, dates: { size: 0 }, daily: {} };
    const userInfo = empMap[email];
    const appUsage = {};
    APP_LIST.forEach(app => { appUsage[app] = (stats.apps[app] || 0) > 0; });
    
    let usageLevel = stats.total > 0 ? ((stats.total >= 20 && stats.total >= top10Threshold) ? "高" : (stats.total >= 5 ? "中" : "低")) : "未使用";
    
    let dailyJson = JSON.stringify(stats.daily);
    // 念のための安全装置：万が一それでも45,000文字を超える場合は詳細履歴を空にする
    if (dailyJson.length > 45000) {
      dailyJson = JSON.stringify({});
    }

    return [
      email, userInfo.name || email, userInfo.icon || "", userInfo.dept || "-",
      usageLevel, Math.min(stats.dates.size || 0, 28), JSON.stringify(appUsage), stats.total, dailyJson
    ];
  });

  cacheSheet.clear();
  cacheSheet.getRange(1, 1, 1, 9).setValues([["Email", "名前", "アイコン", "所属", "使用量", "使用日数", "アプリ利用状況", "利用回数", "詳細JSON"]]);
  if (rows.length > 0) cacheSheet.getRange(2, 1, rows.length, 9).setValues(rows);
  
  // Z1(更新日時)も日本時間で保存
  cacheSheet.getRange("Z1").setValue(Utilities.formatDate(new Date(), "JST", "yyyy/MM/dd HH:mm:ss"));
  const periodStr = (minLogDate && maxLogDate) ? Utilities.formatDate(minLogDate, "JST", "yyyy/MM/dd") + " 〜 " + Utilities.formatDate(maxLogDate, "JST", "yyyy/MM/dd") : "データなし";
  cacheSheet.getRange("Z2").setValue(periodStr);
}

// --- 4. 毎日ログを拾う関数 ---
function fetchYesterdayLogs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let logSheet = ss.getSheetByName('LogStorage');
  const now = new Date();
  const startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
  const endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
  let pageToken = null;
  const applicationName = 'gemini_in_workspace_apps';

  try {
    do {
      const optionalArgs = { startTime: startTime.toISOString(), endTime: endTime.toISOString(), maxResults: 1000, pageToken: pageToken };
      const response = AdminReports.Activities.list('all', applicationName, optionalArgs);
      if (response.items && response.items.length > 0) {
        const rows = response.items.map(activity => {
          let appName = "その他";
          const params = activity.events[0].parameters;
          if (params) {
            params.forEach(p => {
              const key = p.name.toLowerCase();
              const val = (p.value || "").toLowerCase();
              if (key.includes('product') || key.includes('client') || key.includes('app_name')) {
                if (val.includes('gmail')) appName = 'Gmail';
                else if (val.includes('docs') || val.includes('document')) appName = 'Google ドキュメント';
                else if (val.includes('sheets') || val.includes('spreadsheet')) appName = 'Google スプレッドシート';
                else if (val.includes('slides') || val.includes('presentation')) appName = 'Google スライド';
                else if (val.includes('drive')) appName = 'Google ドライブ';
                else if (val.includes('meet')) appName = 'Google Meet';
                else if (val.includes('gemini') || val.includes('web')) appName = 'Gemini App';
                else appName = p.value; // 主要リストにない場合は、Googleの生データをそのまま採用
              }
            });
          }
          return [activity.id.time, activity.actor.email, activity.events[0].name, appName];
        });
        logSheet.getRange(logSheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
      }
      
      pageToken = response.nextPageToken;
    } while (pageToken);
  } catch (e) { console.error("エラー: " + e.message); }

  // ▼▼▼ 突合・シート出力処理 ▼▼▼
  try {
    // 1. ログ全体のユーザー（B列）を取得して activeUsers を作成
    const activeUsers = [];
    const lastRow = logSheet.getLastRow();
    if (lastRow > 1) {
      // B列（インデックス2）からデータを取得
      const logs = logSheet.getRange(2, 2, lastRow - 1, 1).getValues();
      logs.forEach(row => {
        if (row[0]) activeUsers.push(String(row[0]).toLowerCase().trim());
      });
    }

    // 2. 全ユーザーを取得して突合
    const allUsers = getAllWorkspaceUsers(); // 追記いただいた関数を呼び出し
    let finalOutputData = [];
    finalOutputData.push(["ユーザー", "利用状況"]); 

    allUsers.forEach(user => {
      const lowerUser = user.toLowerCase();
      // ログにメールアドレスが存在するかチェック
      if (activeUsers.includes(lowerUser)) {
        finalOutputData.push([user, "利用あり"]);
      } else {
        finalOutputData.push([user, "未利用"]);
      }
    });

    // 3. シートに出力（なければ作成）
    let outputSheet = ss.getSheetByName("利用状況まとめ");
    if (!outputSheet) {
      outputSheet = ss.insertSheet("利用状況まとめ");
    }
    outputSheet.clearContents();
    outputSheet.getRange(1, 1, finalOutputData.length, finalOutputData[0].length).setValues(finalOutputData);
    
  } catch(e) {
    console.error("まとめシート作成エラー: " + e.message);
  }
}

// --- 5. 1日1回の定期実行用メイン関数 ---
function dailyUpdateFlow() {
  console.log("--- 定期更新フローを開始します ---");
  
  // 1. まず前日のログを取得して LogStorage に追加
  console.log("ステップ1: 前日のログを取得中...");
  fetchYesterdayLogs(); 
  
  // 2. ログの追加が終わったら、即座にダッシュボードを集計・更新
  console.log("ステップ2: ダッシュボードを集計中...");
  refreshDashboardCache();
  
  console.log("--- すべての更新処理が完了しました ---");
}