/**
 * 隔離稿（NO_DEPLOY），對 2026-09-27 快照只改印尼文。
 * 中文總覽、讀表、寫表、LINE 發送都沒改。
 * 回滾點是部署前對同一個專案的完整 pull，不是 original/ 的 09-27 快照。
 * 備註翻譯還要用測試用 Apps Script 的真實 LanguageApp 看過，才可以部署。
 * 金額一律照中文原文（例如 $1,000、NT$12,000、$1,000.50），不改成 $1.000，也不自行加幣別。
 * B 欄備註、整行退回、C 欄一般翻譯與固定警示的尾段，都走同一套保護。
 * 一般錯誤暫停 250ms 再試一次。in a short time 暫停 1000ms 再試一次。都不是整則固定多等約 3 秒。
 * 「Service invoked too many times」且不是 in a short time：不暫停、不重試。
 * 這個停止只在 translateTaskCnToId 的 cache。C 欄傳 null，沒有整欄停止旗標；每個中文分段仍可能各呼叫一次，不重試、不暫停。
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
  // 一次總覽翻譯共用快取，相同片段不重複呼叫 LanguageApp。
  var translateCache = {};
  
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
      // 備註裡的 | 是內容，不是欄位分隔。只拿 parts[1] 會把後面整段丟掉。
      var backPart = parts.slice(1).join("|");

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
      translatedBack = translatedBack.replace(/備註：/g, "Catatan: ");
      translatedBack = translatedBack.replace(/預估金額/g, "Perkiraan biaya");
      translatedBack = translatedBack.replace(/人數待確認/g, "Jumlah orang menunggu konfirmasi");
      // 只在 ；;、，,（）()、| 與換行切開。不加 / 或空白。數字與英文留在同一段。
      translatedBack = translateRemarkBodyToId_(translatedBack, translateCache);

      if (!hadPipe) translatedLines.push(translatedFront);
      else translatedLines.push(translatedFront + " | " + translatedBack);
      continue;
    }

    // 整行退回與備註同一套：保護金額、翻譯、逐段核對、正規化，最後才還原來源。
    translatedLines.push(translateRemarkBodyToId_(line, translateCache));
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

var FROZEN_REMARK_LABELS_ = ["Jumlah orang menunggu konfirmasi", "Perkiraan biaya", "Catatan:"];

function remarkPlaceholder_(id) {
  return "\uE000" + id + "\uE001";
}

function escapeSentinels_(text) {
  return String(text || "").replace(/\uE000/g, "\uE000E").replace(/\uE001/g, "\uE000F");
}

function unescapeSentinels_(text) {
  return String(text || "").replace(/\uE000F/g, "\uE001").replace(/\uE000E/g, "\uE000");
}

function protectRemarkTokens_(text) {
  var tokens = [];
  function stash(match) {
    var id = tokens.length;
    tokens.push(match);
    return remarkPlaceholder_(id);
  }
  var src = String(text || "");
  // 每次新建 regex，避免 /g 的 lastIndex 留到下一則備註。
  src = src.replace(/\d+(?:\.\d+)?\s*[Kk]\s*[Xx]?\d*\s*[Aa]/g, stash);
  // 千分位必須剛好 3 位。$500,2隻雞 只保護 $500，不能把數量 2 吃進金額。
  src = src.replace(/(?:NT\s*)?[\$＄]\s*\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?/g, stash);
  src = src.replace(/(?:NT\s*)?[\$＄]\s*\d+(?:\.\d+)?/g, stash);
  src = src.replace(/\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?/g, stash);
  return { text: src, tokens: tokens };
}

function listPlaceholderIds_(text) {
  var ids = [];
  var re = /\uE000(\d+)\uE001/g;
  var match;
  while ((match = re.exec(String(text || ""))) !== null) ids.push(match[1]);
  return ids;
}

function placeholdersIntact_(text, expectedIds) {
  var found = listPlaceholderIds_(text);
  if (found.length !== expectedIds.length) return false;
  var expectCount = {};
  var foundCount = {};
  var i;
  for (i = 0; i < expectedIds.length; i++) {
    expectCount[expectedIds[i]] = (expectCount[expectedIds[i]] || 0) + 1;
  }
  for (i = 0; i < found.length; i++) {
    foundCount[found[i]] = (foundCount[found[i]] || 0) + 1;
  }
  var key;
  for (key in expectCount) {
    if (!Object.prototype.hasOwnProperty.call(expectCount, key)) continue;
    if (expectCount[key] !== 1 || foundCount[key] !== 1) return false;
  }
  for (key in foundCount) {
    if (!Object.prototype.hasOwnProperty.call(foundCount, key)) continue;
    if (expectCount[key] !== 1) return false;
  }
  return true;
}

function restorePlaceholders_(text, tokens) {
  // 金額與方案代碼照來源原文放回。缺的占位符不補到別段。
  var src = String(text || "");
  for (var i = 0; i < tokens.length; i++) {
    var ph = remarkPlaceholder_(i);
    if (src.indexOf(ph) === -1) continue;
    var shown = String(tokens[i]);
    var next = "";
    var from = 0;
    var idx = src.indexOf(ph);
    while (idx !== -1) {
      next += src.slice(from, idx);
      var before = next.slice(-1);
      var after = src.charAt(idx + ph.length);
      var left = before && /[A-Za-z]/.test(before) ? " " : "";
      var right = after && /[A-Za-z]/.test(after) ? " " : "";
      next += left + shown + right;
      from = idx + ph.length;
      idx = src.indexOf(ph, from);
    }
    src = next + src.slice(from);
  }
  return src;
}

function peelFrozenLabels_(core) {
  var prefix = "";
  var rest = String(core || "");
  var guard = 0;
  while (rest && guard < 6) {
    guard++;
    var trimmedLead = rest.replace(/^\s+/, "");
    var leadWs = rest.substring(0, rest.length - trimmedLead.length);
    var found = "";
    for (var i = 0; i < FROZEN_REMARK_LABELS_.length; i++) {
      if (trimmedLead.indexOf(FROZEN_REMARK_LABELS_[i]) === 0) {
        found = FROZEN_REMARK_LABELS_[i];
        break;
      }
    }
    if (!found) break;
    prefix += leadWs + found;
    rest = trimmedLead.substring(found.length);
    var ws = rest.match(/^\s+/);
    if (ws) {
      prefix += ws[0];
      rest = rest.substring(ws[0].length);
    } else if (rest) {
      prefix += " ";
    }
  }
  return { prefix: prefix, rest: rest };
}

var QUOTA_FLAG_ = "\u0000quota";

function isShortTimeLimitError_(err) {
  var msg = String(err && (err.message || err) || "");
  return /in a short time/i.test(msg);
}

function isDailyTranslateQuotaError_(err) {
  // 官方同型：Service invoked too many times: Calendar.
  // 必須先排除 in a short time。不要用單獨的 quota／每日，避免一般句子被當成配額。
  // 這個比對不是完整清單，沒有涵蓋所有 LanguageApp 或所有語系的寫法。
  if (isShortTimeLimitError_(err)) return false;
  var msg = String(err && (err.message || err) || "");
  return /Service invoked too many times\b/i.test(msg);
}

function pauseBeforeTranslateRetry_(ms) {
  // 單次失敗的暫停，不是整則固定多等約 3 秒。配額用盡不會進到這裡。
  try {
    Utilities.sleep(ms);
  } catch (e) {}
}

function translatePieceCached_(cache, piece) {
  var key = String(piece);
  if (cache && cache[QUOTA_FLAG_]) return key;
  if (cache && key !== QUOTA_FLAG_ && Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
  var translated = key;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var got = LanguageApp.translate(key, "zh-TW", "id");
      if (got == null || String(got).trim() === "") {
        translated = key;
        break;
      }
      translated = String(got);
      break;
    } catch (e) {
      translated = key;
      if (isDailyTranslateQuotaError_(e)) {
        if (cache) cache[QUOTA_FLAG_] = true;
        break;
      }
      if (attempt === 0) pauseBeforeTranslateRetry_(isShortTimeLimitError_(e) ? 1000 : 250);
    }
  }
  if (cache && key !== QUOTA_FLAG_) cache[key] = translated;
  return translated;
}

function translateRemarkBodyToId_(text, cache) {
  var src = normalizeFullwidthTime_(text);
  if (!src) return "";
  src = escapeSentinels_(src);
  var box = protectRemarkTokens_(src);
  var parts = box.text.split(/([；;、，,（）()|\n])/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (!part) continue;
    if (/^[；;、，,（）()|\n]$/.test(part)) {
      out.push(part);
      continue;
    }
    var ids = listPlaceholderIds_(part);
    var lead = (part.match(/^\s*/) || [""])[0];
    var trail = (part.match(/\s*$/) || [""])[0];
    var core = part.trim();
    if (!core) {
      out.push(part);
      continue;
    }
    var peeled = peelFrozenLabels_(core);
    if (cache && cache[QUOTA_FLAG_]) {
      out.push(part);
      continue;
    }
    if (!/[\u4e00-\u9fff]/.test(peeled.rest)) {
      out.push(part);
      continue;
    }
    var translatedCore = translatePieceCached_(cache, peeled.rest);
    if (cache && cache[QUOTA_FLAG_]) {
      out.push(part);
      continue;
    }
    var stitched = lead + peeled.prefix + translatedCore + trail;
    if (!placeholdersIntact_(stitched, ids)) {
      out.push(part);
      continue;
    }
    out.push(stitched);
  }
  // 先正規化仍含占位符的文字，最後才把來源金額放回，避免 $1,000已付 被逗號規則拆開。
  return unescapeSentinels_(restorePlaceholders_(normalizeIdPunctuation_(out.join("")), box.tokens));
}

function normalizeFullwidthTime_(text) {
  return String(text || "").replace(/([0-9０-９])：([0-9０-９])/g, "$1:$2");
}

function normalizeIdPunctuation_(text) {
  var s = normalizeFullwidthTime_(text);
  s = s.replace(/；/g, ";");
  s = s.replace(/[、，]/g, ",");
  s = s.replace(/（/g, "(");
  s = s.replace(/）/g, ")");
  s = s.replace(/：/g, ": ");
  s = s.replace(/。/g, ". ");
  s = s.replace(/！/g, "! ");
  s = s.replace(/？/g, "? ");
  s = s.replace(/;(?!\s)/g, "; ");
  // 只有「數字,正好三位」且後面不是字才是千分位。,300份 / ,300 porsi 要空一格。
  s = s.replace(/,(?!\s)/g, function(match, offset, whole) {
    var before = offset > 0 ? whole.charAt(offset - 1) : "";
    var after = whole.slice(offset + 1);
    if (/\d/.test(before) && /^\d{3}(?![\dA-Za-z\u00C0-\u024F\u4e00-\u9fff\uFF10-\uFF19])/.test(after)) {
      return ",";
    }
    return ", ";
  });
  s = s.replace(/([^\s(])\(/g, "$1 (");
  s = s.replace(/\)([^\s),.;!?])/g, ") $1");
  s = s.replace(/[ \t]{2,}/g, " ");
  return s.replace(/^\s+|\s+$/g, "");
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

function operationalNoteParts_(trans) {
  // 只有整句就是已知警示才用固定對照。後面還有內容時，固定句與尾段分開，尾段走保護翻譯。
  var src = String(trans || "");
  var takeout = src.match(/^(🛵 純外帶日，無內用桌)([\s\S]*)$/);
  if (takeout) {
    return {
      fixed: "🛵 Hari khusus bawa pulang (Antaran), tidak ada meja di tempat.",
      tail: String(takeout[2] || "").trim() ? takeout[2] : ""
    };
  }
  var group = src.match(/^(⚠️ 注意：包含 (\d+) 人大組訂位！)([\s\S]*)$/);
  if (group) {
    return {
      fixed: "⚠️ Perhatian: Termasuk reservasi grup besar " + group[2] + " orang!",
      tail: String(group[3] || "").trim() ? group[3] : ""
    };
  }
  // 舊列若仍帶此句，整句相符才翻譯；新組字與推播外殼都不再送出。
  var normal = src.match(/^(✅\s*今日預約正常(?:\s*\(共\s*(\d+)\s*桌\))?)([\s\S]*)$/);
  if (normal) {
    return {
      fixed: "✅ Reservasi hari ini normal (Total " + (normal[2] || "0") + " meja)",
      tail: String(normal[3] || "").trim() ? normal[3] : ""
    };
  }
  return null;
}

function joinOperationalNote_(fixed, tailSrc) {
  var tailId = translateRemarkBodyToId_(tailSrc, null);
  if (!tailId) return fixed;
  if (/^[；;、，,。！？!?|\n]/.test(tailId)) return fixed + tailId;
  return fixed + "; " + tailId;
}

/**
 * C欄營運警示專屬精準對照翻譯
 */
function translateNoteCnToId(noteCn) {
  var trans = String(noteCn || "").trim();
  if (!trans || trans === "無") return "Tidak ada keterangan";
  var known = operationalNoteParts_(trans);
  if (known && !known.tail) return known.fixed;
  if (known) return joinOperationalNote_(known.fixed, known.tail);
  // 翻失敗、空結果或原樣退回時留下中文警示，不可改成「沒有說明」。
  // cache 傳 null，沒有整欄配額停止旗標。每日配額錯誤後，每個中文分段仍可能各呼叫一次；不重試、不暫停。忙日驗收要算進這些呼叫。
  return translateRemarkBodyToId_(trans, null);
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
