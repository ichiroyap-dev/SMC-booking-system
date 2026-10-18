/**
 * 隔離測試用。必須貼在新建的獨立試算表專案，不要貼進任何既有專案。
 * 這支沒有 doPost，只有 doGet。誤貼進正式專案會蓋掉同名入口，所以不要貼。
 * 不要部署成正式 web app，不要寫正式試算表。
 *
 * 正式 Apps Script 的原始碼不在這個 repo。這支是依官網現有的 11 欄 POST
 * （action、type、name、phone、email、people、tables、date、time、note、orderItems）
 * 另寫的測試實作，不是正式腳本的補丁。
 *
 * 來源 9 欄可有可無。缺欄、多欄、型別不對，都仍收單：備註原樣保留意思，壞掉的來源改空白。
 * 客人信不放活動代碼。店內信才放來源對帳。
 * 寫入後先 flush，再讀回同一列。讀回值要等於原值字串，而且 getFormula 為空。
 * 對不上或讀不回來就停下：回結果未知（寫明欄位、原值、讀回值）、不寄信、請核對原列，不要重送。
 * 舊寫法：前導單引號不會被 Sheets 存進格子。setValues 會把 = 算掉。setRichTextValue 會把 + 開頭改成文字 =+。
 * 資料列在鎖內用 values.get 讀整張分頁的公式（valueRenderOption=FORMULA），不設 A:ZZ 上限。
 * 再用 values.update 的 RAW 寫到最後一筆有值的下一列。="" 這類公式也算有資料。
 * updatedRange 要對上分頁、正好那一列、欄從 A 到這列最後一欄。只對到列號不夠。
 * 記錄裡的 tableRange 是推算，不是 API 回傳的 tableRange。
 * 不看試算表快取的最後一列，也不用 A1 的 append。中段空白下方的資料仍算在表尾。
 * 自由文字、電話、來源是 RAW 文字。人數、桌數是數字。日期、時間、收到時間是試算表序號。
 * 電話保留開頭的 0。姓名、備註開頭的單引號不刪，客人可能真的打了。
 * 報告分頁仍用 values.update 的 RAW，以及 values.clear。
 * 使用前要在編輯器左側「服務」加入 Google Sheets API。不必另外手改 appsscript.json。
 * 確認成功並放開鎖之後才寄信。兩封信的收件人都固定為 SMC_SHOP_EMAIL，不採用 payload 的 email。
 * 網頁驗收用 doGet 的 HtmlService 頁 IsolatedCheck，由 google.script.run 呼叫 submitIsolatedFromPage。
 * 部署存取維持「只有我」。不要改成「任何人」。
 * 旗標 SEND_ATTRIBUTION_TO_BACKEND 仍由官網控制；這支腳本不會把它打開。
 *
 * 使用前在指令碼屬性設定（試算表 ID 不可省略，腳本也不會改寫「目前打開的那張表」）：
 *   SMC_ATTRIBUTION_ISOLATED = yes
 *   SMC_SHOP_EMAIL = 你的測試信箱
 *   SMC_TEST_SHEET_ID = 測試試算表 ID
 * 測試試算表要自己先建分頁「隔離標記」，A1 打上 SMC-ISOLATED-TEST。
 * 對不上就不會寫入任何訂單、也不會寄信。腳本不會自動幫你做出這個標記。
 *
 * 編輯器選 runIsolatedEightCases 後按執行，或在綁定的試算表選單「隔離測試」送出 8 筆。
 * 表尾三筆只用編輯器入口 runIsolatedOneBooking201／202／203，每次只送一筆固定編號。
 * 帶編號的 helper 是私有函式，網頁呼叫不到（google.script.run 不能呼叫尾綴 _ 的函式）。
 * 編輯器只選 runIsolatedOneBooking201／202／203。沒有新的 doGet／doPost，也不要為了這三筆重新部署。
 * 這個檔在 .github/pages-unpublished/booking-attribution-isolated.gs。
 * 目前的建置方式不會公開 .github，請從 repo 複製，不要從官網網址下載。
 * 換建置流程或 upload-pages-artifact 換版本後，要再確認這個目錄沒有被公開。
 * 步驟見 .github/pages-unpublished/booking-attribution-isolated-runbook.md。
 */
var ORDER_HEADERS = [
  '訂單編號', '收到時間', '動作', '類型', '姓名', '電話', '信箱', '人數', '桌數', '日期', '時間', '備註', '品項',
  '來源', 'utm來源', 'utm媒介', 'utm活動', 'utm內容', 'utm關鍵字', 'utm廣告群組', '群組分類', '點擊識別碼'
];
var MAIL_HEADERS = ['訂單編號', '客人信箱', '客人主旨', '客人正文', '店內信箱', '店內主旨', '店內正文'];
var RESULT_HEADERS = ['案例', '訂單編號', '結果', '寫入', '寄信'];
var ATTRIBUTION_FIELDS = ['source', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', 'utmAdgroup', 'adgroupBucket', 'gclid'];
var MARKER_SHEET = '隔離標記';
var MARKER_VALUE = 'SMC-ISOLATED-TEST';
var BLOCKED_MESSAGE = '這支腳本只供隔離測試。未設定 SMC_ATTRIBUTION_ISOLATED=yes，沒有寫入試算表，也沒有寄信。';

function stripInvisible_(text) {
  return String(text).replace(/[\u0000\u200B-\u200D\uFEFF]/g, '');
}

function formulaGuard_(value) {
  var raw = stripInvisible_(value == null ? '' : String(value));
  var normalized = raw.replace(/^\s+/, '');
  if (!normalized) return '';
  // 不要加前導單引號。Sheets 的 setValues 會把它當成輸入跳脫吃掉，接著仍計算 =。
  if (/^[=+\-@]/.test(normalized)) return normalized;
  return raw;
}

function attributionText_(value) {
  if (typeof value !== 'string') return '';
  var text = stripInvisible_(value).trim();
  if (!text) return '';
  if (text.length > 200) text = text.slice(0, 200);
  return text;
}

function bucketText_(value) {
  var text = attributionText_(value);
  return text === '品牌' || text === '非品牌' ? text : '';
}

function bookingText_(value) {
  if (typeof value === 'string') return formulaGuard_(value);
  if (typeof value === 'number' && isFinite(value)) return formulaGuard_(String(value));
  return '';
}

var COLUMN_FORMAT = {
  '收到時間': 'yyyy-mm-dd hh:mm:ss',
  '電話': '@',
  '人數': '0',
  '桌數': '0',
  '日期': 'yyyy-mm-dd',
  '時間': 'hh:mm'
};

function sheetsEpochMs_() {
  return Date.UTC(1899, 11, 30);
}

function serialFromMs_(ms) {
  return (ms - sheetsEpochMs_()) / 86400000;
}

function textStore_(value) {
  return formulaGuard_(value);
}

function phoneStore_(value) {
  // 一律文字。保留開頭的 0，也不刪客人打的單引號。
  return formulaGuard_(value);
}

function numberStore_(value) {
  if (typeof value === 'number' && isFinite(value) && Math.floor(value) === value) return value;
  var text = typeof value === 'string' ? value.trim() : '';
  if (/^(0|[1-9][0-9]*)$/.test(text)) return Number(text);
  return formulaGuard_(value);
}

function dateStore_(value) {
  var text = typeof value === 'string' ? value.trim() : '';
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return formulaGuard_(value);
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var ms = Date.UTC(year, month - 1, day);
  var check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return formulaGuard_(value);
  return serialFromMs_(ms);
}

function timeStore_(value) {
  var text = typeof value === 'string' ? value.trim() : '';
  var match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) return formulaGuard_(value);
  var hour = Number(match[1]);
  var minute = Number(match[2]);
  if (hour > 23 || minute > 59) return formulaGuard_(value);
  return (hour * 60 + minute) / 1440;
}

function spreadsheetZone_(ss) {
  try {
    if (ss && ss.getSpreadsheetTimeZone) return String(ss.getSpreadsheetTimeZone() || '');
  } catch (err) {}
  return '';
}

// 序號是試算表時區的牆鐘，不是 UTC 瞬時。2026-10-18T07:00:00Z 在台北是 15:00。
function wallClockSerial_(ms, timeZone) {
  if (!timeZone || typeof Utilities === 'undefined' || !Utilities || typeof Utilities.formatDate !== 'function') return null;
  var text = Utilities.formatDate(new Date(ms), timeZone, 'yyyy-MM-dd HH:mm:ss');
  var match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(text || ''));
  if (!match) return null;
  return serialFromMs_(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])));
}

function datetimeStore_(value, timeZone) {
  var text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(text)) return formulaGuard_(value);
  var ms = Date.parse(text);
  if (!isFinite(ms)) return formulaGuard_(value);
  var serial = wallClockSerial_(ms, timeZone);
  if (serial == null) return formulaGuard_(value);
  return serial;
}

function displayCount_(stored, raw) {
  if (typeof stored === 'number' && isFinite(stored)) return String(stored);
  return stored == null ? '' : String(stored);
}

function displayDate_(stored, raw) {
  if (typeof stored === 'number' && isFinite(stored) && typeof raw === 'string') return raw.trim();
  return stored == null ? '' : String(stored);
}

function emptyAttribution_() {
  var out = {};
  for (var i = 0; i < ATTRIBUTION_FIELDS.length; i += 1) out[ATTRIBUTION_FIELDS[i]] = '';
  return out;
}

function attributionFromPayload_(payload) {
  var out = emptyAttribution_();
  try {
    var body = payload && typeof payload === 'object' ? payload : {};
    for (var i = 0; i < ATTRIBUTION_FIELDS.length; i += 1) {
      var key = ATTRIBUTION_FIELDS[i];
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      out[key] = key === 'adgroupBucket' ? bucketText_(body[key]) : attributionText_(body[key]);
    }
    if (out.adgroupBucket !== '品牌' && out.adgroupBucket !== '非品牌') out.adgroupBucket = '';
  } catch (err) {
    return emptyAttribution_();
  }
  return out;
}

function guestAddress_(email) {
  if (typeof email !== 'string') return '';
  var text = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return '';
  return text;
}

function typeLabel_(type) {
  return type === 'takeout' ? '外帶' : '內用';
}

function guestEmailFor_(booking, orderId, to) {
  var lines = [
    '水美土雞城｜預約申請已收到',
    '訂單編號：' + orderId,
    '申請類型：' + typeLabel_(booking.type),
    '預約日期與時間：' + booking.date + ' ' + booking.time,
    '人數：' + booking.people,
    '桌數：' + booking.tables,
    '備註：' + (booking.note ? booking.note : '無'),
    '郵件上的「已收到」是收件通知，細節以電話確認為準。'
  ];
  return {
    to: to || '',
    subject: '水美土雞城｜預約申請已收到（' + orderId + '）',
    body: lines.join('\n')
  };
}

function shopEmailFor_(booking, attr, orderId, to) {
  var lines = [
    '水美土雞城｜店內收件（隔離測試，勿轉寄給客人）',
    '訂單編號：' + orderId,
    '申請類型：' + typeLabel_(booking.type),
    '預約日期與時間：' + booking.date + ' ' + booking.time,
    '人數：' + booking.people,
    '桌數：' + booking.tables,
    '備註：' + (booking.note ? booking.note : '無'),
    '品項：' + (booking.orderItems ? booking.orderItems : '無'),
    '---',
    '來源對帳',
    '來源：' + attr.source,
    'utm來源：' + attr.utmSource,
    'utm媒介：' + attr.utmMedium,
    'utm活動：' + attr.utmCampaign,
    'utm內容：' + attr.utmContent,
    'utm關鍵字：' + attr.utmTerm,
    'utm廣告群組：' + attr.utmAdgroup,
    '群組分類：' + attr.adgroupBucket,
    '點擊識別碼：' + attr.gclid
  ];
  return {
    to: to || '',
    subject: '【店內對帳】預約 ' + orderId,
    body: lines.join('\n')
  };
}

function buildBookingResult_(payload, orderId, receivedAt, guestTo, shopTo, timeZone) {
  var peopleStored = numberStore_(payload.people);
  var tablesStored = numberStore_(payload.tables);
  var dateStored = dateStore_(payload.date);
  var timeStored = timeStore_(payload.time);
  var receivedStored = datetimeStore_(receivedAt || '', timeZone);
  var booking = {
    action: 'book',
    type: payload.type === 'takeout' ? 'takeout' : 'dining',
    name: textStore_(payload.name),
    phone: phoneStore_(payload.phone),
    email: textStore_(payload.email),
    people: displayCount_(peopleStored, payload.people),
    tables: displayCount_(tablesStored, payload.tables),
    date: displayDate_(dateStored, payload.date),
    time: displayDate_(timeStored, payload.time),
    note: textStore_(payload.note),
    orderItems: textStore_(payload.orderItems)
  };
  var attr = attributionFromPayload_(payload);
  var row = [
    orderId,
    receivedStored,
    booking.action,
    booking.type,
    booking.name,
    booking.phone,
    booking.email,
    peopleStored,
    tablesStored,
    dateStored,
    timeStored,
    booking.note,
    booking.orderItems,
    attr.source,
    attr.utmSource,
    attr.utmMedium,
    attr.utmCampaign,
    attr.utmContent,
    attr.utmTerm,
    attr.utmAdgroup,
    attr.adgroupBucket,
    attr.gclid
  ];
  return {
    response: { status: 'success', orderId: orderId, message: '訂位成功，已為您保留座位。' },
    row: row,
    guestEmail: guestEmailFor_(booking, orderId, guestTo),
    shopEmail: shopEmailFor_(booking, attr, orderId, shopTo)
  };
}

function missingBooking_(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return true;
  if (payload.action !== 'book') return true;
  if (payload.type !== 'dining' && payload.type !== 'takeout') return true;
  if (typeof payload.name !== 'string' || !payload.name.trim()) return true;
  if (typeof payload.phone !== 'string' || !payload.phone.trim()) return true;
  if (typeof payload.date !== 'string' || !payload.date.trim()) return true;
  if (typeof payload.time !== 'string' || !payload.time.trim()) return true;
  return false;
}

function isIsolated_() {
  return PropertiesService.getScriptProperties().getProperty('SMC_ATTRIBUTION_ISOLATED') === 'yes';
}

function nowIso_() {
  return new Date().toISOString();
}

function orderIdFor_(payload, existingIds) {
  var requested = '';
  try {
    requested = payload && typeof payload._testOrderId === 'string' ? payload._testOrderId.trim() : '';
  } catch (err) {
    requested = '';
  }
  if (/^SMC[0-9]{6}$/.test(requested)) return requested;
  var taken = {};
  var list = existingIds || [];
  for (var i = 0; i < list.length; i += 1) taken[String(list[i])] = true;
  var props = PropertiesService.getScriptProperties();
  var current = Number(props.getProperty('SMC_TEST_SEQ') || '900000');
  if (!isFinite(current) || current < 0) current = 900000;
  var next = Math.floor(current);
  var candidate = '';
  var spins = 0;
  do {
    next += 1;
    spins += 1;
    if (next > 999999) next = 0;
    var digits = String(next);
    while (digits.length < 6) digits = '0' + digits;
    candidate = 'SMC' + digits;
  } while (taken[candidate] && spins < 1000000);
  if (taken[candidate]) return '';
  props.setProperty('SMC_TEST_SEQ', String(next));
  return candidate;
}

function openIsolatedSpreadsheet_() {
  var rawId = PropertiesService.getScriptProperties().getProperty('SMC_TEST_SHEET_ID');
  var id = rawId == null ? '' : String(rawId).trim();
  if (!id) {
    return { ok: false, message: '未設定 SMC_TEST_SHEET_ID。沒有寫入試算表，也沒有寄信。' };
  }
  var ss;
  try {
    ss = SpreadsheetApp.openById(id);
  } catch (err) {
    return { ok: false, message: '打不開指定的測試試算表。沒有寫入試算表，也沒有寄信。' };
  }
  if (!ss) {
    return { ok: false, message: '打不開指定的測試試算表。沒有寫入試算表，也沒有寄信。' };
  }
  var markerSheet = ss.getSheetByName(MARKER_SHEET);
  if (!markerSheet) {
    return { ok: false, message: '找不到分頁「隔離標記」。沒有寫入試算表，也沒有寄信。' };
  }
  var marker = '';
  try {
    var cell = markerSheet.getRange(1, 1).getValue();
    marker = cell == null ? '' : String(cell).trim();
  } catch (err) {
    return { ok: false, message: '讀不到隔離標記。沒有寫入試算表，也沒有寄信。' };
  }
  if (marker !== MARKER_VALUE) {
    return { ok: false, message: '隔離標記不符。沒有寫入試算表，也沒有寄信。' };
  }
  return { ok: true, ss: ss, id: id };
}

function applyColumnFormats_(sheet, headers) {
  var rows = 1;
  try {
    if (sheet.getMaxRows) rows = sheet.getMaxRows();
  } catch (err) {
    rows = 1;
  }
  if (!rows || rows < 1) rows = 1;
  for (var i = 0; i < headers.length; i += 1) {
    var fmt = COLUMN_FORMAT[headers[i]];
    if (!fmt) continue;
    try { sheet.getRange(1, i + 1, rows, 1).setNumberFormat(fmt); } catch (err) {}
  }
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (!sheetsApiReady_()) throw new Error(sheetsMissingMessage_());
    var id = ss.getId ? ss.getId() : '';
    if (!id) throw new Error('找不到試算表 ID');
    var headerRow = [];
    for (var h = 0; h < headers.length; h += 1) headerRow.push(String(headers[h]));
    // 表頭用 API 立刻寫進伺服器。不靠 appendRow 再等 flush，避免 append 寫到第 1 列後被表頭蓋掉。
    Sheets.Spreadsheets.Values.update(
      { values: [headerRow] },
      id,
      quotedSheet_(sheet) + '!A1:' + columnLetter_(headers.length) + '1',
      { valueInputOption: 'RAW' }
    );
  }
  applyColumnFormats_(sheet, headers);
  return sheet;
}

function readColumn_(sheet, col) {
  var last = sheet.getLastRow();
  if (!last) return [];
  var values = sheet.getRange(1, col, last, 1).getValues();
  var out = [];
  for (var i = 0; i < values.length; i += 1) out.push(values[i][0] == null ? '' : String(values[i][0]));
  return out;
}

function sheetsApiReady_() {
  try {
    return typeof Sheets !== 'undefined' && !!Sheets && !!Sheets.Spreadsheets && !!Sheets.Spreadsheets.Values
      && typeof Sheets.Spreadsheets.Values.update === 'function'
      && typeof Sheets.Spreadsheets.Values.clear === 'function'
      && typeof Sheets.Spreadsheets.Values.get === 'function';
  } catch (err) {
    return false;
  }
}

function sheetsMissingMessage_() {
  return '尚未啟用 Google Sheets API 進階服務。請在編輯器左側「服務」加 Google Sheets API。沒有寫入，也沒有寄信。';
}

function sheetsMissingOutcome_() {
  return {
    response: {
      status: 'error',
      message: sheetsMissingMessage_(),
      mailed: false,
      wrote: false,
      duplicate: false
    },
    wrote: false,
    mailed: false
  };
}

function columnLetter_(col) {
  var n = col;
  var out = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function quotedSheet_(sheet) {
  return "'" + String(sheet.getName()).replace(/'/g, "''") + "'";
}

function literalRange_(sheet, startRow, numRows, numCols) {
  var endRow = startRow + numRows - 1;
  return quotedSheet_(sheet) + '!' + columnLetter_(1) + startRow + ':' + columnLetter_(numCols) + endRow;
}

// 2026-10-18 14:31 真表：setRichTextValue 對 = - @ 有效，但 +1+1 被存成文字 =+1+1，getFormula 仍是空的。
// 官方 values.update 的 RAW 不解析輸入，=1+2 會以字串原樣留下。訂單、郵件、驗收、公式核對都走這條。
function writeLiteralMatrix_(sheet, startRow, matrix) {
  if (!matrix || !matrix.length) return [];
  if (!sheetsApiReady_()) throw new Error(sheetsMissingMessage_());
  var width = matrix[0].length;
  var values = [];
  for (var r = 0; r < matrix.length; r += 1) {
    var line = [];
    for (var c = 0; c < width; c += 1) line.push(String(formulaGuard_(matrix[r][c])));
    values.push(line);
  }
  var parent = sheet.getParent();
  var id = parent && parent.getId ? parent.getId() : '';
  if (!id) throw new Error('找不到試算表 ID');
  Sheets.Spreadsheets.Values.update(
    { values: values },
    id,
    literalRange_(sheet, startRow, values.length, width),
    { valueInputOption: 'RAW' }
  );
  return values;
}

function rawApiCell_(value) {
  if (typeof value === 'number' && isFinite(value)) return value;
  return String(formulaGuard_(value));
}

function lastValueRow_(grid) {
  var last = 0;
  var maxCol = 0;
  for (var r = 0; r < grid.length; r += 1) {
    var line = grid[r] || [];
    for (var c = 0; c < line.length; c += 1) {
      if (line[c] != null && String(line[c]) !== '') {
        last = r + 1;
        if (c + 1 > maxCol) maxCol = c + 1;
      }
    }
  }
  return { row: last, col: maxCol };
}

function columnIndex_(letters) {
  var n = 0;
  var text = String(letters || '').toUpperCase();
  for (var i = 0; i < text.length; i += 1) {
    var code = text.charCodeAt(i);
    if (code < 65 || code > 90) return 0;
    n = n * 26 + (code - 64);
  }
  return n;
}

// $ 只從儲存格部分去掉。分頁名稱本身可以有 $，例如 'Cash$1'!A5:V5。
function parseUpdatedRange_(range) {
  var text = String(range || '').trim();
  var bang = text.lastIndexOf('!');
  if (bang < 0) return null;
  var name = text.slice(0, bang).trim();
  var cells = text.slice(bang + 1).trim().replace(/\$/g, '');
  if (name.charAt(0) === "'" && name.charAt(name.length - 1) === "'") {
    name = name.slice(1, -1).replace(/''/g, "'");
  }
  var pair = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(cells);
  if (pair) {
    return {
      name: name,
      startCol: columnIndex_(pair[1]),
      startRow: Number(pair[2]),
      endCol: columnIndex_(pair[3]),
      endRow: Number(pair[4])
    };
  }
  var single = /^([A-Za-z]+)(\d+)$/.exec(cells);
  if (!single) return null;
  return {
    name: name,
    startCol: columnIndex_(single[1]),
    startRow: Number(single[2]),
    endCol: columnIndex_(single[1]),
    endRow: Number(single[2])
  };
}

function updatedRangeMatches_(updated, sheetName, targetRow, numCols) {
  var parsed = parseUpdatedRange_(updated);
  if (!parsed || !parsed.startCol || !parsed.endCol) return false;
  return parsed.name === String(sheetName)
    && parsed.startRow === targetRow
    && parsed.endRow === targetRow
    && parsed.startCol === 1
    && parsed.endCol === numCols;
}

// A1 的 values.append 只接在包含 A1 的表格後面，中段空白下方的資料不會算進去。
// 這裡在鎖內讀整張分頁的公式，寫到最後一筆有值的下一列。="" 也算有資料。格式不算值。
// updatedRange 必須是這張分頁、正好目標列、欄從 A 到這列最後一欄。對不上就不寄信。
function writeRow_(sheet, row) {
  if (!sheetsApiReady_()) throw new Error(sheetsMissingMessage_());
  var parent = sheet.getParent();
  var id = parent && parent.getId ? parent.getId() : '';
  if (!id) throw new Error('找不到試算表 ID');
  var read = Sheets.Spreadsheets.Values.get(id, quotedSheet_(sheet), { valueRenderOption: 'FORMULA' });
  var grid = read && read.values ? read.values : [];
  var used = lastValueRow_(grid);
  var targetRow = used.row + 1;
  var line = [];
  for (var c = 0; c < row.length; c += 1) line.push(rawApiCell_(row[c]));
  var range = literalRange_(sheet, targetRow, 1, line.length);
  var response = Sheets.Spreadsheets.Values.update(
    { values: [line] },
    id,
    range,
    { valueInputOption: 'RAW' }
  );
  var updated = response && response.updatedRange ? String(response.updatedRange) : '';
  var tableEndCol = used.col > 0 ? used.col : line.length;
  var tableRange = used.row > 0 ? quotedSheet_(sheet) + '!A1:' + columnLetter_(tableEndCol) + used.row : '';
  console.log('tableRange=' + tableRange + '（推算，不是 API 回傳的 tableRange） updatedRange=' + updated);
  if (!updatedRangeMatches_(updated, sheet.getName(), targetRow, line.length)) throw new Error('寫入位置不符');
}

function unknownOutcome_(orderId, detail) {
  var message = '結果未知，先核對試算表、勿重送。讀回與寫入不一致就停下，請核對原列，不要重送';
  if (detail && detail.header) {
    message += '。欄位：' + detail.header + '。原值：' + detail.want + '。讀回值：' + detail.actual;
    message += '。getFormula：' + (detail.formula ? detail.formula : '（空）');
  }
  return {
    response: {
      status: 'unknown',
      orderId: orderId,
      message: message,
      mailed: false,
      wrote: true,
      duplicate: false
    },
    wrote: true,
    mailed: false
  };
}

// flush 之後把剛寫入的那一列讀回來。讀回值要等於原值字串，而且 getFormula 為空。對不上就停下。不寄信，請核對原列，不要重送。
function isDateObject_(value) {
  return Object.prototype.toString.call(value) === '[object Date]';
}

function serialOf_(value, timeZone) {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (!isDateObject_(value)) return null;
  // 不用本地 getters，也不用專案時區。Date 的牆鐘以試算表時區解讀。
  return wallClockSerial_(value.getTime(), timeZone);
}

function showStored_(value) {
  if (value == null) return '';
  if (typeof value === 'number' && isFinite(value)) return String(value);
  return String(formulaGuard_(value));
}

function sameStored_(actual, expected, timeZone) {
  if (typeof expected === 'number' && isFinite(expected)) {
    var got = serialOf_(actual, timeZone);
    return got != null && Math.abs(got - expected) < 1e-6;
  }
  var want = String(formulaGuard_(expected));
  var left = actual == null ? '' : String(actual);
  return left === want;
}

function confirmOrderRow_(sheet, orderId, expectedRow) {
  var miss = { ok: false, header: '', want: '', actual: '', formula: '' };
  if (!sheet || !expectedRow || !orderId) return miss;
  var timeZone = spreadsheetZone_(sheet.getParent ? sheet.getParent() : null);
  var width = expectedRow.length;
  var last = sheet.getLastRow();
  if (last < 1 || width < 1) return miss;
  var values = sheet.getRange(1, 1, last, width).getValues();
  var found = false;
  for (var r = 0; r < values.length; r += 1) {
    var id = values[r][0] == null ? '' : String(values[r][0]);
    if (id !== String(orderId)) continue;
    found = true;
    for (var c = 0; c < width; c += 1) {
      var actual = values[r][c] == null ? '' : values[r][c];
      var want = expectedRow[c];
      var formula = '';
      try {
        formula = sheet.getRange(r + 1, c + 1).getFormula();
        formula = formula == null ? '' : String(formula);
      } catch (err) {
        formula = '讀取失敗';
      }
      if (!sameStored_(actual, want, timeZone) || formula !== '') {
        return {
          ok: false,
          header: ORDER_HEADERS[c] || String(c),
          want: showStored_(want),
          actual: showStored_(actual),
          formula: formula
        };
      }
    }
  }
  if (!found) return miss;
  return { ok: true, header: '', want: '', actual: '', formula: '' };
}

function mailPreviewRow_(result) {
  return [
    result.response.orderId,
    result.guestEmail.to,
    result.guestEmail.subject,
    result.guestEmail.body,
    result.shopEmail.to,
    result.shopEmail.subject,
    result.shopEmail.body
  ];
}

function shopMailbox_() {
  return guestAddress_(PropertiesService.getScriptProperties().getProperty('SMC_SHOP_EMAIL') || '');
}

function invalidMailboxOutcome_() {
  return {
    response: {
      status: 'error',
      message: 'SMC_SHOP_EMAIL 空白或格式不對，沒有寫入，也沒有寄信。',
      mailed: false,
      wrote: false,
      duplicate: false
    },
    wrote: false,
    mailed: false
  };
}

function errorText_(err) {
  if (err && err.message) return String(err.message);
  if (err) return String(err);
  return '沒有錯誤內容';
}

function mailNote_(sent, failed) {
  var note = '確認寄出 ' + sent + ' 封。未確認寄出 ' + failed + ' 封';
  if (failed > 0) note += '，不要補寄';
  return note;
}

function sendEmails_(result) {
  var sent = 0;
  var failed = 0;
  // 客人信丟錯後仍嘗試店內信。丟錯只記成未確認寄出，不代表一定沒送到，不要補寄。
  function deliver_(mail) {
    if (!mail || !mail.to) return;
    try {
      MailApp.sendEmail(mail.to, mail.subject, mail.body);
      sent += 1;
    } catch (err) {
      failed += 1;
    }
  }
  deliver_(result.guestEmail);
  deliver_(result.shopEmail);
  return { sent: sent, failed: failed };
}

function acceptBooking_(payload) {
  if (!isIsolated_()) {
    return { response: { status: 'error', message: BLOCKED_MESSAGE }, wrote: false, mailed: false };
  }
  if (missingBooking_(payload)) {
    return { response: { status: 'error', message: '缺少預約必要欄位。' }, wrote: false, mailed: false };
  }
  var shopTo = shopMailbox_();
  if (!shopTo) return invalidMailboxOutcome_();
  if (!sheetsApiReady_()) return sheetsMissingOutcome_();
  var opened = openIsolatedSpreadsheet_();
  if (!opened.ok) {
    return { response: { status: 'error', message: opened.message }, wrote: false, mailed: false };
  }
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(10000) === true;
  } catch (lockErr) {
    locked = false;
  }
  if (!locked) {
    return { response: { status: 'error', message: '隔離腳本忙碌，這次沒有收單。請稍後再試。' }, wrote: false, mailed: false };
  }
  var orderId = '';
  var attemptedWrite = false;
  var pendingMail = null;
  var pendingRow = null;
  var orderSheet = null;
  var outcome = { response: { status: 'error', message: '隔離腳本無法完成寫入。' }, wrote: false, mailed: false };
  try {
    var sheet = ensureSheet_(opened.ss, '訂單', ORDER_HEADERS);
    orderSheet = sheet;
    var ids = readColumn_(sheet, 1).slice(1);
    orderId = orderIdFor_(payload, ids);
    if (!orderId) {
      outcome = { response: { status: 'error', message: '測試編號已用完，沒有收單。' }, wrote: false, mailed: false };
    } else {
      var zone = spreadsheetZone_(opened.ss);
      if (!zone) {
        throw new Error('找不到試算表時區。這筆訂單沒有寫入，也沒有寄信。訂單分頁若是這次新建，表頭可能已寫上，整欄格式也可能已設過。');
      }
      var result = buildBookingResult_(payload, orderId, nowIso_(), shopTo, shopTo, zone);
      if (ids.indexOf(orderId) !== -1) {
        result.response.mailed = false;
        result.response.duplicate = true;
        result.response.wrote = false;
        result.response.message = '這個編號已經收過，這次沒有新增。';
        outcome = { response: result.response, wrote: false, mailed: false };
      } else {
        attemptedWrite = true;
        writeRow_(sheet, result.row);
        var mailSheet = ensureSheet_(opened.ss, '郵件預覽', MAIL_HEADERS);
        writeRow_(mailSheet, mailPreviewRow_(result));
        result.response.mailed = false;
        result.response.wrote = true;
        result.response.duplicate = false;
        pendingMail = result;
        pendingRow = result.row;
        outcome = { response: result.response, wrote: true, mailed: false };
      }
    }
  } catch (err) {
    pendingMail = null;
    var caught = errorText_(err);
    if (attemptedWrite) {
      outcome = unknownOutcome_(orderId);
    } else if (caught.indexOf('找不到試算表時區') !== -1) {
      outcome = {
        response: { status: 'error', message: caught, mailed: false, wrote: false, duplicate: false },
        wrote: false,
        mailed: false
      };
    } else {
      outcome = { response: { status: 'error', message: '隔離腳本無法完成寫入。' }, wrote: false, mailed: false };
    }
  } finally {
    if (attemptedWrite) {
      try {
        SpreadsheetApp.flush();
      } catch (flushErr) {
        pendingMail = null;
        outcome = unknownOutcome_(orderId);
      }
      if (pendingMail && outcome.response && outcome.response.status === 'success') {
        try {
          var check = confirmOrderRow_(orderSheet, orderId, pendingRow);
          if (!check.ok) {
            pendingMail = null;
            outcome = unknownOutcome_(orderId, check);
          }
        } catch (readErr) {
          pendingMail = null;
          outcome = unknownOutcome_(orderId);
        }
      }
    }
    try { lock.releaseLock(); } catch (releaseErr) {}
  }
  if (pendingMail && outcome.response && outcome.response.status === 'success') {
    var mailed = false;
    var sentCount = 0;
    var failedCount = 0;
    try {
      var mailResult = sendEmails_(pendingMail);
      if (mailResult && typeof mailResult === 'object') {
        sentCount = mailResult.sent || 0;
        failedCount = mailResult.failed || 0;
      }
      mailed = sentCount === 2 && failedCount === 0;
    } catch (mailErr) {
      mailed = false;
    }
    pendingMail.response.mailed = mailed;
    outcome.mailed = mailed;
    outcome.sentCount = sentCount;
    outcome.failedCount = failedCount;
  }
  return outcome;
}

function runIsolatedFixedBooking_(orderId) {
  var id = String(orderId || '').trim();
  if (id !== 'SMC900201' && id !== 'SMC900202' && id !== 'SMC900203') {
    var badId = '編號只能是 SMC900201、SMC900202 或 SMC900203。沒有寫入，也沒有寄信。';
    notify_(badId);
    return badId;
  }
  if (!isIsolated_()) {
    notify_(BLOCKED_MESSAGE);
    return BLOCKED_MESSAGE;
  }
  var shop = shopMailbox_();
  if (!shop) {
    var badMail = 'SMC_SHOP_EMAIL 空白或格式不對，沒有寫入，也沒有寄信。';
    notify_(badMail);
    return badMail;
  }
  if (!sheetsApiReady_()) {
    var missingSheets = sheetsMissingMessage_();
    notify_(missingSheets);
    return missingSheets;
  }
  var opened = openIsolatedSpreadsheet_();
  if (!opened.ok) {
    notify_(opened.message);
    return opened.message;
  }
  var outcome;
  try {
    outcome = acceptBooking_(isolatedBasePayload_(shop, id));
  } catch (err) {
    outcome = { response: { status: 'error', message: errorText_(err) }, wrote: false, mailed: false };
  }
  if (!outcome || !outcome.response) outcome = { response: { status: 'error', message: '沒有回應' }, wrote: false, mailed: false };
  var res = outcome.response;
  var sent = outcome.sentCount || 0;
  var failed = outcome.failedCount || 0;
  if (res.status === 'unknown' || res.status !== 'success') {
    var fail = '結果未知。停在單筆「' + id + '」。原因：' + (res.message || res.status || '沒有回應') + '。'
      + mailNote_(sent, failed) + '。不要重跑，不要補寄，不要部署，不要開網頁驗收。';
    notify_(fail);
    return fail;
  }
  if (res.duplicate === true) {
    if (outcome.wrote !== false || outcome.mailed !== false) {
      var badDup = '結果未知。停在單筆「' + id + '」。原因：預期重複編號，要 duplicate=true、wrote=false、mailed=false。實際 wrote=' + outcome.wrote + '、mailed=' + outcome.mailed + '。'
        + mailNote_(sent, failed) + '。不要重跑，不要補寄，不要部署，不要開網頁驗收。';
      notify_(badDup);
      return badDup;
    }
    var dup = '這個編號已經收過，這次沒有新增。duplicate=true、wrote=false、mailed=false。'
      + mailNote_(sent, failed) + '。';
    return afterNotify_(dup, notify_(dup));
  }
  if (outcome.wrote !== true || outcome.mailed !== true) {
    var unconf = '結果未知。停在單筆「' + id + '」。原因：寄信未確認。'
      + mailNote_(sent, failed) + '。不要重跑，不要補寄，不要部署，不要開網頁驗收。';
    notify_(unconf);
    return unconf;
  }
  var ok = '單筆 ' + id + ' 已收單。' + mailNote_(sent, failed) + '。';
  return afterNotify_(ok, notify_(ok));
}

function runIsolatedOneBooking201() {
  return runIsolatedFixedBooking_('SMC900201');
}

function runIsolatedOneBooking202() {
  return runIsolatedFixedBooking_('SMC900202');
}

function runIsolatedOneBooking203() {
  return runIsolatedFixedBooking_('SMC900203');
}

function submitIsolatedFromPage(payload) {
  try {
    if (!isIsolated_()) {
      return { status: 'error', message: BLOCKED_MESSAGE, mailed: false, wrote: false, duplicate: false };
    }
    var body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    return acceptBooking_(body).response;
  } catch (err) {
    return { status: 'error', message: '隔離腳本無法完成寫入。', mailed: false, wrote: false, duplicate: false };
  }
}

function doGet() {
  if (!isIsolated_()) return HtmlService.createHtmlOutput(BLOCKED_MESSAGE);
  return HtmlService.createHtmlOutputFromFile('IsolatedCheck')
    .setTitle('隔離驗收')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function copyFields_(extra) {
  var out = {};
  if (!extra) return out;
  for (var key in extra) {
    if (Object.prototype.hasOwnProperty.call(extra, key)) out[key] = extra[key];
  }
  return out;
}

function isolatedBasePayload_(email, orderId) {
  return {
    action: 'book',
    type: 'dining',
    name: '測試同學',
    phone: '0900000000',
    email: email || '',
    people: '2',
    tables: '1',
    date: '2026-10-22',
    time: '12:00',
    note: '散客 大人2位；靠窗',
    orderItems: '',
    _testOrderId: orderId
  };
}

function isolatedWithAttr_(email, orderId, extra) {
  var payload = isolatedBasePayload_(email, orderId);
  var fields = copyFields_(extra);
  for (var key in fields) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) payload[key] = fields[key];
  }
  return payload;
}

function isolatedEightPayloads_(email) {
  var brand = {
    source: 'google',
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: 'launch_202610',
    utmContent: 'ag_brand',
    utmTerm: '',
    utmAdgroup: '',
    adgroupBucket: '品牌',
    gclid: ''
  };
  var geo = copyFields_(brand);
  geo.utmContent = 'ag_geo_dining';
  geo.adgroupBucket = '非品牌';
  var direct = {
    source: 'direct/unknown',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    utmContent: '',
    utmTerm: '',
    utmAdgroup: '',
    adgroupBucket: '',
    gclid: ''
  };
  var unknown = {
    source: '有點擊識別碼、來源待核對',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    utmContent: '',
    utmTerm: '',
    utmAdgroup: '',
    adgroupBucket: '',
    gclid: 'TESTGCLID9000'
  };
  var formula = copyFields_(brand);
  formula.utmCampaign = '=1+1';
  formula.utmContent = '+1+1';
  formula.utmTerm = '-1+1';
  formula.utmAdgroup = '@cmd';
  var malformed = {
    source: { bad: true },
    utmContent: ['ag_brand'],
    adgroupBucket: '品牌<script>',
    gclid: 12345
  };
  return [
    { label: '1 只有原來的 11 欄', payload: isolatedBasePayload_(email, 'SMC900001') },
    { label: '2 廣告品牌', payload: isolatedWithAttr_(email, 'SMC900101', brand) },
    { label: '3 廣告非品牌', payload: isolatedWithAttr_(email, 'SMC900102', geo) },
    { label: '4 非廣告', payload: isolatedWithAttr_(email, 'SMC900103', direct) },
    { label: '5 來源不明', payload: isolatedWithAttr_(email, 'SMC900104', unknown) },
    { label: '6 公式開頭', payload: isolatedWithAttr_(email, 'SMC900105', formula), probes: [
      { header: 'utm活動', raw: formula.utmCampaign },
      { header: 'utm內容', raw: formula.utmContent },
      { header: 'utm關鍵字', raw: formula.utmTerm },
      { header: 'utm廣告群組', raw: formula.utmAdgroup }
    ] },
    { label: '7 格式壞掉', payload: isolatedWithAttr_(email, 'SMC900106', malformed) },
    { label: '8 同一編號再送', payload: isolatedWithAttr_(email, 'SMC900101', brand), expectDuplicate: true }
  ];
}

function isEditorUiUnavailable_(err) {
  var text = errorText_(err);
  return text.indexOf('getUi') !== -1 && text.indexOf('from this context') !== -1;
}

function notify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (err) {
    var text = errorText_(err);
    if (isEditorUiUnavailable_(err)) {
      console.log('編輯器執行，無彈窗，以執行紀錄為準');
      console.log(message);
      return { ok: true, error: text };
    }
    console.log(message);
    console.log(text);
    return { ok: false, error: text };
  }
  console.log(message);
  return { ok: true, error: '' };
}

function afterNotify_(summary, notice) {
  if (notice && notice.ok === false && String(summary).indexOf('結果未知') === -1) {
    var alertUnknown = '結果未知。試算表分頁的 alert 沒有彈出。錯誤：' + (notice.error || '沒有錯誤內容') + '。不要把成功摘要當成通過。不要重跑，不要部署。';
    console.log(alertUnknown);
    return alertUnknown;
  }
  return summary;
}

function showLiteral_(value) {
  return JSON.stringify(value == null ? '' : String(value));
}

function protectReportLine_(line) {
  var out = [];
  for (var c = 0; c < line.length; c += 1) {
    var text = String(formulaGuard_(line[c]));
    if (/^[=+\-@]/.test(text)) text = showLiteral_(text);
    out.push(text);
  }
  return out;
}

function clearSheetContents_(sheet) {
  // 先送出可能還排著的表頭 appendRow，再由 API 清除。
  // SpreadsheetApp 的 clear 會延後到下一次 flush，把中間用 API 寫好的報告洗掉。
  SpreadsheetApp.flush();
  if (!sheetsApiReady_()) throw new Error(sheetsMissingMessage_());
  var parent = sheet.getParent();
  var id = parent && parent.getId ? parent.getId() : '';
  if (!id) throw new Error('找不到試算表 ID');
  Sheets.Spreadsheets.Values.clear({}, id, quotedSheet_(sheet) + '!A:ZZ');
}

function readSheetValues_(sheet) {
  if (!sheetsApiReady_()) throw new Error(sheetsMissingMessage_());
  var parent = sheet.getParent();
  var id = parent && parent.getId ? parent.getId() : '';
  if (!id) throw new Error('找不到試算表 ID');
  var response = Sheets.Spreadsheets.Values.get(id, quotedSheet_(sheet) + '!A:ZZ');
  return response && response.values ? response.values : [];
}

function reportProblem_(name, actual, expected) {
  var got = actual ? actual.length : 0;
  var want = expected ? expected.length : 0;
  if (got !== want) return name + '讀回 ' + got + ' 列，預期 ' + want + ' 列';
  for (var r = 0; r < want; r += 1) {
    var row = actual[r] || [];
    var exp = expected[r] || [];
    if (row.length > exp.length) {
      return name + '第 ' + (r + 1) + ' 列多了欄。實際：' + row.join(' | ') + '。預期：' + exp.join(' | ');
    }
    for (var c = 0; c < exp.length; c += 1) {
      var left = c < row.length && row[c] != null ? String(row[c]) : '';
      var right = exp[c] == null ? '' : String(exp[c]);
      if (left !== right) {
        return name + '第 ' + (r + 1) + ' 列第 ' + (c + 1) + ' 欄不一致。實際：' + left + '。預期：' + right;
      }
    }
  }
  return '';
}

function writeResultSheet_(ss, lines) {
  var sheet = ensureSheet_(ss, '驗收結果', RESULT_HEADERS);
  clearSheetContents_(sheet);
  if (!lines.length) return [];
  var safe = [];
  for (var r = 0; r < lines.length; r += 1) safe.push(protectReportLine_(lines[r]));
  return writeLiteralMatrix_(sheet, 1, safe);
}

function inspectFormulaProbes_(sheet, orderId, probes) {
  var checks = [];
  var rowIndex = 0;
  var ids = sheet ? readColumn_(sheet, 1) : [];
  for (var i = 0; i < ids.length; i += 1) {
    if (ids[i] === String(orderId)) rowIndex = i + 1;
  }
  for (var p = 0; p < probes.length; p += 1) {
    var probe = probes[p];
    var col = ORDER_HEADERS.indexOf(probe.header) + 1;
    var raw = probe.raw == null ? '' : String(probe.raw);
    var want = String(formulaGuard_(raw));
    var read = '';
    var formula = '讀取失敗';
    var ok = false;
    if (rowIndex > 0 && col > 0) {
      var cell = sheet.getRange(rowIndex, col);
      read = cell.getValue() == null ? '' : String(cell.getValue());
      formula = cell.getFormula() == null ? '' : String(cell.getFormula());
      ok = formula === '' && read === want;
    }
    checks.push({ header: probe.header, raw: raw, read: read, formula: formula, ok: ok });
  }
  return checks;
}

function writeProbeSheet_(ss, checks) {
  var headers = ['欄位', '原值', '讀回值', 'getFormula', '判定'];
  var sheet = ensureSheet_(ss, '公式核對', headers);
  clearSheetContents_(sheet);
  var rows = [headers];
  for (var i = 0; i < checks.length; i += 1) {
    var item = checks[i];
    rows.push([
      item.header,
      showLiteral_(item.raw),
      showLiteral_(item.read),
      item.formula === '' ? '（空）' : showLiteral_(item.formula),
      item.ok ? '通過' : '失敗'
    ]);
  }
  return writeLiteralMatrix_(sheet, 1, rows);
}

// 新單要 success、有寫入、兩封都確認寄出。重複那一筆要 duplicate=true、wrote=false、mailed=false。
// 回空字串代表這個案例可以繼續，否則回停下的原因。
function markUnverified_(lines) {
  for (var r = 1; r < lines.length; r += 1) {
    var result = String(lines[r][2] || '');
    if (result.indexOf('未驗證') === -1) lines[r][2] = result ? result + '／未驗證' : '未驗證';
  }
}

function writeStopReports_(ss, lines) {
  var note = '';
  try {
    writeResultSheet_(ss, lines);
  } catch (err) {
    note += '「驗收結果」也沒有留住。錯誤：' + errorText_(err) + '。';
  }
  return note;
}

function finishStopped_(opened, lines, summary, extras) {
  extras = extras || {};
  markUnverified_(lines);
  if (extras.formulaNotRun) summary += '本輪公式核對未執行。';
  summary += writeStopReports_(opened.ss, lines);
  if (summary.indexOf('不要重跑') === -1) summary += '不要重跑，不要補寄，不要部署，不要開網頁驗收。';
  notify_(summary);
  return summary;
}

function caseStopReason_(item, outcome) {
  var res = outcome && outcome.response ? outcome.response : {};
  var status = res.status || '';
  if (status === 'unknown') return '結果未知：' + (res.message || '');
  if (status !== 'success') return '錯誤：' + (res.message || status || '沒有回應');
  if (item.expectDuplicate) {
    if (res.duplicate !== true || outcome.wrote !== false || outcome.mailed !== false) {
      return '預期重複編號，要 duplicate=true、wrote=false、mailed=false。實際 duplicate=' + res.duplicate
        + '、wrote=' + outcome.wrote + '、mailed=' + outcome.mailed;
    }
    return '';
  }
  if (res.duplicate === true || outcome.wrote !== true) return '新單沒有寫入。duplicate=' + res.duplicate + '、wrote=' + outcome.wrote;
  if (outcome.mailed !== true) return '寄信未確認';
  return '';
}

function runIsolatedEightCases() {
  if (!isIsolated_()) {
    notify_(BLOCKED_MESSAGE);
    return BLOCKED_MESSAGE;
  }
  var shop = shopMailbox_();
  if (!shop) {
    var badMail = 'SMC_SHOP_EMAIL 空白或格式不對，沒有寫入，也沒有寄信。';
    notify_(badMail);
    return badMail;
  }
  if (!sheetsApiReady_()) {
    var missingSheets = sheetsMissingMessage_();
    notify_(missingSheets);
    return missingSheets;
  }
  var opened = openIsolatedSpreadsheet_();
  if (!opened.ok) {
    notify_(opened.message);
    return opened.message;
  }
  var cases = isolatedEightPayloads_(shop);
  var lines = [RESULT_HEADERS];
  var stopped = false;
  var failNote = '';
  var writtenProbe = null;
  var sentMails = 0;
  var failedMails = 0;
  for (var i = 0; i < cases.length; i += 1) {
    var outcome;
    try {
      outcome = acceptBooking_(cases[i].payload);
    } catch (caseErr) {
      outcome = { response: { status: 'error', message: errorText_(caseErr) }, wrote: false, mailed: false };
    }
    if (!outcome || !outcome.response) outcome = { response: { status: 'error', message: '沒有回應' }, wrote: false, mailed: false };
    sentMails += outcome.sentCount || 0;
    failedMails += outcome.failedCount || 0;
    lines.push([
      cases[i].label,
      outcome.response.orderId || '',
      outcome.response.status || '',
      outcome.wrote ? '是' : '否',
      outcome.mailed ? '是' : '否'
    ]);
    var stopReason = caseStopReason_(cases[i], outcome);
    if (stopReason) {
      var caseFail = '結果未知。停在「' + cases[i].label + '」。原因：' + stopReason + '。後面的案例沒有執行。'
        + mailNote_(sentMails, failedMails) + '。';
      return finishStopped_(opened, lines, caseFail, { formulaNotRun: !writtenProbe && i < 5 });
    }
    if (cases[i].probes) {
      var orderSheet = opened.ss.getSheetByName('訂單');
      var checks;
      try {
        checks = inspectFormulaProbes_(orderSheet, outcome.response.orderId || '', cases[i].probes);
      } catch (probeReadErr) {
        var probeReadFail = '結果未知。停在「' + cases[i].label + '」的公式核對讀取。錯誤：' + errorText_(probeReadErr) + '。'
          + mailNote_(sentMails, failedMails) + '。';
        return finishStopped_(opened, lines, probeReadFail, { formulaNotRun: false });
      }
      try {
        writtenProbe = writeProbeSheet_(opened.ss, checks);
      } catch (probeErr) {
        var probeFail = '結果未知。停在「' + cases[i].label + '」的公式核對寫入。' + mailNote_(sentMails, failedMails) + '。錯誤：' + errorText_(probeErr) + '。不要重跑，不要部署。';
        markUnverified_(lines);
        try {
          writeResultSheet_(opened.ss, lines);
        } catch (stopReportErr) {
          probeFail += '「驗收結果」也沒有留住。錯誤：' + errorText_(stopReportErr) + '。';
        }
        notify_(probeFail);
        return probeFail;
      }
      var pass = outcome.response.status === 'success';
      for (var c = 0; c < checks.length; c += 1) {
        if (!checks[c].ok) pass = false;
      }
      if (!pass) {
        stopped = true;
        if (outcome.response.status !== 'success') failNote = outcome.response.message || '';
        break;
      }
    }
  }
  var resultWritten = [];
  try {
    resultWritten = writeResultSheet_(opened.ss, lines);
  } catch (resultErr) {
    var resultFail = '結果未知。「驗收結果」沒有留住。錯誤：' + errorText_(resultErr) + '。不要重跑，不要部署。';
    notify_(resultFail);
    return resultFail;
  }
  var readError = '';
  var resultActual = [];
  var probeActual = [];
  try {
    SpreadsheetApp.flush();
  } catch (flushErr) {
    readError = '停在讀回「驗收結果」和「公式核對」之前的 flush。錯誤：' + errorText_(flushErr);
  }
  if (!readError) {
    try {
      var resultSheet = opened.ss.getSheetByName('驗收結果');
      resultActual = resultSheet ? readSheetValues_(resultSheet) : [];
    } catch (resultReadErr) {
      readError = '「驗收結果」讀回失敗。錯誤：' + errorText_(resultReadErr);
    }
  }
  if (!readError) {
    try {
      var probeSheet = opened.ss.getSheetByName('公式核對');
      probeActual = probeSheet ? readSheetValues_(probeSheet) : [];
    } catch (probeReadErr) {
      readError = '「公式核對」讀回失敗。錯誤：' + errorText_(probeReadErr);
    }
  }
  if (!readError) {
    var problems = [];
    var resultProblem = reportProblem_('驗收結果', resultActual, resultWritten);
    if (resultProblem) problems.push(resultProblem);
    if (!writtenProbe) problems.push('公式核對沒有寫入');
    else {
      var probeProblem = reportProblem_('公式核對', probeActual, writtenProbe);
      if (probeProblem) problems.push(probeProblem);
    }
    readError = problems.join('。');
  }
  if (readError) {
    var unknownReport = '結果未知。' + readError + '。不要重跑，不要部署。';
    notify_(unknownReport);
    return unknownReport;
  }
  var summary = stopped
    ? '公式核對失敗。' + (failNote ? failNote + '。' : '') + '請看「公式核對」分頁的原值、讀回值與 getFormula。不要部署，不要開網頁驗收，不要重跑。'
    : '已送出 8 筆。四種前綴都通過，才可以部署。' + mailNote_(sentMails, failedMails) + '。請到「訂單」「郵件預覽」「驗收結果」「公式核對」核對。同一編號那一筆應是沒有再寫入、也沒有再寄信。';
  var notice = notify_(summary);
  if (notice && notice.ok === false && summary.indexOf('四種前綴都通過') !== -1) {
    return afterNotify_(summary, notice);
  }
  return summary;
}

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('隔離測試')
      .addItem('送出 8 筆驗收案例', 'runIsolatedEightCases')
      .addToUi();
  } catch (err) {}
}
