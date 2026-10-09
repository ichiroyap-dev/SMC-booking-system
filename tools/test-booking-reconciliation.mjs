#!/usr/bin/env node
// Local reconciliation only. Does not call script.google.com, send mail, or open a sheet.
// The in-memory sheet stores setValues strings and does not execute formulas.
// A leading apostrophe here is not evidence that Google Sheets will skip calculation.
// Usage: node tools/test-booking-reconciliation.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const attr = require(join(root, 'js/booking-attribution.js'));
const source = readFileSync(join(root, 'js/booking-attribution.js'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const gs = readFileSync(join(root, 'apps-script/booking-attribution-isolated.gs'), 'utf8');
const runbook = readFileSync(join(root, 'docs/booking-attribution-isolated-runbook.md'), 'utf8');
const checkPage = readFileSync(join(root, 'tools/isolated-dining-check.html'), 'utf8');
const checkGuard = readFileSync(join(root, 'tools/isolated-check-guard.js'), 'utf8');
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

const t0 = 1700000000000;
const FIXED_TIME = '2026-10-08T00:00:00.000Z';
const BRAND_URL = '?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=ag_brand';
const GEO_URL = '?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=ag_geo_dining';
const NOTE = '散客 大人2位；靠窗';
const LIVE_ID = 'AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q';
const GUEST_FORBIDDEN = ['launch_202610', 'ag_brand', 'ag_geo_dining', 'utm_', 'gclid', 'TESTGCLID', 'direct/unknown', '有點擊識別碼', '品牌', '非品牌', '=1+1'];
const BOOKING_POST = {
  action: 'book',
  type: 'dining',
  name: '測試同學',
  phone: '0900000000',
  email: 'hub-test@example.com',
  people: '2',
  tables: '1',
  date: '2026-10-22',
  time: '12:00',
  note: NOTE,
  orderItems: '',
};
const SHEET_BOOKING = {
  動作: 'book',
  類型: 'dining',
  姓名: '測試同學',
  電話: '0900000000',
  信箱: 'hub-test@example.com',
  人數: '2',
  桌數: '1',
  日期: '2026-10-22',
  時間: '12:00',
  備註: NOTE,
  品項: '',
};
const ATTR_HEADERS = {
  source: '來源',
  utmSource: 'utm來源',
  utmMedium: 'utm媒介',
  utmCampaign: 'utm活動',
  utmContent: 'utm內容',
  utmTerm: 'utm關鍵字',
  utmAdgroup: 'utm廣告群組',
  adgroupBucket: '群組分類',
  gclid: '點擊識別碼',
};

function baseOrder() {
  return Object.assign({}, BOOKING_POST);
}

function fieldsFor(search) {
  const store = attr.memoryStorage();
  attr.capture(search, store, t0, 'navigate');
  return attr.bookingFields(store, t0);
}

function memorySpreadsheet() {
  const sheets = {};
  function make() {
    const data = [];
    return {
      getLastRow() { return data.length; },
      appendRow(row) { data.push(row.slice()); },
      clear() { data.length = 0; },
      getRange(row, col, numRows, numCols) {
        const rowsN = numRows == null ? 1 : numRows;
        const colsN = numCols == null ? 1 : numCols;
        return {
          setNumberFormat() { return this; },
          setValues(values) {
            for (let r = 0; r < rowsN; r += 1) {
              const line = data[row - 1 + r] ? data[row - 1 + r].slice() : [];
              for (let c = 0; c < colsN; c += 1) line[col - 1 + c] = values[r][c];
              data[row - 1 + r] = line;
            }
          },
          getValues() {
            const out = [];
            for (let r = 0; r < rowsN; r += 1) {
              const line = data[row - 1 + r] || [];
              const slice = [];
              for (let c = 0; c < colsN; c += 1) {
                const cell = line[col - 1 + c];
                slice.push(cell == null ? '' : cell);
              }
              out.push(slice);
            }
            return out;
          },
          getValue() {
            const line = data[row - 1] || [];
            return line[col - 1] == null ? '' : line[col - 1];
          },
        };
      },
      rows() { return data.map((row) => row.slice()); },
    };
  }
  return {
    getSheetByName(name) { return sheets[name] || null; },
    insertSheet(name) {
      sheets[name] = make();
      return sheets[name];
    },
  };
}

function loadIsolated(options = {}) {
  const sandbox = {
    console,
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        return { setMimeType() { return this; }, getContent() { return text; } };
      },
    },
  };
  const props = {
    SMC_ATTRIBUTION_ISOLATED: options.isolated == null ? 'yes' : options.isolated,
    SMC_SHOP_EMAIL: 'shop-test@example.com',
  };
  const sheetId = options.sheetId || 'isolated-test-sheet';
  if (!options.omitId) props.SMC_TEST_SHEET_ID = sheetId;
  const box = {
    byId: {},
    mails: [],
    opened: [],
    activeCalls: [],
    menus: [],
    menuItems: [],
    alerts: [],
    lockHeld: false,
    lockDenied: 0,
    lockAcquires: 0,
    lockLog: [],
  };
  const marked = memorySpreadsheet();
  if (options.marker !== 'missing') {
    const marker = marked.insertSheet('隔離標記');
    marker.appendRow([options.marker === 'wrong' ? 'OTHER-SHEET' : 'SMC-ISOLATED-TEST']);
  }
  box.byId['isolated-test-sheet'] = marked;
  sandbox.PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(key) { return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null; },
        setProperty(key, value) { props[key] = String(value); },
      };
    },
  };
  sandbox.SpreadsheetApp = {
    getActive() {
      box.activeCalls.push('getActive');
      throw new Error('bound sheet fallback removed');
    },
    openById(id) {
      box.opened.push(id);
      if (!box.byId[id]) box.byId[id] = memorySpreadsheet();
      return box.byId[id];
    },
    flush() {
      box.lockLog.push(box.lockHeld ? 'flush-held' : 'flush-free');
    },
    getUi() {
      return {
        createMenu(name) {
          box.menus.push(name);
          return {
            addItem(title, fn) {
              box.menuItems.push({ title, fn });
              return this;
            },
            addToUi() {},
          };
        },
        alert(message) { box.alerts.push(String(message)); },
      };
    },
  };
  sandbox.MailApp = {
    sendEmail(to, subject, body) { box.mails.push({ to, subject, body }); },
  };
  sandbox.LockService = {
    getScriptLock() {
      return {
        tryLock() {
          if (box.lockHeld) {
            box.lockDenied += 1;
            return false;
          }
          box.lockHeld = true;
          box.lockAcquires += 1;
          box.lockLog.push('lock');
          return true;
        },
        releaseLock() {
          box.lockLog.push('release');
          box.lockHeld = false;
        },
      };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(gs, sandbox);
  sandbox.nowIso_ = () => FIXED_TIME;
  return { sandbox, props, box };
}

function post(isolated, payload) {
  const response = isolated.sandbox.doPost({ postData: { contents: JSON.stringify(payload) } });
  return JSON.parse(response.getContent());
}

function assertFlushBeforeRelease(box, label) {
  assert(!box.lockLog.includes('flush-free'), `${label}：flush 時鎖還在`);
  let open = false;
  let sawFlush = false;
  for (const event of box.lockLog) {
    if (event === 'lock') open = true;
    if (event === 'flush-held') {
      assert(open, `${label}：flush 要在 releaseLock 之前，而且鎖還握著`);
      sawFlush = true;
    }
    if (event === 'release') open = false;
  }
  assert(sawFlush, `${label}：寫入訂單列後要呼叫 SpreadsheetApp.flush`);
  assert(open === false, `${label}：結束時鎖要放開`);
}

function sheetRows(isolated, name) {
  const id = isolated.props.SMC_TEST_SHEET_ID;
  const ss = id ? isolated.box.byId[id] : null;
  if (!ss) return [];
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  return sheet.rows();
}

function asMap(headers, row) {
  const out = {};
  headers.forEach((key, index) => { out[key] = row[index] == null ? '' : String(row[index]); });
  return out;
}

function rowById(isolated, id) {
  const rows = sheetRows(isolated, '訂單');
  if (!rows.length) return null;
  const found = rows.slice(1).find((row) => row[0] === id);
  return found ? asMap(rows[0], found) : null;
}

function mailById(isolated, id) {
  const rows = sheetRows(isolated, '郵件預覽');
  if (!rows.length) return null;
  const found = rows.slice(1).find((row) => row[0] === id);
  return found ? asMap(rows[0], found) : null;
}

function expectedGuest(orderId, note = NOTE) {
  return [
    '水美土雞城｜預約申請已收到',
    '訂單編號：' + orderId,
    '申請類型：內用',
    '預約日期與時間：2026-10-22 12:00',
    '人數：2',
    '桌數：1',
    '備註：' + note,
    '郵件上的「已收到」是收件通知，細節以電話確認為準。',
  ].join('\n');
}

function expectedShop(orderId, expectedAttr, note = NOTE, items = '無') {
  return [
    '水美土雞城｜店內收件（隔離測試，勿轉寄給客人）',
    '訂單編號：' + orderId,
    '申請類型：內用',
    '預約日期與時間：2026-10-22 12:00',
    '人數：2',
    '桌數：1',
    '備註：' + note,
    '品項：' + items,
    '---',
    '來源對帳',
    '來源：' + expectedAttr.source,
    'utm來源：' + expectedAttr.utmSource,
    'utm媒介：' + expectedAttr.utmMedium,
    'utm活動：' + expectedAttr.utmCampaign,
    'utm內容：' + expectedAttr.utmContent,
    'utm關鍵字：' + expectedAttr.utmTerm,
    'utm廣告群組：' + expectedAttr.utmAdgroup,
    '群組分類：' + expectedAttr.adgroupBucket,
    '點擊識別碼：' + expectedAttr.gclid,
  ].join('\n');
}

function emptyAttr() {
  return {
    source: '',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    utmContent: '',
    utmTerm: '',
    utmAdgroup: '',
    adgroupBucket: '',
    gclid: '',
  };
}

const BRAND_ATTR = {
  source: 'google',
  utmSource: 'google',
  utmMedium: 'cpc',
  utmCampaign: 'launch_202610',
  utmContent: 'ag_brand',
  utmTerm: '',
  utmAdgroup: '',
  adgroupBucket: '品牌',
  gclid: '',
};
const GEO_ATTR = {
  source: 'google',
  utmSource: 'google',
  utmMedium: 'cpc',
  utmCampaign: 'launch_202610',
  utmContent: 'ag_geo_dining',
  utmTerm: '',
  utmAdgroup: '',
  adgroupBucket: '非品牌',
  gclid: '',
};
const DIRECT_ATTR = {
  source: 'direct/unknown',
  utmSource: '',
  utmMedium: '',
  utmCampaign: '',
  utmContent: '',
  utmTerm: '',
  utmAdgroup: '',
  adgroupBucket: '',
  gclid: '',
};
const UNKNOWN_ATTR = {
  source: '有點擊識別碼、來源待核對',
  utmSource: '',
  utmMedium: '',
  utmCampaign: '',
  utmContent: '',
  utmTerm: '',
  utmAdgroup: '',
  adgroupBucket: '',
  gclid: 'TESTGCLID9000',
};

function assertBookingResponse(res, id) {
  assert(res.status === 'success' && res.orderId === id, `${id} 隔離腳本要回同一個編號`);
  assert(!Object.prototype.hasOwnProperty.call(res, 'note') && !Object.prototype.hasOwnProperty.call(res, '備註'), `${id} 回應沒有備註欄`);
}

const isolated = loadIsolated();
assert(source.includes('SEND_ATTRIBUTION_TO_BACKEND = false'), '旗標必須維持 false');
assert(!html.includes('payloadIfAttributionEnabled'), '官網不可呼叫預覽送出');
assert(!html.includes('booking-attribution-isolated'), '官網不可載入隔離腳本');
assert(!html.includes('isolated-dining-check'), '官網不可連到隔離驗收頁');
assert(html.includes('script.google.com/macros/s/' + LIVE_ID + '/exec'), '正式 web app 網址不可改');
assert(!gs.includes('getActive'), '隔離腳本不可讀取目前打開的試算表');
assert(!/insertSheet\(\s*MARKER_SHEET/.test(gs), '隔離腳本不可自己建立隔離標記');
assert(checkPage.includes('payloadIfAttributionEnabled'), '驗收頁要送出旗標打開後的預覽內容');
assert(checkPage.includes('resolveStorage'), '驗收頁要讀這次分頁已記下的來源');
assert(checkPage.includes('isolated-check-guard.js'), '驗收頁要使用網址與回應判斷');
assert(checkPage.includes('classifyFetch'), '驗收頁要依回應內容決定成功或失敗');
assert(!checkPage.includes('沒有送到'), '驗收頁不可把網路失敗說成沒有送到');
assert(checkGuard.includes(LIVE_ID), '驗收頁要拒絕正式 web app');
assert(checkGuard.includes('結果未知，先核對試算表、勿重送'), '結果未知時要先核對試算表');
assert(checkPage.includes('noindex'), '驗收頁不可被索引');
assert(checkPage.includes('www.sweetmeichicken.com') && checkPage.includes('不要打開'), '驗收頁要寫明不要用正式官網');
for (const phrase of ['SMC900001', 'SMC900101', 'SMC900102', 'SMC900103', 'SMC900104', 'SMC900105', 'SMC900106', 'ag_brand', 'ag_geo_dining', 'direct/unknown', '=1+1', '測試同學', 'runIsolatedEightCases', 'SMC-ISOLATED-TEST', 'isolated-dining-check.html', '回應沒有備註', '不會執行公式']) {
  assert(runbook.includes(phrase), `驗收步驟缺少 ${phrase}`);
}
assert(!runbook.includes('備註四邊'), '手冊不可再要求回應裡的備註');

const brandFields = fieldsFor(BRAND_URL);
const geoFields = fieldsFor(GEO_URL);
const directFields = fieldsFor('?mode=dining');
const unknownFields = fieldsFor('?gclid=TESTGCLID9000');
assert(brandFields.adgroupBucket === '品牌' && brandFields.utmContent === 'ag_brand' && brandFields.utmAdgroup === '', '對帳起點：品牌最終網址');
assert(geoFields.adgroupBucket === '非品牌' && geoFields.utmContent === 'ag_geo_dining', '對帳起點：非品牌最終網址');
assert(directFields.source === 'direct/unknown' && directFields.gclid === '', '對帳起點：非廣告');
assert(unknownFields.source === '有點擊識別碼、來源待核對' && unknownFields.gclid === 'TESTGCLID9000', '對帳起點：來源不明');

const ledger = attr.memoryStorage();
attr.bindOrderAttribution(ledger, 'SMC900101', brandFields);
attr.bindOrderAttribution(ledger, 'SMC900102', geoFields);
attr.bindOrderAttribution(ledger, 'SMC900103', directFields);
attr.bindOrderAttribution(ledger, 'SMC900104', unknownFields);
assert(attr.bindOrderAttribution(ledger, 'SMC900101', geoFields).reason === 'duplicate', '同一編號不可改綁');
assert(attr.readOrderAttribution(ledger, 'SMC900101').utmContent === 'ag_brand', '品牌訂單不可被非品牌蓋掉');
assert(attr.readOrderAttribution(ledger, 'SMC900102').adgroupBucket === '非品牌', '非品牌訂單保持自己的分類');

function livePayload(fields) {
  return attr.payloadForBooking(baseOrder(), fields);
}
function previewPayload(fields, orderId) {
  const payload = attr.payloadIfAttributionEnabled(baseOrder(), fields);
  payload._testOrderId = orderId;
  return payload;
}
function assertPostKeys(payload, label) {
  assert(JSON.stringify(Object.keys(payload)) === JSON.stringify(['action', 'type', 'name', 'phone', 'email', 'people', 'tables', 'date', 'time', 'note', 'orderItems']), `${label} 正式 POST 仍是 11 欄`);
  for (const key of Object.keys(BOOKING_POST)) {
    assert(payload[key] === BOOKING_POST[key], `${label} 正式 POST 的 ${key} 要是固定預期值`);
  }
  for (const key of attr.ATTRIBUTION_KEYS) assert(!(key in payload), `${label} 正式 POST 不可有 ${key}`);
}

const cases = [
  { id: 'SMC900101', label: '廣告／品牌', fields: brandFields },
  { id: 'SMC900102', label: '廣告／非品牌', fields: geoFields },
  { id: 'SMC900103', label: '非廣告', fields: directFields },
  { id: 'SMC900104', label: '來源不明', fields: unknownFields },
];

const omitted = livePayload(brandFields);
omitted._testOrderId = 'SMC900001';
assertPostKeys(livePayload(brandFields), '缺來源');
assert(omitted.note === NOTE && omitted.date === '2026-10-22' && omitted.time === '12:00' && omitted.people === '2' && omitted.tables === '1', '旗標關閉的訂位欄維持原樣');
const omittedRes = post(isolated, omitted);
assertBookingResponse(omittedRes, 'SMC900001');
assert(omittedRes.mailed === true, '收單成功時要另外標明寄信成功');

for (const item of cases) {
  const live = livePayload(item.fields);
  assertPostKeys(live, item.label);
  const preview = previewPayload(item.fields, item.id);
  for (const key of Object.keys(BOOKING_POST)) {
    assert(preview[key] === BOOKING_POST[key], `${item.label} 預覽 POST 的 ${key} 要是固定預期值`);
  }
  for (const key of attr.ATTRIBUTION_KEYS) {
    assert(preview[key] === item.fields[key], `${item.label} 預覽 POST 的 ${key} 要等於瀏覽器`);
  }
  const bound = attr.readOrderAttribution(ledger, item.id);
  assert(bound && bound.source === item.fields.source && bound.utmContent === item.fields.utmContent && bound.gclid === item.fields.gclid, `${item.label} 訂單快照要等於瀏覽器`);
  assertBookingResponse(post(isolated, preview), item.id);
}

const formula = previewPayload(brandFields, 'SMC900105');
formula.utmCampaign = '=1+1';
assert(formula.note === NOTE && formula.date === '2026-10-22' && formula.people === '2', '公式案例的訂位欄仍是固定預期值');
assertBookingResponse(post(isolated, formula), 'SMC900105');

const malformed = Object.assign(previewPayload(directFields, 'SMC900106'), {
  source: { bad: true },
  utmContent: ['ag_brand'],
  adgroupBucket: '品牌<script>',
  gclid: 12345,
});
assert(malformed.note === NOTE && malformed.tables === '1' && malformed.time === '12:00', '壞來源案例的訂位欄仍是固定預期值');
assertBookingResponse(post(isolated, malformed), 'SMC900106');

const beforeDup = sheetRows(isolated, '訂單').length;
const beforeMail = sheetRows(isolated, '郵件預覽').length;
const beforeSent = isolated.box.mails.length;
const dup = post(isolated, previewPayload(geoFields, 'SMC900101'));
assertBookingResponse(dup, 'SMC900101');
assert(sheetRows(isolated, '訂單').length === beforeDup, '同一編號不可再寫一列');
assert(sheetRows(isolated, '郵件預覽').length === beforeMail, '同一編號不可再寫一封預覽');
assert(isolated.box.mails.length === beforeSent, '同一編號不可再寄信');

const expectedAttr = {
  SMC900001: emptyAttr(),
  SMC900101: BRAND_ATTR,
  SMC900102: GEO_ATTR,
  SMC900103: DIRECT_ATTR,
  SMC900104: UNKNOWN_ATTR,
  SMC900105: {
    source: 'google',
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: "'=1+1",
    utmContent: 'ag_brand',
    utmTerm: '',
    utmAdgroup: '',
    adgroupBucket: '品牌',
    gclid: '',
  },
  SMC900106: emptyAttr(),
};

for (const id of Object.keys(expectedAttr)) {
  const row = rowById(isolated, id);
  const mail = mailById(isolated, id);
  assert(row && mail, `${id} 要同時有訂單列與郵件預覽`);
  assert(row['收到時間'] === FIXED_TIME, `${id} 收到時間要寫入`);
  assert(row['訂單編號'] === id && mail['訂單編號'] === id, `${id} 表與郵件預覽的編號要相同`);
  for (const [column, value] of Object.entries(SHEET_BOOKING)) {
    assert(row[column] === value, `${id} 試算表${column}要是固定預期值`);
  }
  for (const key of attr.ATTRIBUTION_KEYS) {
    assert(row[ATTR_HEADERS[key]] === expectedAttr[id][key], `${id} 試算表${ATTR_HEADERS[key]}要是固定預期值`);
  }
  const guest = expectedGuest(id);
  const shop = expectedShop(id, expectedAttr[id]);
  assert(mail['客人正文'] === guest, `${id} 客人信正文要逐字等於固定預期`);
  assert(mail['店內正文'] === shop, `${id} 店內信正文要逐字等於固定預期，不可只跟試算表互相抄`);
  assert(mail['客人主旨'] === '水美土雞城｜預約申請已收到（' + id + '）', `${id} 客人信主旨`);
  assert(mail['店內主旨'] === '【店內對帳】預約 ' + id, `${id} 店內信主旨`);
  for (const token of GUEST_FORBIDDEN) {
    assert(!mail['客人正文'].includes(token), `${id} 客人信不可出現 ${token}`);
  }
  const sentGuest = isolated.box.mails.filter((item) => item.subject === mail['客人主旨']);
  const sentShop = isolated.box.mails.filter((item) => item.subject === mail['店內主旨']);
  assert(sentGuest.length === 1 && sentGuest[0].body === guest && sentGuest[0].to === 'hub-test@example.com', `${id} 寄出的客人信要與固定預期一致，且只一封`);
  assert(sentShop.length === 1 && sentShop[0].body === shop && sentShop[0].to === 'shop-test@example.com', `${id} 寄出的店內信要與固定預期一致，且只一封`);
}

assert(!mailById(isolated, 'SMC900101')['店內正文'].includes('ag_geo_dining'), '品牌店內信不可混入非品牌代碼');
assert(mailById(isolated, 'SMC900102')['店內正文'].includes('ag_geo_dining') && mailById(isolated, 'SMC900102')['店內正文'].includes('非品牌'), '非品牌店內信要有自己的代碼');
assert(rowById(isolated, 'SMC900105')['utm活動'] === "'=1+1" && rowById(isolated, 'SMC900105')['utm活動'] !== '2', '公式開頭要變成純文字；這不是 Google 試算表已執行過的證明');

isolated.sandbox.MailApp.sendEmail = () => { throw new Error('mail down'); };
const mailed = post(isolated, previewPayload(brandFields, 'SMC900107'));
assert(mailed.status === 'success' && mailed.orderId === 'SMC900107' && mailed.mailed === false, '寄信失敗仍要收單，並標明沒有寄出');
assert(rowById(isolated, 'SMC900107'), '寄信失敗仍要寫進表');
assert(rowById(isolated, 'SMC900107')['日期'] === '2026-10-22' && rowById(isolated, 'SMC900107')['人數'] === '2', '寄信失敗的列仍要是固定訂位欄');

const missing = post(isolated, { action: 'book', type: 'dining', name: '', phone: '0900000000', date: '2026-10-22', time: '12:00', note: NOTE });
assert(missing.status === 'error', '缺少姓名不要寫成一筆空單');
assert(!sheetRows(isolated, '訂單').slice(1).some((row) => row[0] === ''), '錯誤回應不可寫出空白編號');

isolated.props.SMC_ATTRIBUTION_ISOLATED = 'no';
const blocked = post(isolated, previewPayload(brandFields, 'SMC900108'));
assert(blocked.status === 'error' && !rowById(isolated, 'SMC900108'), '沒標成隔離時不可寫表');
assert(isolated.box.mails.every((item) => !item.subject.includes('SMC900108')), '沒標成隔離時不可寄信');

const guardIso = loadIsolated();
assert(guardIso.sandbox.formulaGuard_(' 靠窗') === ' 靠窗', '一般備註的開頭空白要保留');
assert(guardIso.sandbox.attributionText_(' 靠窗') === '靠窗', '來源欄仍去掉兩端空白');
for (const hidden of ['\u200B', '\u200C', '\u200D', '\uFEFF', '\u0000']) {
  assert(guardIso.sandbox.formulaGuard_(hidden + '=1+1') === "'=1+1", '公式前的零寬或 NUL 要先拿掉');
  assert(guardIso.sandbox.attributionText_(hidden + '=1+1') === "'=1+1", '來源欄的零寬或 NUL 要先拿掉');
}
assert(guardIso.sandbox.formulaGuard_(' \u200B=1+1') === "'=1+1", '空白加零寬仍要擋下公式');
const leads = [['空白', ' '], ['Tab', '\t'], ['換行', '\n']];
const prefixes = ['=', '+', '-', '@'];
let guardN = 0;
for (const [leadName, lead] of leads) {
  for (const prefix of prefixes) {
    guardN += 1;
    const raw = lead + prefix + '1+1';
    const quoted = "'" + prefix + '1+1';
    const id = 'SMC91' + String(1000 + guardN);
    assert(guardIso.sandbox.attributionText_(raw) === quoted, `${leadName}+${prefix} 來源要先去掉空白再加引號`);
    assert(guardIso.sandbox.formulaGuard_(raw) === quoted, `${leadName}+${prefix} 訂位文字要先去掉空白再加引號`);
    const payload = previewPayload(brandFields, id);
    payload.utmCampaign = raw;
    payload.note = raw;
    payload.name = raw;
    payload.orderItems = raw;
    const res = post(guardIso, payload);
    assert(res.status === 'success' && res.orderId === id, `${id} 空白加公式仍要收單`);
    assert(payload.note === raw && payload.utmCampaign === raw && payload.name === raw, `${id} 送出內容保持原字`);
    const row = rowById(guardIso, id);
    const mail = mailById(guardIso, id);
    assert(row['utm活動'] === quoted && row['utm活動'] !== '2' && row['utm活動'] !== prefix + '1+1', `${id} utm活動不可是未跳脫的公式`);
    assert(row['備註'] === quoted && row['姓名'] === quoted && row['品項'] === quoted, `${id} 原訂位文字在寫入前要跳脫`);
    assert(row['日期'] === '2026-10-22' && row['時間'] === '12:00' && row['人數'] === '2' && row['桌數'] === '1', `${id} 其他訂位欄不可被公式案例改掉`);
    assert(mail['客人正文'] === expectedGuest(id, quoted), `${id} 客人信備註要是跳脫後的文字`);
    assert(mail['店內正文'].includes('備註：' + quoted) && mail['店內正文'].includes('utm活動：' + quoted) && mail['店內正文'].includes('品項：' + quoted), `${id} 店內信要是跳脫後的文字`);
    assert(!mail['客人正文'].includes(raw) && !mail['店內正文'].includes(raw) && !row['備註'].includes(lead + prefix), `${id} 寫入與兩封信不可留下會變成公式的前綴`);
  }
}

function assertNoWriteNoMail(boxIsolated, label) {
  assert(boxIsolated.box.mails.length === 0, `${label} 不可寄信`);
  assert(boxIsolated.box.activeCalls.length === 0, `${label} 不可改讀目前打開的試算表`);
  assert(sheetRows(boxIsolated, '訂單').length === 0, `${label} 不可寫訂單`);
  assert(sheetRows(boxIsolated, '郵件預覽').length === 0, `${label} 不可寫郵件預覽`);
  assert(sheetRows(boxIsolated, '驗收結果').length === 0, `${label} 不可寫驗收結果`);
}

const noId = loadIsolated({ omitId: true });
const noIdRes = post(noId, previewPayload(brandFields, 'SMC900301'));
assert(noIdRes.status === 'error' && String(noIdRes.message).includes('SMC_TEST_SHEET_ID'), '沒有試算表 ID 要拒絕');
assert(noId.box.opened.length === 0, '沒有試算表 ID 時不可打開任何試算表');
assertNoWriteNoMail(noId, '沒有試算表 ID');
assert(String(noId.sandbox.runIsolatedEightCases()).includes('沒有寫入'), '沒有 ID 時 8 筆按鈕也要停住');
assert(noId.box.opened.length === 0 && noId.box.mails.length === 0, '8 筆按鈕在沒有 ID 時仍不可打開或寄信');

const foreign = loadIsolated({ sheetId: 'other-sheet' });
const foreignRes = post(foreign, previewPayload(brandFields, 'SMC900302'));
assert(foreignRes.status === 'error', '指到沒有標記的試算表要拒絕');
assert(foreign.box.opened.length === 1 && foreign.box.opened[0] === 'other-sheet', '要打開的是屬性裡那個 ID');
assert(!foreign.box.byId['other-sheet'].getSheetByName('隔離標記'), '腳本不可在錯的試算表補上標記');
assertNoWriteNoMail(foreign, '沒有標記的試算表');

const wrongMarker = loadIsolated({ marker: 'wrong' });
const wrongRes = post(wrongMarker, previewPayload(brandFields, 'SMC900303'));
assert(wrongRes.status === 'error' && String(wrongRes.message).includes('不符'), '標記不符要拒絕');
assert(wrongMarker.box.opened.length === 1, '標記不符前可以讀標記');
assertNoWriteNoMail(wrongMarker, '標記不符');
assert(String(wrongMarker.sandbox.runIsolatedEightCases()).includes('沒有寫入'), '標記不符時 8 筆按鈕也要停住');
assert(wrongMarker.box.mails.length === 0 && sheetRows(wrongMarker, '訂單').length === 0 && sheetRows(wrongMarker, '驗收結果').length === 0, '按鈕不可在標記不符時寫入或寄信');

const missingMarker = loadIsolated({ marker: 'missing' });
const missingMarkerRes = post(missingMarker, previewPayload(brandFields, 'SMC900304'));
assert(missingMarkerRes.status === 'error' && String(missingMarkerRes.message).includes('隔離標記'), '沒有標記分頁要拒絕');
assertNoWriteNoMail(missingMarker, '沒有標記分頁');

const flaggedOff = loadIsolated({ isolated: 'no' });
assert(String(flaggedOff.sandbox.runIsolatedEightCases()).includes('沒有寫入'), '沒標成隔離時按鈕不可送出');
assert(flaggedOff.box.opened.length === 0 && flaggedOff.box.mails.length === 0, '沒標成隔離時按鈕不可打開試算表或寄信');

const runner = loadIsolated();
runner.sandbox.onOpen();
assert(runner.box.menus.includes('隔離測試'), '試算表要有隔離測試選單');
assert(runner.box.menuItems.some((item) => item.title === '送出 8 筆驗收案例' && item.fn === 'runIsolatedEightCases'), '選單要指向 8 筆驗收');
const eight = runner.sandbox.isolatedEightPayloads_('shop-test@example.com');
assert(eight.length === 8, '按鈕要送 8 筆');
assert(eight[5].payload.utmCampaign === '=1+1' && eight[5].payload.note === NOTE, '第 6 筆公式在活動欄，備註仍是原句');
assert(eight[7].payload._testOrderId === 'SMC900101' && eight[7].payload.utmContent === 'ag_brand', '第 8 筆是品牌同一編號');
assert(String(runner.sandbox.runIsolatedEightCases()).includes('8'), '按鈕要回報已送出 8 筆');
const runnerOrders = sheetRows(runner, '訂單');
assert(runnerOrders.length === 8, '8 筆裡同一編號只佔一列，加上表頭是 8 列');
for (const id of ['SMC900001', 'SMC900101', 'SMC900102', 'SMC900103', 'SMC900104', 'SMC900105', 'SMC900106']) {
  assert(runnerOrders.slice(1).filter((row) => row[0] === id).length === 1, `按鈕結果應有一列 ${id}`);
}
assert(runner.box.mails.filter((item) => item.subject.includes('SMC900101')).length === 2, '同一編號只寄一輪客人信與店內信');
const resultRows = sheetRows(runner, '驗收結果');
assert(resultRows.length === 9, '驗收結果要有表頭加 8 列');
assert(resultRows[8][1] === 'SMC900101' && resultRows[8][2] === 'success' && resultRows[8][3] === '否' && resultRows[8][4] === '否', '第 8 筆不可再寫入或再寄信');
const runnerFormula = asMap(runnerOrders[0], runnerOrders.find((row) => row[0] === 'SMC900105'));
assert(runnerFormula['utm活動'] === "'=1+1" && runnerFormula['備註'] === NOTE && runnerFormula['日期'] === '2026-10-22', '按鈕送出的公式列也要是純文字，訂位欄不變');

function withoutTestId(fields) {
  const payload = attr.payloadIfAttributionEnabled(baseOrder(), fields);
  delete payload._testOrderId;
  return payload;
}
const rowsBeforeAuto = sheetRows(runner, '訂單').length;
const mailsBeforeAuto = runner.box.mails.length;
const brandNew = post(runner, withoutTestId(brandFields));
const geoNew = post(runner, withoutTestId(geoFields));
assert(brandNew.status === 'success' && brandNew.orderId === 'SMC900002', '8 筆之後的品牌新單要跳過已占用的 SMC900001');
assert(geoNew.status === 'success' && geoNew.orderId === 'SMC900003', '下一筆非品牌要再用下一個新編號');
assert(brandNew.orderId !== geoNew.orderId, '兩筆新單編號要不同');
assert(sheetRows(runner, '訂單').length === rowsBeforeAuto + 2, '8 筆之後要多兩列');
assert(rowById(runner, 'SMC900001')['來源'] === '' && rowById(runner, 'SMC900001')['utm內容'] === '', '案例 1 不可被新單改成有來源');
assert(rowById(runner, 'SMC900002')['來源'] === 'google' && rowById(runner, 'SMC900002')['utm媒介'] === 'cpc' && rowById(runner, 'SMC900002')['utm內容'] === 'ag_brand' && rowById(runner, 'SMC900002')['群組分類'] === '品牌', '新品牌列要有自己的來源');
assert(rowById(runner, 'SMC900003')['utm內容'] === 'ag_geo_dining' && rowById(runner, 'SMC900003')['群組分類'] === '非品牌', '新非品牌列要有自己的來源');
const autoMails = runner.box.mails.slice(mailsBeforeAuto);
assert(autoMails.filter((item) => item.subject.includes('SMC900002')).length === 2, '新品牌單要寄出客人信與店內信');
assert(autoMails.filter((item) => item.subject.includes('SMC900003')).length === 2, '新非品牌單要寄出客人信與店內信');
assert(sheetRows(runner, '郵件預覽').filter((row) => row[0] === 'SMC900002').length === 1, '新品牌單要有一列郵件預覽');
assert(sheetRows(runner, '郵件預覽').filter((row) => row[0] === 'SMC900003').length === 1, '新非品牌單要有一列郵件預覽');
const replayAfterAuto = post(runner, previewPayload(geoFields, 'SMC900101'));
assert(replayAfterAuto.status === 'success' && replayAfterAuto.orderId === 'SMC900101', '明示的舊編號仍回原編號');
assert(sheetRows(runner, '訂單').filter((row) => row[0] === 'SMC900101').length === 1, '明示的舊編號不可再寫一列');
assert(runner.box.mails.filter((item) => item.subject.includes('SMC900101')).length === 2, '明示的舊編號不可再寄信');

const race = loadIsolated();
let raceSecond = null;
const realRead = race.sandbox.readColumn_;
race.sandbox.readColumn_ = function (sheet, col) {
  const values = realRead(sheet, col);
  if (!raceSecond && col === 1) raceSecond = post(race, withoutTestId(brandFields));
  return values;
};
const raceFirst = post(race, withoutTestId(geoFields));
assert(raceFirst.status === 'success' && raceFirst.orderId === 'SMC900001' && raceFirst.mailed === true, '交錯取號：先進入的一筆收單');
assert(raceSecond && raceSecond.status === 'error' && !raceSecond.orderId, '交錯取號：拿不到鎖的一筆是一般錯誤，沒有訂單編號');
assert(race.box.lockDenied === 1 && race.box.lockHeld === false, '交錯取號：第二筆被拒，鎖有放開');
assert(sheetRows(race, '訂單').filter((row) => row[0] === 'SMC900001').length === 1, '交錯取號：SMC900001 只有一列');
assert(race.box.mails.length === 2, '交錯取號：只模擬寄出先進入那一筆的兩封信');
assertFlushBeforeRelease(race.box, '交錯取號');
console.log('test 交錯取號: pass');

const exhausted = loadIsolated();
const everyId = [];
for (let n = 0; n <= 999999; n += 1) everyId.push('SMC' + String(n).padStart(6, '0'));
assert(exhausted.sandbox.orderIdFor_({ action: 'book' }, everyId) === '', '編號耗盡時不回傳已被占用的編號');
const realOrderId = exhausted.sandbox.orderIdFor_;
exhausted.sandbox.orderIdFor_ = function () { return realOrderId({ action: 'book' }, everyId); };
const exhaustedRes = post(exhausted, withoutTestId(brandFields));
assert(exhaustedRes.status === 'error' && !exhaustedRes.orderId && String(exhaustedRes.message).includes('沒有收單'), '編號耗盡時明確拒絕');
assert(sheetRows(exhausted, '訂單').slice(1).length === 0 && exhausted.box.mails.length === 0, '編號耗盡時沒有訂單列也沒有寄信');
console.log('test 編號耗盡: pass');

const previewBoom = loadIsolated();
const realEnsure = previewBoom.sandbox.ensureSheet_;
previewBoom.sandbox.ensureSheet_ = function (ss, name, headers) {
  if (name === '郵件預覽') throw new Error('preview failed');
  return realEnsure(ss, name, headers);
};
const previewRes = post(previewBoom, previewPayload(brandFields, 'SMC900401'));
assert(previewRes.status === 'unknown' && previewRes.orderId === 'SMC900401' && previewRes.mailed === false, '訂單列寫入後郵件預覽失敗要回 unknown 與訂單編號');
assert(String(previewRes.message).includes('結果未知，先核對試算表、勿重送'), '未知回應要提醒勿重送');
assert(rowById(previewBoom, 'SMC900401') && rowById(previewBoom, 'SMC900401')['utm內容'] === 'ag_brand', '未知時訂單列已經寫入');
assert(sheetRows(previewBoom, '郵件預覽').length === 0 && previewBoom.box.mails.length === 0, '郵件預覽失敗時沒有預覽列也沒有寄信');
assertFlushBeforeRelease(previewBoom.box, '寫入後郵件預覽失敗');
console.log('test 寫入後郵件預覽失敗: pass');

assertFlushBeforeRelease(isolated.box, '八筆與後續新單');

const lines = [
  'case | browser source | browser content | browser bucket | live POST has source | sheet source | sheet content | sheet bucket | guest has code | shop matches expected',
];
for (const item of cases) {
  const row = rowById(isolated, item.id);
  const guest = mailById(isolated, item.id)['客人正文'];
  const shopOk = mailById(isolated, item.id)['店內正文'] === expectedShop(item.id, expectedAttr[item.id]);
  lines.push([
    item.label,
    item.fields.source,
    item.fields.utmContent || '-',
    item.fields.adgroupBucket || '-',
    'source' in livePayload(item.fields) ? 'yes' : 'no',
    row['來源'] || '-',
    row['utm內容'] || '-',
    row['群組分類'] || '-',
    GUEST_FORBIDDEN.some((token) => guest.includes(token)) ? 'yes' : 'no',
    shopOk ? 'yes' : 'no',
  ].join(' | '));
}
console.log(lines.join('\n'));

if (failures.length) {
  console.error('reconciliation failed:');
  failures.forEach((line) => console.error(' -', line));
  process.exit(1);
}
console.log('reconciliation: browser, flag-off POST, isolated sheet, guest mail, shop mail agree');
