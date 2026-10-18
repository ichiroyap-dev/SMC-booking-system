#!/usr/bin/env node
// Pre-flag fixes. Does not call script.google.com, send mail, or open a sheet.
// Usage: node tools/test-preflag-fixes.mjs [--item 1|2|3|4|5|nit1|nit2|nit3|nit4]
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const attr = require(join(root, 'js/booking-attribution.js'));
const unpublished = '.github/pages-unpublished';
const gsPath = join(root, unpublished, 'booking-attribution-isolated.gs');
const gs = readFileSync(gsPath, 'utf8');
const source = readFileSync(join(root, 'js/booking-attribution.js'), 'utf8');
const runbook = readFileSync(join(root, unpublished, 'booking-attribution-isolated-runbook.md'), 'utf8');
const verification = readFileSync(join(root, unpublished, 'isolated-e2e-verification.md'), 'utf8');
const spec = readFileSync(join(root, 'docs/booking-attribution.md'), 'utf8');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

const FIXED_TIME = '2026-10-08T00:00:00.000Z';
const EPOCH = Date.UTC(1899, 11, 30);
const DATE_SERIAL = (Date.UTC(2026, 9, 22) - EPOCH) / 86400000;
const TIME_SERIAL = 0.5;
// 2026-10-08T00:00:00.000Z 的台北牆鐘是 08:00。不是把 UTC 瞬時直接換成序號。
const RECEIVED_SERIAL = (Date.UTC(2026, 9, 8, 8, 0, 0) - EPOCH) / 86400000;
const LIVE_ID = 'AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q';
const NOTE = '散客 大人2位；靠窗';

function columnIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
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
  const pair = cells.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (pair) return { name, row: Number(pair[2]), col: columnIndex(pair[1]), endRow: Number(pair[4]), endCol: columnIndex(pair[3]) };
  const single = cells.match(/^([A-Z]+)(\d+)$/);
  if (single) {
    const row = Number(single[2]);
    const col = columnIndex(single[1]);
    return { name, row, col, endRow: row, endCol: col };
  }
  throw new Error('bad range ' + range);
}

function enterLikeSheets(input) {
  let text = input == null ? '' : String(input);
  if (text.charAt(0) === "'") text = text.slice(1);
  if (text.charAt(0) === '=') return '2';
  return text;
}

function formatInZone(date, timeZone, pattern) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date instanceof Date ? date : new Date(date))) parts[part.type] = part.value;
  const map = { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour === '24' ? '00' : parts.hour, mm: parts.minute, ss: parts.second };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => map[token]);
}

function memorySpreadsheet() {
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
    const server = [];
    const pending = [];
    const formats = [];
    function put(list, r, c, value) {
      const line = list[r] ? list[r].slice() : [];
      line[c] = value;
      list[r] = line;
    }
    return {
      formats,
      getMaxRows() { return 1000; },
      getLastRow() { return cache.length; },
      padFormattedTail(n) {
        for (let i = 0; i < n; i += 1) cache.push([]);
      },
      appendRow(row) {
        const copy = row.slice();
        const index = cache.length;
        cache.push(copy);
        pending.push({ type: 'row', index, row: copy });
      },
      clear() {
        cache.length = 0;
        pending.push({ type: 'clear' });
      },
      clearServer() {
        server.length = 0;
        cache.length = 0;
      },
      applyPending() {
        const ops = pending.splice(0, pending.length);
        for (const op of ops) {
          if (op.type === 'clear') server.length = 0;
          else if (op.type === 'row') server[op.index] = op.row.slice();
        }
        cache.length = 0;
        for (let i = 0; i < server.length; i += 1) cache.push(server[i] ? server[i].slice() : []);
      },
      appendRaw(matrix, insertRows, mode) {
        let last = -1;
        for (let i = 0; i < server.length; i += 1) {
          const line = server[i] || [];
          if (line.some((cell) => cell != null && cell !== '')) last = i;
        }
        const at = last + 1;
        for (let r = 0; r < matrix.length; r += 1) {
          const stored = (matrix[r] || []).map((cell) => {
            if (mode === 'RAW' && typeof cell === 'number' && isFinite(cell)) return cell;
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
      getRange(row, col, numRows, numCols) {
        const rowsN = numRows == null ? 1 : numRows;
        const colsN = numCols == null ? 1 : numCols;
        return {
          setNumberFormat(fmt) {
            formats.push({ row, col, numRows: rowsN, numCols: colsN, fmt });
            return this;
          },
          setValues(values) {
            for (let r = 0; r < rowsN; r += 1) {
              for (let c = 0; c < colsN; c += 1) put(cache, row - 1 + r, col - 1 + c, enterLikeSheets(values[r][c]));
            }
          },
          setRawValues(values) {
            for (let r = 0; r < values.length; r += 1) {
              for (let c = 0; c < values[r].length; c += 1) {
                const cell = values[r][c];
                const stored = typeof cell === 'number' && isFinite(cell) ? cell : (cell == null ? '' : String(cell));
                put(cache, row - 1 + r, col - 1 + c, stored);
                put(server, row - 1 + r, col - 1 + c, stored);
              }
            }
          },
          getValues() {
            const out = [];
            for (let r = 0; r < rowsN; r += 1) {
              const line = cache[row - 1 + r] || [];
              const slice = [];
              for (let c = 0; c < colsN; c += 1) slice.push(line[col - 1 + c] == null ? '' : line[col - 1 + c]);
              out.push(slice);
            }
            return out;
          },
          getValue() {
            const line = cache[row - 1] || [];
            return line[col - 1] == null ? '' : line[col - 1];
          },
          getFormula() { return ''; },
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

function loadIsolated() {
  const props = {
    SMC_ATTRIBUTION_ISOLATED: 'yes',
    SMC_SHOP_EMAIL: 'shop-test@example.com',
    SMC_TEST_SHEET_ID: 'isolated-test-sheet',
  };
  const box = { byId: {}, mails: [], rawWrites: [], alerts: [], lockHeld: false, lockLog: [] };
  const marked = memorySpreadsheet();
  const marker = marked.insertSheet('隔離標記');
  marker.appendRow(['SMC-ISOLATED-TEST']);
  box.byId['isolated-test-sheet'] = marked;
  const sandbox = {
    console,
    Date,
    Utilities: { formatDate: formatInZone },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput(text) { return { setMimeType() { return this; }, getContent() { return text; } }; } },
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
        if (!box.byId[id]) box.byId[id] = memorySpreadsheet();
        box.byId[id].id = id;
        return box.byId[id];
      },
      flush() {
        box.lockLog.push(box.lockHeld ? 'flush-held' : 'flush-free');
        Object.keys(box.byId).forEach((id) => box.byId[id].flushPending());
      },
      getUi() {
        return { alert(message) { box.alerts.push(String(message)); }, createMenu() { return { addItem() { return this; }, addToUi() {} }; } };
      },
    },
    MailApp: {
      sendEmail(to, subject, body) {
        box.mails.push({ to, subject, body });
      },
    },
    Sheets: {
      Spreadsheets: {
        Values: {
          update(resource, spreadsheetId, range, options) {
            const mode = options && options.valueInputOption;
            box.rawWrites.push({ op: 'update', mode, range, lockHeld: box.lockHeld });
            const parsed = parseA1(range);
            const sheet = box.byId[spreadsheetId].getSheetByName(parsed.name);
            const values = resource && resource.values ? resource.values : [];
            const target = sheet.getRange(parsed.row, parsed.col, parsed.endRow - parsed.row + 1, parsed.endCol - parsed.col + 1);
            if (mode === 'RAW') target.setRawValues(values);
            else target.setValues(values);
            return { updatedRange: range };
          },
          append(resource, spreadsheetId, range, options) {
            const mode = options && options.valueInputOption;
            const insert = options && options.insertDataOption;
            box.rawWrites.push({ op: 'append', mode, insert, range, lockHeld: box.lockHeld });
            const parsed = parseA1(range);
            const sheet = box.byId[spreadsheetId].getSheetByName(parsed.name);
            sheet.appendRaw(resource && resource.values ? resource.values : [], insert === 'INSERT_ROWS', mode);
          },
          clear(resource, spreadsheetId, range) {
            const parsed = parseA1(range);
            box.byId[spreadsheetId].getSheetByName(parsed.name).clearServer();
          },
          get(spreadsheetId, range) {
            const parsed = parseA1(range);
            const rows = box.byId[spreadsheetId].getSheetByName(parsed.name).rows();
            return { values: rows.map((row) => row.slice()) };
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

function sheetRows(isolated, name) {
  const ss = isolated.box.byId[isolated.props.SMC_TEST_SHEET_ID];
  const sheet = ss && ss.getSheetByName(name);
  return sheet ? sheet.rows() : [];
}

function rowById(isolated, id) {
  const rows = sheetRows(isolated, '訂單');
  const found = rows.slice(1).find((row) => row[0] === id);
  if (!found) return null;
  const out = {};
  rows[0].forEach((key, index) => { out[key] = found[index] == null ? '' : found[index]; });
  return out;
}

function basePayload(extra) {
  return Object.assign({
    action: 'book',
    type: 'dining',
    name: '測試同學',
    phone: '0900000000',
    email: 'shop-test@example.com',
    people: '2',
    tables: '1',
    date: '2026-10-22',
    time: '12:00',
    note: NOTE,
    orderItems: '',
  }, extra || {});
}

function guard(fn) {
  try { fn(); } catch (err) { failures.push('拋出：' + (err && err.stack ? err.stack : err)); }
}

function item1() {
  assert(source.includes('SEND_ATTRIBUTION_TO_BACKEND = false'), '旗標必須維持 false');
  for (const prefix of ['=', '+', '-', '@']) {
    const sample = prefix + '1+1';
    assert(attr.plainSheetText(sample) === sample, `plainSheetText(${sample}) 要原樣送出，不可加單引號`);
  }
  assert(attr.plainSheetText("'靠窗") === "'靠窗", '一般單引號要原樣留下');
  assert(attr.plainSheetText('brand') === 'brand', '一般文字不可被改');
  const store = attr.memoryStorage();
  const query = '?utm_source=' + encodeURIComponent('=1+1')
    + '&utm_medium=' + encodeURIComponent('+1+1')
    + '&utm_campaign=' + encodeURIComponent('-1+1')
    + '&utm_term=' + encodeURIComponent('@cmd')
    + '&utm_content=' + encodeURIComponent("'原樣");
  attr.capture(query, store, 1700000000000, 'navigate');
  const fields = attr.bookingFields(store, 1700000000000);
  assert(fields.utmSource === '=1+1' && fields.utmMedium === '+1+1' && fields.utmCampaign === '-1+1' && fields.utmTerm === '@cmd', '前端四種前綴要是原文');
  assert(fields.utmContent === "'原樣", '前端本來就有的單引號要留下');
  assert(!String(fields.utmSource).startsWith("'"), '前端不可在 = 前面加單引號');
  const live = attr.payloadForBooking(basePayload(), fields);
  assert(!('source' in live) && !('utmSource' in live), '旗標關閉時正式 POST 仍不可帶來源');
  guard(() => {
    const isolated = loadIsolated();
    const payload = attr.payloadIfAttributionEnabled(basePayload({
      name: "'測試同學",
      note: "'靠窗",
      phone: '0900000000',
    }), fields);
    payload._testOrderId = 'SMC910001';
    const res = isolated.sandbox.acceptBooking_(payload);
    assert(res.response && res.response.status === 'success', '整合：前端 payload 要能收單');
    const row = rowById(isolated, 'SMC910001');
    assert(row && row['utm來源'] === '=1+1' && row['utm媒介'] === '+1+1' && row['utm活動'] === '-1+1' && row['utm關鍵字'] === '@cmd', '整合：四種前綴要原樣存回');
    assert(row && row['utm內容'] === "'原樣", '整合：來源裡本來的單引號要原樣存回');
    assert(row && row['姓名'] === "'測試同學" && row['備註'] === "'靠窗", '整合：姓名和備註開頭的單引號不可刪');
    assert(row && row['姓名'] !== '測試同學' && row['備註'] !== '靠窗', '整合：不可把客人打的單引號吃掉');
    const quotedFormula = basePayload({ name: "'=1+1", note: "'+1+1", _testOrderId: 'SMC910002' });
    const quotedRes = isolated.sandbox.acceptBooking_(quotedFormula);
    const quotedRow = rowById(isolated, 'SMC910002');
    assert(quotedRes.response && quotedRes.response.status === 'success', '客人打了單引號加公式字元仍要收單');
    assert(quotedRow && quotedRow['姓名'] === "'=1+1" && quotedRow['備註'] === "'+1+1", '後端不可一律刪掉使用者欄位開頭的單引號');
  });
}

function item2() {
  assert(!/Values\.append/.test(gs), '資料列不可再 append 到 A1');
  assert(gs.includes('tableRange=') && gs.includes('updatedRange'), '要寫出 tableRange，並核對 updatedRange');
  assert(!/getLastRow\(\)\s*\+\s*1/.test(gs), '不可再使用 getLastRow()+1 決定寫入列');
  guard(() => {
    const isolated = loadIsolated();
    const book = isolated.box.byId['isolated-test-sheet'];
    book.id = 'isolated-test-sheet';
    const sheet = book.insertSheet('訂單');
    sheet.appendRow(['訂單編號']);
    isolated.sandbox.SpreadsheetApp.flush();
    const frozen = sheet.getLastRow();
    sheet.getLastRow = () => frozen;
    const rowA = ['SMC910011'];
    const rowB = ['SMC910012'];
    isolated.sandbox.writeRow_(sheet, rowA);
    isolated.sandbox.writeRow_(sheet, rowB);
    const ids = sheet.rows().map((row) => row[0]);
    assert(ids.filter((id) => id === 'SMC910011').length === 1 && ids.filter((id) => id === 'SMC910012').length === 1, '並發或快取停住時，兩筆不可寫進同一列');
    const writes = isolated.box.rawWrites.filter((item) => item.op === 'update' && item.range && !String(item.range).includes('1:'));
    assert(writes.length === 2 && writes.every((item) => item.mode === 'RAW'), '兩筆都要 RAW 寫到明確的列');
  });
  guard(() => {
    const isolated = loadIsolated();
    const book = isolated.box.byId['isolated-test-sheet'];
    book.id = 'isolated-test-sheet';
    const sheet = book.insertSheet('表尾');
    sheet.appendRow(['表頭']);
    isolated.sandbox.SpreadsheetApp.flush();
    sheet.padFormattedTail(4);
    assert(sheet.getLastRow() > sheet.rows().length, '表尾格式要讓 getLastRow 比有值的列還多');
    isolated.sandbox.writeRow_(sheet, ['SMC910021']);
    const rows = sheet.rows();
    assert(rows[1] && rows[1][0] === 'SMC910021', '表尾有空列或格式時，新列要接在最後一筆有值的列後面');
    assert(!rows.slice(1, -1).some((row) => !row.some((cell) => cell != null && cell !== '')), '新列和上一筆中間不可空一列');
  });
  guard(() => {
    const isolated = loadIsolated();
    const res = isolated.sandbox.acceptBooking_(basePayload({ _testOrderId: 'SMC910031' }));
    assert(res.response && res.response.status === 'success', '改走 append 後一般收單仍要成功');
    const writes = isolated.box.rawWrites.filter((item) => item.op === 'update');
    assert(writes.length >= 1 && writes.every((item) => item.lockHeld === true && item.mode === 'RAW'), '寫入時要握著 LockService');
    const orders = sheetRows(isolated, '訂單');
    assert(orders[0] && orders[0][0] === '訂單編號' && orders[1] && orders[1][0] === 'SMC910031', '表頭先落地，資料列接在表頭下一列');
  });
}

function item3() {
  const columnDoc = existsSync(join(root, 'docs/booking-sheet-columns.md'))
    ? readFileSync(join(root, 'docs/booking-sheet-columns.md'), 'utf8')
    : '';
  assert(columnDoc.length > 0, '要有逐欄儲存契約文件');
  for (const phrase of ['電話', '人數', '桌數', '日期', '時間', 'RAW', '0']) {
    assert(columnDoc.includes(phrase), `欄位契約要寫到 ${phrase}`);
  }
  assert(columnDoc.includes('開頭的 0') || columnDoc.includes('開頭 0'), '契約要寫電話保留開頭的 0');
  assert(spec.includes('docs/booking-sheet-columns.md') || spec.includes('逐欄'), '預約來源文件要指向欄位契約');
  guard(() => {
    const isolated = loadIsolated();
    const res = isolated.sandbox.acceptBooking_(basePayload({
      _testOrderId: 'SMC910041',
      name: "'測試同學",
      phone: '0900000000',
      people: '2',
      tables: '1',
      date: '2026-10-22',
      time: '12:00',
      note: "'靠窗",
    }));
    assert(res.response && res.response.status === 'success', '型別化寫入後仍要收單');
    const row = rowById(isolated, 'SMC910041');
    assert(row && typeof row['電話'] === 'string' && row['電話'] === '0900000000', '電話要是文字，而且保留開頭的 0');
    assert(row && typeof row['人數'] === 'number' && row['人數'] === 2, '人數要存成數字 2');
    assert(row && typeof row['桌數'] === 'number' && row['桌數'] === 1, '桌數要存成數字 1');
    assert(row && typeof row['日期'] === 'number' && Math.abs(row['日期'] - DATE_SERIAL) < 1e-6, '日期要存成試算表日期序號');
    assert(row && typeof row['時間'] === 'number' && Math.abs(row['時間'] - TIME_SERIAL) < 1e-6, '時間要存成一天的分數');
    assert(row && typeof row['收到時間'] === 'number' && Math.abs(row['收到時間'] - RECEIVED_SERIAL) < 1e-6, '收到時間要存成日期時間序號');
    assert(row && row['姓名'] === "'測試同學" && row['備註'] === "'靠窗", '自由文字仍走 RAW，單引號保留');
    assert(row && typeof row['備註'] === 'string', '備註不可被存成數字');
    const mail = sheetRows(isolated, '郵件預覽').find((line) => line[0] === 'SMC910041');
    assert(mail && String(mail[3]).includes('2026-10-22 12:00') && String(mail[3]).includes('人數：2'), '客人信仍要顯示日期、時間和人數');
    const weird = isolated.sandbox.acceptBooking_(basePayload({ _testOrderId: 'SMC910042', people: '兩位', date: '=1+1', phone: '0123' }));
    const weirdRow = rowById(isolated, 'SMC910042');
    assert(weird.response && weird.response.status === 'success', '不像數字的人數仍要收單');
    assert(weirdRow && weirdRow['人數'] === '兩位' && typeof weirdRow['人數'] === 'string', '不像整數的人數要留成文字，不可變成 0');
    assert(weirdRow && weirdRow['日期'] === '=1+1' && weirdRow['日期'] !== 2, '日期欄如果是公式開頭，要當文字留下');
    assert(weirdRow && weirdRow['電話'] === '0123' && typeof weirdRow['電話'] === 'string', '較短的電話也要保留開頭的 0');
    const formats = isolated.box.byId['isolated-test-sheet'].getSheetByName('訂單').formats.map((item) => item.fmt);
    assert(formats.includes('@') && formats.includes('yyyy-mm-dd') && formats.includes('hh:mm') && formats.includes('0'), '電話、日期、時間、人數要設對應的儲存格格式');
  });
}

function item4() {
  const path = join(root, unpublished, 'production-port-checklist.md');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  assert(text.length > 0, '要有正式腳本移植清單');
  for (const phrase of ['doPost', '11', 'values.update', 'updatedRange', 'https://www.googleapis.com/auth/spreadsheets', LIVE_ID, '回滾', 'Sheets']) {
    assert(text.includes(phrase), `移植清單要寫到 ${phrase}`);
  }
  assert(text.includes('不要部署') || text.includes('這輪不部署'), '清單要寫這輪不部署');
  assert(source.includes('SEND_ATTRIBUTION_TO_BACKEND = false'), '這輪不可打開旗標');
  assert(indexHtml.includes(LIVE_ID), '正式 web app 網址不可改');
  assert(!/^function doPost\s*\(/m.test(gs), '隔離腳本不可新增 doPost');
}

function item5() {
  const script = join(root, 'tools/check-pages-unpublished.mjs');
  assert(existsSync(script), '要有可重複執行的 Pages 排除檢查');
  if (!existsSync(script)) return;
  const ran = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert(ran.status === 0, 'Pages 排除檢查結束碼要是 0，實際 ' + ran.status + '\n' + (ran.stdout || '') + (ran.stderr || ''));
}

function nit1() {
  assert(runbook.includes('客人的信寄失敗後，仍然會寄店內的信'), '手冊要寫客人信失敗後仍寄店內信');
  guard(() => {
    const isolated = loadIsolated();
    let guestTries = 0;
    let shopTries = 0;
    isolated.sandbox.MailApp.sendEmail = function (to, subject, body) {
      if (String(subject).includes('預約申請已收到')) {
        guestTries += 1;
        throw new Error('guest send failed');
      }
      if (String(subject).includes('店內對帳')) {
        shopTries += 1;
        isolated.box.mails.push({ to, subject, body });
      }
    };
    const res = isolated.sandbox.acceptBooking_(basePayload({ _testOrderId: 'SMC910051' }));
    assert(res.response && res.response.status === 'success' && res.response.mailed === false, '客人信未確認時仍收單，mailed 為 false');
    assert(guestTries === 1 && shopTries === 1, '客人信寄失敗後，仍然會寄店內的信，而且不重試客人信');
    assert(isolated.box.mails.length === 1 && String(isolated.box.mails[0].subject).includes('店內對帳'), '店內信要有送出嘗試');
  });
}

function nit2() {
  assert(runbook.includes('以執行記錄的最後一行為準；分頁寫 success，不等於整輪通過。'), '手冊要寫以執行記錄最後一行為準');
}

function nit3() {
  assert(gs.includes('未確認寄出'), '寄信丟錯要寫未確認寄出');
  assert(!gs.includes('沒有寄出，不要補寄'), '不可再把 sendEmail 的錯誤寫成已經確定沒有寄出');
  guard(() => {
    const isolated = loadIsolated();
    const msg = String(isolated.sandbox.runIsolatedEightCases());
    assert(msg.includes('確認寄出 14 封') && msg.includes('未確認寄出 0 封'), '全成功的摘要要寫實際確認寄出 14 封、未確認 0 封');
    assert(msg.includes('四種前綴都通過'), '四種前綴通過的句子要留著');
  });
  guard(() => {
    const isolated = loadIsolated();
    isolated.sandbox.MailApp.sendEmail = function (to, subject, body) {
      if (String(subject).includes('預約申請已收到')) throw new Error('guest send failed');
      isolated.box.mails.push({ to, subject, body });
    };
    const msg = String(isolated.sandbox.runIsolatedEightCases());
    assert(msg.includes('確認寄出 7 封') && msg.includes('未確認寄出 7 封'), '客人信都丟錯時，摘要要寫 7 封確認、7 封未確認');
    assert(msg.includes('不要補寄'), '未確認的信不要補寄');
    assert(!msg.includes('沒有寄出'), '不可寫成沒有寄出');
    assert(isolated.box.mails.length === 7, '七筆新單的店內信仍要各寄一次');
  });
}

function nit4() {
  assert(verification.includes('9') && verification.includes('7') && verification.includes('14') && verification.includes('11'), '文件要同時寫下 9／7 和 14／11');
  assert(verification.includes('355da77:.github/pages-unpublished/booking-attribution-isolated.gs'), '重現指令要能換回 355da77 的腳本');
  assert(verification.includes('355da77:.github/pages-unpublished/isolated-e2e-verification.md'), '另一種重現要把驗證文件也換回 355da77');
  assert(verification.includes('只換腳本') || verification.includes('只換 .gs') || verification.includes('新文件'), '要寫明只換腳本、文件留在新版');
}

const items = { 1: item1, 2: item2, 3: item3, 4: item4, 5: item5, nit1, nit2, nit3, nit4 };
const asked = process.argv.includes('--item') ? process.argv[process.argv.indexOf('--item') + 1] : 'all';
const selected = asked === 'all' ? Object.keys(items) : [asked];
if (selected.some((name) => !items[name])) {
  console.error('未知項目 ' + asked);
  process.exit(2);
}
for (const name of selected) items[name]();
if (failures.length) {
  console.error('preflag item ' + asked + ' failed: ' + failures.length);
  failures.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
console.log('preflag item ' + asked + ': pass');
