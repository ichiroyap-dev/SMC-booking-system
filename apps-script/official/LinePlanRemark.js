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

// 與 DailyBookingSync.parseRemarkAndCode_ 相同的 KA 短碼辨識式。
var LINE_KA_CODE_RE_ = /(\d+(?:\.\d+)?\s*[Kk]\s*[Xx]?\d*\s*[Aa])/;
var LINE_NUM_ = "[0-9一二兩两三四五六七八九十]+";
var LINE_ADULT_LABEL_ = "大人|成人";
var LINE_KID_LABEL_ = "小朋友|小孩|兒童|小童|孩子|國小生|國中生|學童";
var LINE_INFANT_LABEL_ = "幼兒園?|幼稚園|嬰兒|幼童|寶寶(?![椅座])";
var LINE_MAX_TABLES_ = 20;

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

// 先移除手機、訂單編號、日期、時間，避免數字被誤判成價位／桌數／人數。
function stripLineNoise_(msg) {
  return String(msg == null ? "" : msg)
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
 * 解析桌菜方案價位（每桌）。回傳 { price: 5000, tables: 1|null } 或 null。
 *   - 店內簡寫：5k1a、4.5k2a、5k、4.5K 2A
 *   - 價位＋關鍵字：5000的桌菜、桌菜5000、4500元方案、每桌5000、一桌4500、5000一桌
 */
function parseLinePlan_(msg) {
  var t = stripLineNoise_(msg);
  var m = t.match(/(?:^|[^0-9A-Za-z.])(\d{1,2}(?:\.\d)?)\s*[Kk](?:\s*(\d{1,2})\s*[Aa])?(?![A-Za-z])/);
  if (m) {
    var p = Math.round(parseFloat(m[1]) * 1000);
    if (linePriceToCode_(p)) {
      var tb = m[2] ? parseInt(m[2], 10) : null;
      return { price: p, tables: (tb && tb >= 1 && tb <= LINE_MAX_TABLES_) ? tb : null };
    }
  }
  var kw = "(?:桌菜|合菜|方案|套餐|價位|每桌|一桌|\\/桌)";
  var re = [
    new RegExp("(?:^|[^0-9])([1-9]\\d{3,4})\\s*(?:元|塊)?\\s*(?:的)?\\s*" + kw),
    new RegExp(kw + "\\s*(?:價位|價格)?\\s*[:：]?\\s*(?:NT\\$?|\\$)?\\s*([1-9]\\d{3,4})(?![0-9])")
  ];
  for (var i = 0; i < re.length; i++) {
    var mm = t.match(re[i]);
    if (mm && linePriceToCode_(parseInt(mm[1], 10))) return { price: parseInt(mm[1], 10), tables: null };
  }
  return null;
}

// 解析客人明講的桌數（「2桌」「兩桌」「共3張桌」）；「桌菜」「每桌」「一桌5000」（價位說明）不算。回傳 1..20 或 null。
function parseLineTables_(msg) {
  var t = stripLineNoise_(msg);
  var re = /(?:(?:^|[^0-9.])(\d{1,2})|([一二兩两三四五六七八九十]{1,3}))\s*(?:張)?\s*桌(?!菜)/g;
  var m;
  while ((m = re.exec(t)) !== null) {
    var after = t.slice(m.index + m[0].length);
    var n = lineNumToInt_(m[1] || m[2]);
    if (n === 1 && /^\s*(?:是|要|約|大約)?\s*(?:NT\$?|\$)?\s*[1-9]\d{3,4}/.test(after)) continue; // 「一桌5000」= 價位
    var before = t.slice(0, m.index + (m[1] ? m[0].indexOf(m[1]) : m[0].indexOf(m[2])));
    if (/每\s*$/.test(before)) continue; // 「每桌」
    if (n === 1 && /[1-9]\d{3,4}\s*(?:元|塊)?\s*(?:的)?\s*$/.test(before)) continue; // 「5000一桌」= 價位
    if (n >= 1 && n <= LINE_MAX_TABLES_) return n;
  }
  return null;
}

/**
 * 解析大人／小朋友／幼兒分類人數。沒有任何分類字時回傳 null（只講「10位」→ 不加人數字）。
 * 支援「大人8位小孩2位」（分類在前）與「8個大人2個小孩」（數字在前）；依第一個分類字的寫法決定。
 * 回傳 { adults, kids, infants, total }。
 */
function parseLineHeadcount_(msg) {
  var t = stripLineNoise_(msg);
  var labels = "(" + LINE_ADULT_LABEL_ + "|" + LINE_KID_LABEL_ + "|" + LINE_INFANT_LABEL_ + ")";
  var labelFirst = new RegExp(labels + "\\s*[:：]?\\s*(" + LINE_NUM_ + ")\\s*(?:位|個|名|人)?", "g");
  var numFirst = new RegExp("(" + LINE_NUM_ + ")\\s*(?:位|個|名)?\\s*" + labels, "g");
  // 台灣常見簡寫「4大2小」→ 大人4位、小朋友2位
  var bs = t.match(new RegExp("(" + LINE_NUM_ + ")\\s*大\\s*(" + LINE_NUM_ + ")\\s*小(?![朋孩童])"));
  if (bs && !new RegExp(labels).test(t)) {
    var ba = lineNumToInt_(bs[1]), bk = lineNumToInt_(bs[2]);
    if (ba > 0 && ba + bk <= 99) return { adults: ba, kids: bk, infants: 0, total: ba + bk };
  }
  var first = t.match(new RegExp(labels));
  if (!first) return null;
  var afterFirst = t.slice(first.index + first[0].length);
  var beforeFirst = t.slice(0, first.index);
  var useLabelFirst = new RegExp("^\\s*[:：]?\\s*" + LINE_NUM_).test(afterFirst) &&
                      !new RegExp(LINE_NUM_ + "\\s*(?:位|個|名)?\\s*$").test(beforeFirst);
  var out = { adults: 0, kids: 0, infants: 0, total: 0 };
  var found = false, m;
  var re = useLabelFirst ? labelFirst : numFirst;
  while ((m = re.exec(t)) !== null) {
    var label = useLabelFirst ? m[1] : m[2];
    var n = lineNumToInt_(useLabelFirst ? m[2] : m[1]);
    if (!(n > 0)) continue;
    found = true;
    if (new RegExp("^(?:" + LINE_ADULT_LABEL_ + ")$").test(label)) out.adults += n;
    else if (new RegExp("^(?:" + LINE_INFANT_LABEL_ + ")$").test(label)) out.infants += n;
    else out.kids += n;
  }
  if (!found) return null;
  out.total = out.adults + out.kids + out.infants;
  if (out.total <= 0 || out.total > 99) return null;
  return out;
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
 * 回傳字串，例：「5k1a 大人10位、小朋友2位；靠窗」。沒有方案也沒有分類人數時回傳原備註（行為不變）。
 */
function composeLineRemark_(opts) {
  opts = opts || {};
  var note = String(opts.note == null ? "" : opts.note).trim();
  var code = "";
  var existing = note.match(LINE_KA_CODE_RE_);
  if (existing) {
    // 備註已有代碼：不重複，只把它移到最前面（正規化成小寫、無空白）。
    code = existing[1].toLowerCase().replace(/\s+/g, "");
    note = note.replace(existing[0], "").replace(/^[\s、，,；;]+|[\s、，,；;]+$/g, "").replace(/、{2,}/g, "、");
  } else if (opts.plan && opts.plan.price) {
    var priceCode = linePriceToCode_(opts.plan.price);
    var tables = parseInt(opts.tables, 10);
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

// 店內方案代碼樣式（含只有價位的 5k、4.5K，與大寫／空白／x 變體）；前後不可黏英數字，避免誤砍一般字。
var LINE_CODE_TOKEN_RE_ = /(^|[^0-9A-Za-z.])\d{1,2}(?:\.\d+)?\s*[Kk](?:\s*[Xx]?\s*\d{0,2}\s*[Aa])?(?![A-Za-z])(?!\d(?![\d.]*\s*[Kk]))/g;

/**
 * 回給客人看的備註：客人原本備註拿掉方案代碼等店內短碼，其餘原話保留。
 * 例：「5k1a 慶生」→「慶生」；「靠窗、4.5K 2A」→「靠窗」；只有代碼 → ""（呼叫端顯示「無」或整行不顯示）。
 * 只給客人訊息用；寫進工作表的備註請用 composeLineRemark_。
 */
function lineCustomerNote_(note) {
  var s = String(note == null ? "" : note);
  LINE_CODE_TOKEN_RE_.lastIndex = 0;
  if (!LINE_CODE_TOKEN_RE_.test(s)) return s.trim(); // 沒代碼 → 原話不動（行為不變）
  LINE_CODE_TOKEN_RE_.lastIndex = 0;
  var prev;
  do { prev = s; s = s.replace(LINE_CODE_TOKEN_RE_, "$1 "); } while (s !== prev); // 相鄰代碼要重跑
  return s
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
  var s = String(text == null ? "" : text);
  var m = s.match(/(?:^|[^0-9A-Za-z.])(\d{1,2}(?:\.\d+)?)\s*[Kk](?:\s*[Xx]?\s*(\d{1,2})?\s*[Aa])?(?![A-Za-z])/);
  if (!m) return "";
  var price = Math.round(parseFloat(m[1]) * 1000);
  if (!linePriceToCode_(price)) return "";
  var tables = m[2] ? parseInt(m[2], 10) : 0;
  return "每桌 " + price + " 元" + (tables >= 1 && tables <= LINE_MAX_TABLES_ ? "、" + tables + " 桌" : "");
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
    lineCustomerPlanText_: lineCustomerPlanText_, customerNoteText_: customerNoteText_
  };
}
