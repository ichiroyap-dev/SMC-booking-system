#!/usr/bin/env node
// Local reconciliation only. Does not call script.google.com, send mail, or open a sheet.
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
const runbook = readFileSync(join(root, 'docs/booking-attribution-isolated-runbook.md'), 'utf8');
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

const t0 = 1700000000000;
const FIXED_TIME = '2026-10-08T00:00:00.000Z';
const BRAND_URL = '?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=ag_brand';
const GEO_URL = '?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=ag_geo_dining';
const NOTE = '散客 大人2位；靠窗';
const GUEST_FORBIDDEN = ['launch_202610', 'ag_brand', 'ag_geo_dining', 'utm_', 'gclid', 'TESTGCLID', 'direct/unknown', '有點擊識別碼', '品牌', '非品牌', '=1+1'];

function baseOrder() {
  return {
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
      getRange(row, col, numRows, numCols) {
        return {
          setNumberFormat() { return this; },
          setValues(values) {
            for (let r = 0; r < numRows; r += 1) {
              const line = data[row - 1 + r] ? data[row - 1 + r].slice() : [];
              for (let c = 0; c < numCols; c += 1) line[col - 1 + c] = values[r][c];
              data[row - 1 + r] = line;
            }
          },
          getValues() {
            const out = [];
            for (let r = 0; r < numRows; r += 1) {
              const line = data[row - 1 + r] || [];
              const slice = [];
              for (let c = 0; c < numCols; c += 1) {
                const cell = line[col - 1 + c];
                slice.push(cell == null ? '' : cell);
              }
              out.push(slice);
            }
            return out;
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

function loadIsolated() {
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
    SMC_ATTRIBUTION_ISOLATED: 'yes',
    SMC_SHOP_EMAIL: 'shop-test@example.com',
  };
  sandbox.PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(key) { return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null; },
        setProperty(key, value) { props[key] = String(value); },
      };
    },
  };
  const box = { ss: memorySpreadsheet(), mails: [] };
  sandbox.SpreadsheetApp = {
    getActive() { return box.ss; },
    openById() { return box.ss; },
  };
  sandbox.MailApp = {
    sendEmail(to, subject, body) { box.mails.push({ to, subject, body }); },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(root, 'apps-script/booking-attribution-isolated.gs'), 'utf8'), sandbox);
  sandbox.nowIso_ = () => FIXED_TIME;
  return { sandbox, props, box };
}

function post(isolated, payload) {
  const response = isolated.sandbox.doPost({ postData: { contents: JSON.stringify(payload) } });
  return JSON.parse(response.getContent());
}

function sheetRows(isolated, name) {
  const sheet = isolated.box.ss.getSheetByName(name);
  if (!sheet) return [];
  return sheet.rows();
}

function asMap(headers, row) {
  const out = {};
  headers.forEach((key, index) => { out[key] = row[index] == null ? '' : String(row[index]); });
  return out;
}

const isolated = loadIsolated();
assert(source.includes('SEND_ATTRIBUTION_TO_BACKEND = false'), '旗標必須維持 false');
assert(!html.includes('payloadIfAttributionEnabled'), '官網不可呼叫預覽送出');
assert(!html.includes('booking-attribution-isolated'), '官網不可載入隔離腳本');
assert(html.includes('script.google.com/macros/s/AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q/exec'), '正式 web app 網址不可改');
for (const phrase of ['SMC900001', 'SMC900101', 'SMC900102', 'SMC900103', 'SMC900104', 'SMC900105', 'SMC900106', 'ag_brand', 'ag_geo_dining', 'direct/unknown', '=1+1', '測試同學']) {
  assert(runbook.includes(phrase), `驗收步驟缺少 ${phrase}`);
}

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

const cases = [
  { id: 'SMC900101', label: '廣告／品牌', fields: brandFields },
  { id: 'SMC900102', label: '廣告／非品牌', fields: geoFields },
  { id: 'SMC900103', label: '非廣告', fields: directFields },
  { id: 'SMC900104', label: '來源不明', fields: unknownFields },
];

const omitted = livePayload(brandFields);
omitted._testOrderId = 'SMC900001';
assert(!('source' in omitted) && !('utmContent' in omitted) && !('gclid' in omitted), '旗標關閉的 POST 沒有來源欄');
assert(omitted.note === NOTE && omitted.type === 'dining', '旗標關閉的備註與類型維持原樣');
const omittedRes = post(isolated, omitted);
assert(omittedRes.status === 'success' && omittedRes.orderId === 'SMC900001', '缺來源仍要收單');

for (const item of cases) {
  const live = livePayload(item.fields);
  assert(JSON.stringify(Object.keys(live)) === JSON.stringify(['action', 'type', 'name', 'phone', 'email', 'people', 'tables', 'date', 'time', 'note', 'orderItems']), `${item.label} 正式 POST 仍是 11 欄`);
  assert(live.note === NOTE && !live.note.includes('ag_') && !live.note.includes('launch_'), `${item.label} 備註不可混入來源`);
  const preview = previewPayload(item.fields, item.id);
  for (const key of attr.ATTRIBUTION_KEYS) {
    assert(preview[key] === item.fields[key], `${item.label} 預覽 POST 的 ${key} 要等於瀏覽器`);
  }
  assert(preview.note === NOTE, `${item.label} 預覽 POST 的備註要等於瀏覽器訂單`);
  const bound = attr.readOrderAttribution(ledger, item.id);
  assert(bound && bound.source === item.fields.source && bound.utmContent === item.fields.utmContent && bound.gclid === item.fields.gclid, `${item.label} 訂單快照要等於瀏覽器`);
  const res = post(isolated, preview);
  assert(res.status === 'success' && res.orderId === item.id, `${item.label} 隔離腳本要回同一個編號`);
}

const formula = previewPayload(brandFields, 'SMC900105');
formula.utmCampaign = '=1+1';
const formulaRes = post(isolated, formula);
assert(formulaRes.status === 'success' && formulaRes.orderId === 'SMC900105', '公式開頭仍要收單');

const malformed = Object.assign(previewPayload(directFields, 'SMC900106'), {
  source: { bad: true },
  utmContent: ['ag_brand'],
  adgroupBucket: '品牌<script>',
  gclid: 12345,
});
const malformedRes = post(isolated, malformed);
assert(malformedRes.status === 'success' && malformedRes.orderId === 'SMC900106', '格式壞掉仍要收單');

const beforeDup = sheetRows(isolated, '訂單').length;
const beforeMail = sheetRows(isolated, '郵件預覽').length;
const dup = post(isolated, previewPayload(geoFields, 'SMC900101'));
assert(dup.status === 'success' && dup.orderId === 'SMC900101', '同一編號再送仍回成功');
assert(sheetRows(isolated, '訂單').length === beforeDup, '同一編號不可再寫一列');
assert(sheetRows(isolated, '郵件預覽').length === beforeMail, '同一編號不可再寫一封預覽');

const orders = sheetRows(isolated, '訂單');
const mails = sheetRows(isolated, '郵件預覽');
const headers = orders[0];
const mailHeaders = mails[0];
const byId = {};
for (const row of orders.slice(1)) byId[row[0]] = asMap(headers, row);
const mailById = {};
for (const row of mails.slice(1)) mailById[row[0]] = asMap(mailHeaders, row);

assert(byId.SMC900001['備註'] === NOTE && byId.SMC900001['來源'] === '' && byId.SMC900001['utm內容'] === '' && byId.SMC900001['群組分類'] === '', '缺來源時表上的來源欄要空白，備註不變');
assert(byId.SMC900101['utm內容'] === 'ag_brand' && byId.SMC900101['群組分類'] === '品牌' && byId.SMC900101['來源'] === 'google', '品牌列不可被後續訂單改掉');
assert(byId.SMC900102['utm內容'] === 'ag_geo_dining' && byId.SMC900102['群組分類'] === '非品牌' && byId.SMC900102['來源'] === 'google', '非品牌列要是 ag_geo_dining');
assert(byId.SMC900103['來源'] === 'direct/unknown' && byId.SMC900103['群組分類'] === '' && byId.SMC900103['點擊識別碼'] === '', '非廣告不可記成 google');
assert(byId.SMC900104['來源'] === '有點擊識別碼、來源待核對' && byId.SMC900104['點擊識別碼'] === 'TESTGCLID9000' && byId.SMC900104['utm來源'] === '', '來源不明要另列，不可混進廣告或 direct');
assert(byId.SMC900105['utm活動'].indexOf('=1+1') !== -1 && byId.SMC900105['utm活動'] !== '2' && byId.SMC900105['utm活動'].charAt(0) === "'", '公式開頭要變成純文字');
assert(byId.SMC900106['來源'] === '' && byId.SMC900106['utm內容'] === '' && byId.SMC900106['群組分類'] === '' && byId.SMC900106['點擊識別碼'] === '', '壞掉的來源要空白');
assert(byId.SMC900106['備註'] === NOTE && byId.SMC900101['備註'] === NOTE, '壞來源與廣告列的備註都要維持原句');

for (const id of Object.keys(byId)) {
  const row = byId[id];
  const mail = mailById[id];
  assert(mail && mail['訂單編號'] === id, `${id} 郵件預覽要有同一編號`);
  assert(row['收到時間'] === FIXED_TIME, `${id} 收到時間要寫入`);
  assert(row['姓名'] === '測試同學' && row['電話'] === '0900000000' && row['類型'] === 'dining', `${id} 原訂位欄要在`);
  assert(mail['客人正文'].includes('訂單編號：' + id) && mail['客人正文'].includes('備註：' + NOTE), `${id} 客人信要有編號與備註`);
  assert(mail['店內正文'].includes('訂單編號：' + id) && mail['店內正文'].includes('備註：' + NOTE), `${id} 店內信要有編號與備註`);
  assert(mail['店內正文'].includes('來源：' + row['來源']), `${id} 店內信來源要等於表`);
  assert(mail['店內正文'].includes('utm內容：' + row['utm內容']), `${id} 店內信 utm內容要等於表`);
  assert(mail['店內正文'].includes('群組分類：' + row['群組分類']), `${id} 店內信分類要等於表`);
  assert(mail['店內正文'].includes('點擊識別碼：' + row['點擊識別碼']), `${id} 店內信識別碼要等於表`);
  for (const token of GUEST_FORBIDDEN) {
    assert(!mail['客人正文'].includes(token), `${id} 客人信不可出現 ${token}`);
  }
  const sentGuest = isolated.box.mails.filter((item) => item.subject.includes(id) && item.subject.startsWith('水美土雞城'));
  const sentShop = isolated.box.mails.filter((item) => item.subject === '【店內對帳】預約 ' + id);
  assert(sentGuest.length === 1 && sentGuest[0].body === mail['客人正文'], `${id} 寄出的客人信要與預覽一致，且只一封`);
  assert(sentShop.length === 1 && sentShop[0].body === mail['店內正文'], `${id} 寄出的店內信要與預覽一致，且只一封`);
}

assert(!mailById.SMC900101['店內正文'].includes('ag_geo_dining'), '品牌店內信不可混入非品牌代碼');
assert(mailById.SMC900102['店內正文'].includes('ag_geo_dining') && mailById.SMC900102['店內正文'].includes('非品牌'), '非品牌店內信要有自己的代碼');
assert(mailById.SMC900105['店內正文'].includes("'=1+1") && !mailById.SMC900105['客人正文'].includes('=1+1'), '公式只留在店內信');

isolated.sandbox.MailApp.sendEmail = () => { throw new Error('mail down'); };
const mailed = post(isolated, previewPayload(brandFields, 'SMC900107'));
assert(mailed.status === 'success' && mailed.orderId === 'SMC900107', '寄信失敗仍要收單');
assert(byIdSafe(sheetRows(isolated, '訂單'), 'SMC900107'), '寄信失敗仍要寫進表');

function byIdSafe(rows, id) {
  return rows.slice(1).some((row) => row[0] === id);
}

const missing = post(isolated, { action: 'book', type: 'dining', name: '', phone: '0900000000', date: '2026-10-22', time: '12:00', note: NOTE });
assert(missing.status === 'error', '缺少姓名不要寫成一筆空單');
assert(!byIdSafe(sheetRows(isolated, '訂單'), ''), '錯誤回應不可寫出空白編號');

isolated.props.SMC_ATTRIBUTION_ISOLATED = 'no';
const blocked = post(isolated, previewPayload(brandFields, 'SMC900108'));
assert(blocked.status === 'error' && !byIdSafe(sheetRows(isolated, '訂單'), 'SMC900108'), '沒標成隔離時不可寫表');

const lines = [
  'case | browser source | browser content | browser bucket | live POST has source | sheet source | sheet content | sheet bucket | guest has code | shop matches sheet',
];
for (const item of cases) {
  const row = byId[item.id];
  const guest = mailById[item.id]['客人正文'];
  const shopOk = mailById[item.id]['店內正文'].includes('來源：' + row['來源']) && mailById[item.id]['店內正文'].includes('utm內容：' + row['utm內容']);
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
