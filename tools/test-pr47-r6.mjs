#!/usr/bin/env node
// PR47 Codex r5 / round 6 must-fix. Does not call script.google.com, send mail, or open a real sheet.
// Red: this file against the pinned script a50a364. Green: the same commands after the fix.
// Usage: node tools/test-pr47-r6.mjs [--item cell|allow|docs|nit]
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

function callFixed(isolated, id) {
  const fn = isolated.sandbox.runIsolatedFixedBooking_ || isolated.sandbox.runIsolatedFixedBooking;
  if (typeof fn !== 'function') throw new Error('missing fixed-booking helper');
  return String(fn.call(isolated.sandbox, id));
}

function armCellFault(isolated, method, message) {
  const orig = isolated.sandbox.inspectFormulaProbes_;
  isolated.sandbox.inspectFormulaProbes_ = function (sheet, orderId, probes) {
    const realRange = sheet.getRange.bind(sheet);
    sheet.getRange = function (row, col, n, m) {
      const range = realRange(row, col, n, m);
      const real = range[method].bind(range);
      range[method] = function () {
        if (isolated.box.mails.length >= 12) throw new Error(message);
        return real();
      };
      return range;
    };
    return orig(sheet, orderId, probes);
  };
}

function itemCell() {
  for (const [method, err] of [['getValue', 'cell getValue failed'], ['getFormula', 'cell getFormula failed']]) {
    const isolated = loadIsolated();
    armCellFault(isolated, method, err);
    let msg = '';
    let threw = '';
    try {
      msg = String(isolated.sandbox.runIsolatedEightCases());
    } catch (e) {
      threw = String(e && e.message ? e.message : e);
    }
    const label = '儲存格 ' + method + ' 丟錯';
    assert(!threw, label + ' 不可再往外拋，實際 ' + threw);
    assert(msg.includes('6 公式開頭'), label + '：摘要要寫停在案例 6，實際 ' + msg);
    assert(msg.includes('公式核對讀取'), label + '：摘要要寫階段是公式核對讀取，實際 ' + msg);
    assert(msg.includes(err), label + '：摘要要寫出錯誤文字，實際 ' + msg);
    assert(msg.includes('確認寄出 12 封') && msg.includes('未確認寄出 0 封'), label + '：摘要要寫封數，實際 ' + msg);
    assert(!orderIdsOf(isolated).includes('SMC900106'), label + '：不可再跑案例 7');
    assert(!msg.includes('公式核對失敗') || msg.includes('公式核對讀取'), label + '：不可只寫公式核對失敗，實際 ' + msg);
    noPassWording(label, isolated, msg);
  }
}

function itemAllow() {
  for (const name of ['toString', 'constructor', '__proto__', 'SMC900204', 'SMC900001']) {
    const isolated = loadIsolated();
    let msg = '';
    try {
      msg = callFixed(isolated, name);
    } catch (err) {
      msg = String(err && err.message ? err.message : err);
    }
    assert(isolated.box.mails.length === 0, name + ' 不可寄信，實際 ' + isolated.box.mails.length + ' 封');
    assert(!orderIdsOf(isolated).some((id) => id && String(id).indexOf('SMC') === 0 && id !== '訂單編號'), name + ' 不可寫入訂單，實際 ' + orderIdsOf(isolated).join(','));
    assert(msg.includes('編號只能是') || msg.includes('SMC900201'), name + ' 要被擋下，實際 ' + msg);
  }
  for (const id of ['SMC900201', 'SMC900202', 'SMC900203']) {
    const isolated = loadIsolated();
    isolated.sandbox['runIsolatedOneBooking' + id.slice(-3)]();
    assert(orderIdsOf(isolated).includes(id), id + ' 合法編號要寫入，實際 ' + orderIdsOf(isolated).join(','));
    assert(isolated.box.mails.length === 2, id + ' 合法編號要寄 2 封，實際 ' + isolated.box.mails.length);
  }
}

function itemDocs() {
  assert(runbook.includes('需 Owner GO'), '手冊仍要需 Owner GO');
  assert(runbook.includes('人工確認測試表 ID 和收件信箱是測試用'), '重跑前要人工確認測試表 ID 和收件信箱是測試用');
  assert(runbook.includes('A9:V9') && runbook.includes('SMC900201'), '手冊要寫 201 寫入 A9:V9');
  assert(runbook.includes('A11:V11') && runbook.includes('=""') && runbook.includes('A10'), '手冊要寫 202 寫入 A11:V11，且 A10 公式仍在');
  assert(runbook.includes('A15:V15') && runbook.includes('AAA14'), '手冊要寫 203 寫入 A15:V15，且 AAA14 不可被蓋');
  assert(runbook.includes('再跑') && runbook.includes('201') && (runbook.includes('重複') || runbook.includes('duplicate')), '手冊要寫最後再跑 201 必須判成重複');
  assert(runbook.includes('至少1000列') && runbook.includes('欄擴至 AAA'), '手冊要寫訂單分頁至少1000列、欄擴至 AAA');
  assert(runbook.includes('各自在執行前佈置') && runbook.includes('不要一次全部放好'), '三筆要各自在執行前佈置，不要一次全部放好');
  assert(runbook.includes('A10') && runbook.includes('第 11 列') && runbook.includes('A9:V9'), '手冊要寫若先放 A10 公式，201 會寫到第 11 列而不是 A9:V9');
  assert(
    verification.includes('a50a3645f848ef0221411c7589f1ca461539e240:.github/pages-unpublished/booking-attribution-isolated-runbook.md'),
    'docs 紅燈指令要同時換回舊手冊'
  );
}

function itemNit() {
  assert(/function runIsolatedFixedBooking_\s*\(/.test(gs), '帶編號的函式要是 runIsolatedFixedBooking_');
  assert(!/function runIsolatedFixedBooking\s*\(/.test(gs), '不可再公開 runIsolatedFixedBooking');
  assert(!/function runIsolatedOneBooking\s*\(/.test(gs), '不可再公開讀常數的 runIsolatedOneBooking');
  assert(/function runIsolatedOneBooking201\s*\(/.test(gs) && /function runIsolatedOneBooking202\s*\(/.test(gs) && /function runIsolatedOneBooking203\s*\(/.test(gs), '三個無參數入口要留著');
  assert(!html.includes('runIsolatedFixedBooking') && !html.includes('runIsolatedOneBooking'), '網頁不可加單筆入口');
  assert(!/^function doPost\s*\(/m.test(gs), '不可新增 doPost');
  assert(!/ISOLATED_ONE_ORDER_IDS\s*\[/.test(gs), '不可再用物件鍵查白名單');

  const first = loadIsolated();
  first.sandbox.runIsolatedOneBooking201();
  const again = String(first.sandbox.runIsolatedOneBooking201());
  assert(again.includes('wrote=false') && again.includes('mailed=false'), '單筆重複要寫 wrote=false、mailed=false，實際 ' + again);
  assert(first.box.mails.length === 2, '真重複不可再寄信');

  const fake = loadIsolated();
  const real = fake.sandbox.acceptBooking_;
  fake.sandbox.acceptBooking_ = function (payload) {
    const out = real(payload);
    if (out && out.response && out.response.duplicate === true) {
      return { response: Object.assign({}, out.response, { duplicate: true, status: 'success' }), wrote: true, mailed: true, sentCount: 2, failedCount: 0 };
    }
    return out;
  };
  fake.sandbox.runIsolatedOneBooking201();
  const fakeMsg = String(fake.sandbox.runIsolatedOneBooking201());
  assert(fakeMsg.includes('結果未知') || fakeMsg.includes('wrote'), '矛盾的重複結果不可當正常重複，實際 ' + fakeMsg);
  assert(!fakeMsg.includes('這個編號已經收過') || fakeMsg.includes('結果未知'), 'wrote/mailed 不對時不可只報已經收過，實際 ' + fakeMsg);
}

const items = { cell: itemCell, allow: itemAllow, docs: itemDocs, nit: itemNit };
const asked = process.argv.includes('--item') ? process.argv[process.argv.indexOf('--item') + 1] : 'all';
const selected = asked === 'all' ? Object.keys(items) : [asked];
if (selected.some((name) => !items[name])) {
  console.error('未知項目 ' + asked);
  process.exit(2);
}
for (const name of selected) items[name]();
if (failures.length) {
  console.error('pr47 r6 item ' + asked + ' failed: ' + failures.length);
  failures.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
console.log('pr47 r6 item ' + asked + ': pass');
