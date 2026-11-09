/**
 * 水美土雞城 - 店務自動化系統 (C欄營運警示版)
 * 任務：
 * 1. 各時段全面納入外帶與內用統計，時間前置並自動排序。
 * 2. 活化 C 欄 (備註說明) 為【方案 2】：自動偵測大組訂位(10人以上)與純外帶日，方便外籍勞工夥伴看表提早備料與排桌。
 *
 * P0（僅組字／過濾／顯示，不改訂位表、不推播）：
 * 人數 0／空／非法顯示「人數待確認」；只刪已確認的內部註記片段；
 * 合計只統計實際列出的訂單，缺桌數不報假的「共 0 桌」；
 * 不再寫入無查核依據的「✅ 今日預約正常」。
 *
 * 內用／外帶分區（20260927）：每個時段分成「🍽️ 內用」（桌數只算內用）與「🥡 外帶」（筆數）兩區；
 * 總計改為「內用 N 桌＋外帶 M 筆」。大組警示、備註清理／完全相等去重不變。
 */

// =================【系統參數配置】=================
const CONFIG = {
  SOURCE_SS_ID: "1FDLWdXTvnlG3QywUQvB3hsTLkgxJQ0gKOU8aBZqYcpQ",
  DESTINATION_SHEET_ID: "1eE3i1LshGphEm8tcs2OrOaOBuKCeZk-9Fa3HGRnMM8o",
  DEST_SHEET_NAME: "維護排程",
  TIMEZONE: "GMT+8",

  // 內用表欄位索引 (0 開始計算，例如 A=0, B=1...)
  DINE_IN_COLS: {
    NAME: 1,      // B 欄：姓名/客戶
    PEOPLE: 3,    // D 欄：人數
    DATE: 4,      // E 欄：預約日期
    TIME: 6,      // G 欄：預約時間
    REMARK: 7,    // H 欄：備註
    TABLES: 8,    // I 欄：桌數
    STATUS: 10,   // K 欄：狀態
    EST_AMT: 12   // M 欄：預估金額
  },

  // 外帶表欄位索引
  TAKEOUT_COLS: {
    NAME: 1,      // B 欄：姓名/客戶
    CONTENT: 3,   // D 欄：內容
    DATE: 4,      // E 欄：預約日期
    TIME: 5,      // F 欄：時間
    REMARK: 6,    // G 欄：備註
    STATUS: 8     // I 欄：狀態
  }
};

// =================【P0 組字／過濾】=================
// 只刪整段已確認的系統片語。不可裸刪「測試／Owner／電話／取消／系統」。

var P0_EXACT_REMARK_MARKERS_ = [
  "不填電話（電話欄占位00000000）",
  "不填電話(電話欄占位00000000)",
  "Owner 手訂",
  "Owner手訂"
];

function parsePositivePeopleCount_(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!isFinite(raw) || raw <= 0 || Math.floor(raw) !== raw) return null;
    return raw;
  }
  var s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  var n = parseInt(s, 10);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

function formatPeopleToken_(rawPeople, kaCode) {
  if (kaCode) return "(" + kaCode + ")";
  var n = parsePositivePeopleCount_(rawPeople);
  if (n === null) return "人數待確認";
  return "(" + n + ")";
}

function parseKnownTableCount_(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    if (!isFinite(raw) || raw <= 0 || Math.floor(raw) !== raw) return null;
    return raw;
  }
  var s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  var n = parseInt(s, 10);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

function parseRemarkAndCode_(rawRemark, defaultCode) {
  var remark = String(rawRemark || "");
  var kaMatch = remark.match(/(\d+(?:\.\d+)?\s*[Kk]\s*[Xx]?\d*\s*[Aa])/);
  var code = defaultCode;
  var cleanRemark = remark;
  var hasKaCode = false;
  if (kaMatch) {
    hasKaCode = true;
    code = kaMatch[1].toLowerCase().replace(/\s+/g, "");
    cleanRemark = remark.replace(kaMatch[0], "").trim();
  }
  return { code: code, cleanRemark: cleanRemark, hasKaCode: hasKaCode };
}

function stripExactRemarkMarkers_(text) {
  var out = String(text || "");
  for (var i = 0; i < P0_EXACT_REMARK_MARKERS_.length; i++) {
    out = out.split(P0_EXACT_REMARK_MARKERS_[i]).join("");
  }
  return out;
}

function stripSystemTaggedSpan_(segment) {
  // P0 r2：只移除標籤本身，不可 substring(0, idx) 吃掉後面的服務備註。
  var s = String(segment || "");
  s = s.split("[系統附註]").join("");
  s = s.split("[測試資料]").join("");
  return s;
}

function stripTrailingMetaLabels_(segment) {
  // P0 r3：只移除緊貼、已確認的 meta 碎片，不可 /[\s\S]*$/ 吃到段尾。
  // 匯入批次：僅在 VALUE 為已驗證批次格式（可選 batch 前綴 + 純數字）且有明確結束邊界時才刪；
  // 任意非空白／中文服務字不可當批次值（如「匯入批次：花生過敏」「匯入批次：123花生過敏」整段保留）。
  var s = String(segment || "");
  s = s.replace(/\[(?:debug|trace)\]/gi, "");
  s = s.replace(/(^|[\s，,、])(?:debug|trace)\s*[:：=]\s*/gi, "$1");
  s = s.replace(/\bbatch\s*=\s*\d+\b/gi, "");
  s = s.replace(/(^|[\s，,、])\[匯入批次(?:資訊)?\]/g, "$1");
  s = s.replace(/(^|[\s，,、])匯入批次(?:資訊)?\s*[:：]\s*(?:batch[=_-]?)?\d+(?=$|[\s，,、；;\n])/gi, "$1");
  return s;
}

function cleanRemarkSegment_(segment) {
  var original = String(segment || "");
  var s = stripSystemTaggedSpan_(original);
  s = stripTrailingMetaLabels_(s);
  s = s.replace(/[\r\n]+/g, " ");
  s = s.replace(/[（(]\s*[）)]/g, "");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/^[；;\s，,、]+|[；;\s，,、]+$/g, "").trim();
  if (!s) {
    // P0 r3：清完變空時，以「已驗證格式」再探測一次（與 stripTrailingMetaLabels_ 同規則）。
    // 若探測後仍含中文／服務字 → 邊界不清，整段保留待分類；僅確認為已知完整 scrap 才丟棄。
    var probe = stripSystemTaggedSpan_(original);
    probe = stripTrailingMetaLabels_(probe);
    probe = probe.replace(/[\r\n]+/g, " ").trim();
    if (/[\u4e00-\u9fff]/.test(original) && /[\u4e00-\u9fff]/.test(probe.replace(/\bbatch\s*=\s*\d+\b/gi, ""))) {
      return original.replace(/^[；;\s]+|[；;\s]+$/g, "").trim();
    }
    // 原文只有標籤 + 已驗證 batch 等已知碎片：丟棄
    return "";
  }
  if (/^[（）()\s、,，.。:：\-—]+$/.test(s)) return "";
  if (/^(debug|trace)$/i.test(s)) return "";
  if (s === "匯入批次" || s === "匯入批次資訊") return "";
  // P0 r3：不可僅因「無中文 + 含冒號/等號」就當 scrap（會誤刪 Allergy: peanuts、Arrival: 18:30）。
  // 未知內容原樣保留；只刪上方已確認的完整內部碎片格式。
  return s;
}

function filterInternalRemark_(raw) {
  if (raw === null || raw === undefined) return "";
  var parts = stripExactRemarkMarkers_(String(raw)).split(/[；;]/);
  var kept = [];
  for (var i = 0; i < parts.length; i++) {
    var seg = cleanRemarkSegment_(parts[i]);
    if (seg) kept.push(seg);
  }
  return kept.join("；");
}

function sanitizeRemarkField_(remark) {
  var text = String(remark || "").trim();
  if (!text || text === "無特殊備註" || text === "無內容") return "";
  var amountMatch = text.match(/^(預估金額\s*\$[\d,]+(?:\.\d+)?)\s*(?:\((.*)\))?\s*$/);
  if (amountMatch) {
    var filtered = filterInternalRemark_(amountMatch[2] || "");
    if (!filtered) return amountMatch[1];
    return amountMatch[1] + " (" + filtered + ")";
  }
  return filterInternalRemark_(text);
}

function composeDineInRemark_(estAmountRaw, cleanRemark) {
  var filtered = filterInternalRemark_(cleanRemark);
  var estAmount = parseFloat(estAmountRaw);
  if (!isNaN(estAmount) && estAmount > 0) {
    var amountText = "預估金額 $" + estAmount.toLocaleString("en-US");
    if (filtered) return amountText + " (" + filtered + ")";
    return amountText;
  }
  return filtered;
}

function isTakeoutOnlyRemark_(text) {
  // 「外帶」/空白／大小寫變體視為無備註（品項改看 CONTENT）
  var s = String(text || "").replace(/[\s　]+/g, "");
  if (!s) return true;
  return s === "外帶" || s.toLowerCase() === "takeout";
}

function stripRedundantTakeoutLabel_(text) {
  // 去掉備註頭尾多餘的「外帶」標籤（來源已有 (外帶)）
  var s = String(text || "").trim();
  s = s.replace(/^外帶(?=$|[\s　；;，,、])/i, "");
  s = s.replace(/(?:^|[\s　；;，,、])外帶$/i, "");
  s = s.replace(/^[；;\s，,、]+|[；;\s，,、]+$/g, "").trim();
  return s;
}

function composeTakeoutRemark_(cleanRemark, contentRaw) {
  // P0 follow-up：CONTENT（品項）優先；僅「外帶」的 G 欄不擋品項。
  var content = filterInternalRemark_(String(contentRaw || "").trim());
  var remark = filterInternalRemark_(cleanRemark);
  if (isTakeoutOnlyRemark_(remark)) {
    remark = "";
  } else {
    remark = stripRedundantTakeoutLabel_(remark);
    if (isTakeoutOnlyRemark_(remark)) remark = "";
  }
  if (content && remark) {
    // Codex TAKEOUT_DETAIL REJECT：子字串相同≠服務要求相同；僅完整相等才去重
    if (content === remark) return content;
    return content + "；" + remark;
  }
  if (content) return content;
  return remark;
}

function formatTimeValue_(val) {
  if (!val) return "未填";
  if (val instanceof Date) {
    return Utilities.formatDate(val, CONFIG.TIMEZONE, "HH:mm");
  }
  var str = String(val).trim();
  if (str.indexOf(":") !== -1) return str.substring(0, 5);
  return str;
}

function isTargetDate_(cellValue, targetDateStr) {
  if (!cellValue) return false;
  if (cellValue instanceof Date) {
    return Utilities.formatDate(cellValue, CONFIG.TIMEZONE, "yyyy-MM-dd") === targetDateStr;
  }
  // 處理字串型態的日期，將斜線或其它分隔符號統一化
  var normalizedStr = String(cellValue).replace(/\//g, "-").split(" ")[0].trim();
  // 處理簡易格式如 2026-7-4 補零為 2026-07-04 的情況
  try {
    var parsedDate = new Date(normalizedStr);
    if (!isNaN(parsedDate.getTime())) {
      return Utilities.formatDate(parsedDate, CONFIG.TIMEZONE, "yyyy-MM-dd") === targetDateStr;
    }
  } catch (e) {
    // 解析失敗時退回直接字串比對
  }
  return normalizedStr === targetDateStr;
}

function mapDineInRecord_(row) {
  var cols = CONFIG.DINE_IN_COLS;
  var rawRemark = String(row[cols.REMARK] || "").trim();
  var parsed = parseRemarkAndCode_(rawRemark, "");
  return {
    source: "內用",
    name: String(row[cols.NAME] || "客戶").trim(),
    peopleToken: formatPeopleToken_(row[cols.PEOPLE], parsed.hasKaCode ? parsed.code : ""),
    peopleCount: parsePositivePeopleCount_(row[cols.PEOPLE]),
    time: formatTimeValue_(row[cols.TIME]),
    tables: parseKnownTableCount_(row[cols.TABLES]),
    remarkStr: composeDineInRemark_(row[cols.EST_AMT], parsed.cleanRemark)
  };
}

function mapTakeoutRecord_(row) {
  var cols = CONFIG.TAKEOUT_COLS;
  var rawRemark = String(row[cols.REMARK] || "").trim();
  var parsed = parseRemarkAndCode_(rawRemark, "外帶");
  // 無 KA 時 peopleToken 留空，避免與 formatBookingLine_ 的「 (外帶)」重複
  var peopleToken = parsed.hasKaCode ? ("(" + parsed.code + ")") : "";
  return {
    source: "外帶",
    name: String(row[cols.NAME] || "客戶").trim(),
    peopleToken: peopleToken,
    peopleCount: null,
    time: formatTimeValue_(row[cols.TIME]),
    tables: 1,
    remarkStr: composeTakeoutRemark_(parsed.cleanRemark, row[cols.CONTENT])
  };
}

function summarizeListedTables_(orders) {
  var known = 0;
  var unknownOrders = 0;
  var list = orders || [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i].tables;
    if (typeof t === "number" && isFinite(t) && t > 0) known += t;
    else unknownOrders++;
  }
  return { known: known, unknownOrders: unknownOrders, listed: list.length };
}

function formatSessionHeading_(label, summary) {
  if (!summary || summary.listed === 0) return label + " (共 0 桌)";
  if (summary.unknownOrders === 0) return label + " (共 " + summary.known + " 桌)";
  if (summary.known === 0) return label + " (共 " + summary.listed + " 筆，桌數待確認)";
  return label + " (共 " + summary.known + " 桌，另 " + summary.unknownOrders + " 筆桌數待確認)";
}

function formatTakeoutHeading_(count) {
  return "🥡 外帶 (共 " + (count || 0) + " 筆)";
}

function formatDineInTotalPart_(summary) {
  // 內用部分：只算內用；缺桌數沿用 P0 規則（不報假的桌數）
  if (!summary || summary.listed === 0) return "內用 0 桌";
  if (summary.unknownOrders === 0) return "內用 " + summary.known + " 桌";
  if (summary.known === 0) return "內用 " + summary.listed + " 筆桌數待確認";
  return "內用 " + summary.known + " 桌，另 " + summary.unknownOrders + " 筆桌數待確認";
}

function formatGrandTotal_(lunchSession, dinnerSession) {
  var dine = {
    known: lunchSession.summary.known + dinnerSession.summary.known,
    unknownOrders: lunchSession.summary.unknownOrders + dinnerSession.summary.unknownOrders,
    listed: lunchSession.summary.listed + dinnerSession.summary.listed
  };
  var takeoutCount = (lunchSession.takeoutCount || 0) + (dinnerSession.takeoutCount || 0);
  return "(總計 " + formatDineInTotalPart_(dine) + "＋外帶 " + takeoutCount + " 筆)";
}

function formatBookingLine_(order, omitTakeoutLabel) {
  // 外帶區內已有區塊標題，不再每行重複「(外帶)」
  var label = (order.source === "外帶" && !omitTakeoutLabel) ? " (外帶)" : "";
  var token = order.peopleToken ? (" " + order.peopleToken) : "";
  var line = order.time + " " + order.name + token + label;
  if (order.remarkStr) line += " | 備註：" + order.remarkStr;
  return line;
}

function splitOrdersBySource_(orders) {
  var dineIn = [];
  var takeout = [];
  var list = orders || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].source === "外帶") takeout.push(list[i]);
    else dineIn.push(list[i]);
  }
  return { dineIn: dineIn, takeout: takeout };
}

function appendSessionBlock_(label, orders) {
  // 時段標題 → 🍽️ 內用（桌數只算內用）→ 🥡 外帶（筆數；該時段無外帶則不列此區）
  var split = splitOrdersBySource_(orders);
  var summary = summarizeListedTables_(split.dineIn);
  var block = label + "\n\n";
  if (!orders || orders.length === 0) {
    block += "無\n\n";
    return { text: block, summary: summary, takeoutCount: 0 };
  }
  block += formatSessionHeading_("🍽️ 內用", summary) + "\n\n";
  if (split.dineIn.length === 0) {
    block += "無\n\n";
  } else {
    for (var i = 0; i < split.dineIn.length; i++) {
      block += formatBookingLine_(split.dineIn[i], false) + "\n\n";
    }
  }
  if (split.takeout.length > 0) {
    block += formatTakeoutHeading_(split.takeout.length) + "\n\n";
    for (var j = 0; j < split.takeout.length; j++) {
      block += formatBookingLine_(split.takeout[j], true) + "\n\n";
    }
  }
  return { text: block, summary: summary, takeoutCount: split.takeout.length };
}

function buildDigestText_(dayOfWeekEN, dateString, timeStr, lunchOrders, dinnerOrders) {
  var lunch = appendSessionBlock_("☀️ 午餐", lunchOrders);
  var dinner = appendSessionBlock_("🌙 晚餐", dinnerOrders);
  var cell = "[" + dayOfWeekEN + " " + dateString + " " + timeStr + " GMT+8] [" + dateString + " 預約總覽]\n";
  cell += lunch.text;
  cell += dinner.text;
  cell += formatGrandTotal_(lunch, dinner);
  return cell;
}

function buildAlertSummary_(innerUseCount, takeOutCount, maxDineInPeople) {
  if (innerUseCount === 0 && takeOutCount > 0) {
    return "🛵 純外帶日，無內用桌";
  }
  if (innerUseCount > 0 && maxDineInPeople >= 10) {
    return "⚠️ 注意：包含 " + maxDineInPeople + " 人大組訂位！";
  }
  // P0：沒有真實查核就不寫「✅ 今日預約正常」。上方總計已有桌數。
  return "";
}

function syncMaintenanceSchedule() {
  const today = new Date();
  const dateString = Utilities.formatDate(today, CONFIG.TIMEZONE, "yyyy-MM-dd");

  const ss = SpreadsheetApp.openById(CONFIG.SOURCE_SS_ID);
  const destSs = SpreadsheetApp.openById(CONFIG.DESTINATION_SHEET_ID);
  const destSheet = destSs.getSheetByName(CONFIG.DEST_SHEET_NAME);

  if (!destSheet) throw new Error(`找不到「${CONFIG.DEST_SHEET_NAME}」分頁。`);

  let allData = [];
  let maxDineInPeople = 0; // 紀錄當天內用人數最多的一單是多少人
  let innerUseCount = 0;   // 內用總筆數
  let takeOutCount = 0;    // 外帶總筆數

  // ================= 1. 抓取內用資料 (工作表1) =================
  const sourceSheetA = ss.getSheets()[0];
  const dataA = sourceSheetA.getDataRange().getValues();
  const colsA = CONFIG.DINE_IN_COLS;

  const innerUse = dataA.slice(1).filter(row => {
    const isToday = isTargetDate_(row[colsA.DATE], dateString);
    const status = String(row[colsA.STATUS] || "").trim();
    return isToday && status !== "已取消";
  }).map(row => {
    const rec = mapDineInRecord_(row);
    if (rec.peopleCount !== null && rec.peopleCount > maxDineInPeople) {
      maxDineInPeople = rec.peopleCount;
    }
    innerUseCount++;
    return rec;
  });

  // ================= 2. 抓取外帶資料 (外帶訂單) =================
  const sourceSheetB = ss.getSheetByName("外帶訂單");

  if (sourceSheetB) {
    const dataB = sourceSheetB.getDataRange().getValues();
    const colsB = CONFIG.TAKEOUT_COLS;
    const takeOuts = dataB.slice(1).filter(row => {
      const isToday = isTargetDate_(row[colsB.DATE], dateString);
      const status = String(row[colsB.STATUS] || "").trim();
      return isToday && status !== "已取消";
    }).map(row => {
      takeOutCount++;
      return mapTakeoutRecord_(row);
    });

    allData = innerUse.concat(takeOuts);
  } else {
    allData = innerUse;
  }

  // 沒有任何有效訂單就不寫列，避免空白日被報成「共 0 桌／預約正常」。
  if (allData.length === 0) {
    console.log(`今日日期為 ${dateString}，無預約資料。`);
    return;
  }

  // ================= 3. 依時間分流與各時段加總 =================
  const daysEN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayOfWeekEN = daysEN[today.getDay()];
  const timeStr = Utilities.formatDate(today, CONFIG.TIMEZONE, "HH:mm");

  let lunchOrders = [];
  let dinnerOrders = [];

  allData.forEach(d => {
    let isLunch = true;
    if (d.time !== "未填") {
      const hour = parseInt(d.time.split(":")[0], 10);
      if (hour >= 15) isLunch = false;
    }
    if (isLunch) lunchOrders.push(d);
    else dinnerOrders.push(d);
  });

  // 排序輔助：確保「未填」時間的預約安全地被排在最末尾
  const sortFunc = (a, b) => {
    if (a.time === "未填" && b.time !== "未填") return 1;
    if (a.time !== "未填" && b.time === "未填") return -1;
    return a.time.localeCompare(b.time);
  };

  lunchOrders.sort(sortFunc);
  dinnerOrders.sort(sortFunc);

  // 桌數在組字時由「實際列入午餐／晚餐的訂單」加總，不另做一套計數。
  const cellContent = buildDigestText_(dayOfWeekEN, dateString, timeStr, lunchOrders, dinnerOrders);
  const alertSummary = buildAlertSummary_(innerUseCount, takeOutCount, maxDineInPeople);

  // ================= 6. 寫入目標試算表 =================
  // 只寫維護排程的組字結果，不回寫訂位來源表。
  destSheet.appendRow([new Date(), cellContent, alertSummary, "待處理"]);
  console.log(`[成功] 已依營運警示邏輯(方案2)將資料寫入維護排程表。`);
}
