#!/usr/bin/env node
// 離線檢查讀取 API。不連 Apps Script、不讀寫正式試算表、不使用正式權杖。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'apps-script/read-api.js'), 'utf8');
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

const TOKEN = 'test-token-not-a-secret';
const DINING_NAME = '測甲';
const DINING_PHONE = '0900111222';
const OTHER_NAME = '測乙';
const OTHER_PHONE = '0900333444';
const UNKNOWN_TAB = 'ZZ_NOT_A_TAB_9f3c';
const TEST_TAB_SENTINEL = 'ZZ_TEST_TAB_ROW';

const calls = {
  dataReads: 0,
  sheets: [],
  appendDining: 0,
  appendTakeout: 0,
  booking: 0,
  cap: 0,
  cancels: 0,
};
let scriptProperties = { READ_API_TOKEN: TOKEN };
let failSheetRead = false;
let propertyThrow = false;
let propertyNull = false;
const DINING_HEADER = ['時間戳記', '姓名', '電話', '人數', '日期', '時段', '抵達時間', '備註', '預訂桌數', '訂單編號', '狀態', 'email'];
const TAKEOUT_HEADER = ['時間戳記', '姓名', '電話', '品項', '日期', '時間', '備註', '訂單編號', '狀態', 'email'];
const BLOCKED_LOOKUP_KEYS = ['date', 'phone', 'tel', 'mobile', 'orderId', 'orderID', 'order_id', 'bookingId', 'type', 'orderItems'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function diningRow(partial) {
  const row = new Array(12).fill('');
  row[1] = partial.name || '';
  row[2] = partial.phone || '';
  row[4] = partial.date || '';
  row[5] = partial.session || '';
  row[9] = partial.orderId || '';
  row[10] = partial.status || '';
  return row;
}

function takeoutRow(partial) {
  const row = new Array(10).fill('');
  row[1] = partial.name || '';
  row[2] = partial.phone || '';
  row[7] = partial.orderId || '';
  row[8] = partial.status || '';
  return row;
}

const diningRows = [
  diningRow({
    name: DINING_NAME,
    phone: DINING_PHONE,
    date: '2026-11-02',
    session: '中午',
    orderId: 'SMC100001',
    status: '預約中',
  }),
  diningRow({
    name: OTHER_NAME,
    phone: OTHER_PHONE,
    date: '2026-11-02',
    session: '中午',
    orderId: 'SMC100002',
    status: '已取消',
  }),
  diningRow({
    name: DINING_NAME,
    phone: "'" + DINING_PHONE,
    date: new Date('2026-11-02T00:30:00Z'),
    session: '晚上',
    orderId: 'SMC100003',
    status: '預約中',
  }),
  diningRow({
    name: DINING_NAME,
    phone: DINING_PHONE,
    date: '2026-11-03',
    session: '晚上',
    orderId: 'smc100004',
    status: '已完成',
  }),
  diningRow({
    name: '測丁',
    phone: '0900777888',
    date: '2026-11-04',
    session: '中午',
    orderId: 'SMC100008',
    status: '預約中',
  }),
  diningRow({
    name: '測丁',
    phone: '0900777888',
    date: '2026-11-04',
    session: '中午',
    orderId: '',
    status: '預約中',
  }),
  diningRow({
    name: '測己',
    phone: '0900666000',
    date: '2026-11-05',
    session: '晚上',
    orderId: '',
    status: '預約中',
  }),
  diningRow({
    name: '測己',
    phone: '0900666000',
    date: '2026-11-05',
    session: '晚上',
    orderId: '',
    status: '預約中',
  }),
  diningRow({
    name: '測庚',
    phone: '0900888000',
    date: '2026-11-06',
    session: '中午',
    orderId: 'SMC100009',
    status: '取消訂位',
  }),
  diningRow({
    name: '測戊',
    phone: 'line訂',
    date: '2026-11-07',
    session: '晚上',
    orderId: 'SMC100010',
    status: '預約中',
  }),
  diningRow({
    name: '測辛',
    phone: '0900999000',
    date: '2026-11-08',
    session: '中午',
    orderId: 'SMC100011',
    status: '取消',
  }),
];

const takeoutRows = [
  takeoutRow({ name: '測丙', phone: '0900555666', orderId: 'SMC200002', status: '預約中' }),
];

const sheets = {
  工作表1: [DINING_HEADER.slice(), ...diningRows],
  外帶訂單: [TAKEOUT_HEADER.slice(), ...takeoutRows],
  測試分頁: [['標記'], [TEST_TAB_SENTINEL]],
  待審: [['header'], ['ZZ_PENDING']],
  候補: [['header'], ['ZZ_WAITLIST']],
  系統設定: [['header'], ['ZZ_CONFIG']],
};

function resetCalls() {
  calls.dataReads = 0;
  calls.sheets = [];
  calls.appendDining = 0;
  calls.appendTakeout = 0;
  calls.booking = 0;
  calls.cap = 0;
  calls.cancels = 0;
  failSheetRead = false;
  propertyThrow = false;
  propertyNull = false;
  scriptProperties = { READ_API_TOKEN: TOKEN };
  sheets['工作表1'][0] = DINING_HEADER.slice();
  sheets['外帶訂單'][0] = TAKEOUT_HEADER.slice();
}

const context = vm.createContext({
  Array, Object, String, Number, Math, parseInt, isNaN, isFinite, Date, JSON, RegExp,
  Utilities: {
    formatDate(date, timeZone, format) {
      if (timeZone !== 'GMT+8') throw new Error('unexpected tz');
      const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
      const y = shifted.getUTCFullYear();
      const m = pad2(shifted.getUTCMonth() + 1);
      const d = pad2(shifted.getUTCDate());
      if (format === 'yyyy-MM-dd') return `${y}-${m}-${d}`;
      throw new Error('unexpected format');
    },
  },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(name) {
          if (propertyThrow) throw new Error('properties down');
          if (propertyNull) return null;
          if (!Object.prototype.hasOwnProperty.call(scriptProperties, name)) return null;
          return scriptProperties[name];
        },
      };
    },
  },
  SpreadsheetApp: {
    getActiveSpreadsheet() {
      return {
        getSheetByName(name) {
          calls.sheets.push(name);
          const rows = sheets[name];
          if (!rows) return null;
          return {
            getDataRange() {
              return {
                getValues() {
                  calls.dataReads += 1;
                  if (failSheetRead) throw new Error('sheet read failed');
                  return rows.map((row) => row.slice());
                },
              };
            },
            appendRow() {
              if (name === '工作表1') calls.appendDining += 1;
              if (name === '外帶訂單') calls.appendTakeout += 1;
            },
          };
        },
      };
    },
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput(text) {
      return {
        text: String(text),
        setMimeType(mime) {
          this.mime = mime;
          return this;
        },
      };
    },
  },
});

context.pad2_ = (n) => (n < 10 ? '0' : '') + n;
context.isValidYmd_ = (y, m, d) => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === (m - 1) && dt.getUTCDate() === d;
};
context.sheetDayStr_ = function sheetDayStr_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return context.Utilities.formatDate(v, 'GMT+8', 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  if (/T\d{2}:\d{2}/.test(s) || /Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    const instant = new Date(s);
    if (isNaN(instant.getTime())) return '';
    return context.Utilities.formatDate(instant, 'GMT+8', 'yyyy-MM-dd');
  }
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (!m) return '';
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (!context.isValidYmd_(y, mo, day)) return '';
  return `${y}-${context.pad2_(mo)}-${context.pad2_(day)}`;
};
context.dineInTableLimit_ = function dineInTableLimit_() {
  calls.cap += 1;
  return 9;
};

vm.runInContext(source, context, { filename: 'apps-script/read-api.js' });
context.calls = calls;

vm.runInContext(`
function legacyBookingDoPost_(e) {
  var body = JSON.parse(e.postData.contents);
  calls.booking += 1;
  if (body.type === 'takeout') {
    calls.appendTakeout += 1;
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: '外帶預約成功！我們會儘快為您準備。',
      orderId: 'SMC200099'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  dineInTableLimit_(body.date, '中午', 9, 9);
  calls.appendDining += 1;
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    message: '內用預約成功！',
    orderId: 'SMC100099'
  })).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) {
  var looked = handleReadLookup_(e);
  if (looked) return looked;
  return legacyBookingDoPost_(e);
}
`, context, { filename: 'doPost-wrapper.js' });

function output(result) {
  assert(result && typeof result.text === 'string', '回應必須是文字');
  if (!result || typeof result.text !== 'string') return null;
  try {
    return JSON.parse(result.text);
  } catch (err) {
    failures.push('回應不是 JSON');
    return null;
  }
}

function leaked(text) {
  return [DINING_NAME, DINING_PHONE, OTHER_NAME, OTHER_PHONE, TEST_TAB_SENTINEL, 'ZZ_PENDING', 'ZZ_WAITLIST', 'ZZ_CONFIG', UNKNOWN_TAB, '找不到分頁']
    .filter((needle) => text.indexOf(needle) !== -1);
}

function assertNoPrivate(label, result) {
  const text = result && result.text ? result.text : '';
  const hits = leaked(text);
  assert(hits.length === 0, `${label} 不應含個資或分頁名稱，實際含 ${hits.join(',')}`);
}

function assertUnauthorized(label, result) {
  const body = output(result);
  assert(body && body.ok === false && body.error === 'unauthorized', `${label} 應為 unauthorized，實際 ${result && result.text}`);
  assertNoPrivate(label, result);
  assert(!body || !Object.prototype.hasOwnProperty.call(body, 'data'), `${label} 不應有 data`);
  assert(!body || !Object.prototype.hasOwnProperty.call(body, 'found'), `${label} 不應看成找不到`);
  assert(!body || !Object.prototype.hasOwnProperty.call(body, 'duplicate'), `${label} 不應看成沒有重複`);
}

function keysOf(body) {
  return Object.keys(body).sort().join(',');
}

function getEvent(parameter) {
  return { parameter: parameter || {} };
}

function postEvent(body, parameter) {
  return {
    parameter: parameter || {},
    postData: { contents: JSON.stringify(body) },
  };
}

const existsPayload = {
  action: 'lookup',
  token: TOKEN,
  op: 'exists',
  lookup_order_id: 'smc100004',
};
const takeoutPayload = {
  action: 'lookup',
  token: TOKEN,
  op: 'takeout_exists',
  lookup_order_id: 'SMC200002',
};
const duplicatePayload = {
  action: 'lookup',
  token: TOKEN,
  op: 'duplicate_check',
  lookup_date: '2026/11/2',
  lookup_session: '午',
  lookup_phone: DINING_PHONE,
  lookup_name: DINING_NAME,
};

function assertLookupShape(label, body) {
  BLOCKED_LOOKUP_KEYS.forEach((key) => {
    assert(!Object.prototype.hasOwnProperty.call(body, key), `${label} 不可帶 ${key}`);
  });
}

function legacyDoPostWithoutLookup_(body) {
  const actionStr = String(body.action || body.mode || body.type || '').toLowerCase();
  const isCancel = actionStr.indexOf('cancel') !== -1 || actionStr.indexOf('取消') !== -1
    || (!body.type && !body.orderItems && (body.orderId || body.orderID || body.order_id || body.bookingId));
  if (isCancel) {
    calls.cancels += 1;
    return { path: 'cancel' };
  }
  const day = context.sheetDayStr_(body.date);
  if (!day) return { path: 'error' };
  if (body.type !== 'dining') {
    calls.appendTakeout += 1;
    return { path: 'takeout' };
  }
  calls.appendDining += 1;
  calls.cap += 1;
  return { path: 'dining' };
}

resetCalls();
assert(legacyDoPostWithoutLookup_({ action: 'cancel', orderId: 'SMC100001', phone: DINING_PHONE }).path === 'cancel', 'action 含 cancel 應走取消');
assert(calls.cancels === 1 && calls.appendDining === 0 && calls.appendTakeout === 0, '取消不寫表');
resetCalls();
assert(legacyDoPostWithoutLookup_({ type: 'cancel-dining', date: '2026-11-02' }).path === 'cancel', 'type 含 cancel 應走取消');
resetCalls();
assert(legacyDoPostWithoutLookup_({ orderId: 'SMC100001' }).path === 'cancel', '沒有 type 與 orderItems 但有 orderId 應走取消');
resetCalls();
assert(legacyDoPostWithoutLookup_({ type: 'dining', date: '2026-02-31' }).path === 'error', '非法日期應是錯誤');
assert(calls.appendDining === 0 && calls.appendTakeout === 0 && calls.cancels === 0, '非法日期不寫不取消');
resetCalls();
assert(legacyDoPostWithoutLookup_({ type: 'dining', date: '2026-11-02' }).path === 'dining' && calls.appendDining === 1, '合法內用應寫內用');
resetCalls();
assert(legacyDoPostWithoutLookup_({ type: 'takeout', date: '2026-11-02' }).path === 'takeout' && calls.appendTakeout === 1, '非內用應寫外帶');
resetCalls();
assert(legacyDoPostWithoutLookup_({ action: 'lookup', date: '2026-11-02' }).path === 'takeout', '舊路由看到 date 且沒有 type 會寫外帶');

for (const [label, payload] of [['exists', existsPayload], ['takeout_exists', takeoutPayload], ['duplicate_check', duplicatePayload]]) {
  resetCalls();
  assertLookupShape(label, payload);
  const routed = legacyDoPostWithoutLookup_(payload);
  assert(routed.path === 'error', `${label} 打到舊 doPost 應因沒有日期而拒絕，實際 ${routed.path}`);
  assert(calls.appendDining === 0 && calls.appendTakeout === 0 && calls.cancels === 0, `${label} 打到舊 doPost 不可寫入或取消`);
}

resetCalls();
const pingLegacy = legacyDoPostWithoutLookup_({ action: 'lookup', op: 'ping', token: TOKEN });
assert(pingLegacy.path === 'error', `ping 打到舊 doPost 應因沒有日期而拒絕，實際 ${pingLegacy.path}`);
assert(calls.appendDining === 0 && calls.appendTakeout === 0 && calls.cancels === 0, 'ping 打到舊 doPost 不可寫入或取消');

resetCalls();
assertUnauthorized('沒帶權杖', context.handleReadLookup_(postEvent({ action: 'lookup', op: 'exists', lookup_order_id: 'SMC100001' })));
assert(calls.dataReads === 0, '沒帶權杖不應讀表');

resetCalls();
assertUnauthorized('權杖錯誤', context.handleReadLookup_(postEvent({
  action: 'lookup', op: 'exists', lookup_order_id: 'SMC100001', token: 'wrong-token',
})));
assert(calls.dataReads === 0, '權杖錯誤不應讀表');

resetCalls();
scriptProperties = {};
assertUnauthorized('屬性未設定', context.handleReadLookup_(postEvent({
  action: 'lookup', op: 'exists', lookup_order_id: 'SMC100001', token: TOKEN,
})));
assert(calls.dataReads === 0, '屬性未設定不應讀表');

resetCalls();
propertyNull = true;
assertUnauthorized('屬性讀回 null', context.handleReadLookup_(postEvent(existsPayload)));
assert(calls.dataReads === 0, '屬性 null 不應讀表');

resetCalls();
propertyThrow = true;
assertUnauthorized('屬性讀取丟出例外', context.handleReadLookup_(postEvent(existsPayload)));
assert(calls.dataReads === 0, '屬性例外不應讀表');
assert(context.handleReadLookup_(postEvent(existsPayload)).text.indexOf('properties') === -1, '屬性例外不可把內部訊息回出去');

resetCalls();
scriptProperties = { READ_API_TOKEN: '   ' };
assertUnauthorized('屬性是空白', context.handleReadLookup_(postEvent({
  action: 'lookup', op: 'exists', lookup_order_id: 'SMC100001', token: '   ',
})));

resetCalls();
assertUnauthorized('屬性有值但送出空權杖', context.handleReadLookup_(postEvent({
  action: 'lookup', op: 'exists', lookup_order_id: 'SMC100001', token: '',
})));
assert(calls.dataReads === 0, '空權杖不應讀表');

resetCalls();
scriptProperties = { READ_API_TOKEN: '42' };
assertUnauthorized('權杖不是字串', context.handleReadLookup_(postEvent({
  action: 'lookup', op: 'ping', token: 42,
})));
assert(calls.dataReads === 0, '非字串權杖不應讀表');

resetCalls();
scriptProperties = { READ_API_TOKEN: 'abc' };
assertUnauthorized('權杖比屬性長', context.handleReadLookup_(postEvent({
  action: 'lookup', op: 'ping', token: 'abcXYZ',
})));

resetCalls();
assertUnauthorized('等長但錯誤的權杖', context.handleReadLookup_(postEvent({
  action: 'lookup', op: 'ping', token: 'X'.repeat(TOKEN.length),
})));
assert(calls.dataReads === 0, '等長錯誤權杖不應讀表');

resetCalls();
assertUnauthorized('權杖只放網址', context.handleReadLookup_(postEvent(
  { action: 'lookup', op: 'exists', lookup_order_id: 'SMC100001' },
  { token: TOKEN },
)));
assert(calls.dataReads === 0, '網址權杖不應讀表');

resetCalls();
const bare = context.doGet(getEvent({}));
assertUnauthorized('裸 GET', bare);
assert(calls.dataReads === 0, '裸 GET 不應讀表');
assert(bare.text.indexOf(TEST_TAB_SENTINEL) === -1, '裸 GET 不應回測試分頁');

resetCalls();
const pageDump = context.doGet(getEvent({ page: '工作表1' }));
assertUnauthorized('GET page=工作表1', pageDump);
assert(calls.dataReads === 0, 'GET 工作表1 不應讀表');
assert(pageDump.text.indexOf('工作表1') === -1, 'GET 不應回分頁名稱');

resetCalls();
const unknown = context.doGet(getEvent({ page: UNKNOWN_TAB }));
assertUnauthorized('未知分頁', unknown);
assert(unknown.text.indexOf(UNKNOWN_TAB) === -1, '未知分頁不應回分頁名稱');
assert(unknown.text.indexOf('找不到分頁') === -1, '未知分頁不應出現找不到分頁');

resetCalls();
const authedGet = context.doGet(getEvent({ page: '工作表1', token: TOKEN }));
assertUnauthorized('GET 帶對的權杖', authedGet);
assert(calls.dataReads === 0, 'GET 即使權杖正確也不應讀表');

resetCalls();
const ping = output(context.handleReadLookup_(postEvent({ action: 'lookup', op: 'ping', token: TOKEN })));
assert(ping && ping.ok === true && ping.api === 'read-v1', `ping 應為 read-v1，實際 ${JSON.stringify(ping)}`);
assert(keysOf(ping) === 'api,ok', `ping 只能有 ok/api，實際 ${keysOf(ping)}`);
assert(calls.dataReads === 0, 'ping 不應讀表');

resetCalls();
const exists = output(context.handleReadLookup_(postEvent(existsPayload)));
assert(exists && exists.ok === true && exists.found === true && exists.status === '已完成', `exists 應找到狀態，實際 ${JSON.stringify(exists)}`);
assert(keysOf(exists) === 'found,ok,status', `exists 只能有 ok/found/status，實際 ${keysOf(exists)}`);
assertNoPrivate('exists', { text: JSON.stringify(exists) });
assert(calls.sheets.join(',') === '工作表1', `exists 只讀工作表1，實際 ${calls.sheets.join(',')}`);

resetCalls();
const missing = output(context.handleReadLookup_(postEvent({
  action: 'lookup', op: 'exists', token: TOKEN, lookup_order_id: 'SMC199999',
})));
assert(missing && missing.ok === true && missing.found === false, `找不到應是 found:false，實際 ${JSON.stringify(missing)}`);
assert(keysOf(missing) === 'found,ok', `找不到只能有 ok/found，實際 ${keysOf(missing)}`);
assert(missing.error !== 'unauthorized', '找不到不可是 unauthorized');

resetCalls();
const dup = output(context.handleReadLookup_(postEvent(duplicatePayload)));
assert(dup && dup.ok === true && dup.duplicate === true && dup.matchedOrderId === 'SMC100001', `重複檢查應命中 SMC100001，實際 ${JSON.stringify(dup)}`);
assert(keysOf(dup) === 'duplicate,matchedOrderId,ok', `重複命中只能有三個欄位，實際 ${keysOf(dup)}`);
assertNoPrivate('duplicate_check', { text: JSON.stringify(dup) });

resetCalls();
const phoneOnly = output(context.handleReadLookup_(postEvent({
  action: 'lookup',
  op: 'duplicate_check',
  token: TOKEN,
  lookup_date: '2026-11-02',
  lookup_session: '晚上',
  lookup_phone: '900111222',
})));
assert(phoneOnly && phoneOnly.duplicate === true && phoneOnly.matchedOrderId === 'SMC100003', `電話比對應命中晚場，實際 ${JSON.stringify(phoneOnly)}`);

resetCalls();
const nameOnly = output(context.handleReadLookup_(postEvent({
  action: 'lookup',
  op: 'duplicate_check',
  token: TOKEN,
  lookup_date: '2026-11-03',
  lookup_session: '晚上',
  lookup_name: DINING_NAME,
})));
assert(nameOnly && nameOnly.ok === true && nameOnly.duplicate === 'possible' && nameOnly.matchedOrderId === 'smc100004', `只有姓名應是 possible，實際 ${JSON.stringify(nameOnly)}`);

resetCalls();
const notDup = output(context.handleReadLookup_(postEvent({
  action: 'lookup',
  op: 'duplicate_check',
  token: TOKEN,
  lookup_date: '2026-11-02',
  lookup_session: '中午',
  lookup_phone: OTHER_PHONE,
  lookup_name: OTHER_NAME,
})));
assert(notDup && notDup.ok === true && notDup.duplicate === false, `已取消列不是重複，實際 ${JSON.stringify(notDup)}`);
assert(keysOf(notDup) === 'duplicate,ok', `沒有重複只能有 ok/duplicate，實際 ${keysOf(notDup)}`);
assert(notDup.error !== 'unauthorized', '沒有重複不可是 unauthorized');

resetCalls();
const phoneIgnoresName = output(context.handleReadLookup_(postEvent({
  action: 'lookup',
  op: 'duplicate_check',
  token: TOKEN,
  lookup_date: '2026-11-02',
  lookup_session: '中午',
  lookup_phone: DINING_PHONE,
  lookup_name: OTHER_NAME,
})));
assert(phoneIgnoresName && phoneIgnoresName.duplicate === true && phoneIgnoresName.matchedOrderId === 'SMC100001', '有有效電話時只比電話、日期、時段');

resetCalls();
const takeout = output(context.handleReadLookup_(postEvent(takeoutPayload)));
assert(takeout && takeout.ok === true && takeout.found === true && takeout.status === '預約中', `外帶 exists 應找到，實際 ${JSON.stringify(takeout)}`);
assert(keysOf(takeout) === 'found,ok,status', `外帶 exists 只能有 ok/found/status，實際 ${keysOf(takeout)}`);
assertNoPrivate('takeout_exists', { text: JSON.stringify(takeout) });
assert(calls.sheets.join(',') === '外帶訂單', `外帶 exists 只讀外帶訂單，實際 ${calls.sheets.join(',')}`);

resetCalls();
const takeoutMissingOnDining = output(context.handleReadLookup_(postEvent({
  action: 'lookup', op: 'exists', token: TOKEN, lookup_order_id: 'SMC200002',
})));
assert(takeoutMissingOnDining && takeoutMissingOnDining.found === false, '內用 exists 不讀外帶編號');

resetCalls();
const lineBooking = output(context.handleReadLookup_(postEvent({
  action: 'lookup',
  op: 'duplicate_check',
  token: TOKEN,
  lookup_date: '2026-11-07',
  lookup_session: '晚',
  lookup_phone: 'line訂',
  lookup_name: '測戊',
})));
assert(lineBooking && lineBooking.duplicate === 'possible' && lineBooking.matchedOrderId === 'SMC100010', `line訂 應改走姓名並標 possible，實際 ${JSON.stringify(lineBooking)}`);

resetCalls();
const badPhone = output(context.handleReadLookup_(postEvent({
  action: 'lookup',
  op: 'duplicate_check',
  token: TOKEN,
  lookup_date: '2026-11-02',
  lookup_session: '中午',
  lookup_phone: 'abc',
  lookup_name: DINING_NAME,
})));
assert(badPhone && badPhone.ok === false && badPhone.error === 'bad_request', `電話沒有數字應是 bad_request，實際 ${JSON.stringify(badPhone)}`);
assert(calls.dataReads === 0, '電話正規化成空不可讀表');

resetCalls();
const cancelledWord = output(context.handleReadLookup_(postEvent({
  action: 'lookup',
  op: 'duplicate_check',
  token: TOKEN,
  lookup_date: '2026-11-06',
  lookup_session: '中午',
  lookup_phone: '0900888000',
})));
assert(cancelledWord && cancelledWord.duplicate === false, `取消訂位不可當成重複，實際 ${JSON.stringify(cancelledWord)}`);

resetCalls();
const plainCancelled = output(context.handleReadLookup_(postEvent({
  action: 'lookup',
  op: 'duplicate_check',
  token: TOKEN,
  lookup_date: '2026-11-08',
  lookup_session: '中午',
  lookup_phone: '0900999000',
})));
assert(plainCancelled && plainCancelled.duplicate === false, `狀態「取消」不可當成重複，實際 ${JSON.stringify(plainCancelled)}`);

resetCalls();
const blankIds = output(context.handleReadLookup_(postEvent({
  action: 'lookup',
  op: 'duplicate_check',
  token: TOKEN,
  lookup_date: '2026-11-05',
  lookup_session: '晚上',
  lookup_phone: '0900666000',
})));
assert(blankIds && blankIds.duplicate === true && !Object.prototype.hasOwnProperty.call(blankIds, 'matchedOrderId'), `訂單編號都是空的不可回 matchedOrderId，實際 ${JSON.stringify(blankIds)}`);

resetCalls();
const keepEarlierId = output(context.handleReadLookup_(postEvent({
  action: 'lookup',
  op: 'duplicate_check',
  token: TOKEN,
  lookup_date: '2026-11-04',
  lookup_session: '中午',
  lookup_phone: '0900777888',
})));
assert(keepEarlierId && keepEarlierId.duplicate === true && keepEarlierId.matchedOrderId === 'SMC100008', `後面的空編號不可蓋掉已命中的編號，實際 ${JSON.stringify(keepEarlierId)}`);

resetCalls();
failSheetRead = true;
const broken = output(context.handleReadLookup_(postEvent({
  action: 'lookup', op: 'exists', token: TOKEN, lookup_order_id: 'SMC100001',
})));
assert(broken && broken.ok === false && broken.error === 'unavailable', `讀表失敗不可當成找不到，實際 ${JSON.stringify(broken)}`);
assert(broken && broken.found !== false && broken.duplicate !== false, '讀表失敗不可 fail open');
assert(broken && JSON.stringify(broken).indexOf('sheet read failed') === -1, '讀表失敗不可回內部訊息');

resetCalls();
failSheetRead = true;
const brokenDup = output(context.handleReadLookup_(postEvent(duplicatePayload)));
assert(brokenDup && brokenDup.error === 'unavailable' && brokenDup.duplicate !== false, `duplicate_check 讀表失敗不可當成沒有重複，實際 ${JSON.stringify(brokenDup)}`);

resetCalls();
failSheetRead = true;
const brokenTakeout = output(context.handleReadLookup_(postEvent(takeoutPayload)));
assert(brokenTakeout && brokenTakeout.error === 'unavailable' && brokenTakeout.found !== false, `takeout_exists 讀表失敗不可當成找不到，實際 ${JSON.stringify(brokenTakeout)}`);

resetCalls();
const missingId = output(context.handleReadLookup_(postEvent({ action: 'lookup', op: 'exists', token: TOKEN })));
assert(missingId && missingId.error === 'bad_request', `exists 缺編號應是 bad_request，實際 ${JSON.stringify(missingId)}`);
assert(calls.dataReads === 0, '缺編號不應讀表');

resetCalls();
const missingDate = output(context.handleReadLookup_(postEvent({
  action: 'lookup', op: 'duplicate_check', token: TOKEN, lookup_session: '中午', lookup_phone: DINING_PHONE,
})));
assert(missingDate && missingDate.error === 'bad_request', `缺日期應是 bad_request，實際 ${JSON.stringify(missingDate)}`);
assert(calls.dataReads === 0, '缺日期不應讀表');

resetCalls();
sheets['工作表1'][0][9] = '編號';
const badHeader = output(context.handleReadLookup_(postEvent(existsPayload)));
assert(badHeader && badHeader.error === 'unavailable', `表頭不符應是 unavailable，實際 ${JSON.stringify(badHeader)}`);
assertNoPrivate('表頭不符', { text: JSON.stringify(badHeader) });

resetCalls();
sheets['工作表1'][0][1] = '電話';
sheets['工作表1'][0][2] = '姓名';
const misplaced = output(context.handleReadLookup_(postEvent(duplicatePayload)));
assert(misplaced && misplaced.ok === false && misplaced.error === 'unavailable', `欄位對錯位置應是 unavailable，實際 ${JSON.stringify(misplaced)}`);
assert(misplaced && misplaced.duplicate !== true && misplaced.duplicate !== false, '欄位對錯位置不可當成有或沒有重複');
assertNoPrivate('欄位對錯位置', { text: JSON.stringify(misplaced) });

resetCalls();
sheets['外帶訂單'][0][8] = '情形';
const badTakeoutHeader = output(context.handleReadLookup_(postEvent(takeoutPayload)));
assert(badTakeoutHeader && badTakeoutHeader.error === 'unavailable', `外帶表頭不符應是 unavailable，實際 ${JSON.stringify(badTakeoutHeader)}`);

resetCalls();
const savedDay = context.sheetDayStr_;
context.sheetDayStr_ = undefined;
const noDayHelper = output(context.handleReadLookup_(postEvent(duplicatePayload)));
context.sheetDayStr_ = savedDay;
assert(noDayHelper && noDayHelper.error === 'unavailable', `沒有 sheetDayStr_ 應是 unavailable，實際 ${JSON.stringify(noDayHelper)}`);
assert(calls.dataReads === 0, '沒有日期函式不應讀表');

resetCalls();
const blocked = output(context.handleReadLookup_(postEvent({ ...existsPayload, orderId: 'SMC100001' })));
assert(blocked && blocked.error === 'bad_request', `查詢不可同時帶 orderId，實際 ${JSON.stringify(blocked)}`);
assert(calls.dataReads === 0, '帶了舊欄位不應讀表');

for (const key of BLOCKED_LOOKUP_KEYS) {
  resetCalls();
  const oneField = output(context.handleReadLookup_(postEvent({ ...existsPayload, [key]: 'x' })));
  assert(oneField && oneField.error === 'bad_request', `查詢不可同時帶 ${key}，實際 ${JSON.stringify(oneField)}`);
  assert(calls.dataReads === 0, `只帶 ${key} 不應讀表`);
}

resetCalls();
const arrayBody = context.handleReadLookup_(postEvent(['lookup']));
assert(arrayBody == null, '陣列 body 不是查詢物件');
assert(calls.dataReads === 0, '陣列 body 不應讀表');

for (const [label, body] of [
  ['取消', { action: 'cancel', orderId: 'SMC100001', phone: DINING_PHONE }],
  ['LINE events', { events: [{ type: 'message', message: { type: 'text', text: '訂位' } }] }],
  ['pending_update', { action: 'pending_update' }],
  ['pending_ingest', { action: 'pending_ingest' }],
]) {
  resetCalls();
  const passed = context.handleReadLookup_(postEvent(body));
  assert(passed == null, `${label} 應穿過攔截並回 null，實際 ${passed && passed.text}`);
  assert(calls.dataReads === 0 && calls.booking === 0 && calls.cancels === 0 && calls.appendDining === 0 && calls.appendTakeout === 0, `${label} 攔截不可讀寫`);
}

resetCalls();
const markedBook = output(context.doPost(postEvent({
  action: 'book', type: 'dining', date: '2026-11-02', op: 'exists', token: TOKEN,
})));
assert(markedBook && markedBook.ok === false && markedBook.error === 'bad_request', `action 不是 lookup 但帶了 op 或 token 應拒絕，實際 ${JSON.stringify(markedBook)}`);
assert(calls.booking === 0 && calls.appendDining === 0 && calls.appendTakeout === 0 && calls.cancels === 0, '混進查詢欄位的訂位不可寫入');

resetCalls();
const badOp = output(context.handleReadLookup_(postEvent({
  action: 'lookup', op: UNKNOWN_TAB, token: TOKEN,
})));
assert(badOp && badOp.ok === false && badOp.error === 'bad_request', `未知查詢應為 bad_request，實際 ${JSON.stringify(badOp)}`);
assert(JSON.stringify(badOp).indexOf(UNKNOWN_TAB) === -1, '錯誤不可回查詢字');
assert(calls.dataReads === 0, '參數不對不應讀表');

resetCalls();
const diningBook = output(context.doPost(postEvent({
  action: 'book', type: 'dining', date: '2026-11-02', tables: 1,
})));
assert(diningBook && diningBook.status === 'success' && diningBook.message === '內用預約成功！' && diningBook.orderId === 'SMC100099', `內用寫入應維持舊回應，實際 ${JSON.stringify(diningBook)}`);
assert(calls.booking === 1 && calls.appendDining === 1 && calls.cap === 1, '內用仍走原本寫入與桌數上限');
assert(calls.dataReads === 0, '內用寫入不應改走讀取 API');

resetCalls();
const takeoutBook = output(context.doPost(postEvent({
  action: 'book', type: 'takeout', date: '2026-11-02',
})));
assert(takeoutBook && takeoutBook.status === 'success' && takeoutBook.message === '外帶預約成功！我們會儘快為您準備。' && takeoutBook.orderId === 'SMC200099', `外帶寫入應維持舊回應，實際 ${JSON.stringify(takeoutBook)}`);
assert(calls.booking === 1 && calls.appendTakeout === 1 && calls.cap === 0 && calls.appendDining === 0, '外帶不套用內用桌數上限');

resetCalls();
const lookupWrite = context.doPost(postEvent({
  action: 'lookup', op: 'exists', token: 'wrong-token', lookup_order_id: 'SMC199999',
}));
output(lookupWrite);
assert(calls.booking === 0 && calls.appendDining === 0 && calls.appendTakeout === 0 && calls.cap === 0 && calls.cancels === 0, '未授權查詢不可寫表');

resetCalls();
const unknownWrite = context.doPost(postEvent({
  action: 'lookup', op: 'nope', token: TOKEN,
}));
output(unknownWrite);
assert(calls.booking === 0 && calls.appendDining === 0 && calls.appendTakeout === 0 && calls.cancels === 0, '未知 op 不可寫表');

const docs = readFileSync(join(root, 'docs/read-api.md'), 'utf8');
for (const phrase of [
  'lookup_date', 'lookup_session', 'lookup_phone', 'lookup_name', 'lookup_order_id',
  'read-v1', '暫停上傳', 'v152', '30 天',
  'live-upload_py.py', 'finish_takeout_verify.py', 'live_takeout_once.py', 'lineok',
  '取消訂位', 'possible', 'duplicate: true', '沒有 matchedOrderId', '重複',
  '已取消、取消、取消訂位', 'Executions', '看不出呼叫端', 'doGet 為 0', '進行中的工作',
  '一起改回', '只可短暫', '事前檢查', '轉人工', '不算成功',
]) {
  assert(docs.indexOf(phrase) !== -1, `說明應寫到「${phrase}」`);
}

assert(!/function\s+processBooking|function\s+dineInTableLimit_|CNY_2027_DINE_IN_TABLE_CAPS|AKfycb|script\.google\.com/.test(source), '讀取 API 不可改寫入流程，也不可寫入網址或部署編號');

const headerConst = source.match(/var READ_API_DINING_HEADERS = \[[\s\S]*?\];/);
assert(headerConst, '內用表頭應是單一常數');
if (headerConst) {
  for (const label of ['姓名', '電話', '日期', '時段', '訂單編號', '狀態']) {
    assert(headerConst[0].indexOf(label) !== -1, `表頭常數應含「${label}」`);
  }
  assert(headerConst[0].indexOf('[1, "姓名"]') !== -1, '表頭常數應把第 1 欄定成姓名');
  assert(headerConst[0].indexOf('[2, "電話"]') !== -1, '表頭常數應把第 2 欄定成電話');
  assert(headerConst[0].indexOf('[4, "日期"]') !== -1, '表頭常數應把第 4 欄定成日期');
  assert(headerConst[0].indexOf('[5, "時段"]') !== -1, '表頭常數應把第 5 欄定成時段');
  assert(headerConst[0].indexOf('[9, "訂單編號"]') !== -1, '表頭常數應把第 9 欄定成訂單編號');
  assert(headerConst[0].indexOf('[10, "狀態"]') !== -1, '表頭常數應把第 10 欄定成狀態');
}

if (failures.length) {
  console.error(`FAIL ${failures.length}`);
  failures.forEach((item) => console.error(` - ${item}`));
  process.exit(1);
}
console.log(`ok ${source.length} bytes`);
