#!/usr/bin/env node
// Local reconciliation only. Does not call script.google.com, send mail, or open a sheet.
// setValues reproduces Sheets: a leading apostrophe is discarded, and a string starting with = is calculated.
// setNumberFormat('@') does not stop that. setRichTextValue of a leading + stores the text =+ with an empty formula.
// Sheets.Spreadsheets.Values.update with valueInputOption RAW stores the string unchanged.
// SpreadsheetApp appendRow, setValues, setRichTextValue, and clear change the local cache immediately,
// but stored rows change only when SpreadsheetApp.flush() replays those calls.
// A deferred clear therefore wipes a Sheets API write that landed in between.
// values.clear and values.get change or read stored rows immediately.
// Usage: node tools/test-booking-reconciliation.mjs
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const attr = require(join(root, 'js/booking-attribution.js'));
const source = readFileSync(join(root, 'js/booking-attribution.js'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const unpublishedDir = '.github/pages-unpublished';
const gs = readFileSync(join(root, unpublishedDir, 'booking-attribution-isolated.gs'), 'utf8');
const runbook = readFileSync(join(root, unpublishedDir, 'booking-attribution-isolated-runbook.md'), 'utf8');
const faq = readFileSync(join(root, 'faq.html'), 'utf8');
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

function memorySpreadsheet(options = {}) {
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
            return out;
          },
          getValue() {
            const line = cache[row - 1] || [];
            return line[col - 1] == null ? '' : line[col - 1];
          },
          getFormula() {
            const text = cache[row - 1] && cache[row - 1][col - 1] != null ? String(cache[row - 1][col - 1]) : '';
            if (options.forceFormula && text === '=1+1') return '=1+1';
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
    Object.keys(sheets).forEach((name) => sheets[name].applyPending());
  };
  return ss;
}

function loadIsolated(options = {}) {
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
    rawWrites: [],
  };
  const marked = memorySpreadsheet(options);
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
      box.byId[id].id = id;
      return box.byId[id];
    },
    flush() {
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
    sendEmail(to, subject, body) {
      box.mails.push({ to, subject, body });
      box.lockLog.push(box.lockHeld ? 'mail-held' : 'mail-free');
    },
  };
  sandbox.Sheets = {
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
  return isolated.sandbox.acceptBooking_(payload).response;
}

function assertMailAfterRelease(box, label) {
  let open = false;
  let sawMail = false;
  for (const event of box.lockLog) {
    if (event === 'lock') open = true;
    if (event === 'mail-held') assert(false, `${label}：寄信時鎖還握著`);
    if (event === 'mail-free') {
      assert(!open, `${label}：寄信要在 releaseLock 之後`);
      sawMail = true;
    }
    if (event === 'release') open = false;
  }
  assert(sawMail, `${label}：成功寫入後要寄信`);
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

function asMap(headers, row) {
  const out = {};
  headers.forEach((key, index) => { out[key] = displayStored(key, row[index]); });
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
assert(!html.includes('isolated-check-guard') && !faq.includes('isolated-check-guard'), '公開頁不可載入隔離驗收 guard');
assert(html.includes('bookingSheetText(document.getElementById(\'phone\').value)'), '官網電話要走與來源欄相同的文字規則');
assert(html.includes('script.google.com/macros/s/' + LIVE_ID + '/exec'), '正式 web app 網址不可改');
assert(!gs.includes('getActive'), '隔離腳本不可讀取目前打開的試算表');
assert(!/insertSheet\(\s*MARKER_SHEET/.test(gs), '隔離腳本不可自己建立隔離標記');
assert(!existsSync(join(root, unpublishedDir, 'isolated-dining-check.html')), '本機驗收頁已移除');
assert(!existsSync(join(root, unpublishedDir, 'isolated-check-guard.js')), 'guard 已移除');
assert(!existsSync(join(root, 'tools/test-isolated-dining-check.mjs')), '驗收頁測試已移除');
assert(existsSync(join(root, unpublishedDir, 'booking-attribution-isolated.gs')), '隔離腳本要留在 repo 的未公開目錄');
assert(!existsSync(join(root, 'tools/isolated-dining-check.html')), '驗收頁不可留在會被 Pages 發布的 tools');
assert(!existsSync(join(root, 'apps-script/booking-attribution-isolated.gs')), '隔離腳本不可留在會被 Pages 發布的 apps-script');
assert(existsSync(join(root, unpublishedDir, 'booking-attribution-isolated-runbook.md')), '手冊要留在 repo 的未公開目錄');
assert(!existsSync(join(root, 'docs/booking-attribution-isolated-runbook.md')), '手冊不可留在會被 Pages 發布的 docs');
assert(!existsSync(join(root, 'tools/isolated-check-guard.js')), 'guard 不可留在會被 Pages 發布的 tools');
assert(unpublishedDir.startsWith('.github/'), '未公開檔必須放在目前建置會排除的 .github');
assert(runbook.includes('http://127.0.0.1:8765/.github/pages-unpublished/isolated-dining-check.html'), '手冊要寫明不要再開已移除的本機驗收網址');
assert(runbook.includes('已移除'), '手冊要含「已移除」');
assert(runbook.includes('.github/pages-unpublished/booking-attribution-isolated.gs'), '手冊要含 .github/pages-unpublished/booking-attribution-isolated.gs');
assert(runbook.includes('.github/pages-unpublished/isolated-check-guard.js'), '手冊要含 .github/pages-unpublished/isolated-check-guard.js');
assert(runbook.includes('目前的建置方式會排除'), '手冊要寫明排除只適用目前的建置方式');
assert(runbook.includes('upload-pages-artifact'), '手冊要提醒 action 換版本後再檢查');
assert(runbook.includes('404'), '手冊要寫公開測試頁應為 404');
assert(!runbook.includes('python3 -m http.server'), '手冊不可再教人開本機驗收頁');
assert(!runbook.includes('tools/isolated-dining-check.html'), '手冊不可再叫人開公開路徑上的驗收頁');
assert(!runbook.includes('apps-script/booking-attribution-isolated.gs'), '手冊不可再指向公開路徑上的隔離腳本');
assert(!runbook.includes('tools/isolated-check-guard.js'), '手冊不可再指向公開路徑上的 guard');
for (const phrase of ['SMC900001', 'SMC900101', 'SMC900102', 'SMC900103', 'SMC900104', 'SMC900105', 'SMC900106', 'ag_brand', 'ag_geo_dining', 'direct/unknown', '=1+1', '測試同學', 'runIsolatedEightCases', 'SMC-ISOLATED-TEST', 'isolated-dining-check.html', '回應沒有備註', '不會執行公式', '127.0.0.1', '未確認全部寄出', 'duplicate']) {
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
formula.utmContent = '+1+1';
formula.utmTerm = '-1+1';
formula.utmAdgroup = '@cmd';
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
assert(dup.duplicate === true && dup.wrote === false && String(dup.message).includes('沒有新增'), '重複編號要明示 duplicate 與 wrote:false，不可理解成這次新增');
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
    utmCampaign: '=1+1',
    utmContent: '+1+1',
    utmTerm: '-1+1',
    utmAdgroup: '@cmd',
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
  assert(sentGuest.length === 1 && sentGuest[0].body === guest && sentGuest[0].to === 'shop-test@example.com', `${id} 寄出的客人信要與固定預期一致，收件人固定為測試信箱，且只一封`);
  assert(sentShop.length === 1 && sentShop[0].body === shop && sentShop[0].to === 'shop-test@example.com', `${id} 寄出的店內信要與固定預期一致，且只一封`);
}

assert(!mailById(isolated, 'SMC900101')['店內正文'].includes('ag_geo_dining'), '品牌店內信不可混入非品牌代碼');
assert(mailById(isolated, 'SMC900102')['店內正文'].includes('ag_geo_dining') && mailById(isolated, 'SMC900102')['店內正文'].includes('非品牌'), '非品牌店內信要有自己的代碼');
assert(rowById(isolated, 'SMC900105')['utm活動'] === '=1+1' && rowById(isolated, 'SMC900105')['utm活動'] !== '2', '公式開頭要留下原值字串，不可變成算式結果');

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
  assert(guardIso.sandbox.formulaGuard_(hidden + '=1+1') === '=1+1', '公式前的零寬或 NUL 要先拿掉');
  assert(guardIso.sandbox.attributionText_(hidden + '=1+1') === '=1+1', '來源欄的零寬或 NUL 要先拿掉');
}
assert(guardIso.sandbox.formulaGuard_(' \u200B=1+1') === '=1+1', '空白加零寬仍要擋下公式');
const formulaDemo = guardIso.box.byId['isolated-test-sheet'].insertSheet('等號模擬');
formulaDemo.getRange(1, 1).setNumberFormat('@');
formulaDemo.getRange(1, 1).setValues([['=1+1']]);
formulaDemo.getRange(1, 2).setNumberFormat('@');
formulaDemo.getRange(1, 2).setValues([["'=1+1"]]);
formulaDemo.getRange(1, 3).setValues([['+1+1']]);
formulaDemo.getRange(1, 4).setValues([['-1+1']]);
formulaDemo.getRange(1, 5).setValues([['@cmd']]);
formulaDemo.getRange(1, 6).setRichTextValue(guardIso.sandbox.SpreadsheetApp.newRichTextValue().setText('=1+1').build());
assert(formulaDemo.getRange(1, 1).getValue() === '2' && formulaDemo.getRange(1, 1).getFormula() === '', 'setValues 把 = 開頭算成結果，純文字格式擋不住');
assert(formulaDemo.getRange(1, 2).getValue() === '2', '前導單引號在 setValues 會被吃掉，= 仍被計算');
assert(formulaDemo.getRange(1, 3).getValue() === '+1+1' && formulaDemo.getRange(1, 4).getValue() === '-1+1' && formulaDemo.getRange(1, 5).getValue() === '@cmd', '+ - @ 不是公式開頭，setValues 會原樣留下');
assert(formulaDemo.getRange(1, 6).getValue() === '=1+1' && formulaDemo.getRange(1, 6).getFormula() === '', 'setRichTextValue 留下 =1+1 且 getFormula 為空');
formulaDemo.getRange(2, 1).setNumberFormat('@');
formulaDemo.getRange(2, 1).setRichTextValue(guardIso.sandbox.SpreadsheetApp.newRichTextValue().setText('+1+1').build());
assert(formulaDemo.getRange(2, 1).getValue() === '=+1+1' && formulaDemo.getRange(2, 1).getFormula() === '', 'setRichTextValue 會把 + 開頭改成文字 =+，getFormula 仍是空的');
formulaDemo.getParent().id = 'isolated-test-sheet';
guardIso.sandbox.Sheets.Spreadsheets.Values.update({ values: [['+1+1', '=1+1', '-1+1', '@cmd']] }, 'isolated-test-sheet', "'等號模擬'!A3:D3", { valueInputOption: 'RAW' });
assert(formulaDemo.getRange(3, 1).getValue() === '+1+1' && formulaDemo.getRange(3, 2).getValue() === '=1+1' && formulaDemo.getRange(3, 3).getValue() === '-1+1' && formulaDemo.getRange(3, 4).getValue() === '@cmd', 'RAW 要原樣留下四種開頭');
assert(formulaDemo.getRange(3, 1).getFormula() === '' && formulaDemo.getRange(3, 2).getFormula() === '', 'RAW 寫入的格子 getFormula 要為空');
const leads = [['空白', ' '], ['Tab', '\t'], ['換行', '\n']];
const prefixes = ['=', '+', '-', '@'];
let guardN = 0;
for (const [leadName, lead] of leads) {
  for (const prefix of prefixes) {
    guardN += 1;
    const raw = lead + prefix + '1+1';
    const literal = prefix + '1+1';
    const id = 'SMC91' + String(1000 + guardN);
    assert(guardIso.sandbox.attributionText_(raw) === literal, `${leadName}+${prefix} 來源要先去掉空白，留下原值字串`);
    assert(guardIso.sandbox.formulaGuard_(raw) === literal, `${leadName}+${prefix} 訂位文字要先去掉空白，留下原值字串`);
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
    assert(row['utm活動'] === literal && row['utm活動'] !== '2', `${id} utm活動要留下原值字串，不可變成算式結果`);
    assert(row['備註'] === literal && row['姓名'] === literal && row['品項'] === literal, `${id} 原訂位文字寫入後仍是去掉空白後的原值`);
    assert(row['日期'] === '2026-10-22' && row['時間'] === '12:00' && row['人數'] === '2' && row['桌數'] === '1', `${id} 其他訂位欄不可被公式案例改掉`);
    assert(mail['客人正文'] === expectedGuest(id, literal), `${id} 客人信備註要是原值字串`);
    assert(mail['店內正文'].includes('備註：' + literal) && mail['店內正文'].includes('utm活動：' + literal) && mail['店內正文'].includes('品項：' + literal), `${id} 店內信要是原值字串`);
    assert(!mail['客人正文'].includes(raw) && !mail['店內正文'].includes(raw) && !row['備註'].includes(lead + prefix), `${id} 寫入與兩封信不可留下公式前的空白`);
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
const eightMsg = String(runner.sandbox.runIsolatedEightCases());
assert(eightMsg.includes('8') && !eightMsg.includes('結果未知'), '按鈕要回報已送出 8 筆');
runner.sandbox.SpreadsheetApp.flush();
const runnerOrders = sheetRows(runner, '訂單');
assert(runnerOrders.length === 8, '8 筆裡同一編號只佔一列，加上表頭是 8 列');
for (const id of ['SMC900001', 'SMC900101', 'SMC900102', 'SMC900103', 'SMC900104', 'SMC900105', 'SMC900106']) {
  assert(runnerOrders.slice(1).filter((row) => row[0] === id).length === 1, `按鈕結果應有一列 ${id}`);
}
assert(runner.box.mails.filter((item) => item.subject.includes('SMC900101')).length === 2, '同一編號只寄一輪客人信與店內信');
assert(runner.box.mails.length === 14, '八案例全成功是 14 封：七筆新單各兩封，重複那筆不寄');
const resultRows = sheetRows(runner, '驗收結果');
assert(resultRows.length === 9, '驗收結果要有表頭加 8 列');
const eighth = resultRows[8] || [];
assert(eighth[1] === 'SMC900101' && eighth[2] === 'success' && eighth[3] === '否' && eighth[4] === '否', '第 8 筆不可再寫入或再寄信');
const runnerFormula = asMap(runnerOrders[0], runnerOrders.find((row) => row[0] === 'SMC900105'));
assert(runnerFormula['utm活動'] === '=1+1' && runnerFormula['utm活動'] !== '2' && runnerFormula['utm內容'] === '+1+1' && runnerFormula['utm內容'] !== '=+1+1' && runnerFormula['備註'] === NOTE && runnerFormula['日期'] === '2026-10-22', '按鈕送出的公式列要留下原值字串，加號不可變成 =+，訂位欄不變');
assert(runner.box.rawWrites.length > 0 && runner.box.rawWrites.every((item) => item.mode === 'RAW'), '寫入必須走 Sheets API 的 RAW');
assert(gs.includes("valueInputOption: 'RAW'") && gs.includes('Sheets.Spreadsheets.Values.update'), '隔離腳本要用 Sheets API，而且 valueInputOption 是 RAW');
assert(gs.includes('舊寫法'), '檔頭要註明前導單引號那句是舊寫法');
assert(gs.includes('Sheets.Spreadsheets.Values.clear') && gs.includes('Sheets.Spreadsheets.Values.get'), '報告分頁要用 API 清除，最後再用 API 讀回');
assert(!gs.includes('sheet.clear()'), '不可再呼叫會延後的 sheet.clear');

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
assertMailAfterRelease(race.box, '交錯取號');
console.log('test 交錯取號: pass');
console.log('test 寄信在放鎖之後: pass');

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

const flushFail = loadIsolated();
flushFail.sandbox.SpreadsheetApp.flush = function () {
  flushFail.box.lockLog.push(flushFail.box.lockHeld ? 'flush-held' : 'flush-free');
  throw new Error('flush failed');
};
const flushRes = post(flushFail, previewPayload(brandFields, 'SMC900501'));
assert(flushRes.status === 'unknown' && flushRes.orderId === 'SMC900501', '寫入後 flush 失敗不可回成功，要回 unknown 與訂單編號');
assert(flushRes.status !== 'success' && flushRes.mailed === false, 'flush 失敗的回應不可是成功，也不可宣稱已寄出');
assert(String(flushRes.message).includes('結果未知，先核對試算表、勿重送'), 'flush 失敗要告訴操作者結果未知');
assert(String(flushRes.message) !== '隔離腳本無法完成寫入。', 'flush 失敗不可落成一般錯誤');
assert(rowById(flushFail, 'SMC900501'), 'flush 失敗前訂單列已經寫入');
assert(flushFail.box.lockHeld === false, 'flush 失敗後鎖仍要放開');
assertFlushBeforeRelease(flushFail.box, '寫入後 flush 失敗');
assert(flushFail.box.mails.length === 0, 'flush 失敗不可寄信');
assert(!flushFail.box.lockLog.includes('mail-held') && !flushFail.box.lockLog.includes('mail-free'), 'flush 失敗不可在鎖內或鎖外寄信');
console.log('test 寫入後 flush 失敗: pass');

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

const formulaPayload = eight[5].payload;
assert(formulaPayload.note === NOTE, '公式案例的備註仍是原句');
assert(formulaPayload.utmCampaign === '=1+1', '公式案例要用活動欄放 =1+1');
assert(formulaPayload.utmContent === '+1+1', '公式案例要用內容欄放 +1+1');
assert(formulaPayload.utmTerm === '-1+1', '公式案例要用關鍵字放 -1+1');
assert(formulaPayload.utmAdgroup === '@cmd', '公式案例要用廣告群組放 @cmd');
assert(eightMsg.includes('四種前綴都通過'), '四種前綴通過才可以部署');
const probeRows = sheetRows(runner, '公式核對');
assert(probeRows.length === 5, '公式核對要有表頭與四格');
if (probeRows.length === 5) {
  const probeMap = {};
  for (const row of probeRows.slice(1)) probeMap[row[0]] = row;
  for (const [header, raw] of [['utm活動', '=1+1'], ['utm內容', '+1+1'], ['utm關鍵字', '-1+1'], ['utm廣告群組', '@cmd']]) {
    const row = probeMap[header];
    assert(row && row[1] === JSON.stringify(raw), `${header} 原值要用 JSON 字串原樣呈現`);
    assert(row && row[2] === JSON.stringify(raw), `${header} 讀回值要用 JSON 字串原樣呈現`);
    assert(row && row[1] !== '=+' + raw.slice(1) && row[2] !== '=+1+1', `${header} 報告分頁不可把 + 補成 =+`);
    assert(row && row[3] === '（空）', `${header} 的 getFormula 要為空`);
    assert(row && row[4] === '通過', `${header} 不符就不可算通過`);
  }
}
const forced = loadIsolated({ forceFormula: true });
const forcedMsg = String(forced.sandbox.runIsolatedEightCases());
assert(forcedMsg.includes('不要部署') && forcedMsg.includes('不要開網頁驗收'), '任一格不符就要失敗，不准進入部署和網頁驗收');
assert(!sheetRows(forced, '訂單').some((row) => row[0] === 'SMC900106'), '公式核對失敗後不可繼續後面的案例');
assert(runbook.includes('getFormula') && runbook.includes('+1+1') && runbook.includes('-1+1') && runbook.includes('@cmd'), '手冊要列出四種原值與 getFormula');
assert(runbook.includes('Google Sheets API') && runbook.includes('RAW') && runbook.includes('同一張表') && runbook.includes('表頭以下'), '手冊要寫進階服務、RAW，以及同一張表清除表頭以下的內容');
assert(!runbook.includes('或新建一張試算表'), '重跑說明只留同一張表清除內容，不要再教換新試算表');
assert(runbook.includes('可能再授權') && runbook.includes('清除內容') && runbook.includes('所有案例都會被判成重複'), '手冊要寫可能再授權、清除內容，以及沒清訂單和郵件預覽時全部變成重複');
assert(!runbook.includes('會再授權'), '手冊不要寫成一定會再授權');

const reportSheet = loadIsolated();
reportSheet.box.byId['isolated-test-sheet'].id = 'isolated-test-sheet';
reportSheet.sandbox.writeResultSheet_(reportSheet.box.byId['isolated-test-sheet'], [
  ['案例', '訂單編號', '結果', '寫入', '寄信'],
  ['加號', '+1+1', 'success', '是', '是'],
]);
reportSheet.sandbox.SpreadsheetApp.flush();
const reportRows = sheetRows(reportSheet, '驗收結果');
assert(reportRows[1] && reportRows[1][1] === JSON.stringify('+1+1') && reportRows[1][1] !== '=+1+1', '驗收結果裡以 + 開頭的內容要原樣呈現');

const deferred = loadIsolated();
const deferredBook = deferred.box.byId['isolated-test-sheet'];
const deferredDemo = deferredBook.insertSheet('延後清除');
deferredDemo.appendRow(['仍在']);
assert(deferredDemo.rows().length === 0, 'SpreadsheetApp 的 appendRow 要等 flush 才寫進儲存的列');
deferred.sandbox.SpreadsheetApp.flush();
assert(deferredDemo.rows().length === 1 && deferredDemo.rows()[0][0] === '仍在', 'flush 後 appendRow 才生效');
deferredDemo.clear();
assert(deferredDemo.rows().length === 1, 'SpreadsheetApp 的 clear 要等 flush 才生效');
deferred.sandbox.SpreadsheetApp.flush();
assert(deferredDemo.rows().length === 0, 'flush 後 clear 才把儲存的列清掉');
deferredBook.id = 'isolated-test-sheet';
for (const name of ['驗收結果', '公式核對']) {
  const seeded = deferredBook.insertSheet(name);
  seeded.appendRow(name === '驗收結果' ? ['案例', '訂單編號', '結果', '寫入', '寄信'] : ['欄位', '原值', '讀回值', 'getFormula', '判定']);
}
deferred.sandbox.SpreadsheetApp.flush();
const deferredMsg = String(deferred.sandbox.runIsolatedEightCases());
deferred.sandbox.SpreadsheetApp.flush();
const deferredResults = sheetRows(deferred, '驗收結果');
const deferredProbes = sheetRows(deferred, '公式核對');
assert(deferredResults.length === 9, '報告被延後的 clear 洗掉：腳本結束的 flush 之後，驗收結果應仍有 9 列');
assert(deferredProbes.length === 5, '報告被延後的 clear 洗掉：腳本結束的 flush 之後，公式核對應仍有 5 列');
assert(deferredMsg.includes('四種前綴都通過') && !deferredMsg.includes('結果未知'), '報告留住時八案例才算通過');

const blankRead = loadIsolated();
blankRead.box.blankReportRead = true;
const blankReadMsg = String(blankRead.sandbox.runIsolatedEightCases());
assert(blankReadMsg.includes('結果未知') && blankReadMsg.includes('驗收結果') && blankReadMsg.includes('公式核對'), '讀回列數不對要標成未知，並寫明兩張分頁');
assert(blankReadMsg.includes('讀回') && blankReadMsg.includes('預期'), '讀回失敗要寫明實際列數和預期列數');
assert(!blankReadMsg.includes('才可以部署'), '報告讀回是空白時不可說可以部署');

const noSheets = loadIsolated();
delete noSheets.sandbox.Sheets;
const noSheetsRes = post(noSheets, previewPayload(brandFields, 'SMC900801'));
assert(noSheetsRes.status === 'error' && noSheetsRes.wrote === false && noSheetsRes.mailed !== true, '沒啟用進階服務要在寫入前回錯誤，不可標成已寄出');
assert(noSheets.box.mails.length === 0 && sheetRows(noSheets, '訂單').length === 0, '沒啟用進階服務不可寫表或寄信');
assert(String(noSheets.sandbox.runIsolatedEightCases()).includes('沒有寫入'), '沒啟用進階服務時八案例要停住');

const blankMail = loadIsolated();
blankMail.props.SMC_SHOP_EMAIL = '';
const blankBooking = blankMail.sandbox.acceptBooking_(previewPayload(brandFields, 'SMC900701'));
assert(blankBooking.response.status === 'error' && blankBooking.wrote === false && blankBooking.mailed === false && blankBooking.response.mailed !== true, '信箱空白要直接回錯誤，不寫表、不寄信，也不可標成已寄出');
assert(blankMail.box.mails.length === 0 && sheetRows(blankMail, '訂單').length === 0, '信箱空白不可寫表或寄信');
const blankRun = String(blankMail.sandbox.runIsolatedEightCases());
assert(blankRun.includes('沒有寫入') && blankRun.includes('沒有寄信'), '信箱空白時八案例要停住');
assert(blankMail.box.mails.length === 0 && sheetRows(blankMail, '訂單').length === 0, '八案例在信箱空白時仍不可寫表或寄信');
const badMail = loadIsolated();
badMail.props.SMC_SHOP_EMAIL = 'not-an-email';
const badBooking = badMail.sandbox.acceptBooking_(previewPayload(brandFields, 'SMC900702'));
assert(badBooking.response.status === 'error' && badBooking.wrote === false && badBooking.mailed === false, '信箱格式錯誤要直接回錯誤，不寫表、不寄信');
assert(badMail.box.mails.length === 0 && sheetRows(badMail, '訂單').length === 0, '信箱格式錯誤不可寫表或寄信');

const readbackSrc = gs.slice(gs.indexOf('var readError'));
assert(readbackSrc.includes('SpreadsheetApp.flush()'), '最後讀回報告的開頭要先 flush');
const lateClear = loadIsolated();
const realWriteResult = lateClear.sandbox.writeResultSheet_;
lateClear.sandbox.writeResultSheet_ = function (ss, lines) {
  const written = realWriteResult(ss, lines);
  ss.getSheetByName('驗收結果').clear();
  return written;
};
const lateMsg = String(lateClear.sandbox.runIsolatedEightCases());
lateClear.sandbox.SpreadsheetApp.flush();
assert(lateMsg.includes('結果未知') && lateMsg.includes('驗收結果') && lateMsg.includes('讀回 0') && lateMsg.includes('預期 9'), '讀回前先 flush，延後的 clear 要報結果未知，並列出 0 列和預期 9 列');
assert(!lateMsg.includes('四種前綴都通過'), '延後的 clear 把報告洗掉時不可說四種前綴都通過');
assert(sheetRows(lateClear, '驗收結果').length === 0, '這個突變在腳本結束後驗收結果是空的');

const noteLogs = [];
const note = loadIsolated();
note.sandbox.console = {
  log(...args) { noteLogs.push(args.map((item) => String(item)).join(' ')); },
};
note.sandbox.SpreadsheetApp.getUi = function () {
  return { alert() { throw new Error('沒有試算表介面'); } };
};
let noteThrew = false;
try {
  note.sandbox.notify_('已送出 8 筆。四種前綴都通過');
} catch (err) {
  noteThrew = true;
}
assert(!noteThrew, 'notify_ 只記執行紀錄，不可外拋');
assert(noteLogs.some((line) => line.includes('四種前綴都通過')), 'notify_ 要把訊息寫進 console.log');

const mismatch = loadIsolated();
mismatch.box.mutateReportCell = true;
const mismatchMsg = String(mismatch.sandbox.runIsolatedEightCases());
assert(mismatchMsg.includes('結果未知') && mismatchMsg.includes('實際：tampered') && mismatchMsg.includes('預期：success'), '內容不符要寫出實際值和預期值');

const probeBoom = loadIsolated();
probeBoom.sandbox.writeProbeSheet_ = function () { throw new Error('probe write failed'); };
const probeMsg = String(probeBoom.sandbox.runIsolatedEightCases());
assert(probeMsg.includes('結果未知') && probeMsg.includes('6 公式開頭') && probeMsg.includes('公式核對寫入') && probeMsg.includes('確認寄出 12 封'), '公式核對寫入失敗要寫明停在哪一步，以及確認寄出幾封');
assert(probeBoom.box.mails.length === 12, '停在案例 6 時已經寄出 12 封');
assert(!sheetRows(probeBoom, '訂單').some((row) => row[0] === 'SMC900106'), '公式核對寫入失敗後不可繼續案例 7');

const trail = loadIsolated();
const trailBook = trail.box.byId['isolated-test-sheet'];
trailBook.id = 'isolated-test-sheet';
const trailWritten = trail.sandbox.writeResultSheet_(trailBook, [
  ['案例', '訂單編號', '結果', '寫入', '寄信'],
  ['尾端空白', 'SMC900199', 'success', '是', ''],
]);
const trailActual = trail.sandbox.readSheetValues_(trailBook.getSheetByName('驗收結果'));
assert(trailActual[1] && trailActual[1].length === 4, 'API 讀回要省略列尾的空欄');
assert(trail.sandbox.reportProblem_('驗收結果', trailActual, trailWritten) === '', '列尾空欄被 API 省略時要補齊再比對');

const verification = readFileSync(join(root, unpublishedDir, 'isolated-e2e-verification.md'), 'utf8');
const spec = readFileSync(join(root, 'docs/booking-attribution.md'), 'utf8');
assert(!verification.includes('不再默默留下空白'), '文件要刪掉不再默默留下空白');
assert(!verification.includes('案例 7、8 的'), '案例 8 是重複編號，不會 flush');
assert(verification.includes('移植到正式腳本要另外驗證'), '文件要寫移植到正式腳本要另外驗證');
assert(verification.includes('PR37') && verification.includes('getLastRow()+1') && verification.includes('RAW 全文字'), '開旗標前的三項要在文件裡寫清楚');
assert(spec.includes('--experimental-websocket') && spec.includes('Node 20') && spec.includes('Node 22'), '說明要寫 Node 20 的瀏覽器測試要加 --experimental-websocket，Node 22 不用');
assert(spec.includes('test-booking-attribution.mjs') && spec.includes('test-isolated-dining-check.mjs') && spec.includes('已移除'), '瀏覽器測試只留 attribution，dining-check 要標成已移除');
assert(runbook.includes('執行記錄'), '手冊要寫執行記錄也有同一段結果');

const flushBoom = loadIsolated();
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

const probeRead = loadIsolated();
const realProbeGet = probeRead.sandbox.Sheets.Spreadsheets.Values.get;
probeRead.sandbox.Sheets.Spreadsheets.Values.get = function (id, range) {
  if (String(range).includes('公式核對')) throw new Error('公式核對 get 失敗');
  return realProbeGet.apply(this, arguments);
};
const probeReadMsg = String(probeRead.sandbox.runIsolatedEightCases());
assert(probeReadMsg.includes('結果未知') && probeReadMsg.includes('公式核對') && probeReadMsg.includes('公式核對 get 失敗'), '公式核對讀回失敗要寫明分頁和錯誤');

const resultBoom = loadIsolated();
resultBoom.sandbox.writeResultSheet_ = function () { throw new Error('驗收結果寫入失敗'); };
const resultBoomMsg = String(resultBoom.sandbox.runIsolatedEightCases());
assert(resultBoomMsg.includes('結果未知') && resultBoomMsg.includes('驗收結果') && resultBoomMsg.includes('驗收結果寫入失敗'), '驗收結果寫入失敗要寫明分頁和錯誤');

const partialCount = loadIsolated();
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
assert(partialCountMsg.includes('確認寄出 11 封'), '部分寄信要算已確認成功的 11 封，不可寫成 10');
assert(partialCountMsg.includes('未確認寄出 1 封') && partialCountMsg.includes('不要補寄'), '丟錯的那封要標成未確認寄出，而且不要補寄');
assert(!partialCountMsg.includes('確認寄出 10 封') && !partialCountMsg.includes('沒有寄出'), '不可寫成 10 封，也不可保證沒有寄出');

const alertLogs = [];
const alertRun = loadIsolated();
alertRun.sandbox.console = {
  log(...args) { alertLogs.push(args.map((item) => String(item)).join(' ')); },
};
alertRun.sandbox.SpreadsheetApp.getUi = function () {
  return { alert() { throw new Error('沒有試算表介面'); } };
};
const alertMsg = String(alertRun.sandbox.runIsolatedEightCases());
assert(alertMsg.includes('四種前綴都通過') && !alertMsg.includes('結果未知'), '八案例只記執行紀錄，alert 丟錯仍回成功摘要');
assert(alertLogs.some((line) => line.includes('四種前綴都通過')), '八案例成功摘要仍要進執行記錄');

assert(!verification.includes('API 寫入不會更新這份快取'), '快取那句沒有官方來源，要改掉');
assert(verification.includes('不可依賴') && verification.includes('即時一致'), '快取要改成不可依賴跨服務即時一致');
assert(verification.includes('真表上觀察到') && verification.includes('模擬重現'), '根因要分開真表觀察和模擬重現');
assert(verification.includes('確認 Pages 建置仍把 .github/pages-unpublished 排除在公開網站之外'), '開旗標前要確認 Pages 仍排除未公開目錄');
assert(runbook.includes('沒有完整摘要') && runbook.includes('不算通過'), '手冊要寫執行紀錄沒有完整摘要就停、不算通過');

if (failures.length) {
  console.error('reconciliation failed:');
  failures.forEach((line) => console.error(' -', line));
  process.exit(1);
}
console.log('reconciliation: browser, flag-off POST, isolated sheet, guest mail, shop mail agree');
