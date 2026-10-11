/**
 * 隔離稿（NO_DEPLOY），對 2026-09-27 快照只改印尼文。
 * 中文總覽、讀表、寫表、LINE 發送都沒改。
 * 上線前要先把線上腳本拉下來，和 original/LineDailyRemind.gs 對過；線上可能已不同。
 * 備註分段（NIT2）還要用測試用 Apps Script 的真實 LanguageApp 看過，才可以部署。
 */
function checkAndSendDailyReminders() {
  // ======= 1. 系統安全性憑證設定 =======
  var LINE_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  if (!LINE_ACCESS_TOKEN || !String(LINE_ACCESS_TOKEN).trim()) {
    Logger.log("LINE 發送中止：找不到指令碼屬性「LINE_ACCESS_TOKEN」。");
    return;
  }
  LINE_ACCESS_TOKEN = String(LINE_ACCESS_TOKEN).trim();
  
  // 請在此處填入所有需要接收通知的人員 LINE User ID
  var LINE_USER_IDS = [
    "Ud78cb228d24366ed14211aa04bc97372", // 您自己
    "U629747dfee6e7abdc5281831c2bd9e7b", 
    "Uc65da31025a31501479b5ce59fe44c5f", 
    "U9c931c760264c770758a530220918402", 
    "Udf3c8fa581382eb76f33172d5dc454e3"  
  ];

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("維護排程");
  if (!sheet) {
    Logger.log("找不到名為「維護排程」的分頁。");
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("試算表中目前沒有任何店務排程資料。");
    return;
  }
  
  // 取得今天的標準台灣日期字串 (格式: yyyy-MM-dd)
  var todayStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");
  Logger.log("全自動翻譯推播系統啟動。今天的日期是: " + todayStr);
  
  // 抓取 A 欄至 D 欄資料（共 4 欄）
  var dataRange = sheet.getRange(2, 1, lastRow - 1, 4);
  var displayValues = dataRange.getDisplayValues(); // 用於抓取處理好的文字
  var actualValues = dataRange.getValues();         // 核心修正：用於抓取原生 Date 物件
  var matchCount = 0;
  
  for (var i = 0; i < displayValues.length; i++) {
    // 【雙保險時間解析機制】：徹底解決未補零與中文下午/上午的干擾
    var rawDateObj = actualValues[i][0];
    var rowDateStr = "";

    if (rawDateObj instanceof Date && !isNaN(rawDateObj.getTime())) {
      // 優先：如果是原生時間物件，直接格式化為標準 yyyy-MM-dd
      rowDateStr = Utilities.formatDate(rawDateObj, "GMT+8", "yyyy-MM-dd");
    } else {
      // 備援：如果是純文字，透過正則表達式強制捕獲並「手動精準補零」
      var textDate = displayValues[i][0].trim();
      var dateMatch = textDate.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (dateMatch) {
        var y = dateMatch[1];
        var m = ("0" + dateMatch[2]).slice(-2); // 強制兩位數
        var d = ("0" + dateMatch[3]).slice(-2); // 強制兩位數
        rowDateStr = y + "-" + m + "-" + d;
      }
    }

    var taskCn = displayValues[i][1]; // B欄：整併後的預約總覽
    var noteCn = displayValues[i][2]; // C欄：營運警示說明
    var status = displayValues[i][3]; // D欄：狀態
    
    // 比對標準化之後的日期 (例如 2026-07-01 === 2026-07-01)
    if (rowDateStr === todayStr && status !== "已通知") {
      matchCount++;

      // P0 r2：只對預約總覽做 booking sanitize／人數 token／備註過濾與正常句剝離。
      // 一般店務列保持原文，避免 sanitize 誤傷維護備註。
      if (isBookingOverviewTask_(taskCn)) {
        taskCn = sanitizeDigestTaskForPush_(taskCn);
        noteCn = stripRedundantNormalNoteLines_(noteCn);
      }
      var taskId = translateTaskCnToId(taskCn);
      var noteId = translateNoteCnToId(noteCn);
      var lineMessage = buildDailyReminderMessage_(taskCn, taskId, noteCn, noteId);
      
      // 執行多人同時群播發送
      var allSuccess = true;
      for (var j = 0; j < LINE_USER_IDS.length; j++) {
        var currentUserId = LINE_USER_IDS[j].trim();
        if (currentUserId && currentUserId.indexOf("U") === 0) {
          var isSuccess = sendToLineMessagingAPI(lineMessage, LINE_ACCESS_TOKEN, currentUserId);
          if (!isSuccess) {
            allSuccess = false;
            Logger.log("發送給用戶 " + maskLineUserId_(currentUserId) + " 失敗。");
          }
        }
      }
      
      // 全部成功後標記為「已通知」
      if (allSuccess) {
        sheet.getRange(i + 2, 4).setValue("Transit");
        sheet.getRange(i + 2, 4).setValue("已通知");
        Logger.log("成功發送全自動雙語通報：" + rowDateStr + " 預約總覽");
      }
      
      Utilities.sleep(1000); // 防爆冷卻時間
    }
  }
  
  if (matchCount === 0) {
    Logger.log("今天沒有符合日期或尚未通知的店務提醒項目。");
  }
}

function isBookingOverviewTask_(taskCn) {
  // P0 r3：只檢查第一個非空白行；整行須符合 generator 產出的完整標頭。
  // 正文引用「預約總覽」不可改任務類型（例：清洗設備\n備註：請查看 [日期 預約總覽] …）。
  var text = String(taskCn || "");
  var lines = text.split(/\r?\n/);
  var first = "";
  for (var i = 0; i < lines.length; i++) {
    var t = String(lines[i] || "").trim();
    if (t) {
      first = t;
      break;
    }
  }
  if (!first) return false;
  // buildDigestText_ 標頭：[Day YYYY-MM-DD HH:MM GMT+8] [YYYY-MM-DD 預約總覽]
  return /^\[[A-Za-z]{3}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+GMT\+8\]\s*\[\d{4}-\d{2}-\d{2}\s+預約總覽\]$/.test(first);
}

function dailyReminderTitle_(taskCn) {
  if (isBookingOverviewTask_(taskCn)) {
    return "📢【今日預約總覽／Ringkasan Reservasi Hari Ini】";
  }
  return "📢【店務定期維護提醒 / Pengingat Tugas Toko】";
}

function stripRedundantNormalNoteLines_(noteCn) {
  // 只刪「整行」符合舊完整正常句的列，保留同行以外的警示。
  var lines = String(noteCn || "").split(/\r?\n/);
  var kept = [];
  for (var i = 0; i < lines.length; i++) {
    var trimmed = String(lines[i] || "").trim();
    if (/^✅\s*今日預約正常(?:\s*\(共\s*\d+\s*桌\))?\s*$/.test(trimmed)) {
      continue;
    }
    kept.push(lines[i]);
  }
  return kept.join("\n").replace(/^\s+|\s+$/g, "");
}

function shouldOmitOperationalNote_(noteCn, taskCn) {
  var note = String(noteCn || "").trim();
  // P0 r2：不再因「含有」今日預約正常就整欄省略（警示會被一起丟掉）。
  if ((!note || note === "無") && isBookingOverviewTask_(taskCn)) return true;
  return false;
}

function buildDailyReminderMessage_(taskCn, taskId, noteCn, noteId) {
  var msg = dailyReminderTitle_(taskCn) + "\n\n" +
    "🛠️ 項目/Tugas (CN)：" + taskCn + "\n" +
    "🇮🇩 Tugas (ID)：" + taskId;
  var noteText = isBookingOverviewTask_(taskCn)
    ? stripRedundantNormalNoteLines_(noteCn)
    : String(noteCn || "").trim();
  if (shouldOmitOperationalNote_(noteText, taskCn)) return msg;
  // noteId 應已是對 cleaned note 的翻譯；若呼叫端未清，這裡再剝一次 CN 顯示。
  var noteIdText = String(noteId || "").trim();
  msg += "\n\n" +
    "📝 說明/Keterangan (CN)：" + (noteText ? noteText : "無") + "\n" +
    "🇮🇩 Keterangan (ID)：" + (noteIdText ? noteIdText : "Tidak ada keterangan");
  return msg;
}

function replaceUnconfirmedPeopleToken_(line) {
  var text = String(line || "");
  var pipe = text.indexOf("|");
  var head = pipe === -1 ? text : text.substring(0, pipe);
  var tail = pipe === -1 ? "" : text.substring(pipe);
  var replaced = head.replace(
    /^(\d{2}:\d{2}\s+\S.*?)\s*\(0\)(\s*\(外帶\))?\s*$/,
    function (_, namePart, takeout) {
      return namePart.replace(/\s+$/, "") + " 人數待確認" + (takeout || "");
    }
  );
  return replaced + tail;
}

function sanitizeDigestLineForPush_(line) {
  var next = replaceUnconfirmedPeopleToken_(line);
  var marker = "備註：";
  var idx = next.indexOf(marker);
  if (idx === -1 || typeof sanitizeRemarkField_ !== "function") return next;
  var cleaned = sanitizeRemarkField_(next.substring(idx + marker.length));
  var head = next.substring(0, idx).replace(/\s*\|\s*$/, "");
  if (!cleaned) return head;
  return head + " | 備註：" + cleaned;
}

function sanitizeDigestTaskForPush_(taskCn) {
  var lines = String(taskCn || "").split("\n");
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    out.push(sanitizeDigestLineForPush_(lines[i]));
  }
  return out.join("\n");
}

/**
 * 智慧型逐行翻譯解譯器 (確保印尼文格式與中文百分之百對齊)
 */
function translateTaskCnToId(taskCn) {
  if (!taskCn) return "Tidak ada terjemahan";
  var lines = taskCn.split("\n");
  var translatedLines = [];
  
  var daysMap = { 'Sun': 'Minggu', 'Mon': 'Senin', 'Tue': 'Selasa', 'Wed': 'Rabu', 'Thu': 'Kamis', 'Fri': 'Jumat', 'Sat': 'Sabtu' };
  var monthsMap = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) {
      translatedLines.push("");
      continue;
    }

    // 1. 解析並轉換時間標頭 [Wed 2026-07-01 13:52 GMT+8]
    if (line.indexOf("[") === 0 && line.indexOf("預約總覽]") !== -1) {
      var headerMatch = line.match(/\[([A-Za-z]+)\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})\s+GMT\+8\]/);
      if (headerMatch) {
        var dayEN = headerMatch[1];
        var year = headerMatch[2];
        var monthIdx = parseInt(headerMatch[3], 10) - 1;
        var dayStr = parseInt(headerMatch[4], 10).toString();
        var timeStr = headerMatch[5];

        var dayID = daysMap[dayEN] || dayEN;
        var monthID = monthsMap[monthIdx] || headerMatch[3];
        var dateStrID = dayStr + " " + monthID + " " + year;

        translatedLines.push("[" + dayID + " " + dateStrID + " " + timeStr + " GMT+8] [Ringkasan Reservasi " + dateStrID + "]");
      } else {
        translatedLines.push(line);
      }
      continue;
    }

    // 2a. 內用／外帶分區標題（20260927）
    if (line.indexOf("🍽️ 內用") === 0) {
      translatedLines.push(translateSessionHeadingLine_(line, "🍽️ Makan di tempat"));
      continue;
    }
    if (line.indexOf("🥡 外帶") === 0) {
      var takeoutN = line.match(/\d+/);
      translatedLines.push("🥡 Bawa pulang (total " + (takeoutN ? takeoutN[0] : "0") + " pesanan)");
      continue;
    }

    // 2. 轉換時段標題
    if (line.indexOf("☀️ 午餐") !== -1) {
      translatedLines.push(translateSessionHeadingLine_(line, "☀️ Makan Siang"));
      continue;
    }
    if (line.indexOf("🌙 晚餐") !== -1) {
      translatedLines.push(translateSessionHeadingLine_(line, "🌙 Makan Malam"));
      continue;
    }

    // 3. 轉換結尾總計
    if (line.indexOf("(總計") !== -1) {
      translatedLines.push(translateTotalLine_(line));
      continue;
    }

    // 4. 轉換無預約狀態
    if (line === "無") {
      translatedLines.push("Tidak ada");
      continue;
    }

    // 5. 轉換客戶明細行（含無備註、但人數待確認的列）
    // 20260927：外帶區明細不再帶「(外帶)」且可能無備註 → 以時間開頭也走逐行規則，不整行丟機翻
    if (line.indexOf("|") !== -1 || line.indexOf("人數待確認") !== -1 || /^\d{2}:\d{2}\s+\S/.test(line)) {
      var hadPipe = line.indexOf("|") !== -1;
      var parts = line.split("|");
      var frontPart = parts[0].trim();
      var backPart = parts[1] || "";

      var timePrefix = frontPart.match(/^\d{2}:\d{2}\s+/);
      var timePrefixStr = timePrefix ? timePrefix[0] : "";
      var nameAndCode = frontPart.replace(/^\d{2}:\d{2}\s+/, "");

      var titleID = "Bapak/Ibu ";
      if (line.indexOf("先生") !== -1) titleID = "Bapak ";
      if (line.indexOf("小姐") !== -1 || line.indexOf("女士") !== -1) titleID = "Ibu ";

      nameAndCode = nameAndCode.replace("先生", "").replace("小姐", "").replace("女士", "");
      nameAndCode = nameAndCode.replace("(外帶)", "(Bawa pulang)");
      nameAndCode = nameAndCode.replace(/人數待確認/g, "Jumlah orang menunggu konfirmasi");

      var translatedFront = timePrefixStr + titleID + nameAndCode;

      var translatedBack = backPart.trim();
      translatedBack = translatedBack.replace("備註：", "Catatan: ");
      translatedBack = translatedBack.replace("預估金額", "Perkiraan biaya");
      translatedBack = translatedBack.replace(/人數待確認/g, "Jumlah orang menunggu konfirmasi");
      translatedBack = translatedBack.replace(/,(\d{3})/g, '.$1');

      // NIT2：多段備註（； / 、 / 括號）若先把中文抽出、用空白黏成一句，
      // LanguageApp 看不到分隔，replace 也對不到原文，中文會整段留下。
      // 改為每一段連續中文各翻一次，分隔符、數字與方案代碼原樣留下。
      translatedBack = translateChineseSegmentsToId_(translatedBack);

      if (!hadPipe) translatedLines.push(translatedFront);
      else translatedLines.push(translatedFront + " | " + translatedBack);
      continue;
    }

    try {
      translatedLines.push(LanguageApp.translate(line, 'zh-TW', 'id'));
    } catch(e) {
      translatedLines.push(line);
    }
  }
  return translatedLines.join("\n");
}

function translateSessionHeadingLine_(line, idName) {
  var pendingTail = "jumlah meja menunggu konfirmasi";
  // 20260927：分區後時段標題本身不帶數字（☀️ 午餐／🌙 晚餐）
  // NIT1：「共」不可留在印尼文計數。與總計列的 Total 用同一個詞。
  if (line.indexOf("(") === -1) return idName;
  if (line.indexOf("另") !== -1 && line.indexOf("桌數待確認") !== -1) {
    var nums = line.match(/\d+/g) || [];
    return idName + " (total " + (nums[0] || "?") + " meja, " + (nums[1] || "?") + " pesanan " + pendingTail + ")";
  }
  if (line.indexOf("筆") !== -1 && line.indexOf("桌數待確認") !== -1) {
    var n = line.match(/\d+/);
    return idName + " (total " + (n ? n[0] : "?") + " pesanan, " + pendingTail + ")";
  }
  var tables = line.match(/\d+/);
  return idName + " (total " + (tables ? tables[0] : "0") + " meja)";
}

function translateChineseSegmentsToId_(text) {
  var src = String(text || "");
  if (!/[\u4e00-\u9fff]/.test(src)) return src;
  var re = /[\u4e00-\u9fff]+/g;
  var out = "";
  var last = 0;
  var match;
  while ((match = re.exec(src)) !== null) {
    out += src.slice(last, match.index);
    var segment = match[0];
    var translated = segment;
    try {
      var got = LanguageApp.translate(segment, "zh-TW", "id");
      if (got) translated = String(got);
    } catch (e) {
      translated = segment;
    }
    out += translated;
    last = match.index + segment.length;
  }
  out += src.slice(last);
  return out;
}

function translateTotalLine_(line) {
  var pendingTail = "jumlah meja menunggu konfirmasi";
  // 20260927 新格式：(總計 內用 … ＋外帶 M 筆)
  if (line.indexOf("外帶") !== -1 && line.indexOf("＋") !== -1) {
    var plus = line.indexOf("＋");
    var dinePart = line.substring(0, plus);
    var takePart = line.substring(plus);
    var takeN = takePart.match(/\d+/);
    var takeText = "bawa pulang " + (takeN ? takeN[0] : "0") + " pesanan";
    var dNums = dinePart.match(/\d+/g) || [];
    var dineText;
    if (dinePart.indexOf("另") !== -1 && dinePart.indexOf("桌數待確認") !== -1) {
      dineText = "makan di tempat " + (dNums[0] || "?") + " meja, " + (dNums[1] || "?") + " pesanan " + pendingTail;
    } else if (dinePart.indexOf("筆") !== -1 && dinePart.indexOf("桌數待確認") !== -1) {
      dineText = "makan di tempat " + (dNums[0] || "?") + " pesanan, " + pendingTail;
    } else {
      dineText = "makan di tempat " + (dNums[0] || "0") + " meja";
    }
    return "(Total " + dineText + " + " + takeText + ")";
  }
  if (line.indexOf("另") !== -1 && line.indexOf("桌數待確認") !== -1) {
    var nums = line.match(/\d+/g) || [];
    return "(Total " + (nums[0] || "?") + " meja, " + (nums[1] || "?") + " pesanan " + pendingTail + ")";
  }
  if (line.indexOf("筆") !== -1 && line.indexOf("桌數待確認") !== -1) {
    var n = line.match(/\d+/);
    return "(Total " + (n ? n[0] : "?") + " pesanan, " + pendingTail + ")";
  }
  var tables = line.match(/\d+/);
  return "(Total " + (tables ? tables[0] : "0") + " meja)";
}

/**
 * C欄營運警示專屬精準對照翻譯
 */
function translateNoteCnToId(noteCn) {
  var trans = String(noteCn || "").trim();
  if (!trans || trans === "無") return "Tidak ada keterangan";
  
  if (trans.indexOf("🛵 純外帶日") !== -1) {
    return "🛵 Hari khusus bawa pulang (Antaran), tidak ada meja di tempat.";
  }
  if (trans.indexOf("⚠️ 注意：包含") !== -1) {
    var digits = trans.match(/\d+/);
    return "⚠️ Perhatian: Termasuk reservasi grup besar " + (digits ? digits[0] : "X") + " orang!";
  }
  // 舊列若仍帶此句，翻譯保留；新組字與推播外殼都不再送出。
  if (trans.indexOf("✅ 今日預約正常") !== -1) {
    var tables = trans.match(/\d+/);
    return "✅ Reservasi hari ini normal (Total " + (tables ? tables[0] : "0") + " meja)";
  }
  
  try {
    return LanguageApp.translate(trans, 'zh-TW', 'id');
  } catch (e) {
    return "Tidak ada keterangan";
  }
}

// LINE Messaging API 底層標準發送技術
function maskLineUserId_(userId) {
  if (!userId) return "(空白)";
  return userId.slice(0, 5) + "…" + userId.slice(-4);
}

function sendToLineMessagingAPI(message, token, userId) {
  var safeUserId = maskLineUserId_(userId);

  if (!token || !String(token).trim()) {
    Logger.log("LINE 發送失敗：Channel Access Token 為空白。");
    return false;
  }

  if (!/^U[0-9a-f]{32}$/.test(userId)) {
    Logger.log("LINE 發送失敗：User ID 格式錯誤：" + safeUserId);
    return false;
  }

  if (message.length > 5000) {
    Logger.log("LINE 發送失敗：訊息長度為 " + message.length + "，超過 5000 字元限制。");
    return false;
  }

  var url = "https://api.line.me/v2/bot/message/push";
  var payload = {
    "to": userId,
    "messages": [{
      "type": "text",
      "text": message
    }]
  };
  var options = {
    "method": "post",
    "contentType": "application/json",
    "headers": { "Authorization": "Bearer " + String(token).trim() },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    var body = response.getContentText();
    Logger.log("LINE Push：" + safeUserId + "；HTTP " + code + "；訊息長度：" + message.length + "；回應：" + body);
    return code === 200;
  } catch (e) {
    Logger.log("LINE API 呼叫例外：" + safeUserId + "；錯誤：" + e.message);
    return false;
  }
}

// 不發送訊息，只驗證 Token 與 Push 訊息格式
function diagnoseLineApiNoSend() {
  var token = PropertiesService.getScriptProperties().getProperty("LINE_ACCESS_TOKEN");
  if (!token || !String(token).trim()) {
    Logger.log("LINE 診斷失敗：找不到指令碼屬性「LINE_ACCESS_TOKEN」。");
    return;
  }

  var payload = {
    "messages": [{
      "type": "text",
      "text": "LINE API 診斷測試，不會實際傳送"
    }]
  };
  var options = {
    "method": "post",
    "contentType": "application/json",
    "headers": { "Authorization": "Bearer " + String(token).trim() },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    var response = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/validate/push", options);
    Logger.log("LINE 無發送診斷：HTTP " + response.getResponseCode() + "；回應：" + response.getContentText());
  } catch (e) {
    Logger.log("LINE 無發送診斷例外：" + e.message);
  }
}
// 官方帳號 Webhook 接收端
function doPost(e) {
  try {
    var json = JSON.parse(e.postData.contents);
    var event = json.events[0];
    var userId = event.source.userId;
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var configSheet = ss.getSheetByName("系統設定");
    if (configSheet) {
      configSheet.appendRow(["系統自動抓取", "員工的 LINE UID ->", userId, "請複製此字串"]);
    }
    try { logLineGroupMessage_(event); } catch (eLog) {}
    return ContentService.createTextOutput(JSON.stringify({status: 'success'})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status: 'error'})).setMimeType(ContentService.MimeType.JSON);
  }
}
