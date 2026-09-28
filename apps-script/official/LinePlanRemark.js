/**
 * 水美土雞城 — LINE 訂位：方案代碼＋人數完整字 → 備註（工作表1 H 欄）
 *
 * NO_DEPLOY 草稿：本檔是官方訂位 Apps Script 的「新增檔案」，只放純函式（不讀寫試算表、不呼叫網路）。
 * 由 程式碼.js 的 parseBookingMessage / handleLineWebhook / finalizeBooking 呼叫（見 line-plan-remark.patch）。
 *
 * 規則（與網頁表單 planCode / peopleWords、DailyBookingSync 一致）：
 *   - 方案代碼 = 價位k + 桌數 + a（a = 桌數，不是人數）：4500 × 2 桌 → 4.5k2a；5000 × 1 桌 → 5k1a。
 *   - 代碼只寫進備註（H 欄）；預估金額（M 欄）一律不寫（Option B）。
 *   - 人數完整字：大人N位、小朋友N位、幼兒N位（0 不寫）；只有客人有講「大人／小朋友／幼兒」分類時才加。
 *   - 備註裡已經有代碼（例：客人打「備註 5k1a 靠窗」）→ 不重複加，改把該代碼移到最前面。
 *   - 格式：「代碼 人數字；原本備註」，DailyBookingSync 以 FORM_NEW_PREFIX_RE_／KA 短碼辨識。
 *   - 客人看不到代碼（Owner 2026-09-28）：回給客人的 LINE 訊息（核對、還差資料、預約成功）與網頁表單確認信
 *     備註一律去掉 5k1a／4.5k2a／5k／散客／大型Na 這類代碼；方案改用友善文字另起一行
 *     （4.5k1a →「每桌 4500 元、1 桌」，5k2a →「每桌 5000 元、2 桌」；沒方案就不多一行）。
 *     工作表 H 欄仍存完整備註；老闆通知／行事曆不變。
 *   - 桌數：客人有講桌數（「一桌就好」「兩桌」「5k1a」）就用客人講的（容量檢查、I 欄、代碼同一個數）；
 *     沒講才用 ceil(人數/10)。
 */

var LINE_NUM_ = "[0-9一二兩两三四五六七八九十]+";
// 人數用：1–2 位數字（前後不黏其他數字，避免「小孩 5000的桌菜」被讀成 5000 位）或中文數字
var LINE_HEAD_NUM_ = "(?:(?<![0-9])[0-9]{1,2}(?![0-9])|[一二兩两三四五六七八九十]{1,3})";
var LINE_ADULT_LABEL_ = "大人|成人";
// 「兒童椅／小孩座／寶寶椅」是座椅需求，不是人數分類
var LINE_KID_LABEL_ = "(?:小朋友|小孩|兒童|小童|孩子|國小生|國中生|學童)(?![椅座餐])";
var LINE_INFANT_LABEL_ = "(?:幼兒園?|幼稚園|嬰兒|幼童|寶寶)(?![椅座餐車])";
var LINE_MAX_TABLES_ = 20;
// 方案代碼形狀：5k、4.5k、5k1a、4.5K 2A、5k×2a（a = 桌數）。實際判斷用 lineFindCodes_（含前後文檢查）。
var LINE_CODE_SHAPE_ = "(\\d{1,2}(?:\\.\\d{1,2})?)\\s*[Kk](?:\\s*[Xx×✕＊*]?\\s*(\\d{1,2})\\s*[Aa])?";
var LINE_PRICE_CONN_ = "(?:是|要|約|大約|大概|差不多)";

function lineNumToInt_(s) {
  s = String(s == null ? "" : s).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
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
  var re = /(?:(?:^|[^0-9.])(\d{1,2})|([一二兩两三四五六七八九十]{1,3}))\s*(?:張)?\s*桌(菜)?/g;
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
 * 解析人數：大人／小朋友／幼兒分類＋客人明講的總人數。回傳 { head, stated }。
 *   head   = { adults, kids, infants, total } 或 null（沒有任何分類字）
 *   stated = 客人明講、且不屬於分類的總人數（「10位」「共10位」「總共12人」）或 null
 * 分類逐段解析（以 、，；。和 跟 及 還有 另外 加上 分段），每段自動判斷寫法，可混用：
 *   「大人8位小孩2位」（分類在前）、「8個大人2個小孩」（數字在前）、「大人8位、2個小孩」、「4大2小」。
 *   同一段兩種讀法都說得通時（「10位 大人8位小孩2位」），段落結尾是數字 → 分類在前，結尾是分類字 → 數字在前。
 */
function parseLinePeopleInfo_(msg) {
  var t = stripLineNoise_(msg);
  var residual = t;
  function blank(start, len) { residual = residual.slice(0, start) + new Array(len + 1).join(" ") + residual.slice(start + len); }
  var labels = "(" + LINE_ADULT_LABEL_ + "|" + LINE_KID_LABEL_ + "|" + LINE_INFANT_LABEL_ + ")";
  var adultRe = new RegExp("^(?:" + LINE_ADULT_LABEL_ + ")$"), infantRe = new RegExp("^(?:" + LINE_INFANT_LABEL_ + ")$");
  var out = { adults: 0, kids: 0, infants: 0, total: 0 };
  var found = false;
  function add(label, n) {
    if (!(n > 0)) return;
    found = true;
    if (label === "大") out.adults += n;
    else if (label === "小") out.kids += n;
    else if (adultRe.test(label)) out.adults += n;
    else if (infantRe.test(label)) out.infants += n;
    else out.kids += n;
  }
  // 台灣常見簡寫「4大2小」
  var bsRe = new RegExp("(" + LINE_HEAD_NUM_ + ")\\s*大\\s*(" + LINE_HEAD_NUM_ + ")\\s*小(?![朋孩童])", "g"), bm;
  while ((bm = bsRe.exec(t)) !== null) { add("大", lineNumToInt_(bm[1])); add("小", lineNumToInt_(bm[2])); blank(bm.index, bm[0].length); }
  // 逐段
  var sepRe = /[、，,；;。！!？?\n]|以及|還有|另外|加上|和|跟|及/g, sm, segStart = 0, segs = [];
  while ((sm = sepRe.exec(residual)) !== null) { segs.push([segStart, sm.index]); segStart = sm.index + sm[0].length; }
  segs.push([segStart, residual.length]);
  for (var si = 0; si < segs.length; si++) {
    var s0 = segs[si][0], seg = residual.slice(s0, segs[si][1]);
    if (!new RegExp(labels).test(seg)) continue;
    var modes = [
      { re: new RegExp(labels + "\\s*[:：]?\\s*(" + LINE_HEAD_NUM_ + ")\\s*(?:位|個|名|人)?", "g"), li: 1, ni: 2 },
      { re: new RegExp("(" + LINE_HEAD_NUM_ + ")\\s*(?:位|個|名)?\\s*" + labels, "g"), li: 2, ni: 1 }
    ];
    var results = modes.map(function (md) {
      var hits = [], mm;
      while ((mm = md.re.exec(seg)) !== null) {
        var n = lineNumToInt_(mm[md.ni]);
        if (n > 0) hits.push({ label: mm[md.li], n: n, index: mm.index, len: mm[0].length });
      }
      return hits;
    });
    var pick;
    if (results[0].length !== results[1].length) pick = results[0].length > results[1].length ? 0 : 1;
    else pick = new RegExp(labels + "\\s*$").test(seg) ? 1 : 0;
    results[pick].forEach(function (h) { add(h.label, h.n); blank(s0 + h.index, h.len); });
  }
  var head = null;
  out.total = out.adults + out.kids + out.infants;
  if (found && out.total > 0 && out.total <= 99) head = out;
  var stated = null;
  var sre = new RegExp("(" + LINE_HEAD_NUM_ + ")\\s*(?:位|人|名|個人)(?!份)", "g"), st;
  while ((st = sre.exec(residual)) !== null) {
    var sn = lineNumToInt_(st[1]);
    if (sn >= 1 && sn <= 99) { stated = sn; break; }
  }
  return { head: head, stated: stated };
}

/**
 * 只取分類人數（相容舊呼叫）。沒有任何分類字時回傳 null（只講「10位」→ 不加人數字）。
 */
function parseLineHeadcount_(msg) {
  return parseLinePeopleInfo_(msg).head;
}

/**
 * LINE 一則訊息的人數（D 欄）：
 *   - 有分類：客人有明講總數 → 用明講的（分類只有部分或對不上時，D 欄仍是總數；備註人數字由 composeLineRemark_ 省略）；
 *     沒明講 → 分類合計。fromBreakdown = true 表示這個數字只是分類合計。
 *   - 沒分類：回 null，由 程式碼.js 原本的 parsePeople 處理（行為不變）。
 */
function lineMessagePeople_(info) {
  if (!info || !info.head) return null;
  if (info.stated) return { people: info.stated, fromBreakdown: false };
  return { people: info.head.total, fromBreakdown: true };
}

// 與網頁表單 peopleWords 相同：大人N位、小朋友N位、幼兒N位（0 不寫）。
function linePeopleWords_(adults, kids, infants) {
  var a = parseInt(adults, 10) || 0, k = parseInt(kids, 10) || 0, i = parseInt(infants, 10) || 0;
  var out = [];
  if (a > 0) out.push("大人" + a + "位");
  if (k > 0) out.push("小朋友" + k + "位");
  if (i > 0) out.push("幼兒" + i + "位");
  return out.join("、");
}

/**
 * 組 LINE 訂位的備註（H 欄）。
 * opts = { plan: {price}|null, tables: 寫入 I 欄的桌數, people: 寫入 D 欄的人數, head: parseLineHeadcount_ 結果|null, note: 客人原本備註 }
 * 人數字規則（保守）：分類合計 ≠ D 欄人數（例：「20位，小朋友2位」「4大2小 共10位」）→ 整組人數字都不寫，只留代碼。
 * 回傳字串，例：「5k1a 大人10位、小朋友2位；靠窗」。沒有方案也沒有分類人數時回傳原備註（行為不變）。
 */
function composeLineRemark_(opts) {
  opts = opts || {};
  var rawNote = String(opts.note == null ? "" : opts.note).trim();
  var note = rawNote;
  var code = "";
  var tables = parseInt(opts.tables, 10);
  var existing = lineFindCodes_(lineHalfWidth_(rawNote));
  if (existing.length) {
    // 備註已有代碼（含只有價位的 5k）：不重複，移到最前面；a 一律改成最終桌數（I 欄），確保 H／I／客人訊息一致。
    var c0 = existing[0];
    var pc = linePriceToCode_(c0.price);
    if (pc) code = pc + (tables >= 1 ? tables + "a" : (c0.tables ? c0.tables + "a" : ""));
    else code = lineHalfWidth_(rawNote).slice(c0.index, c0.end).toLowerCase().replace(/\s+/g, "");
    note = lineStripCodes_(rawNote);
  } else if (opts.plan && opts.plan.price) {
    var priceCode = linePriceToCode_(opts.plan.price);
    if (priceCode) code = priceCode + (tables >= 1 ? tables + "a" : "");
  }
  var words = "";
  var h = opts.head;
  var people = parseInt(opts.people, 10);
  // 分類合計與最終人數（D 欄）不一致時（例：先說大人8位小孩2位、後改 12 位）不寫分類，避免矛盾
  if (h && people >= 1 && h.total !== people) h = null;
  if (h && !/(大人|小朋友|幼兒)[0-9]+位/.test(note)) words = linePeopleWords_(h.adults, h.kids, h.infants);
  var head = [code, words].filter(function (x) { return !!x; }).join(" ");
  if (!head) return note;
  return note ? (head + "；" + note) : head;
}

/**
 * 回給客人看的備註：客人原本備註拿掉方案代碼等店內短碼，其餘原話保留。
 * 例：「5k1a 慶生」→「慶生」；「靠窗、4.5K 2A」→「靠窗」；只有代碼 → ""（呼叫端顯示「無」或整行不顯示）。
 * 只給客人訊息用；寫進工作表的備註請用 composeLineRemark_。
 */
function lineCustomerNote_(note) {
  return lineStripCodes_(note);
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
  return linePlanFriendly_(composeLineRemark_({ plan: state.plan || null, tables: tables, people: people, head: null, note: state.note || "" }));
}

/**
 * 工作表備註（網頁表單「代碼 人數字…；客人自填」或 LINE「代碼 人數字；原備註」）→ 給客人看的備註：
 * 去掉開頭的 散客／大型Na 與所有 k 代碼，其餘（大人N位、素食、客人自填）保留。只有代碼 → ""。
 */
function customerNoteText_(remark) {
  var s = String(remark == null ? "" : remark).trim();
  var stripped = s.replace(/^(?:散客|大型(?:[1-9][0-9]*a)?)(?=[ ；;、，,]|$)/, "");
  if (stripped === s) return lineCustomerNote_(s);
  return lineCustomerNote_(stripped.replace(/^[\s、，,；;]+/, "") || "");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    stripLineNoise_: stripLineNoise_, linePriceToCode_: linePriceToCode_, parseLinePlan_: parseLinePlan_,
    parseLineTables_: parseLineTables_, parseLineHeadcount_: parseLineHeadcount_,
    linePeopleWords_: linePeopleWords_, composeLineRemark_: composeLineRemark_, lineNumToInt_: lineNumToInt_,
    lineCustomerNote_: lineCustomerNote_, linePlanFriendly_: linePlanFriendly_,
    lineCustomerPlanText_: lineCustomerPlanText_, customerNoteText_: customerNoteText_,
    lineHalfWidth_: lineHalfWidth_, lineFindCodes_: lineFindCodes_, lineStripCodes_: lineStripCodes_,
    parseLinePeopleInfo_: parseLinePeopleInfo_, lineMessagePeople_: lineMessagePeople_
  };
}
