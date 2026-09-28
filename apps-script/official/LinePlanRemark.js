/**
 * 水美土雞城 — LINE 訂位：方案代碼 → 備註（工作表1 H 欄）；客人看到友善方案文字
 *
 * NO_DEPLOY 草稿：本檔是官方訂位 Apps Script 的「新增檔案」，只放純函式（不讀寫試算表、不呼叫網路）。
 * 由 程式碼.js 的 parseBookingMessage / handleLineWebhook / finalizeBooking / processBooking /
 * sendConfirmationEmail / summariseCollected 呼叫（見 line-plan-remark.patch）。
 *
 * 規則：
 *   - 方案代碼 = 價位k + 桌數 + a（a = 桌數，不是人數）：4500 × 2 桌 → 4.5k2a；5000 × 1 桌 → 5k1a。
 *   - 代碼只寫進備註（H 欄）；預估金額（M 欄）一律不寫（Option B）。
 *   - 備註裡已經有代碼（例：客人打「備註 5k1a 靠窗」、只打「5k」、全形、5k×2a）→ 不重複加，移到最前面，
 *     a 一律改成最終桌數（I 欄）。格式：「代碼；原本備註」。
 *   - 桌數：客人有講桌數（「一桌就好」「兩桌」「一桌是5000」「5k1a」）就用客人講的（容量檢查、I 欄、代碼同一個數）；
 *     沒講才用 ceil(人數/10)。
 *   - 不自動寫人數分類字（大人N位…）到備註（Owner 2026-09-28 縮小範圍）。
 *   - 人數（D 欄）沿用 程式碼.js 的 parsePeople；唯一修正：「大人8位小孩2位」「8大2小」這類分類在前／簡寫要加總
 *     （lineCategoryPeople_，不確定時回 null → 沿用 parsePeople）。
 *   - 客人看不到代碼：回給客人的 LINE 訊息（核對、還差資料、預約成功）與網頁表單內用確認信，備註去掉
 *     5k1a／4.5k2a／5k／散客／大型Na 這類代碼；方案改用友善文字另起一行
 *     （4.5k1a →「每桌 4500 元、1 桌」；沒方案就不多一行）。工作表 H 欄仍存完整備註；老闆通知／行事曆不變。
 */

// 人數用：1–2 位數字（前後不黏其他數字，避免「小孩 5000的桌菜」被讀成 5000 位）或中文數字
// 中文數字前後不可黏「百千萬」或其他中文數字（「一百」「一千」不會被讀成 1；解析不了 → 沿用 parsePeople）
var LINE_HEAD_NUM_ = "(?:(?<![0-9])[0-9]{1,2}(?![0-9])|(?<![百千萬零〇一二兩两三四五六七八九十])[一二兩两三四五六七八九十]{1,3}(?![百千萬零〇一二兩两三四五六七八九十]))";
// 與 程式碼.js parsePeople 相同的分類字（不新增幼兒類，保持保守）；「兒童椅」等座椅需求不算
var LINE_PEOPLE_LABEL_ = "(?:大人|成人|小孩|小朋友|兒童|小童)(?![椅座餐])";
var LINE_MAX_TABLES_ = 20;
// 方案代碼形狀：5k、4.5k、5k1a、4.5K 2A、5k×2a（a = 桌數）。實際判斷用 lineFindCodes_（含前後文檢查）。
var LINE_CODE_SHAPE_ = "(\\d{1,2}(?:\\.\\d{1,2})?)\\s*[Kk](?:\\s*[Xx×✕＊*]?\\s*(\\d{1,2})\\s*[Aa])?";
var LINE_PRICE_CONN_ = "(?:是|要|約|大約|大概|差不多)";

function lineNumToInt_(s) {
  s = String(s == null ? "" : s).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (/[百千萬]/.test(s)) return 0; // 「一百」等大數不在訂位人數／桌數範圍 → 0（呼叫端視為無效，沿用原本邏輯）
  var map = { "零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  if (s === "十") return 10;
  if (s.indexOf("十") !== -1) {
    var parts = s.split("十");
    var tens = parts[0] === "" ? 1 : (map[parts[0]] || 0);
    var ones = (parts[1] === "" || parts[1] === undefined) ? 0 : (map[parts[1]] || 0);
    return tens * 10 + ones;
  }
  if (map[s.charAt(0)] !== undefined) return map[s.charAt(0)];
  return parseInt(s, 10) || 0;
}

// 全形英數字／句點轉半形（５ｋ２ａ → 5k2a），其他字不動。
function lineHalfWidth_(s) {
  return String(s == null ? "" : s).replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A\uFF0E]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
}

// 先轉半形，再移除手機、訂單編號、日期、時間，避免數字被誤判成價位／桌數／人數。
function stripLineNoise_(msg) {
  return lineHalfWidth_(msg)
    .replace(/09\d{8}/g, " ")
    .replace(/SMC\s*\d{6}/gi, " ")
    .replace(/\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/g, " ")
    .replace(/\d{1,2}\s*[:：]\s*\d{2}/g, " ")
    .replace(/\d{1,2}\s*\/\s*\d{1,2}/g, " ");
}

// 4500 → "4.5k"；5000 → "5k"；不合理價位回 ""。
function linePriceToCode_(price) {
  var p = Number(price);
  if (!isFinite(p) || p < 3000 || p > 20000 || p % 100 !== 0) return "";
  return String(p / 1000) + "k";
}

/**
 * 找出字串中所有方案代碼（請先轉半形）。回傳 [{ index, end, price, tables, valid }]。
 *   - 前面黏英數字／小數點，或前面是英文字＋空白（iPhone5k、iPhone 5k）→ 不算。
 *   - 後面黏英文字（5kg）或不是代碼的數字（5k12）→ 不算；相鄰代碼（5k1a5k2a）都算。
 *   - valid = 價位合理（3000–20000、百元整）。
 */
function lineFindCodes_(s) {
  s = String(s == null ? "" : s);
  var re = new RegExp(LINE_CODE_SHAPE_ + "(?![A-Za-z])", "g");
  var startsCode = new RegExp("^" + LINE_CODE_SHAPE_ + "(?![A-Za-z])");
  var out = [], m, lastEnd = -1;
  while ((m = re.exec(s)) !== null) {
    var before = s.slice(0, m.index);
    var end = m.index + m[0].length;
    if (m.index !== lastEnd && (/[0-9A-Za-z.]$/.test(before) || /[A-Za-z]\s+$/.test(before))) continue;
    var after = s.slice(end);
    if (/^\d/.test(after) && !startsCode.test(after)) continue;
    var price = Math.round(parseFloat(m[1]) * 1000);
    var tb = m[2] ? parseInt(m[2], 10) : null;
    out.push({ index: m.index, end: end, price: price, tables: (tb >= 1 && tb <= LINE_MAX_TABLES_) ? tb : null, valid: !!linePriceToCode_(price) });
    lastEnd = end;
  }
  return out;
}

// 移除字串中所有代碼（含價位不合理的代碼形狀），整理多餘的分隔符號。沒有代碼 → 原字串（trim）。
function lineStripCodes_(s) {
  var src = String(s == null ? "" : s);
  var hw = lineHalfWidth_(src);
  var codes = lineFindCodes_(hw);
  if (!codes.length) return src.trim();
  for (var i = codes.length - 1; i >= 0; i--) hw = hw.slice(0, codes[i].index) + " " + hw.slice(codes[i].end);
  return hw
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\s*([、，,；;])\s*/g, "$1")
    .replace(/([、，,；;])[、，,；;]+/g, "$1")
    .replace(/^[\s、，,；;]+|[\s、，,；;:：]+$/g, "")
    .trim();
}

/**
 * 解析桌菜方案價位（每桌）。回傳 { price: 5000, tables: 1|null } 或 null。
 *   - 店內簡寫：5k1a、4.5k2a、5k、4.5K 2A、5k×2a、全形５ｋ２ａ（iPhone 5k 不算）
 *   - 價位＋關鍵字：5000的桌菜、桌菜5000、4500元方案、每桌5000、一桌4500、一桌是／要／大約5000、5000一桌、5000兩桌、2桌菜5000
 */
function parseLinePlan_(msg) {
  var t = stripLineNoise_(msg);
  var codes = lineFindCodes_(t).filter(function (c) { return c.valid; });
  if (codes.length) return { price: codes[0].price, tables: codes[0].tables };
  var kw = "(?:桌菜|合菜|方案|套餐|價位|每桌|一桌|\\/桌)";
  var re = [
    new RegExp("(?:^|[^0-9.])([1-9]\\d{3,4})\\s*(?:元|塊)?\\s*(?:的)?\\s*" + kw),
    new RegExp(kw + "\\s*(?:價位|價格)?\\s*[:：]?\\s*" + LINE_PRICE_CONN_ + "?\\s*(?:NT\\$?|\\$)?\\s*([1-9]\\d{3,4})(?![0-9])"),
    new RegExp("(?:^|[^0-9.])([1-9]\\d{3,4})\\s*(?:元|塊)?\\s*(?:的)?\\s*(?:[0-9]{1,2}|[一二兩两三四五六七八九十]{1,3})\\s*張?\\s*桌")
  ];
  for (var i = 0; i < re.length; i++) {
    var mm = t.match(re[i]);
    if (mm && linePriceToCode_(parseInt(mm[1], 10))) return { price: parseInt(mm[1], 10), tables: null };
  }
  return null;
}

/**
 * 解析客人明講的桌數（「2桌」「兩桌」「共3張桌」「2桌菜」）。回傳 1..20 或 null。
 *   - 「每桌」「桌菜」（前面沒數字）不算；「一桌5000」「5000一桌」= 價位說明，不算桌數。
 *   - 「一桌是／要／大約5000」= 一桌、每桌 5000 → 1 桌（同一句另有明講桌數時以明講的為準）。
 */
function parseLineTables_(msg) {
  var t = stripLineNoise_(msg);
  var re = /(?:(?:^|[^0-9.])(\d{1,2})|(?<![百千萬零〇一二兩两三四五六七八九十])([一二兩两三四五六七八九十]{1,3}))\s*(?:張)?\s*桌(菜)?/g;
  var m, fallback = null;
  while ((m = re.exec(t)) !== null) {
    var after = t.slice(m.index + m[0].length);
    var n = lineNumToInt_(m[1] || m[2]);
    var before = t.slice(0, m.index + (m[1] ? m[0].indexOf(m[1]) : m[0].indexOf(m[2])));
    if (/每\s*$/.test(before)) continue; // 「每桌」
    if (!m[3] && n === 1) {
      if (/^\s*(?:NT\$?|\$)?\s*[1-9]\d{3,4}/.test(after)) continue; // 「一桌5000」= 價位
      if (new RegExp("^\\s*" + LINE_PRICE_CONN_ + "\\s*(?:NT\\$?|\\$)?\\s*[1-9]\\d{3,4}").test(after)) { if (fallback === null) fallback = 1; continue; }
      if (/[1-9]\d{3,4}\s*(?:元|塊)?\s*(?:的)?\s*$/.test(before)) continue; // 「5000一桌」= 價位
    }
    if (n >= 1 && n <= LINE_MAX_TABLES_) return n;
  }
  return fallback;
}

/**
 * 人數（D 欄）的唯一修正：分類字在前的寫法要加總。回傳人數，或 null（= 沿用 程式碼.js 的 parsePeople）。
 *   - 「大人8位小孩2位」「大人8位、小孩2位」「10位 大人8位小孩2位」→ 10
 *     （每個分類字後面都緊接數字、至少兩組、且含大人／成人才算；「20位，小朋友2位」只有部分分類 → null）
 *   - 「8大2小」（訊息裡沒有其他「N位／N人」、也沒有分類字時）→ 10
 *   - 只加分類字後面緊接的數字；「素食1位」「2位不吃辣」「需要1位素食」「第1位置」不算人數。
 *   - 其他情況（數字在前「8個大人2個小孩」、混用、沒有分類字）→ null，行為與原本 parsePeople 相同。
 */
function lineCategoryPeople_(msg) {
  var t = stripLineNoise_(msg);
  var labelAny = new RegExp(LINE_PEOPLE_LABEL_, "g");
  var labelCount = (t.match(labelAny) || []).length;
  if (labelCount === 0) {
    var bs = t.match(new RegExp("(" + LINE_HEAD_NUM_ + ")\\s*大\\s*(" + LINE_HEAD_NUM_ + ")\\s*小(?![朋孩童])"));
    if (!bs) return null;
    var rest = t.slice(0, bs.index) + " " + t.slice(bs.index + bs[0].length);
    if (new RegExp(LINE_HEAD_NUM_ + "\\s*(?:位|人|名)").test(rest)) return null; // 另外還有「共10位」之類 → 不確定
    var n = lineNumToInt_(bs[1]) + lineNumToInt_(bs[2]);
    return (n >= 1 && n <= 99) ? n : null;
  }
  var pairRe = new RegExp(LINE_PEOPLE_LABEL_ + "\\s*[:：]?\\s*(" + LINE_HEAD_NUM_ + ")(?!\\s*(?:桌|k|K))", "g");
  var sum = 0, pairs = 0, adult = false, m;
  while ((m = pairRe.exec(t)) !== null) { sum += lineNumToInt_(m[1]); pairs++; if (/^(?:大人|成人)/.test(m[0])) adult = true; }
  if (pairs !== labelCount) return null; // 有分類字後面沒緊接數字（數字在前或混用）→ 沿用原本
  if (pairs < 2 || !adult) return null;   // 只有一組或沒有大人（「小朋友2位」＝部分分類）→ 沿用原本
  return (sum >= 1 && sum <= 99) ? sum : null;
}

/**
 * 組 LINE 訂位的備註（H 欄）。
 * opts = { plan: {price}|null（最後一次有效的方案，優先於備註裡的舊代碼）, tables: 寫入 I 欄的桌數, note: 客人原本備註 }
 * 回傳字串，例：「5k1a；靠窗」。沒有方案時回傳原備註（行為不變）。
 */
function composeLineRemark_(opts) {
  opts = opts || {};
  var rawNote = String(opts.note == null ? "" : opts.note).trim();
  var note = rawNote;
  var code = "";
  var tables = parseInt(opts.tables, 10);
  var existing = lineFindCodes_(lineHalfWidth_(rawNote));
  var planCode = (opts.plan && opts.plan.price) ? linePriceToCode_(opts.plan.price) : "";
  if (planCode) {
    // 以最後一次有效的方案（state.plan，每則訊息解析後覆蓋）為準：例「備註 5k1a 靠窗」後又說「改成桌菜5500」→ 5.5k1a。
    // 備註裡舊的代碼一律拿掉，不重複；a = 最終桌數（I 欄）。
    code = planCode + (tables >= 1 ? tables + "a" : "");
    if (existing.length) note = lineStripCodes_(rawNote);
  } else if (existing.length) {
    // 沒有方案資訊、只有備註裡的代碼（含只有價位的 5k）：移到最前面；a 改成最終桌數。
    var c0 = existing[0];
    var pc = linePriceToCode_(c0.price);
    if (pc) code = pc + (tables >= 1 ? tables + "a" : (c0.tables ? c0.tables + "a" : ""));
    else code = lineHalfWidth_(rawNote).slice(c0.index, c0.end).toLowerCase().replace(/\s+/g, "");
    note = lineStripCodes_(rawNote);
  }
  if (!code) return note;
  return note ? (code + "；" + note) : code;
}

/**
 * 回給客人看的備註：客人原本備註拿掉方案代碼等店內短碼，其餘原話保留。
 * 例：「5k1a 慶生」→「慶生」；「靠窗、4.5K 2A」→「靠窗」；只有代碼 → ""（呼叫端顯示「無」或整行不顯示）。
 * 只給客人訊息用；寫進工作表的備註請用 composeLineRemark_。
 */
function lineCustomerNote_(note) {
  var s = String(note == null ? "" : note).trim();
  // 店內短碼：散客Na／大型Na（任何位置）、開頭單獨的「散客」「大型」；「散客很多」「大型聚會」這類一般字不動
  var stripped = s
    .replace(/(^|[\s、，,；;])(?:散客|大型)[1-9][0-9]*a(?![A-Za-z0-9])/g, "$1 ")
    .replace(/^(?:散客|大型)(?=[\s、，,；;]|$)/, " ");
  if (stripped === s) return lineStripCodes_(s);
  return lineStripCodes_(stripped)
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\s*([、，,；;])\s*/g, "$1")
    .replace(/([、，,；;])[、，,；;]+/g, "$1")
    .replace(/^[\s、，,；;]+|[\s、，,；;:：]+$/g, "")
    .trim();
}

/**
 * 方案代碼 → 客人看得懂的文字（a = 桌數）。
 *   4.5k1a →「每桌 4500 元、1 桌」；5k2a →「每桌 5000 元、2 桌」；5.5k →「每桌 5500 元」。
 * 參數可以是代碼本身或整段備註（取第一個代碼）；沒有合理代碼回 ""。散客／大型Na 不是價位方案 → ""。
 */
function linePlanFriendly_(text) {
  var codes = lineFindCodes_(lineHalfWidth_(text)).filter(function (c) { return c.valid; });
  if (!codes.length) return "";
  return "每桌 " + codes[0].price + " 元" + (codes[0].tables ? "、" + codes[0].tables + " 桌" : "");
}

/**
 * LINE 對話中（還沒 finalize）給客人看的方案文字：與 finalizeBooking 同規則算桌數後組代碼，再轉友善文字。
 * 客人明講桌數優先；否則有人數時 ceil(人數/10)；都沒有就只顯示價位。沒有方案回 ""。
 */
function lineCustomerPlanText_(state) {
  state = state || {};
  var seat = (typeof SEAT_PER_TABLE !== "undefined" && SEAT_PER_TABLE > 0) ? SEAT_PER_TABLE : 10;
  var people = parseInt(state.people, 10);
  var explicitTables = parseInt(state.tables, 10);
  var tables = explicitTables >= 1 ? explicitTables : (people >= 1 ? Math.max(1, Math.ceil(people / seat)) : 0);
  return linePlanFriendly_(composeLineRemark_({ plan: state.plan || null, tables: tables, note: state.note || "" }));
}

/**
 * 工作表備註（網頁表單「代碼 人數字…；客人自填」或 LINE「代碼；原備註」）→ 給客人看的備註：
 * 去掉開頭的 散客／大型Na 與所有 k 代碼，其餘（大人N位、素食、客人自填）保留。只有代碼 → ""。
 */
function customerNoteText_(remark) {
  return lineCustomerNote_(remark);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    stripLineNoise_: stripLineNoise_, linePriceToCode_: linePriceToCode_, parseLinePlan_: parseLinePlan_,
    parseLineTables_: parseLineTables_, lineCategoryPeople_: lineCategoryPeople_,
    composeLineRemark_: composeLineRemark_, lineNumToInt_: lineNumToInt_,
    lineCustomerNote_: lineCustomerNote_, linePlanFriendly_: linePlanFriendly_,
    lineCustomerPlanText_: lineCustomerPlanText_, customerNoteText_: customerNoteText_,
    lineHalfWidth_: lineHalfWidth_, lineFindCodes_: lineFindCodes_, lineStripCodes_: lineStripCodes_
  };
}
