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
const appsPagePath = join(root, unpublished, 'IsolatedCheck.html');
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

function enterLikeSheets(input) {
  let text = input == null ? '' : String(input);
  if (text.charAt(0) === "'") text = text.slice(1);
  if (text.charAt(0) === '=') {
    const sum = text.match(/^=(\d+(?:\.\d+)?)\+(\d+(?:\.\d+)?)$/);
    return sum ? String(Number(sum[1]) + Number(sum[2])) : '#ERROR!';
  }
  return text;
}

function columnIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

function omitTrailingEmptyCells(rows) {
  return rows.map((row) => {
    const copy = row.slice();
    while (copy.length && (copy[copy.length - 1] == null || copy[copy.length - 1] === '')) copy.pop();
    return copy;
  });
}

function parseA1(range) {
  const text = String(range);
  const bang = text.lastIndexOf('!');
  if (bang < 0) {
    let only = text;
    if (only.charAt(0) === "'" && only.charAt(only.length - 1) === "'") only = only.slice(1, -1).replace(/''/g, "'");
    return { name: only, entire: true };
  }
  let name = text.slice(0, bang);
  const cells = text.slice(bang + 1);
  if (name.charAt(0) === "'" && name.charAt(name.length - 1) === "'") name = name.slice(1, -1).replace(/''/g, "'");
  const columns = cells.match(/^([A-Z]+):([A-Z]+)$/);
  if (columns) return { name, entire: true };
  const match = cells.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (match) return { name, row: Number(match[2]), col: columnIndex(match[1]), endRow: Number(match[4]), endCol: columnIndex(match[3]) };
  const single = cells.match(/^([A-Z]+)(\d+)$/);
  if (single) {
    const row = Number(single[2]);
    const col = columnIndex(single[1]);
    return { name, row, col, endRow: row, endCol: col };
  }
  throw new Error('bad range ' + range);
}

function formatInZone(date, timeZone, pattern) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date instanceof Date ? date : new Date(date))) parts[part.type] = part.value;
  const map = { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour === '24' ? '00' : parts.hour, mm: parts.minute, ss: parts.second };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => map[token]);
}

function memorySpreadsheet(box) {
  const sheets = {};
  const ss = {
    id: '',
    timeZone: 'Asia/Taipei',
    getId() { return ss.id; },
    getSpreadsheetTimeZone() { return ss.timeZone; },
    getSheetByName(name) { return sheets[name] || null; },
    insertSheet(name) {
      sheets[name] = make(name);
      return sheets[name];
    },
  };
  function make(name) {
    const cache = [];
    const cacheFormulas = {};
    const server = [];
    const serverFormulas = {};
    const pending = [];
    function putCache(r, c, value, formula) {
      const line = cache[r] ? cache[r].slice() : [];
      line[c] = value;
      cache[r] = line;
      cacheFormulas[r + ':' + c] = formula || '';
    }
    function putServer(r, c, value, formula) {
      const line = server[r] ? server[r].slice() : [];
      line[c] = value;
      server[r] = line;
      serverFormulas[r + ':' + c] = formula || '';
    }
    function queueCell(r, c, value, formula) {
      putCache(r, c, value, formula);
      pending.push({ type: 'cell', r, c, value, formula: formula || '' });
    }
    function syncCache() {
      cache.length = 0;
      for (let i = 0; i < server.length; i += 1) cache.push(server[i] ? server[i].slice() : []);
      Object.keys(cacheFormulas).forEach((key) => { delete cacheFormulas[key]; });
      Object.keys(serverFormulas).forEach((key) => { cacheFormulas[key] = serverFormulas[key]; });
    }
    return {
      name,
      getLastRow() { return cache.length; },
      appendRaw(matrix, insertRows, mode) {
        let last = -1;
        for (let i = 0; i < server.length; i += 1) {
          const line = server[i] || [];
          if (line.some((cell) => cell != null && cell !== '')) last = i;
        }
        const at = last + 1;
        for (let r = 0; r < matrix.length; r += 1) {
          const stored = (matrix[r] || []).map((cell) => {
            if (mode === 'RAW' && typeof cell === 'number' && Number.isFinite(cell)) return cell;
            if (mode === 'RAW') return cell == null ? '' : String(cell);
            return enterLikeSheets(cell);
          });
          if (insertRows) {
            server.splice(at + r, 0, stored.slice());
            cache.splice(at + r, 0, stored.slice());
          } else {
            server[at + r] = stored.slice();
            cache[at + r] = stored.slice();
          }
        }
      },
      appendRow(row) {
        const copy = row.slice();
        const index = cache.length;
        cache.push(copy);
        pending.push({ type: 'row', index, row: copy });
      },
      clear() {
        cache.length = 0;
        Object.keys(cacheFormulas).forEach((key) => { delete cacheFormulas[key]; });
        pending.push({ type: 'clear' });
      },
      clearServer() {
        server.length = 0;
        Object.keys(serverFormulas).forEach((key) => { delete serverFormulas[key]; });
        cache.length = 0;
        Object.keys(cacheFormulas).forEach((key) => { delete cacheFormulas[key]; });
      },
      applyPending() {
        const ops = pending.splice(0, pending.length);
        for (const op of ops) {
          if (op.type === 'clear') {
            server.length = 0;
            Object.keys(serverFormulas).forEach((key) => { delete serverFormulas[key]; });
          } else if (op.type === 'row') {
            server[op.index] = op.row.slice();
          } else if (op.type === 'cell') {
            putServer(op.r, op.c, op.value, op.formula);
          }
        }
        syncCache();
      },
      getRange(row, col, numRows, numCols) {
        const rowsN = numRows == null ? 1 : numRows;
        const colsN = numCols == null ? 1 : numCols;
        return {
          setNumberFormat() { return this; },
          setValues(values) {
            box.writes.push({ name, row, col, numRows: rowsN, numCols: colsN, lockHeld: box.lockHeld, afterFlush: box.flushed });
            for (let r = 0; r < rowsN; r += 1) {
              for (let c = 0; c < colsN; c += 1) queueCell(row - 1 + r, col - 1 + c, enterLikeSheets(values[r][c]), '');
            }
          },
          setRichTextValue(rich) {
            let text = rich && typeof rich.getText === 'function' ? rich.getText() : '';
            if (text.charAt(0) === '+') text = '=' + text;
            queueCell(row - 1, col - 1, text, '');
            return this;
          },
          setRawValues(values) {
            for (let r = 0; r < rowsN; r += 1) {
              for (let c = 0; c < colsN; c += 1) {
                const cell = values[r] ? values[r][c] : '';
                const stored = typeof cell === 'number' && Number.isFinite(cell) ? cell : (cell == null ? '' : String(cell));
                putCache(row - 1 + r, col - 1 + c, stored, '');
                putServer(row - 1 + r, col - 1 + c, stored, '');
              }
            }
          },
          getValues() {
            const out = [];
            for (let r = 0; r < rowsN; r += 1) {
              const line = cache[row - 1 + r] || [];
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
              if (box.failReadAfterFlush === 'formula') {
                return out.map((line) => line.map((cell) => {
                  const text = cell == null ? '' : String(cell);
                  return text.charAt(0) === '=' ? '2' : cell;
                }));
              }
            }
            return out;
          },
          getValue() {
            const line = cache[row - 1] || [];
            return line[col - 1] == null ? '' : line[col - 1];
          },
          getFormula() {
            return cacheFormulas[(row - 1) + ':' + (col - 1)] || '';
          },
        };
      },
      rows() {
        const out = [];
        for (let i = 0; i < server.length; i += 1) out.push(server[i] ? server[i].slice() : []);
        return out;
      },
      getName() { return name; },
      getParent() { return ss; },
    };
  }
  ss.flushPending = function flushPending() {
    Object.keys(sheets).forEach((sheetName) => sheets[sheetName].applyPending());
  };
  return ss;
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
    rawWrites: [],
    htmlFiles: [],
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
    Date,
    Utilities: { formatDate: formatInZone },
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
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
      createHtmlOutput(text) {
        return {
          setTitle() { return this; },
          setXFrameOptionsMode() { return this; },
          getContent() { return String(text); },
        };
      },
      createHtmlOutputFromFile(name) {
        box.htmlFiles.push(name);
        return {
          setTitle() { return this; },
          setXFrameOptionsMode() { return this; },
          getContent() { return readFileSync(appsPagePath, 'utf8'); },
        };
      },
    },
    SpreadsheetApp: {
      openById(id) {
        box.opened.push(id);
        if (!box.byId[id]) box.byId[id] = memorySpreadsheet(box);
        box.byId[id].id = id;
        return box.byId[id];
      },
      flush() {
        box.flushed = true;
        box.lockLog.push(box.lockHeld ? 'flush-held' : 'flush-free');
        Object.keys(box.byId).forEach((id) => {
          const book = box.byId[id];
          if (book && typeof book.flushPending === 'function') book.flushPending();
        });
      },
      newRichTextValue() {
        const rich = {
          body: '',
          setText(value) { this.body = String(value); return this; },
          build() { return { getText: () => rich.body }; },
        };
        return rich;
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
    Sheets: {
      Spreadsheets: {
        Values: {
          update(resource, spreadsheetId, range, options) {
            const mode = options && options.valueInputOption;
            box.rawWrites.push({ spreadsheetId, range, mode });
            const ss = box.byId[spreadsheetId];
            if (!ss) throw new Error('spreadsheet not open');
            const parsed = parseA1(range);
            const sheet = ss.getSheetByName(parsed.name);
            if (!sheet) throw new Error('sheet missing');
            const values = resource && resource.values ? resource.values : [];
            const target = sheet.getRange(parsed.row, parsed.col, parsed.endRow - parsed.row + 1, parsed.endCol - parsed.col + 1);
            if (mode === 'RAW') target.setRawValues(values);
            else target.setValues(values);
            return { updatedRange: range };
          },
          append(resource, spreadsheetId, range, options) {
            const mode = options && options.valueInputOption;
            const insert = options && options.insertDataOption;
            box.rawWrites.push({ spreadsheetId, range, mode, insert, op: 'append', lockHeld: box.lockHeld });
            const ss = box.byId[spreadsheetId];
            if (!ss) throw new Error('spreadsheet not open');
            const parsed = parseA1(range);
            const sheet = ss.getSheetByName(parsed.name);
            if (!sheet) throw new Error('sheet missing');
            sheet.appendRaw(resource && resource.values ? resource.values : [], insert === 'INSERT_ROWS', mode);
          },
          clear(resource, spreadsheetId, range) {
            const ss = box.byId[spreadsheetId];
            if (!ss) throw new Error('spreadsheet not open');
            const parsed = parseA1(range);
            const sheet = ss.getSheetByName(parsed.name);
            if (!sheet) throw new Error('sheet missing');
            sheet.clearServer();
          },
          get(spreadsheetId, range) {
            const parsedEarly = parseA1(range);
            if (box.blankReportRead && (parsedEarly.name === '驗收結果' || parsedEarly.name === '公式核對')) return { values: [] };
            const ss = box.byId[spreadsheetId];
            if (!ss) throw new Error('spreadsheet not open');
            const parsed = parseA1(range);
            const sheet = ss.getSheetByName(parsed.name);
            if (!sheet) throw new Error('sheet missing');
            let values = omitTrailingEmptyCells(sheet.rows());
            if (box.mutateReportCell && parsed.name === '驗收結果' && values[1]) {
              values = values.map((row) => row.slice());
              values[1][2] = 'tampered';
            }
            return { values };
          },
        },
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
      const outcome = isolated.sandbox.acceptBooking_(JSON.parse(request.body || '{}'));
      const response = { getContent() { return JSON.stringify(outcome.response); } };
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

function displayStored(header, value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    if (header === '日期') return new Date(Math.round(epoch + value * 86400000)).toISOString().slice(0, 10);
    if (header === '收到時間') return new Date(Math.round(epoch + value * 86400000) - 8 * 60 * 60 * 1000).toISOString();
    if (header === '時間') {
      const minutes = Math.round(value * 1440);
      return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
    }
  }
  return String(value);
}

function rowById(isolated, id) {
  const rows = sheetRows(isolated, '訂單');
  if (!rows.length) return null;
  const found = rows.slice(1).find((row) => row[0] === id);
  if (!found) return null;
  const out = {};
  rows[0].forEach((key, index) => { out[key] = displayStored(key, found[index]); });
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
  const guest = isolated.box.mails.filter((item) => item.subject.includes('預約申請已收到') && item.subject.includes(orderId));
  const shop = isolated.box.mails.filter((item) => item.subject.includes('店內對帳') && item.subject.includes(orderId));
  assert(guest.length === 1 && guest[0].to === 'shop-test@example.com' && guest[0].body.includes('訂單編號：' + orderId), `${label}：客人信要寄到 SMC_SHOP_EMAIL，且編號相同`);
  assert(shop.length === 1 && shop[0].to === 'shop-test@example.com' && shop[0].body.includes('訂單編號：' + orderId), `${label}：店內信要寄到 SMC_SHOP_EMAIL，且編號相同`);
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
  const guest = isolated.box.mails.filter((item) => item.subject.includes('預約申請已收到'));
  const shop = isolated.box.mails.filter((item) => item.subject.includes('店內對帳'));
  assert(guest.length === 1 && guest[0].to === 'shop-test@example.com' && guest[0].body.includes(response.orderId), '客人信已模擬寄到測試信箱，編號相同');
  assert(shop.length === 0, '店內信這次沒有寄出');
  const row = rowById(isolated, response.orderId);
  assert(row && row['點擊識別碼'] === 'TESTGCLID9000' && row['訂單編號'] === response.orderId, '部分寄信失敗時表格仍留著 gclid 與同一個編號');
  assert(page.elements.result.className === 'ok' && page.elements.result.textContent.includes('未全部寄出'), '頁面要寫未全部寄出，而不是已寄出');
  console.log('flow 寄信部分失敗: ' + flowLine(isolated.box));
  console.log('ui 寄信部分失敗: ' + page.elements.result.className + ' | ' + oneLine(page.elements.result.textContent));
  console.log('test 寄信部分失敗: ' + (failures.length === before ? 'pass' : 'FAIL'));
}

function privateEntryAndFormula() {
  const before = failures.length;
  const runbook = readFileSync(join(root, unpublished, 'booking-attribution-isolated-runbook.md'), 'utf8');
  let appsPage = '';
  try {
    appsPage = readFileSync(appsPagePath, 'utf8');
  } catch (err) {
    appsPage = '';
  }
  assert(appsPage.length > 0, '要有私人 HtmlService 頁 IsolatedCheck.html');
  assert(gs.includes("HtmlService.createHtmlOutputFromFile('IsolatedCheck')"), '私人頁面要由 HtmlService 從 IsolatedCheck 產出');
  assert(typeof loadIsolated().sandbox.submitIsolatedFromPage === 'function', '要有 submitIsolatedFromPage 給 google.script.run 呼叫');
  assert(typeof loadIsolated().sandbox.runIsolatedEightCases === 'function', '編輯器驗收函式 runIsolatedEightCases 要在');
  assert(appsPage.includes('google.script.run') && appsPage.includes('submitIsolatedFromPage'), '私人頁面要用 google.script.run 呼叫隔離後端');
  assert(!appsPage.includes('fetch(') && !appsPage.includes('script.google.com'), '私人頁面不可跨來源 fetch 部署網址');
  assert(runbook.includes('只有我') && runbook.includes('不可') && runbook.includes('任何人'), '手冊要寫明存取維持只有我，不可改成任何人');
  assert(runbook.includes('實測第一步') && runbook.includes('runIsolatedEightCases'), '實測第一步要在編輯器執行八案例');
  assert(runbook.includes('google.script.run'), '手冊的網頁驗收要改走 google.script.run');
  assert(runbook.includes('127.0.0.1') && runbook.includes('不能拿來送私人部署'), '本機頁面要標明不能拿來送私人部署');
  assert(runbook.includes('mailed') && runbook.includes('duplicate') && runbook.includes('wrote'), '手冊要列出 mailed、duplicate、wrote');
  assert(gs.includes('原列') && runbook.includes('原列') && runbook.includes('不要重送'), '讀回不一致要寫明停下、核對原列、不要重送');
  assert(!/^function doPost\s*\(/m.test(gs), '隔離版不可定義 doPost');
  assert(/^function doGet\s*\(/m.test(gs), '隔離版要保留 doGet');
  assert(runbook.startsWith('# 隔離 Apps Script 驗收') && runbook.includes('必須是新建的獨立試算表專案，不要貼進任何既有專案'), '手冊最前面要寫必須是新建的獨立試算表專案');
  assert(runbook.includes('不可以重新整理後重送'), '結果未知時不可以重新整理後重送');
  assert(!runbook.includes('ALLOWED_DEPLOYMENT_IDS'), 'Owner 文件不要再教加入 guard 白名單');
  const confirmSrc = gs.slice(gs.indexOf('function confirmOrderRow_'), gs.indexOf('function acceptBooking_'));
  assert(confirmSrc.includes('sameStored_') && confirmSrc.includes("formula !== ''") && !confirmSrc.includes('replace('), '讀回要比對原值，數字和日期用序號，而且 getFormula 必須為空');
  assert(gs.includes("valueInputOption: 'RAW'") && gs.includes('Sheets.Spreadsheets.Values.update'), '寫入要用 Sheets API 的 RAW，不可再靠 setRichTextValue');
  assert(gs.includes('舊寫法'), '檔頭要註明前導單引號那句是舊寫法');
  assert(gs.includes('Sheets.Spreadsheets.Values.clear') && gs.includes('Sheets.Spreadsheets.Values.get'), '報告分頁要用 API 清除，最後再用 API 讀回');
  assert(!gs.includes('sheet.clear()'), '不可再呼叫會延後的 sheet.clear');
  assert(runbook.includes('可能再授權') && runbook.includes('清除內容') && runbook.includes('所有案例都會被判成重複'), '手冊要寫可能再授權、清除內容，以及沒清訂單和郵件預覽時全部變成重複');
  assert(!runbook.includes('會再授權'), '手冊不要寫成一定會再授權');
  const isolated = loadIsolated({ sheetId: 'private-sheet' });
  if (typeof isolated.sandbox.submitIsolatedFromPage !== 'function') {
    console.log('test 私人入口與公式往返: FAIL');
    return;
  }
  const attack = isolated.sandbox.submitIsolatedFromPage({
    action: 'book', type: 'dining', name: '測試同學', phone: '0900000000', email: 'attacker@example.com',
    people: '2', tables: '1', date: '2026-10-22', time: '12:00', note: '=1+1', orderItems: '',
    source: 'google', utmSource: 'google', utmMedium: 'cpc', utmCampaign: '+1+1', utmContent: '-1+1',
    utmTerm: '@cmd', utmAdgroup: '', adgroupBucket: '', gclid: '',
  });
  assert(attack && attack.status === 'success' && attack.orderId, '私人頁面送出要能收單');
  assert(attack.mailed === true && attack.wrote === true && attack.duplicate !== true, '成功回應要帶 mailed、wrote，且不是重複');
  const sentTo = isolated.box.mails.map((item) => item.to);
  assert(sentTo.length === 2 && sentTo.every((to) => to === 'shop-test@example.com'), '兩封信的收件人都要固定為 SMC_SHOP_EMAIL');
  assert(!sentTo.includes('attacker@example.com'), 'payload 裡的信箱不可拿來寄信');
  const row = rowById(isolated, attack.orderId);
  assert(row && row['信箱'] === 'attacker@example.com', '表格信箱欄仍是送出內容，不是收件人');
  assert(row && row['備註'] === '=1+1' && row['備註'] !== '2', '等號開頭寫入後讀回仍是文字，不是算式結果');
  assert(row && row['utm活動'] === '+1+1' && row['utm活動'] !== '=+1+1' && row['utm內容'] === '-1+1' && row['utm關鍵字'] === '@cmd', '+ - @ 開頭讀回要等於原值字串，加號不可變成 =+');
  const direct = isolated.sandbox.confirmOrderRow_;
  function sheetOf(rows, formula) {
    return {
      getLastRow() { return rows.length; },
      getRange() { return { getValues() { return rows; }, getFormula() { return formula; } }; },
    };
  }
  assert(direct(sheetOf([['SMC900776', '=1+1']], ''), 'SMC900777', ['SMC900777', '=1+1']).ok === false, '訂單編號對不上不可算讀回成功');
  assert(direct(sheetOf([['SMC900777', '=1+1']], ''), 'SMC900777', ['SMC900777', '=1+1']).ok === true, '讀回等於原值且 getFormula 為空才算一致');
  assert(direct(sheetOf([['SMC900777', '2']], ''), 'SMC900777', ['SMC900777', '=1+1']).ok === false, '讀回變成算式結果不可算一致');
  assert(direct(sheetOf([['SMC900777', "'=1+1"]], ''), 'SMC900777', ['SMC900777', '=1+1']).ok === false, '讀回多了前導單引號不可算成原值');
  assert(direct(sheetOf([['SMC900777', '=1+1']], '=1+1'), 'SMC900777', ['SMC900777', '=1+1']).ok === false, 'getFormula 不是空不可算一致');
  const computed = loadIsolated({ sheetId: 'formula-computed', failReadAfterFlush: 'formula' });
  const computedRes = computed.sandbox.submitIsolatedFromPage({
    action: 'book', type: 'dining', name: '測試同學', phone: '0900000000', email: 'attacker@example.com',
    people: '2', tables: '1', date: '2026-10-22', time: '12:00', note: '=1+1', orderItems: '',
  });
  assert(computedRes.status === 'unknown' && computedRes.mailed === false, '讀回變成公式結果就要停下，不可寄信');
  assert(String(computedRes.message).includes('原列') && String(computedRes.message).includes('不要重送'), '不一致的回應要寫核對原列、不要重送');
  assert(String(computedRes.message).includes('欄位：備註') && String(computedRes.message).includes('原值：=1+1') && String(computedRes.message).includes('讀回值：2'), '讀回不符要寫明欄位、原值與讀回值');
  assert(computed.box.mails.length === 0, '公式讀回不一致不可寄信');
  const kept = rowById(computed, computedRes.orderId);
  assert(kept && kept['備註'] === '=1+1' && kept['備註'] !== '2', '停下後原列仍是寫入的文字，供人工核對');
  const opened = isolated.sandbox.doGet();
  assert(isolated.box.htmlFiles.includes('IsolatedCheck') && opened.getContent().includes('google.script.run'), 'doGet 要送出私人頁面');
  isolated.props.SMC_ATTRIBUTION_ISOLATED = 'no';
  assert(!isolated.sandbox.doGet().getContent().includes('google.script.run'), '沒標成隔離時不可送出驗收頁');
  console.log('test 私人入口與公式往返: ' + (failures.length === before ? 'pass' : 'FAIL'));
}

function deferredReportSurvivesFlush() {
  const before = failures.length;
  const isolated = loadIsolated({ sheetId: 'deferred-clear-sheet' });
  const book = isolated.box.byId['deferred-clear-sheet'];
  const demo = book.insertSheet('延後清除');
  demo.appendRow(['仍在']);
  assert(demo.rows().length === 0, 'SpreadsheetApp 的 appendRow 要等 flush 才寫進儲存的列');
  isolated.sandbox.SpreadsheetApp.flush();
  assert(demo.rows().length === 1, 'flush 後 appendRow 才生效');
  demo.clear();
  assert(demo.rows().length === 1, 'SpreadsheetApp 的 clear 要等 flush 才生效');
  isolated.sandbox.SpreadsheetApp.flush();
  assert(demo.rows().length === 0, 'flush 後 clear 才把儲存的列清掉');
  for (const name of ['驗收結果', '公式核對']) {
    const seeded = book.insertSheet(name);
    seeded.appendRow(name === '驗收結果' ? ['案例', '訂單編號', '結果', '寫入', '寄信'] : ['欄位', '原值', '讀回值', 'getFormula', '判定']);
  }
  isolated.sandbox.SpreadsheetApp.flush();
  const message = String(isolated.sandbox.runIsolatedEightCases());
  isolated.sandbox.SpreadsheetApp.flush();
  assert(sheetRows(isolated, '驗收結果').length === 9, '報告被延後的 clear 洗掉：腳本結束的 flush 之後，驗收結果應仍有 9 列');
  assert(sheetRows(isolated, '公式核對').length === 5, '報告被延後的 clear 洗掉：腳本結束的 flush 之後，公式核對應仍有 5 列');
  assert(message.includes('四種前綴都通過') && !message.includes('結果未知'), '報告留住時八案例才算通過');
  const blank = loadIsolated({ sheetId: 'blank-report-read' });
  blank.box.blankReportRead = true;
  const blankMsg = String(blank.sandbox.runIsolatedEightCases());
  assert(blankMsg.includes('結果未知') && blankMsg.includes('驗收結果') && blankMsg.includes('公式核對') && blankMsg.includes('讀回'), '讀回列數不對要標成未知，並寫明兩張分頁');
  assert(!blankMsg.includes('才可以部署'), '報告讀回是空白時不可說可以部署');
  console.log('test 延後清除與報告讀回: ' + (failures.length === before ? 'pass' : 'FAIL'));
}

function roundSevenReadback() {
  const before = failures.length;
  const readbackSrc = gs.slice(gs.indexOf('var readError'));
  assert(readbackSrc.includes('SpreadsheetApp.flush()'), '最後讀回報告的開頭要先 flush');
  const lateClear = loadIsolated({ sheetId: 'late-clear-sheet' });
  const realWriteResult = lateClear.sandbox.writeResultSheet_;
  lateClear.sandbox.writeResultSheet_ = function (ss, lines) {
    const written = realWriteResult(ss, lines);
    ss.getSheetByName('驗收結果').clear();
    return written;
  };
  const lateMsg = String(lateClear.sandbox.runIsolatedEightCases());
  lateClear.sandbox.SpreadsheetApp.flush();
  assert(lateMsg.includes('結果未知') && lateMsg.includes('讀回 0') && lateMsg.includes('預期 9'), '讀回前先 flush，延後的 clear 要報結果未知');
  assert(!lateMsg.includes('四種前綴都通過'), '延後的 clear 把報告洗掉時不可說四種前綴都通過');
  const logs = [];
  const note = loadIsolated({ sheetId: 'notify-sheet' });
  note.sandbox.console = { log(...args) { logs.push(args.map((item) => String(item)).join(' ')); } };
  note.sandbox.SpreadsheetApp.getUi = function () {
    return { alert() { throw new Error('沒有試算表介面'); }, createMenu() { return { addItem() { return this; }, addToUi() {} }; } };
  };
  let noteThrew = false;
  try { note.sandbox.notify_('已送出 8 筆。四種前綴都通過'); } catch (err) { noteThrew = true; }
  assert(!noteThrew && logs.some((line) => line.includes('四種前綴都通過')) && logs.some((line) => line.includes('沒有試算表介面')), 'notify_ 要寫 console.log，alert 的錯誤也不可吞掉');
  const mismatch = loadIsolated({ sheetId: 'mismatch-sheet' });
  mismatch.box.mutateReportCell = true;
  const mismatchMsg = String(mismatch.sandbox.runIsolatedEightCases());
  assert(mismatchMsg.includes('實際：tampered') && mismatchMsg.includes('預期：success'), '內容不符要寫出實際值和預期值');
  const probeBoom = loadIsolated({ sheetId: 'probe-boom-sheet' });
  probeBoom.sandbox.writeProbeSheet_ = function () { throw new Error('probe write failed'); };
  const probeMsg = String(probeBoom.sandbox.runIsolatedEightCases());
  assert(probeMsg.includes('6 公式開頭') && probeMsg.includes('公式核對寫入') && probeMsg.includes('確認寄出 12 封'), '公式核對寫入失敗要寫明停在哪一步，以及確認寄出幾封');
  const trail = loadIsolated({ sheetId: 'trail-sheet' });
  const trailBook = trail.box.byId['trail-sheet'];
  trailBook.id = 'trail-sheet';
  const trailWritten = trail.sandbox.writeResultSheet_(trailBook, [
    ['案例', '訂單編號', '結果', '寫入', '寄信'],
    ['尾端空白', 'SMC900199', 'success', '是', ''],
  ]);
  const trailActual = trail.sandbox.readSheetValues_(trailBook.getSheetByName('驗收結果'));
  assert(trailActual[1] && trailActual[1].length === 4 && trail.sandbox.reportProblem_('驗收結果', trailActual, trailWritten) === '', '列尾空欄被 API 省略時要補齊再比對');
  console.log('test 讀回前 flush 與錯誤訊息: ' + (failures.length === before ? 'pass' : 'FAIL'));
}

function roundEightMessages() {
  const before = failures.length;
  const flushBoom = loadIsolated({ sheetId: 'flush-boom-sheet' });
  const realFlushWrite = flushBoom.sandbox.writeResultSheet_;
  let resultSheetWritten = false;
  flushBoom.sandbox.writeResultSheet_ = function (ss, lines) {
    const written = realFlushWrite(ss, lines);
    resultSheetWritten = true;
    return written;
  };
  const realFlush = flushBoom.sandbox.SpreadsheetApp.flush;
  flushBoom.sandbox.SpreadsheetApp.flush = function () {
    if (resultSheetWritten) throw new Error('最終 flush 失敗');
    return realFlush.apply(this, arguments);
  };
  const flushMsg = String(flushBoom.sandbox.runIsolatedEightCases());
  assert(flushMsg.includes('結果未知') && flushMsg.includes('驗收結果') && flushMsg.includes('公式核對') && flushMsg.includes('flush') && flushMsg.includes('最終 flush 失敗'), '最終 flush 失敗要寫明階段、兩張分頁和錯誤');
  assert(!flushMsg.includes('讀不回來'), 'flush 失敗不可說成讀不回來');
  const probeRead = loadIsolated({ sheetId: 'probe-read-sheet' });
  const realProbeGet = probeRead.sandbox.Sheets.Spreadsheets.Values.get;
  probeRead.sandbox.Sheets.Spreadsheets.Values.get = function (id, range) {
    if (String(range).includes('公式核對')) throw new Error('公式核對 get 失敗');
    return realProbeGet.apply(this, arguments);
  };
  const probeReadMsg = String(probeRead.sandbox.runIsolatedEightCases());
  assert(probeReadMsg.includes('公式核對') && probeReadMsg.includes('公式核對 get 失敗'), '公式核對讀回失敗要寫明分頁和錯誤');
  const resultBoom = loadIsolated({ sheetId: 'result-boom-sheet' });
  resultBoom.sandbox.writeResultSheet_ = function () { throw new Error('驗收結果寫入失敗'); };
  const resultBoomMsg = String(resultBoom.sandbox.runIsolatedEightCases());
  assert(resultBoomMsg.includes('驗收結果') && resultBoomMsg.includes('驗收結果寫入失敗'), '驗收結果寫入失敗要寫明分頁和錯誤');
  const partialCount = loadIsolated({ sheetId: 'partial-count-sheet' });
  const realPartialSend = partialCount.sandbox.MailApp.sendEmail;
  let shopSends = 0;
  partialCount.sandbox.MailApp.sendEmail = function (to, subject, body) {
    if (String(subject).includes('店內對帳')) {
      shopSends += 1;
      if (shopSends === 6) throw new Error('第二封店內信失敗');
    }
    return realPartialSend.apply(this, arguments);
  };
  partialCount.sandbox.writeProbeSheet_ = function () { throw new Error('probe write failed'); };
  const partialCountMsg = String(partialCount.sandbox.runIsolatedEightCases());
  assert(partialCount.box.mails.length === 11, '案例 1–5 各兩封，加上案例 6 的客人信，實際成功 11 封');
  assert(partialCountMsg.includes('確認寄出 11 封') && !partialCountMsg.includes('確認寄出 10 封'), '部分寄信要算已確認成功的 11 封');
  assert(partialCountMsg.includes('未確認寄出 1 封') && partialCountMsg.includes('不要補寄') && !partialCountMsg.includes('沒有寄出'), '丟錯的那封要標成未確認寄出，而且不要補寄');
  const alertLogs = [];
  const alertRun = loadIsolated({ sheetId: 'alert-run-sheet' });
  alertRun.sandbox.console = { log(...args) { alertLogs.push(args.map((item) => String(item)).join(' ')); } };
  alertRun.sandbox.SpreadsheetApp.getUi = function () {
    return { alert() { throw new Error('沒有試算表介面'); }, createMenu() { return { addItem() { return this; }, addToUi() {} }; } };
  };
  const alertMsg = String(alertRun.sandbox.runIsolatedEightCases());
  assert(alertMsg.includes('結果未知') && alertMsg.includes('沒有試算表介面') && !alertMsg.includes('四種前綴都通過') && !alertMsg.includes('才可以部署'), '八案例的 alert 失敗要回結果未知，不可回成功摘要');
  const runbook = readFileSync(join(root, unpublished, 'booking-attribution-isolated-runbook.md'), 'utf8');
  const verification = readFileSync(join(root, unpublished, 'isolated-e2e-verification.md'), 'utf8');
  assert(runbook.includes('按確定') && runbook.includes('對話框'), '手冊要寫讀完 alert 按確定，等待對話框不是故障');
  assert(!verification.includes('API 寫入不會更新這份快取') && verification.includes('不可依賴') && verification.includes('即時一致'), '快取描述要改成不可依賴即時一致');
  assert(verification.includes('真表上觀察到') && verification.includes('模擬重現'), '根因要分開真表觀察和模擬重現');
  assert(verification.includes('確認 Pages 建置仍把 .github/pages-unpublished 排除在公開網站之外'), '開旗標前要確認 Pages 仍排除未公開目錄');
  console.log('test 錯誤訊息與部分寄信: ' + (failures.length === before ? 'pass' : 'FAIL'));
}

async function main() {
  productionChecks();
  await liveEndpointBlocked();
  await successFlow();
  await unknownFlow();
  await duplicateFlow();
  await timeoutFlow();
  await partialMailFlow();
  privateEntryAndFormula();
  deferredReportSurvivesFlush();
  roundSevenReadback();
  roundEightMessages();
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
