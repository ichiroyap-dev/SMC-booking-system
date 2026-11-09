#!/usr/bin/env node
// PR47 round 9. Does not call script.google.com, send mail, or open a real sheet.
// Red: this file against the pinned script 404b6c4. Green: the same commands after the fix.
// Usage: node tools/test-pr47-r9.mjs [--item log|err|keep|docs]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gsPath = join(root, '.github/pages-unpublished/booking-attribution-isolated.gs');
const gs = readFileSync(gsPath, 'utf8');
const checklistPath = join(root, '.github/pages-unpublished/production-port-checklist.md');
const checklist = existsSync(checklistPath) ? readFileSync(checklistPath, 'utf8') : '';
const verification = readFileSync(join(root, '.github/pages-unpublished/isolated-e2e-verification.md'), 'utf8');
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

function columnIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

function columnLetter(n) {
  let out = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

const ZZ = columnIndex('ZZ');
const AAA = columnIndex('AAA');

function parseA1(range) {
  const text = String(range);
  const bang = text.lastIndexOf('!');
  if (bang < 0) {
    let name = text;
    if (name.charAt(0) === "'" && name.charAt(name.length - 1) === "'") name = name.slice(1, -1).replace(/''/g, "'");
    return { name, entire: true };
  }
  let name = text.slice(0, bang);
  const cells = text.slice(bang + 1);
  if (name.charAt(0) === "'" && name.charAt(name.length - 1) === "'") name = name.slice(1, -1).replace(/''/g, "'");
  const columns = cells.match(/^([A-Z]+):([A-Z]+)$/);
  if (columns) return { name, entire: false, col: columnIndex(columns[1]), endCol: columnIndex(columns[2]), allRows: true };
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

// values.get omits trailing empty rows and the empty cells at the end of each row.
function trimApiGrid(grid) {
  const copy = grid.map((row) => (row || []).slice());
  while (copy.length) {
    const last = copy[copy.length - 1];
    if (last.some((cell) => cell != null && cell !== '')) break;
    copy.pop();
  }
  return copy.map((row) => {
    const line = row.slice();
    while (line.length && (line[line.length - 1] == null || line[line.length - 1] === '')) line.pop();
    return line;
  });
}

function formatInZone(date, timeZone, pattern) {
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date instanceof Date ? date : new Date(date));
  const parts = {};
  for (const part of text) parts[part.type] = part.value;
  const map = {
    yyyy: parts.year,
    MM: parts.month,
    dd: parts.day,
    HH: parts.hour === '24' ? '00' : parts.hour,
    mm: parts.minute,
    ss: parts.second,
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => map[token]);
}

function loadIsolated() {
  const props = {
    SMC_ATTRIBUTION_ISOLATED: 'yes',
    SMC_SHOP_EMAIL: 'shop-test@example.com',
    SMC_TEST_SHEET_ID: 'isolated-test-sheet',
  };
  const logs = [];
  const box = { byId: {}, mails: [], rawWrites: [], gets: [], logs, lockHeld: false, lieUpdatedRange: '', lieAtRow: 0, singleCellForm: false, alerts: [] };
  function makeBook() {
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
      const cells = new Map();
      function key(r, c) { return r + ',' + c; }
      function read(r, c) { return cells.get(key(r, c)) || { value: '', formula: '' }; }
      function write(r, c, value, formula) {
        const stored = typeof value === 'number' && Number.isFinite(value) ? value : (value == null ? '' : String(value));
        if (stored === '' && !formula) {
          cells.delete(key(r, c));
          return;
        }
        cells.set(key(r, c), { value: stored, formula: formula || '' });
      }
      function bounds() {
        let maxRow = 0;
        let maxCol = 0;
        for (const id of cells.keys()) {
          const [r, c] = id.split(',').map(Number);
          if (r + 1 > maxRow) maxRow = r + 1;
          if (c + 1 > maxCol) maxCol = c + 1;
        }
        return { maxRow, maxCol };
      }
      return {
        getMaxRows() { return 1000; },
        getLastRow() { return bounds().maxRow; },
        plantCell(row, col, value, formula) { write(row, col, value, formula); },
        formulaAt(row, col) { return read(row, col).formula; },
        valueAt(row, col) { return read(row, col).value; },
        rows() {
          const { maxRow, maxCol } = bounds();
          const out = [];
          for (let r = 0; r < maxRow; r += 1) {
            const line = [];
            for (let c = 0; c < maxCol; c += 1) line.push(read(r, c).value);
            out.push(line);
          }
          return out;
        },
        getRange(row, col, numRows, numCols) {
          const rowsN = numRows == null ? 1 : numRows;
          const colsN = numCols == null ? 1 : numCols;
          return {
            setNumberFormat() { return this; },
            setRawValues(values) {
              for (let r = 0; r < values.length; r += 1) {
                for (let c = 0; c < values[r].length; c += 1) write(row - 1 + r, col - 1 + c, values[r][c], '');
              }
            },
            getValues() {
              const out = [];
              for (let r = 0; r < rowsN; r += 1) {
                const slice = [];
                for (let c = 0; c < colsN; c += 1) {
                  const cell = read(row - 1 + r, col - 1 + c);
                  slice.push(cell.value === '' ? '' : cell.value);
                }
                out.push(slice);
              }
              return out;
            },
            getValue() {
              const cell = read(row - 1, col - 1);
              return cell.value === '' ? '' : cell.value;
            },
            getFormula() { return read(row - 1, col - 1).formula; },
          };
        },
        getName() { return name; },
        getParent() { return ss; },
        apiValues(range, options) {
          const parsed = parseA1(range);
          const { maxRow, maxCol } = bounds();
          const startCol = parsed.entire ? 1 : parsed.col;
          const endCol = parsed.entire ? maxCol : Math.min(parsed.endCol, maxCol);
          const startRow = parsed.row || 1;
          const endRow = parsed.allRows || parsed.entire ? maxRow : parsed.endRow;
          const mode = options && options.valueRenderOption ? options.valueRenderOption : 'FORMATTED_VALUE';
          const grid = [];
          for (let r = startRow - 1; r < endRow; r += 1) {
            const line = [];
            for (let c = startCol - 1; c < endCol; c += 1) {
              const cell = read(r, c);
              if (mode === 'FORMULA' && cell.formula) line.push(cell.formula);
              else line.push(cell.value === '' ? '' : cell.value);
            }
            grid.push(line);
          }
          return trimApiGrid(grid);
        },
      };
    }
    return ss;
  }
  const marked = makeBook();
  const marker = marked.insertSheet('隔離標記');
  marker.plantCell(0, 0, 'SMC-ISOLATED-TEST', '');
  box.byId['isolated-test-sheet'] = marked;
  const sandbox = {
    console: { log(...args) { logs.push(args.map((item) => String(item)).join(' ')); } },
    Date,
    Utilities: { formatDate: formatInZone },
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
        if (!box.byId[id]) box.byId[id] = makeBook();
        box.byId[id].id = id;
        return box.byId[id];
      },
      flush() {},
      getUi() { return { alert(message) { box.alerts.push(String(message)); }, createMenu() { return { addItem() { return this; }, addToUi() {} }; } }; },
    },
    MailApp: { sendEmail(to, subject, body) { box.mails.push({ to, subject, body }); } },
    Sheets: {
      Spreadsheets: {
        Values: {
          update(resource, spreadsheetId, range) {
            const parsed = parseA1(range);
            const sheet = box.byId[spreadsheetId].getSheetByName(parsed.name);
            sheet.getRange(parsed.row, parsed.col, parsed.endRow - parsed.row + 1, parsed.endCol - parsed.col + 1).setRawValues(resource.values || []);
            box.rawWrites.push({ op: 'update', range, lockHeld: box.lockHeld });
            const lieHere = box.lieUpdatedRange && parsed.name === '訂單' && parsed.row > 1
              && (!box.lieAtRow || parsed.row === box.lieAtRow);
            if (lieHere) return { updatedRange: box.lieUpdatedRange };
            if (box.singleCellForm && parsed.row === parsed.endRow && parsed.col === parsed.endCol) {
              return { updatedRange: range.slice(0, range.lastIndexOf('!') + 1) + columnLetter(parsed.col) + parsed.row };
            }
            return { updatedRange: range };
          },
          clear() {},
          get(spreadsheetId, range, options) {
            box.gets.push({ range: String(range), options: options || null });
            const sheet = box.byId[spreadsheetId].getSheetByName(parseA1(range).name);
            return { values: sheet.apiValues(range, options) };
          },
        },
      },
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() { box.lockHeld = true; return true; },
          releaseLock() { box.lockHeld = false; },
        };
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(gs, sandbox, { filename: 'booking-attribution-isolated.gs' });
  return { sandbox, box };
}

function payload(extra) {
  return Object.assign({
    action: 'book',
    type: 'dining',
    name: '測試同學',
    phone: '0900000000',
    email: 'guest-test@example.com',
    people: '2',
    tables: '1',
    date: '2026-10-22',
    time: '12:00',
    note: '散客 大人2位；靠窗',
    orderItems: '',
  }, extra);
}

function orderSheet(isolated) {
  return isolated.box.byId['isolated-test-sheet'].getSheetByName('訂單');
}

const PASS_WORDS = ['四種前綴都通過', '才可以部署'];

function orderIds(isolated) {
  const sheet = orderSheet(isolated);
  return sheet ? sheet.rows().map((row) => row[0]) : [];
}

function noPassWording(label, isolated, message) {
  for (const word of PASS_WORDS) {
    assert(!message.includes(word), label + '：停下後回傳不可有「' + word + '」，實際 ' + message);
    assert(!isolated.box.alerts.some((item) => item.includes(word)), label + '：停下後 alert 不可有「' + word + '」');
    assert(!isolated.box.logs.some((item) => item.includes(word)), label + '：停下後執行記錄不可有「' + word + '」');
  }
}

const html = readFileSync(join(root, '.github/pages-unpublished/IsolatedCheck.html'), 'utf8');
const runbook = readFileSync(join(root, '.github/pages-unpublished/booking-attribution-isolated-runbook.md'), 'utf8');

function orderIdsOf(isolated) {
  const sheet = orderSheet(isolated);
  return sheet ? sheet.rows().map((row) => row[0]) : [];
}

const PROJECT_LINE = '僅使用已核對 Script ID 的專用隔離 Apps Script 專案；可沿用現有獨立專案，或使用隔離試算表的綁定專案。後續更新同一專案，禁止貼入正式、共用或其他專案。兩者皆只以 SMC_TEST_SHEET_ID 開啟已核對的測試表；獨立專案從編輯器執行，onOpen 選單僅適用綁定專案。';
const GS_STALE = '只用專用隔離試算表綁定的 Apps Script 專案，第一次建立，之後都更新同一個專案；禁止貼進正式或其他專案。';
const SAFE = '錯誤內容無法讀取';

function watchUi(isolated) {
  isolated.box.getUiCount = 0;
  isolated.box.alertCount = 0;
  const orig = isolated.sandbox.SpreadsheetApp.getUi;
  isolated.sandbox.SpreadsheetApp.getUi = function () {
    isolated.box.getUiCount += 1;
    const ui = orig.apply(this, arguments);
    const realAlert = ui.alert.bind(ui);
    ui.alert = function (msg) {
      isolated.box.alertCount += 1;
      return realAlert(msg);
    };
    return ui;
  };
}

function runCaught(fn) {
  let msg = '';
  let threw = '';
  try {
    msg = String(fn());
  } catch (err) {
    threw = String(err && err.message ? err.message : err);
  }
  return { msg, threw };
}

function nullProto() {
  return Object.create(null);
}

function getterThrow() {
  const err = {};
  Object.defineProperty(err, 'message', {
    get() { throw new Error('message getter failed'); },
  });
  return err;
}

function toStringThrow() {
  return {
    toString() { throw new Error('toString failed'); },
  };
}

function itemLog() {
  const runners = [
    ['八案例成功', (iso) => iso.sandbox.runIsolatedEightCases(), '四種前綴都通過', 14],
    ['201 成功', (iso) => iso.sandbox.runIsolatedOneBooking201(), 'SMC900201', 2],
    ['202 成功', (iso) => iso.sandbox.runIsolatedOneBooking202(), 'SMC900202', 2],
    ['203 成功', (iso) => iso.sandbox.runIsolatedOneBooking203(), 'SMC900203', 2],
  ];
  for (const [label, run, token, mails] of runners) {
    const iso = loadIsolated();
    watchUi(iso);
    const { msg, threw } = runCaught(() => run(iso));
    assert(!threw, label + ' 不可外拋，實際 ' + threw);
    assert(msg.includes(token), label + '：回傳要有摘要，實際 ' + msg);
    assert(iso.box.logs.includes(msg), label + '：回傳與執行紀錄要同一句');
    assert(iso.box.getUiCount === 0, label + '：不可呼叫 getUi，實際 ' + iso.box.getUiCount);
    assert(iso.box.alertCount === 0, label + '：不可呼叫 alert，實際 ' + iso.box.alertCount);
    assert(iso.box.mails.length === mails, label + '：信數應是 ' + mails + '，實際 ' + iso.box.mails.length);
  }

  for (const id of ['201', '202', '203']) {
    const iso = loadIsolated();
    iso.sandbox['runIsolatedOneBooking' + id]();
    watchUi(iso);
    const { msg, threw } = runCaught(() => iso.sandbox['runIsolatedOneBooking' + id]());
    assert(!threw, '重複 ' + id + ' 不可外拋，實際 ' + threw);
    assert(msg.includes('已經收過') && msg.includes('wrote=false') && msg.includes('mailed=false'), '重複 ' + id + '：要是重複摘要，實際 ' + msg);
    assert(iso.box.logs.includes(msg), '重複 ' + id + '：回傳與執行紀錄要同一句');
    assert(iso.box.getUiCount === 0 && iso.box.alertCount === 0, '重複 ' + id + '：不可呼叫 getUi／alert');
    assert(iso.box.mails.length === 2, '重複 ' + id + '：不可再寄信，實際 ' + iso.box.mails.length);
  }

  const failEight = loadIsolated();
  watchUi(failEight);
  failEight.box.lieUpdatedRange = "'其他'!A2:V2";
  failEight.box.lieAtRow = 2;
  const failEightOut = runCaught(() => failEight.sandbox.runIsolatedEightCases());
  assert(!failEightOut.threw, '八案例失敗不可外拋，實際 ' + failEightOut.threw);
  assert(failEightOut.msg.includes('結果未知'), '八案例失敗要結果未知，實際 ' + failEightOut.msg);
  assert(failEight.box.logs.includes(failEightOut.msg), '八案例失敗：回傳與執行紀錄要同一句');
  assert(failEight.box.getUiCount === 0 && failEight.box.alertCount === 0, '八案例失敗：不可呼叫 getUi／alert');

  for (const id of ['201', '202', '203']) {
    const iso = loadIsolated();
    watchUi(iso);
    iso.box.lieUpdatedRange = "'其他'!A2:V2";
    iso.box.lieAtRow = 2;
    const out = runCaught(() => iso.sandbox['runIsolatedOneBooking' + id]());
    assert(!out.threw, '失敗 ' + id + ' 不可外拋，實際 ' + out.threw);
    assert(out.msg.includes('結果未知'), '失敗 ' + id + '：要結果未知，實際 ' + out.msg);
    assert(iso.box.logs.includes(out.msg), '失敗 ' + id + '：回傳與執行紀錄要同一句');
    assert(iso.box.getUiCount === 0 && iso.box.alertCount === 0, '失敗 ' + id + '：不可呼叫 getUi／alert');
  }
}

function itemErr() {
  const kinds = [
    ['無原型', nullProto],
    ['message getter 丟錯', getterThrow],
    ['toString 丟錯', toStringThrow],
  ];
  for (const [kind, make] of kinds) {
    const eight = loadIsolated();
    eight.sandbox.acceptBooking_ = function () { throw make(); };
    const eightOut = runCaught(() => eight.sandbox.runIsolatedEightCases());
    assert(!eightOut.threw, '八案例 ' + kind + ' 不可外拋，實際 ' + eightOut.threw);
    assert(eightOut.msg.includes('結果未知'), '八案例 ' + kind + ' 要結果未知，實際 ' + eightOut.msg);
    assert(eightOut.msg.includes(SAFE), '八案例 ' + kind + ' 要用安全文字，實際 ' + eightOut.msg);

    for (const id of ['201', '202', '203']) {
      const iso = loadIsolated();
      iso.sandbox.acceptBooking_ = function () { throw make(); };
      const out = runCaught(() => iso.sandbox['runIsolatedOneBooking' + id]());
      assert(!out.threw, '單筆 ' + id + ' ' + kind + ' 不可外拋，實際 ' + out.threw);
      assert(out.msg.includes('結果未知'), '單筆 ' + id + ' ' + kind + ' 要結果未知，實際 ' + out.msg);
      assert(out.msg.includes(SAFE), '單筆 ' + id + ' ' + kind + ' 要用安全文字，實際 ' + out.msg);
    }
  }
}

function itemKeep() {
  const eight = loadIsolated();
  eight.box.lieUpdatedRange = "'其他'!A2:V2";
  eight.box.lieAtRow = 2;
  eight.sandbox.SpreadsheetApp.getUi = function () {
    return { alert() { throw nullProto(); }, createMenu() { return { addItem() { return this; }, addToUi() {} }; } };
  };
  const eightOut = runCaught(() => eight.sandbox.runIsolatedEightCases());
  assert(!eightOut.threw, '八案例先失敗再通知：不可外拋，實際 ' + eightOut.threw);
  assert(eightOut.msg.includes('結果未知'), '八案例先失敗再通知：要保留結果未知，實際 ' + eightOut.msg);
  assert(eightOut.msg.includes('1 只有原來的 11 欄') || eightOut.msg.includes('停在'), '八案例先失敗再通知：要保留原失敗摘要，實際 ' + eightOut.msg);

  for (const id of ['201', '202', '203']) {
    const iso = loadIsolated();
    iso.box.lieUpdatedRange = "'其他'!A2:V2";
    iso.box.lieAtRow = 2;
    iso.sandbox.SpreadsheetApp.getUi = function () {
      return { alert() { throw getterThrow(); }, createMenu() { return { addItem() { return this; }, addToUi() {} }; } };
    };
    const out = runCaught(() => iso.sandbox['runIsolatedOneBooking' + id]());
    assert(!out.threw, '單筆 ' + id + ' 先失敗再通知：不可外拋，實際 ' + out.threw);
    assert(out.msg.includes('結果未知'), '單筆 ' + id + ' 先失敗再通知：要保留結果未知，實際 ' + out.msg);
    assert(out.msg.includes('停在單筆') || out.msg.includes('SMC900' + id), '單筆 ' + id + ' 先失敗再通知：要保留原失敗摘要，實際 ' + out.msg);
  }
}

function itemDocs() {
  assert(runbook.includes(PROJECT_LINE), '手冊要寫已核對 Script ID、可沿用獨立或綁定專案');
  assert(verification.includes(PROJECT_LINE), 'verification 要寫已核對 Script ID、可沿用獨立或綁定專案');
  assert(gs.includes(GS_STALE), '固定 .gs 第 2 行仍是舊綁定句，不可改 .gs');
  assert(!gs.includes('僅使用已核對 Script ID'), '不可改 .gs 檔頭');
  assert(runbook.includes('已過時') && runbook.includes('以本手冊為準'), '手冊要寫 .gs 第 2 行已過時、以本手冊為準');
  assert(runbook.includes('只記執行紀錄') && runbook.includes('沒有彈窗'), '手冊要寫編輯器入口只記執行紀錄、設計上沒有彈窗');
  assert(gs.includes('只記執行紀錄') && gs.includes('沒有彈窗'), '檔頭要寫編輯器入口只記執行紀錄、設計上沒有彈窗');
  assert(runbook.includes('以執行紀錄') || runbook.includes('以執行記錄'), '手冊要以執行紀錄讀結果');
  assert(runbook.includes('沒有完整摘要') && runbook.includes('不算通過'), '手冊要寫執行紀錄沒有完整摘要就停、不算通過');
  const step2 = runbook.slice(runbook.indexOf('**實測第一步：**'), runbook.indexOf('全成功的執行記錄'));
  assert(!step2.includes('舊版會彈 alert'), '實測第一步不可再寫舊版會彈 alert');
  assert(!step2.includes('讀完按確定'), '實測第一步不可再寫讀完按確定');
  assert(runbook.includes('不適用本輪'), '歷史段落要標不適用本輪');
  assert(!/function isEditorUiUnavailable_/.test(gs), '已不用錯誤文字辨識時，要刪掉 isEditorUiUnavailable_');
  assert(!/^function doPost\s*\(/m.test(gs), '不可新增 doPost');
}

const items = { log: itemLog, err: itemErr, keep: itemKeep, docs: itemDocs };
const asked = process.argv.includes('--item') ? process.argv[process.argv.indexOf('--item') + 1] : 'all';
const selected = asked === 'all' ? Object.keys(items) : [asked];
if (selected.some((name) => !items[name])) {
  console.error('未知項目 ' + asked);
  process.exit(2);
}
for (const name of selected) items[name]();
if (failures.length) {
  console.error('pr47 r9 item ' + asked + ' failed: ' + failures.length);
  failures.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
console.log('pr47 r9 item ' + asked + ': pass');
