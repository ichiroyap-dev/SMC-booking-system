#!/usr/bin/env node
// PR47 round 8. Does not call script.google.com, send mail, or open a real sheet.
// Red: this file against the pinned script cd1aeba. Green: the same commands after the fix.
// Usage: node tools/test-pr47-r8.mjs [--item alert|docs]
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

const EDITOR_UI_ERR = 'Cannot call SpreadsheetApp.getUi() from this context.';
const EDITOR_NOTE = '編輯器執行，無彈窗，以執行紀錄為準';

function armEditorUi(isolated) {
  isolated.sandbox.SpreadsheetApp.getUi = function () {
    throw new Error(EDITOR_UI_ERR);
  };
}

function armAlertSameText(isolated) {
  isolated.sandbox.SpreadsheetApp.getUi = function () {
    return {
      alert() { throw new Error(EDITOR_UI_ERR); },
      createMenu() { return { addItem() { return this; }, addToUi() {} }; },
    };
  };
}

function itemAlert() {
  const eight = loadIsolated();
  armAlertSameText(eight);
  const eightMsg = String(eight.sandbox.runIsolatedEightCases());
  assert(eightMsg.includes('結果未知') && eightMsg.includes(EDITOR_UI_ERR), '八案例：alert 丟出相同文字仍要結果未知，實際 ' + eightMsg);
  assert(!eightMsg.includes('四種前綴都通過'), '八案例：alert 失敗不可回通過，實際 ' + eightMsg);

  for (const id of ['SMC900201', 'SMC900202', 'SMC900203']) {
    const isolated = loadIsolated();
    armAlertSameText(isolated);
    const msg = String(isolated.sandbox['runIsolatedOneBooking' + id.slice(-3)]());
    assert(msg.includes('結果未知') && msg.includes(EDITOR_UI_ERR), '單筆成功 ' + id + '：alert 丟出相同文字仍要結果未知，實際 ' + msg);
    assert(!msg.includes('已收單') || msg.includes('結果未知'), '單筆成功 ' + id + '：不可只報已收單，實際 ' + msg);
  }

  const dup = loadIsolated();
  dup.sandbox.runIsolatedOneBooking201();
  armAlertSameText(dup);
  const dupMsg = String(dup.sandbox.runIsolatedOneBooking201());
  assert(dupMsg.includes('結果未知') && dupMsg.includes(EDITOR_UI_ERR), '單筆重複：alert 丟出相同文字仍要結果未知，實際 ' + dupMsg);
  assert(!dupMsg.includes('已經收過') || dupMsg.includes('結果未知'), '單筆重複：alert 失敗不可只報已經收過，實際 ' + dupMsg);
  assert(dup.box.mails.length === 2, '單筆重複：不可再寄信，實際 ' + dup.box.mails.length);

  const stillLog = loadIsolated();
  armEditorUi(stillLog);
  const stillMsg = String(stillLog.sandbox.runIsolatedEightCases());
  assert(!stillMsg.includes('結果未知'), 'getUi 自己丟錯仍不可降成結果未知，實際 ' + stillMsg);
  assert(stillLog.box.logs.some((line) => line.includes(EDITOR_NOTE)), 'getUi 自己丟錯要寫無彈窗註記');
  assert(stillLog.box.logs.some((line) => line.includes(EDITOR_UI_ERR)), 'getUi 自己丟錯要保留原始錯誤文字');
}

function itemDocs() {
  assert(!runbook.includes('從編輯器執行時沒有試算表彈窗'), '手冊不可再說編輯器執行一定沒有彈窗');
  assert(!runbook.includes('從編輯器執行沒有彈窗'), '手冊不可再說從編輯器執行沒有彈窗');
  assert(runbook.includes('有沒有 UI') || runbook.includes('當下有沒有 UI') || runbook.includes('當下沒有 UI'), '手冊要依實際有沒有 UI 描述');
  assert(runbook.includes('原始錯誤'), '手冊要寫執行紀錄保留原始錯誤');
  assert(runbook.includes('alert 自己失敗') && runbook.includes('結果未知'), '手冊要寫 alert 自己失敗仍是結果未知');
  assert(runbook.includes(EDITOR_NOTE), '手冊仍要保留無彈窗註記原文');
  assert(!/^function doPost\s*\(/m.test(gs), '不可新增 doPost');
}

const items = { alert: itemAlert, docs: itemDocs };
const asked = process.argv.includes('--item') ? process.argv[process.argv.indexOf('--item') + 1] : 'all';
const selected = asked === 'all' ? Object.keys(items) : [asked];
if (selected.some((name) => !items[name])) {
  console.error('未知項目 ' + asked);
  process.exit(2);
}
for (const name of selected) items[name]();
if (failures.length) {
  console.error('pr47 r8 item ' + asked + ' failed: ' + failures.length);
  failures.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
console.log('pr47 r8 item ' + asked + ': pass');
