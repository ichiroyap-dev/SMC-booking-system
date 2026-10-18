#!/usr/bin/env node
// Isolated end-to-end mock.
// Page submit -> Apps Script order id -> sheet write -> flush -> read-back -> mock mail.
// Does not deploy Apps Script, open a Google Sheet, send mail, or call script.google.com.
// Usage: node tools/test-isolated-e2e.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const attr = require(join(root, 'js/booking-attribution.js'));
const unpublished = '.github/pages-unpublished';
const gsPath = join(root, unpublished, 'booking-attribution-isolated.gs');
const pagePath = join(root, unpublished, 'isolated-dining-check.html');
const guardPath = join(root, unpublished, 'isolated-check-guard.js');
const gs = readFileSync(gsPath, 'utf8');
const pageHtml = readFileSync(pagePath, 'utf8');
const guardSource = readFileSync(guardPath, 'utf8');
const attributionSource = readFileSync(join(root, 'js/booking-attribution.js'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

const LIVE_ID = 'AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q';
const ISOLATED_URL = 'https://script.google.com/macros/s/ISOLATEDTEST/exec';
const LIVE_URL = 'https://script.google.com/macros/s/' + LIVE_ID + '/exec';
const FIXED_TIME = '2026-10-08T00:00:00.000Z';
const NOTE = '散客 大人2位；靠窗';
const BRAND_QUERY = '?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=ag_brand';
const GCLID_QUERY = BRAND_QUERY + '&utm_term=family-table&utm_adgroup=brand&gclid=TESTGCLID9000';
const BRAND_ASSIGN = BRAND_QUERY + '#booking-section';
const ORDER_HEADERS = [
  '訂單編號', '收到時間', '動作', '類型', '姓名', '電話', '信箱', '人數', '桌數', '日期', '時間', '備註', '品項',
  '來源', 'utm來源', 'utm媒介', 'utm活動', 'utm內容', 'utm關鍵字', 'utm廣告群組', '群組分類', '點擊識別碼',
];
const LIVE_POST_KEYS = ['action', 'type', 'name', 'phone', 'email', 'people', 'tables', 'date', 'time', 'note', 'orderItems'];
const GUEST_CODES = ['launch_202610', 'ag_brand', 'ag_geo_dining', 'TESTGCLID9000', 'direct/unknown', 'family-table'];

function memoryStore() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(String(key), String(value)); },
    removeItem(key) { data.delete(key); },
  };
}

function memorySpreadsheet(box) {
  const sheets = {};
  function make(name) {
    const data = [];
    return {
      name,
      getLastRow() { return data.length; },
      appendRow(row) { data.push(row.slice()); },
      clear() { data.length = 0; },
      getRange(row, col, numRows, numCols) {
        const rowsN = numRows == null ? 1 : numRows;
        const colsN = numCols == null ? 1 : numCols;
        const meta = { name, row, col, numRows: rowsN, numCols: colsN };
        return {
          setNumberFormat() { return this; },
          setValues(values) {
            box.writes.push({ name, row, col, numRows: rowsN, numCols: colsN, lockHeld: box.lockHeld, afterFlush: box.flushed });
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
            const confirmRead = name === '訂單' && box.flushed && colsN >= ORDER_HEADERS.length;
            if (confirmRead) {
              box.lockLog.push(box.lockHeld ? 'readback-held' : 'readback-free');
              box.readbacks.push({ lockHeld: box.lockHeld, rowCount: out.length });
              if (box.failReadAfterFlush === 'throw') throw new Error('readback failed');
              if (box.failReadAfterFlush === 'mismatch') {
                return out.map((line) => {
                  const copy = line.slice();
                  copy[0] = 'SMC000000';
                  return copy;
                });
              }
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
      sheets[name] = make(name);
      return sheets[name];
    },
  };
}

function loadIsolated(options = {}) {
  const box = {
    byId: {},
    mails: [],
    opened: [],
    lockHeld: false,
    lockLog: [],
    writes: [],
    readbacks: [],
    flushed: false,
    failReadAfterFlush: options.failReadAfterFlush || '',
    partialShopMail: options.partialShopMail === true,
    doPosts: 0,
  };
  const props = {
    SMC_ATTRIBUTION_ISOLATED: 'yes',
    SMC_SHOP_EMAIL: 'shop-test@example.com',
    SMC_TEST_SHEET_ID: options.sheetId || 'isolated-e2e-sheet',
  };
  const marked = memorySpreadsheet(box);
  const marker = marked.insertSheet('隔離標記');
  marker.appendRow(['SMC-ISOLATED-TEST']);
  box.byId[props.SMC_TEST_SHEET_ID] = marked;
  const sandbox = {
    console,
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        return { setMimeType() { return this; }, getContent() { return text; } };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) { return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null; },
          setProperty(key, value) { props[key] = String(value); },
        };
      },
    },
    SpreadsheetApp: {
      openById(id) {
        box.opened.push(id);
        if (!box.byId[id]) box.byId[id] = memorySpreadsheet(box);
        return box.byId[id];
      },
      flush() {
        box.flushed = true;
        box.lockLog.push(box.lockHeld ? 'flush-held' : 'flush-free');
      },
      getUi() {
        return { alert() {}, createMenu() { return { addItem() { return this; }, addToUi() {} }; } };
      },
    },
    MailApp: {
      sendEmail(to, subject, body) {
        if (box.partialShopMail && String(subject).includes('店內對帳')) {
          throw new Error('shop mail down');
        }
        box.mails.push({ to, subject, body });
        box.lockLog.push(box.lockHeld ? 'mail-held' : 'mail-free');
      },
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() {
            if (box.lockHeld) return false;
            box.lockHeld = true;
            box.lockLog.push('lock');
            return true;
          },
          releaseLock() {
            box.lockLog.push('release');
            box.lockHeld = false;
          },
        };
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(gs, sandbox, { filename: 'booking-attribution-isolated.gs' });
  sandbox.nowIso_ = () => FIXED_TIME;
  return { sandbox, props, box };
}

function element(id, value) {
  const node = {
    id,
    value: value == null ? '' : String(value),
    textContent: '',
    hidden: false,
    className: '',
    disabled: false,
    listeners: {},
    addEventListener(type, fn) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(fn);
    },
    dispatch(type, event) {
      for (const fn of this.listeners[type] || []) fn(event);
    },
  };
  return node;
}

function inlinePageScript(html) {
  const marker = '<script src="../../js/booking-attribution.js"></script>';
  const at = html.indexOf(marker);
  const start = html.indexOf('<script>', at);
  const end = html.indexOf('</script>', start);
  if (at < 0 || start < 0 || end < 0) throw new Error('找不到驗收頁內嵌腳本');
  return html.slice(start + '<script>'.length, end);
}

function makeLocks() {
  let chain = Promise.resolve();
  return {
    request(_name, callback) {
      const run = chain.then(() => callback());
      chain = run.then(() => {}, () => {});
      return run;
    },
  };
}

function bootPage(isolated, options = {}) {
  const elements = {};
  const defaults = {
    name: '測試同學',
    phone: '0900000000',
    email: 'test@example.com',
    people: '2',
    tables: '1',
    date: '2026-10-22',
    time: '12:00',
    note: NOTE,
  };
  for (const id of [
    'use-brand', 'use-geo', 'mode-value', 'source-value', 'content-value', 'bucket-value',
    'booking-form', 'endpoint', 'block-reason', 'submit', 'ack-sheet', 'payload-preview', 'result',
    'name', 'phone', 'email', 'people', 'tables', 'date', 'time', 'note',
  ]) {
    elements[id] = element(id, defaults[id]);
  }
  elements['block-reason'].hidden = true;
  elements['ack-sheet'].hidden = true;
  const document = {
    getElementById(id) { return elements[id] || null; },
    addEventListener() {},
  };
  const location = {
    href: 'http://127.0.0.1:8765/.github/pages-unpublished/isolated-dining-check.html',
    search: options.search || '',
    hash: options.hash || '',
    assigned: '',
    assign(next) { this.assigned = String(next); },
  };
  const fetches = [];
  const sandbox = {
    console,
    document,
    location,
    navigator: { locks: makeLocks() },
    sessionStorage: memoryStore(),
    localStorage: memoryStore(),
    performance: {
      getEntriesByType(type) {
        return type === 'navigation' ? [{ type: 'navigate' }] : [];
      },
    },
    AbortController,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    fetch(url, init) {
      const request = { url: String(url), body: init && init.body ? String(init.body) : '', method: init && init.method };
      if (typeof options.rewriteBody === 'function') request.body = options.rewriteBody(request.body);
      fetches.push(request);
      if (options.hang) return new Promise(() => {});
      isolated.box.doPosts += 1;
      const response = isolated.sandbox.doPost({ postData: { contents: request.body } });
      request.responseText = response.getContent();
      return Promise.resolve({
        status: 200,
        type: 'basic',
        text() { return Promise.resolve(request.responseText); },
      });
    },
  };
  vm.createContext(sandbox);
  vm.runInContext('window = globalThis; window.addEventListener = function () {};', sandbox);
  vm.runInContext(guardSource, sandbox, { filename: 'isolated-check-guard.js' });
  vm.runInContext(attributionSource, sandbox, { filename: 'booking-attribution.js' });
  if (options.timeoutMs) sandbox.SmcIsolatedCheck.SUBMIT_TIMEOUT_MS = options.timeoutMs;
  vm.runInContext(inlinePageScript(pageHtml), sandbox, { filename: 'isolated-dining-check.html' });
  return { sandbox, elements, fetches, isolated, location };
}

async function waitFor(fn, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

function setEndpoint(page, url) {
  page.elements.endpoint.value = url;
  page.elements.endpoint.dispatch('input', {});
}

async function submitPage(page) {
  page.elements['booking-form'].dispatch('submit', { preventDefault() {} });
  const done = await waitFor(() => {
    const text = page.elements.result.textContent;
    return !!text && text !== '送出中…';
  }, 400);
  return done;
}

function sheetRows(isolated, name) {
  const ss = isolated.box.byId[isolated.props.SMC_TEST_SHEET_ID];
  if (!ss) return [];
  const sheet = ss.getSheetByName(name);
  return sheet ? sheet.rows() : [];
}

function rowById(isolated, id) {
  const rows = sheetRows(isolated, '訂單');
  if (!rows.length) return null;
  const found = rows.slice(1).find((row) => row[0] === id);
  if (!found) return null;
  const out = {};
  rows[0].forEach((key, index) => { out[key] = found[index] == null ? '' : String(found[index]); });
  return out;
}

function oneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function flowLine(box, from) {
  return box.lockLog.slice(from || 0).join(' -> ') || '(沒有後端事件)';
}

function productionChecks() {
  assert(attributionSource.includes('SEND_ATTRIBUTION_TO_BACKEND = false'), 'SEND_ATTRIBUTION_TO_BACKEND 必須維持 false');
  assert(!/SEND_ATTRIBUTION_TO_BACKEND\s*=\s*true/.test(attributionSource), '原始碼不可把旗標設成 true');
  assert(attr.attributionSendingEnabled() === false, '執行中的旗標必須是關閉');
  const store = attr.memoryStorage();
  attr.capture(GCLID_QUERY, store, 1700000000000, 'navigate');
  const fields = attr.bookingFields(store, 1700000000000);
  const live = attr.payloadForBooking({
    action: 'book', type: 'dining', name: '測試同學', phone: '0900000000', email: 'test@example.com',
    people: '2', tables: '1', date: '2026-10-22', time: '12:00', note: NOTE, orderItems: '',
  }, fields);
  assert(JSON.stringify(Object.keys(live)) === JSON.stringify(LIVE_POST_KEYS), '正式 payloadForBooking 必須是 11 欄');
  for (const key of attr.ATTRIBUTION_KEYS) assert(!(key in live), `正式 POST 不可含 ${key}`);
  const dataAt = indexHtml.indexOf('const data = {');
  const dataEnd = indexHtml.indexOf('};', dataAt);
  const dataBlock = indexHtml.slice(dataAt, dataEnd);
  const dataKeys = [...dataBlock.matchAll(/\n\s+([A-Za-z]+):/g)].map((match) => match[1]);
  assert(JSON.stringify(dataKeys) === JSON.stringify(LIVE_POST_KEYS), '官網訂位物件必須維持 11 欄');
  const ids = [...indexHtml.matchAll(/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
  assert(ids.length === 1 && ids[0] === LIVE_ID, '官網部署編號必須維持原值，且只有一處');
  assert(indexHtml.includes(LIVE_URL), '官網 web app 網址不可改');
  assert(guardSource.includes("'" + LIVE_ID + "'"), '驗收 guard 拒絕的正式編號不可改');
  assert(!gs.includes(LIVE_ID), '隔離腳本不可寫入正式部署編號');
  assert(!indexHtml.includes('payloadIfAttributionEnabled'), '官網不可走隔離預覽送出');
  assert(!indexHtml.includes('isolated-dining-check'), '官網不可連到隔離驗收頁');
  console.log('test 正式環境未改: ' + (failures.length ? 'FAIL' : 'pass'));
  console.log('prod SEND_ATTRIBUTION_TO_BACKEND=false liveKeys=' + Object.keys(live).length + ' deployment=' + (ids[0] || '-'));
}

async function liveEndpointBlocked() {
  const before = failures.length;
  const isolated = loadIsolated({ sheetId: 'blocked-sheet' });
  const page = bootPage(isolated, { search: BRAND_QUERY });
  setEndpoint(page, LIVE_URL);
  assert(page.elements.submit.disabled === true, '貼上正式 web app 時按鈕要停住');
  await submitPage(page);
  assert(page.fetches.length === 0 && isolated.box.doPosts === 0, '正式部署不可被送出');
  assert(page.elements.result.textContent.includes('正式 web app'), '停住原因要寫明這是正式 web app');
  assert(sheetRows(isolated, '訂單').length === 0 && isolated.box.mails.length === 0, '擋下正式網址時不可寫表或寄信');
  console.log('test 正式網址停住: ' + (failures.length === before ? 'pass' : 'FAIL'));
}

function assertReadbackBeforeMail(box, label, from) {
  const events = box.lockLog.slice(from || 0);
  const flushAt = events.indexOf('flush-held');
  const readAt = events.indexOf('readback-held');
  const releaseAt = events.indexOf('release');
  const mailAt = events.indexOf('mail-free');
  assert(flushAt >= 0 && readAt > flushAt && releaseAt > readAt, `${label}：flush 之後、放鎖之前要讀回訂單列`);
  assert(mailAt > releaseAt, `${label}：讀回確認並放鎖之後才可寄信`);
  assert(!events.includes('readback-free') && !events.includes('mail-held') && !events.includes('flush-free'), `${label}：讀回與 flush 要在鎖內，寄信要在鎖外`);
}

function assertSourceMatches(row, expected, label) {
  assert(row['訂單編號'] === expected.orderId, `${label}：表格訂單編號要等於回應`);
  for (const [column, value] of Object.entries(expected.columns)) {
    assert(row[column] === value, `${label}：表格${column}應為 ${value}，實際 ${row[column]}`);
  }
  assert(row['姓名'] === '測試同學' && row['電話'] === '0900000000' && row['備註'] === NOTE, `${label}：訂位欄仍是假資料`);
  assert(row['收到時間'] === FIXED_TIME, `${label}：收到時間要寫入`);
}

function assertMails(isolated, orderId, shopNeeds, label) {
  const guest = isolated.box.mails.filter((item) => item.subject.includes(orderId) && !item.subject.includes('店內對帳'));
  const shop = isolated.box.mails.filter((item) => item.subject.includes('店內對帳') && item.subject.includes(orderId));
  assert(guest.length === 1 && guest[0].to === 'test@example.com' && guest[0].body.includes('訂單編號：' + orderId), `${label}：客人信要有同一個編號`);
  assert(shop.length === 1 && shop[0].to === 'shop-test@example.com' && shop[0].body.includes('訂單編號：' + orderId), `${label}：店內信要有同一個編號`);
  for (const token of GUEST_CODES) assert(!guest[0] || !guest[0].body.includes(token), `${label}：客人信不可出現 ${token}`);
  for (const token of shopNeeds) assert(shop[0] && shop[0].body.includes(token), `${label}：店內信要有 ${token}`);
}

async function successFlow() {
  const before = failures.length;
  const isolated = loadIsolated({ sheetId: 'success-sheet' });
  const brandPage = bootPage(isolated, { search: '?mode=dining' });
  brandPage.elements['use-brand'].dispatch('click', {});
  assert(brandPage.location.assigned === BRAND_ASSIGN, '帶入品牌最終網址要導向 runbook 的品牌網址');
  const reloaded = bootPage(isolated, { search: BRAND_QUERY, hash: '#booking-section' });
  assert(reloaded.elements['source-value'].textContent === 'google', '驗收頁要顯示來源 google');
  assert(reloaded.elements['content-value'].textContent === 'ag_brand', '驗收頁要顯示 utm內容 ag_brand');
  assert(reloaded.elements['bucket-value'].textContent === '品牌', '驗收頁要顯示群組分類 品牌');
  assert(reloaded.elements['mode-value'].textContent.includes('內用'), '驗收頁要停在內用');
  setEndpoint(reloaded, ISOLATED_URL);
  assert(reloaded.elements.submit.disabled === false, '隔離測試網址可以送出');
  const preview = JSON.parse(reloaded.elements['payload-preview'].textContent);
  assert(preview.utmContent === 'ag_brand' && preview.adgroupBucket === '品牌' && preview.gclid === '', '預覽內容要帶品牌來源且沒有 gclid');
  assert(await submitPage(reloaded), '品牌單要等到回應');
  const posted = JSON.parse(reloaded.fetches[0].body);
  assert(posted.utmSource === 'google' && posted.utmMedium === 'cpc' && posted.utmCampaign === 'launch_202610' && posted.utmContent === 'ag_brand', '送出的內容要含 utm 參數');
  assert(!('_testOrderId' in posted), '驗收頁不會指定測試編號，要由隔離腳本取號');
  const brandResponse = JSON.parse(reloaded.fetches[0].responseText);
  assert(brandResponse.status === 'success' && /^SMC[0-9]{6}$/.test(brandResponse.orderId), '品牌單要成功並取到編號');
  assert(!('note' in brandResponse), '回應沒有備註');
  const brandFrom = 0;
  assertReadbackBeforeMail(isolated.box, '品牌單', brandFrom);
  const brandRow = rowById(isolated, brandResponse.orderId);
  assert(brandRow, '品牌單要寫進訂單分頁');
  if (brandRow) {
    assertSourceMatches(brandRow, {
      orderId: brandResponse.orderId,
      columns: {
        來源: 'google', utm來源: 'google', utm媒介: 'cpc', utm活動: 'launch_202610', utm內容: 'ag_brand',
        utm關鍵字: '', utm廣告群組: '', 群組分類: '品牌', 點擊識別碼: '',
      },
    }, '品牌單');
  }
  assertMails(isolated, brandResponse.orderId, ['ag_brand', '品牌', 'launch_202610'], '品牌單');
  assert(reloaded.elements.result.className === 'ok' && reloaded.elements.result.textContent.includes(brandResponse.orderId), '驗收頁成功時要顯示同一個編號');
  assert(reloaded.elements.result.textContent.includes('已寄出'), '兩封都模擬寄出時頁面寫已寄出');

  const gclidFrom = isolated.box.lockLog.length;
  const gclidPage = bootPage(isolated, { search: GCLID_QUERY });
  assert(gclidPage.elements['content-value'].textContent === 'ag_brand', '含 gclid 的進站仍顯示 utm內容');
  assert(gclidPage.elements['bucket-value'].textContent === '品牌', '有 utm_adgroup=brand 時群組分類是品牌');
  setEndpoint(gclidPage, ISOLATED_URL);
  assert(await submitPage(gclidPage), 'gclid 單要等到回應');
  const gclidPosted = JSON.parse(gclidPage.fetches[0].body);
  assert(gclidPosted.gclid === 'TESTGCLID9000' && gclidPosted.utmTerm === 'family-table' && gclidPosted.utmAdgroup === 'brand', '送出內容要含 gclid 與其餘 utm');
  const gclidResponse = JSON.parse(gclidPage.fetches[0].responseText);
  assert(gclidResponse.status === 'success' && gclidResponse.orderId !== brandResponse.orderId, 'gclid 單要是另一個新編號');
  assertReadbackBeforeMail(isolated.box, 'gclid 單', gclidFrom);
  const gclidRow = rowById(isolated, gclidResponse.orderId);
  const brandStill = rowById(isolated, brandResponse.orderId);
  if (gclidRow) {
    assertSourceMatches(gclidRow, {
      orderId: gclidResponse.orderId,
      columns: {
        來源: 'google', utm來源: 'google', utm媒介: 'cpc', utm活動: 'launch_202610', utm內容: 'ag_brand',
        utm關鍵字: 'family-table', utm廣告群組: 'brand', 群組分類: '品牌', 點擊識別碼: 'TESTGCLID9000',
      },
    }, 'gclid 單');
  }
  assert(brandStill && brandStill['點擊識別碼'] === '' && brandStill['utm內容'] === 'ag_brand', '後一筆不可改掉前一筆的來源');
  assertMails(isolated, gclidResponse.orderId, ['TESTGCLID9000', 'family-table', 'utm廣告群組：brand'], 'gclid 單');
  assert(isolated.box.opened.every((id) => id === 'success-sheet'), '只打開記憶體裡的測試表');
  assert(reloaded.fetches.concat(gclidPage.fetches).every((item) => item.url === ISOLATED_URL), '網路請求只進隔離測試 exec');
  console.log('flow 成功: ' + flowLine(isolated.box));
  console.log('sheet 品牌 ' + (brandResponse.orderId || '-') + ' gclid=' + (brandRow ? brandRow['點擊識別碼'] : '-') + ' utm內容=' + (brandRow ? brandRow['utm內容'] : '-'));
  console.log('sheet gclid ' + (gclidResponse.orderId || '-') + ' gclid=' + (gclidRow ? gclidRow['點擊識別碼'] : '-') + ' utm關鍵字=' + (gclidRow ? gclidRow['utm關鍵字'] : '-'));
  console.log('ui 成功: ' + reloaded.elements.result.className + ' | ' + oneLine(reloaded.elements.result.textContent));
  console.log('test 成功: ' + (failures.length === before ? 'pass' : 'FAIL'));
  console.log('mail 成功: mocked ' + isolated.box.mails.length + '（沒有實際寄出）');
}

function responseText(page) {
  const last = page.fetches[page.fetches.length - 1];
  return last && last.responseText ? last.responseText : '';
}

async function unknownFlow() {
  const before = failures.length;
  const isolated = loadIsolated({ sheetId: 'unknown-sheet', failReadAfterFlush: 'mismatch' });
  const page = bootPage(isolated, { search: GCLID_QUERY });
  setEndpoint(page, ISOLATED_URL);
  assert(await submitPage(page), '結果未知案例要等到回應');
  const response = JSON.parse(responseText(page));
  assert(response.status === 'unknown' && response.mailed === false, '讀回對不上要回 unknown，且不可宣稱已寄信');
  assert(String(response.message).includes('結果未知，先核對試算表、勿重送'), '結果未知要提醒勿重送');
  assert(isolated.box.lockLog.includes('readback-held'), '結果未知之前要真的讀過訂單列');
  assert(!isolated.box.lockLog.includes('mail-free') && isolated.box.mails.length === 0, '讀回失敗不可寄信');
  const rows = sheetRows(isolated, '訂單').slice(1);
  assert(rows.length === 1 && rows[0][0] === response.orderId, '讀回失敗前寫入的編號要留在表上，並與回應相同');
  const row = rowById(isolated, response.orderId);
  assert(row && row['點擊識別碼'] === 'TESTGCLID9000' && row['utm活動'] === 'launch_202610', '未知結果的那一列仍要留著來源欄');
  assert(page.elements.result.className === 'warn' && page.elements.result.textContent.includes('勿重送') && page.elements.result.textContent.includes(response.orderId), '驗收頁要把未知結果和編號一起顯示');
  assert(page.elements.submit.disabled === true, '結果未知後按鈕停住');
  console.log('flow 結果未知: ' + flowLine(isolated.box));
  console.log('ui 結果未知: ' + page.elements.result.className + ' | ' + oneLine(page.elements.result.textContent));
  console.log('test 結果未知: ' + (failures.length === before ? 'pass' : 'FAIL'));
}

async function duplicateFlow() {
  const before = failures.length;
  const isolated = loadIsolated({ sheetId: 'duplicate-sheet' });
  const first = bootPage(isolated, { search: BRAND_QUERY });
  setEndpoint(first, ISOLATED_URL);
  assert(await submitPage(first), '第一筆要等到回應');
  const firstBody = JSON.parse(responseText(first));
  assertReadbackBeforeMail(isolated.box, '重複編號的第一筆', 0);
  const from = isolated.box.lockLog.length;
  const mailsAfterFirst = isolated.box.mails.length;
  const second = bootPage(isolated, {
    search: BRAND_QUERY,
    rewriteBody(body) {
      const payload = JSON.parse(body);
      payload._testOrderId = firstBody.orderId;
      return JSON.stringify(payload);
    },
  });
  setEndpoint(second, ISOLATED_URL);
  assert(await submitPage(second), '重複編號要等到回應');
  const secondBody = JSON.parse(responseText(second));
  assert(secondBody.status === 'success' && secondBody.orderId === firstBody.orderId && secondBody.duplicate === true && secondBody.wrote === false, '重複編號要明示沒有新增');
  assert(String(secondBody.message).includes('沒有新增'), '重複編號的訊息要寫沒有新增');
  assert(sheetRows(isolated, '訂單').filter((row) => row[0] === firstBody.orderId).length === 1, '同一編號只能有一列');
  assert(isolated.box.mails.length === mailsAfterFirst, '重複編號不可再寄信');
  assert(!isolated.box.lockLog.slice(from).includes('flush-held') && !isolated.box.lockLog.slice(from).includes('mail-free'), '重複編號不可再 flush 或再寄信');
  assert(second.elements.result.className !== 'ok' && second.elements.result.textContent.includes('沒有新增'), '驗收頁不可把重複編號畫成綠色成功');
  const row = rowById(isolated, firstBody.orderId);
  assert(row && row['utm內容'] === 'ag_brand' && row['群組分類'] === '品牌', '原列的來源要維持不變');
  console.log('flow 重複編號: ' + flowLine(isolated.box, from));
  console.log('ui 重複編號: ' + second.elements.result.className + ' | ' + oneLine(second.elements.result.textContent));
  console.log('test 重複編號: ' + (failures.length === before ? 'pass' : 'FAIL'));
}

async function timeoutFlow() {
  const before = failures.length;
  const isolated = loadIsolated({ sheetId: 'timeout-sheet' });
  const page = bootPage(isolated, { search: BRAND_QUERY, hang: true, timeoutMs: 30 });
  setEndpoint(page, ISOLATED_URL);
  assert(await submitPage(page), '逾時後頁面要停在結果未知');
  assert(page.fetches.length === 1 && page.fetches[0].url === ISOLATED_URL, '逾時前只嘗試隔離網址');
  assert(isolated.box.doPosts === 0 && isolated.box.mails.length === 0 && sheetRows(isolated, '訂單').length === 0, '沒有回應的請求不可寫表或寄信');
  assert(page.elements.result.className === 'warn' && page.elements.result.textContent.includes('結果未知，先核對試算表、勿重送'), '逾時要顯示結果未知');
  assert(page.elements.result.className !== 'ok', '逾時不可畫成成功');
  assert(page.elements.submit.disabled === true && page.elements['ack-sheet'].hidden === false, '逾時後按鈕停住，要先核對才可再送');
  console.log('flow 逾時: fetch hung -> page unknown（後端未被呼叫）');
  console.log('ui 逾時: ' + page.elements.result.className + ' | ' + oneLine(page.elements.result.textContent));
  console.log('test 逾時: ' + (failures.length === before ? 'pass' : 'FAIL'));
}

async function partialMailFlow() {
  const before = failures.length;
  const isolated = loadIsolated({ sheetId: 'partial-sheet', partialShopMail: true });
  const page = bootPage(isolated, { search: GCLID_QUERY });
  setEndpoint(page, ISOLATED_URL);
  assert(await submitPage(page), '部分寄信失敗要等到回應');
  const response = JSON.parse(responseText(page));
  assert(response.status === 'success' && response.mailed === false && response.orderId, '店內信失敗仍要收單，並標明沒有全部寄出');
  assertReadbackBeforeMail(isolated.box, '部分寄信', 0);
  const guest = isolated.box.mails.filter((item) => item.to === 'test@example.com');
  const shop = isolated.box.mails.filter((item) => item.to === 'shop-test@example.com');
  assert(guest.length === 1 && guest[0].body.includes(response.orderId), '客人信已模擬寄出，編號相同');
  assert(shop.length === 0, '店內信這次沒有寄出');
  const row = rowById(isolated, response.orderId);
  assert(row && row['點擊識別碼'] === 'TESTGCLID9000' && row['訂單編號'] === response.orderId, '部分寄信失敗時表格仍留著 gclid 與同一個編號');
  assert(page.elements.result.className === 'ok' && page.elements.result.textContent.includes('未全部寄出'), '頁面要寫未全部寄出，而不是已寄出');
  console.log('flow 寄信部分失敗: ' + flowLine(isolated.box));
  console.log('ui 寄信部分失敗: ' + page.elements.result.className + ' | ' + oneLine(page.elements.result.textContent));
  console.log('test 寄信部分失敗: ' + (failures.length === before ? 'pass' : 'FAIL'));
}

async function main() {
  productionChecks();
  await liveEndpointBlocked();
  await successFlow();
  await unknownFlow();
  await duplicateFlow();
  await timeoutFlow();
  await partialMailFlow();
  if (failures.length) {
    console.error('isolated e2e failed: ' + failures.length);
    for (const line of failures) console.error(' - ' + line);
    process.exit(1);
  }
  console.log('isolated e2e: pass');
  console.log('network: in-process mock only; SpreadsheetApp, MailApp, LockService, fetch 都沒有離開這個行程');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
