/**
 * 隔離測試用。不要貼上正式預約專案，不要部署成正式 web app，不要寫正式試算表。
 *
 * 正式 Apps Script 的原始碼不在這個 repo。這支是依官網現有的 11 欄 POST
 * （action、type、name、phone、email、people、tables、date、time、note、orderItems）
 * 另寫的測試實作，不是正式腳本的補丁。
 *
 * 來源 9 欄可有可無。缺欄、多欄、型別不對，都仍收單：備註原樣保留意思，壞掉的來源改空白。
 * 客人信不放活動代碼。店內信才放來源對帳。
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
 * 步驟見 docs/booking-attribution-isolated-runbook.md。
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
  if (/^[=+\-@]/.test(normalized)) return "'" + normalized;
  return raw;
}

function attributionText_(value) {
  if (typeof value !== 'string') return '';
  var text = stripInvisible_(value).trim();
  if (!text) return '';
  if (/^[=+\-@]/.test(text)) text = "'" + text;
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

function buildBookingResult_(payload, orderId, receivedAt, guestTo, shopTo) {
  var booking = {
    action: 'book',
    type: payload.type === 'takeout' ? 'takeout' : 'dining',
    name: bookingText_(payload.name),
    phone: bookingText_(payload.phone),
    email: bookingText_(payload.email),
    people: bookingText_(payload.people),
    tables: bookingText_(payload.tables),
    date: bookingText_(payload.date),
    time: bookingText_(payload.time),
    note: bookingText_(payload.note),
    orderItems: bookingText_(payload.orderItems)
  };
  var attr = attributionFromPayload_(payload);
  var row = [
    orderId,
    receivedAt || '',
    booking.action,
    booking.type,
    booking.name,
    booking.phone,
    booking.email,
    booking.people,
    booking.tables,
    booking.date,
    booking.time,
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

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
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

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
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

function writeRow_(sheet, row) {
  var safe = [];
  for (var i = 0; i < row.length; i += 1) safe.push(formulaGuard_(row[i]));
  var at = sheet.getLastRow() + 1;
  sheet.getRange(at, 1, 1, safe.length).setNumberFormat('@');
  sheet.getRange(at, 1, 1, safe.length).setValues([safe]);
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

function sendEmails_(result) {
  if (result.guestEmail.to) {
    MailApp.sendEmail(result.guestEmail.to, result.guestEmail.subject, result.guestEmail.body);
  }
  if (result.shopEmail.to) {
    MailApp.sendEmail(result.shopEmail.to, result.shopEmail.subject, result.shopEmail.body);
  }
}

function parsePayload_(e) {
  try {
    var raw = e && e.postData && e.postData.contents;
    var parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (err) {
    return {};
  }
}

function handleCancel_(payload) {
  var phone = payload && typeof payload.phone === 'string' ? payload.phone.trim() : '';
  var orderId = payload && typeof payload.orderId === 'string' ? payload.orderId.trim() : '';
  if (!phone || !orderId) return json_({ status: 'error', message: '缺少電話或訂單編號。' });
  return json_({ status: 'success', message: '已收到取消申請（隔離測試，未改訂單列）。' });
}

function acceptBooking_(payload) {
  if (!isIsolated_()) {
    return { response: { status: 'error', message: BLOCKED_MESSAGE }, wrote: false, mailed: false };
  }
  if (missingBooking_(payload)) {
    return { response: { status: 'error', message: '缺少預約必要欄位。' }, wrote: false, mailed: false };
  }
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
  try {
    var sheet = ensureSheet_(opened.ss, '訂單', ORDER_HEADERS);
    var ids = readColumn_(sheet, 1).slice(1);
    orderId = orderIdFor_(payload, ids);
    if (!orderId) {
      return { response: { status: 'error', message: '測試編號已用完，沒有收單。' }, wrote: false, mailed: false };
    }
    var props = PropertiesService.getScriptProperties();
    var result = buildBookingResult_(
      payload,
      orderId,
      nowIso_(),
      guestAddress_(payload.email),
      guestAddress_(props.getProperty('SMC_SHOP_EMAIL') || '')
    );
    if (ids.indexOf(orderId) !== -1) {
      result.response.mailed = false;
      return { response: result.response, wrote: false, mailed: false };
    }
    attemptedWrite = true;
    writeRow_(sheet, result.row);
    var mailSheet = ensureSheet_(opened.ss, '郵件預覽', MAIL_HEADERS);
    writeRow_(mailSheet, mailPreviewRow_(result));
    var mailed = false;
    try {
      sendEmails_(result);
      mailed = true;
    } catch (mailErr) {
      mailed = false;
    }
    result.response.mailed = mailed;
    return { response: result.response, wrote: true, mailed: mailed };
  } catch (err) {
    if (attemptedWrite) {
      return {
        response: {
          status: 'unknown',
          orderId: orderId,
          message: '結果未知，先核對試算表、勿重送',
          mailed: false
        },
        wrote: true,
        mailed: false
      };
    }
    return { response: { status: 'error', message: '隔離腳本無法完成寫入。' }, wrote: false, mailed: false };
  } finally {
    if (attemptedWrite) {
      try { SpreadsheetApp.flush(); } catch (flushErr) {}
    }
    try { lock.releaseLock(); } catch (releaseErr) {}
  }
}

function doPost(e) {
  try {
    if (!isIsolated_()) return json_({ status: 'error', message: BLOCKED_MESSAGE });
    var payload = parsePayload_(e);
    if (payload.action === 'cancel') return handleCancel_(payload);
    return json_(acceptBooking_(payload).response);
  } catch (err) {
    return json_({ status: 'error', message: '隔離腳本無法完成寫入。' });
  }
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
    { label: '6 公式開頭', payload: isolatedWithAttr_(email, 'SMC900105', formula) },
    { label: '7 格式壞掉', payload: isolatedWithAttr_(email, 'SMC900106', malformed) },
    { label: '8 同一編號再送', payload: isolatedWithAttr_(email, 'SMC900101', brand) }
  ];
}

function notify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (err) {}
}

function writeResultSheet_(ss, lines) {
  var sheet = ensureSheet_(ss, '驗收結果', RESULT_HEADERS);
  sheet.clear();
  if (!lines.length) return;
  var width = lines[0].length;
  var safe = [];
  for (var r = 0; r < lines.length; r += 1) {
    var line = [];
    for (var c = 0; c < width; c += 1) line.push(formulaGuard_(lines[r][c]));
    safe.push(line);
  }
  sheet.getRange(1, 1, safe.length, width).setNumberFormat('@');
  sheet.getRange(1, 1, safe.length, width).setValues(safe);
}

function runIsolatedEightCases() {
  if (!isIsolated_()) {
    notify_(BLOCKED_MESSAGE);
    return BLOCKED_MESSAGE;
  }
  var opened = openIsolatedSpreadsheet_();
  if (!opened.ok) {
    notify_(opened.message);
    return opened.message;
  }
  var shop = guestAddress_(PropertiesService.getScriptProperties().getProperty('SMC_SHOP_EMAIL') || '');
  var cases = isolatedEightPayloads_(shop);
  var lines = [RESULT_HEADERS];
  for (var i = 0; i < cases.length; i += 1) {
    var outcome = acceptBooking_(cases[i].payload);
    lines.push([
      cases[i].label,
      outcome.response.orderId || '',
      outcome.response.status || '',
      outcome.wrote ? '是' : '否',
      outcome.mailed ? '是' : '否'
    ]);
  }
  writeResultSheet_(opened.ss, lines);
  var summary = '已送出 8 筆。請到「訂單」「郵件預覽」「驗收結果」分頁核對，並查看信箱。同一編號那一筆應是沒有再寫入、也沒有再寄信。';
  notify_(summary);
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
