/**
 * 隔離測試用。不要貼上正式預約專案，不要部署成正式 web app，不要寫正式試算表。
 *
 * 正式 Apps Script 的原始碼不在這個 repo。這支是依官網現有的 11 欄 POST
 * （action、type、name、phone、email、people、tables、date、time、note、orderItems）
 * 另寫的測試實作，不是正式腳本的補丁。
 *
 * 來源 9 欄可有可無。缺欄、多欄、型別不對，都仍收單：備註原樣寫入，壞掉的來源改空白。
 * 客人信不放活動代碼。店內信才放來源對帳。
 * 旗標 SEND_ATTRIBUTION_TO_BACKEND 仍由官網控制；這支腳本不會把它打開。
 *
 * 使用前在指令碼屬性設定：
 *   SMC_ATTRIBUTION_ISOLATED = yes
 *   SMC_SHOP_EMAIL = 你的測試信箱
 *   SMC_TEST_SHEET_ID = 測試試算表 ID（若腳本是綁在那張試算表上，可省略）
 *
 * 步驟見 docs/booking-attribution-isolated-runbook.md。
 */
var ORDER_HEADERS = [
  '訂單編號', '收到時間', '動作', '類型', '姓名', '電話', '信箱', '人數', '桌數', '日期', '時間', '備註', '品項',
  '來源', 'utm來源', 'utm媒介', 'utm活動', 'utm內容', 'utm關鍵字', 'utm廣告群組', '群組分類', '點擊識別碼'
];
var MAIL_HEADERS = ['訂單編號', '客人信箱', '客人主旨', '客人正文', '店內信箱', '店內主旨', '店內正文'];
var ATTRIBUTION_FIELDS = ['source', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', 'utmAdgroup', 'adgroupBucket', 'gclid'];

function plainSheetText_(value) {
  var text = value == null ? '' : String(value);
  if (!text) return '';
  if (/^[=+\-@]/.test(text)) return "'" + text;
  return text;
}

function attributionText_(value) {
  if (typeof value !== 'string') return '';
  var text = plainSheetText_(value).trim();
  if (text.length > 200) text = text.slice(0, 200);
  return text;
}

function bucketText_(value) {
  var text = attributionText_(value);
  return text === '品牌' || text === '非品牌' ? text : '';
}

function bookingText_(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && isFinite(value)) return String(value);
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

function orderIdFor_(payload) {
  var requested = '';
  try {
    requested = payload && typeof payload._testOrderId === 'string' ? payload._testOrderId.trim() : '';
  } catch (err) {
    requested = '';
  }
  if (/^SMC[0-9]{6}$/.test(requested)) return requested;
  var props = PropertiesService.getScriptProperties();
  var current = Number(props.getProperty('SMC_TEST_SEQ') || '900000');
  if (!isFinite(current) || current < 0) current = 900000;
  var next = Math.floor(current) + 1;
  props.setProperty('SMC_TEST_SEQ', String(next));
  var digits = String(next);
  while (digits.length < 6) digits = '0' + digits;
  return 'SMC' + digits;
}

function openSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SMC_TEST_SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActive();
  if (!active) throw new Error('no spreadsheet');
  return active;
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
  var at = sheet.getLastRow() + 1;
  sheet.getRange(at, 1, 1, row.length).setNumberFormat('@');
  sheet.getRange(at, 1, 1, row.length).setValues([row]);
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

function doPost(e) {
  try {
    if (!isIsolated_()) {
      return json_({ status: 'error', message: '這支腳本只供隔離測試。未設定 SMC_ATTRIBUTION_ISOLATED=yes，沒有寫入試算表，也沒有寄信。' });
    }
    var payload = parsePayload_(e);
    if (payload.action === 'cancel') return handleCancel_(payload);
    if (missingBooking_(payload)) return json_({ status: 'error', message: '缺少預約必要欄位。' });
    var orderId = orderIdFor_(payload);
    var props = PropertiesService.getScriptProperties();
    var result = buildBookingResult_(
      payload,
      orderId,
      nowIso_(),
      guestAddress_(payload.email),
      guestAddress_(props.getProperty('SMC_SHOP_EMAIL') || '')
    );
    var ss = openSpreadsheet_();
    var sheet = ensureSheet_(ss, '訂單', ORDER_HEADERS);
    var ids = readColumn_(sheet, 1).slice(1);
    if (ids.indexOf(orderId) !== -1) return json_(result.response);
    writeRow_(sheet, result.row);
    var mailSheet = ensureSheet_(ss, '郵件預覽', MAIL_HEADERS);
    writeRow_(mailSheet, mailPreviewRow_(result));
    try { sendEmails_(result); } catch (mailErr) {}
    return json_(result.response);
  } catch (err) {
    return json_({ status: 'error', message: '隔離腳本無法完成寫入。' });
  }
}
