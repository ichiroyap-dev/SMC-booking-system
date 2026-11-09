#!/usr/bin/env node
// PR47 Codex r2 must-fix. Does not call script.google.com, send mail, or open a real sheet.
// Red: this file against the pinned script 46a7254. Green: the same commands after the fix.
// Usage: node tools/test-pr47-r2.mjs [--item range|occupy|checklist|nit]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gsPath = join(root, '.github/pages-unpublished/booking-attribution-isolated.gs');
const gs = readFileSync(gsPath, 'utf8');
const checklistPath = join(root, '.github/pages-unpublished/production-port-checklist.md');
const checklist = existsSync(checklistPath) ? readFileSync(checklistPath, 'utf8') : '';
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
  const box = { byId: {}, mails: [], rawWrites: [], gets: [], logs, lockHeld: false, lieUpdatedRange: '' };
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
      getUi() { return { alert() {}, createMenu() { return { addItem() { return this; }, addToUi() {} }; } }; },
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
            const lieHere = box.lieUpdatedRange && parsed.name === '訂單' && parsed.row > 1;
            return { updatedRange: lieHere ? box.lieUpdatedRange : range };
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

function itemRange() {
  assert(gs.includes('var ORDER_HEADERS'), '隔離腳本要有訂單表頭');
  const widthProbe = loadIsolated();
  const width = widthProbe.sandbox.ORDER_HEADERS.length;
  assert(width === 22, '這組反例用 A:V，訂單欄數要是 22，實際 ' + width);
  const cases = [
    ["'其他'!A2:V2", '另一張分頁'],
    ["'訂單'!B2:W2", '起欄不是 A'],
    ["'訂單'!A1:V2", '跨了兩列'],
    ["'訂單'!A2:U2", '終欄少一欄'],
  ];
  for (const [lie, label] of cases) {
    const isolated = loadIsolated();
    isolated.box.lieUpdatedRange = lie;
    const res = isolated.sandbox.acceptBooking_(payload({ _testOrderId: 'SMC910701' }));
    assert(res.response && res.response.status === 'unknown', label + ' 的 updatedRange 要回未知，實際 ' + (res.response && res.response.status) + ' ' + lie);
    assert(isolated.box.mails.length === 0, label + ' 不可寄信，實際 ' + isolated.box.mails.length + ' 封');
  }
  const ok = loadIsolated();
  ok.box.lieUpdatedRange = '訂單!A2:V2';
  const okRes = ok.sandbox.acceptBooking_(payload({ _testOrderId: 'SMC910702' }));
  assert(okRes.response && okRes.response.status === 'success', '分頁、單列、A:V 都對的時候，不加引號也要收單，實際 ' + (okRes.response && okRes.response.status));
}

function itemOccupy() {
  const probe = loadIsolated();
  const probeBook = probe.box.byId['isolated-test-sheet'];
  probeBook.id = 'isolated-test-sheet';
  const probeSheet = probeBook.insertSheet('訂單');
  probeSheet.plantCell(0, 0, '訂單編號', '');
  probeSheet.plantCell(1, 0, 'SMC910801', '');
  probeSheet.plantCell(2, 0, '', '=""');
  probeSheet.plantCell(3, AAA - 1, '遠欄', '');
  const displayed = probe.sandbox.Sheets.Spreadsheets.Values.get('isolated-test-sheet', "'訂單'!A:ZZ");
  const formulated = probe.sandbox.Sheets.Spreadsheets.Values.get('isolated-test-sheet', "'訂單'", { valueRenderOption: 'FORMULA' });
  assert(displayed.values.length === 2, '顯示值要把尾端 ="" 空列去掉，A:ZZ 也不含 AAA，實際列數 ' + displayed.values.length);
  assert(formulated.values.length === 4 && formulated.values[2] && formulated.values[2][0] === '=""', 'FORMULA 要把 ="" 當成有公式的列');
  assert(formulated.values[3] && formulated.values[3][AAA - 1] === '遠欄', '整張表的讀取要看得到 ZZ 之後的欄');

  const formula = loadIsolated();
  const formulaBook = formula.box.byId['isolated-test-sheet'];
  formulaBook.id = 'isolated-test-sheet';
  const formulaSheet = formulaBook.insertSheet('訂單');
  formulaSheet.plantCell(0, 0, '訂單編號', '');
  formulaSheet.plantCell(1, 0, 'SMC910811', '');
  formulaSheet.plantCell(2, 0, '', '=""');
  const formulaRes = formula.sandbox.acceptBooking_(payload({ _testOrderId: 'SMC910812' }));
  assert(formulaSheet.formulaAt(2, 0) === '=""', '表尾 ="" 公式列不可被新訂單蓋掉，實際公式 ' + JSON.stringify(formulaSheet.formulaAt(2, 0)));
  assert(formulaSheet.valueAt(2, 0) !== 'SMC910812', '新訂單不可寫進 ="" 那一列');
  assert(formulaSheet.valueAt(3, 0) === 'SMC910812', '新訂單要接在公式列的下一列，實際第 4 列 ' + JSON.stringify(formulaSheet.valueAt(3, 0)));
  assert(formulaSheet.valueAt(1, 0) === 'SMC910811', '公式列前面的訂單不可被改');
  assert(formulaRes.response && formulaRes.response.status === 'success', '避開公式列之後仍要收單，實際 ' + (formulaRes.response && formulaRes.response.status));
  const formulaGet = formula.box.gets.find((item) => String(item.range).includes('訂單'));
  assert(formulaGet && formulaGet.options && formulaGet.options.valueRenderOption === 'FORMULA', '找最後一列要讀公式，不可只用顯示值');
  const formulaRange = formulaGet ? parseA1(formulaGet.range) : { entire: false, endCol: ZZ };
  assert(formulaRange.entire || (formulaRange.endCol && formulaRange.endCol > ZZ), '找最後一列不可停在 ZZ，實際 ' + (formulaGet && formulaGet.range));

  const far = loadIsolated();
  const farBook = far.box.byId['isolated-test-sheet'];
  farBook.id = 'isolated-test-sheet';
  const farSheet = farBook.insertSheet('訂單');
  farSheet.plantCell(0, 0, '訂單編號', '');
  farSheet.plantCell(1, 0, 'SMC910821', '');
  farSheet.plantCell(2, AAA - 1, '遠欄', '');
  const farRes = far.sandbox.acceptBooking_(payload({ _testOrderId: 'SMC910822' }));
  assert(farSheet.valueAt(2, AAA - 1) === '遠欄', 'ZZ 之後的原值要留著');
  assert(farSheet.valueAt(2, 0) !== 'SMC910822', '新訂單不可和 ZZ 之後的資料同一列');
  assert(farSheet.valueAt(2, 0) === '', '有遠欄的那一列，A 欄要維持空白，實際 ' + JSON.stringify(farSheet.valueAt(2, 0)));
  assert(farSheet.valueAt(3, 0) === 'SMC910822', '新訂單要寫在遠欄那一列的下一列，實際 ' + JSON.stringify(farSheet.valueAt(3, 0)));
  assert(farSheet.valueAt(1, 0) === 'SMC910821', '遠欄前面的訂單不可被改');
  assert(farRes.response && farRes.response.status === 'success', '避開遠欄之後仍要收單，實際 ' + (farRes.response && farRes.response.status));
}

function itemChecklist() {
  assert(checklist.includes('insertRowsAfter'), '清單要寫列數快滿時用 insertRowsAfter');
  assert(checklist.includes('appendDimension'), '清單要寫列數快滿時也可以 appendDimension');
  assert(checklist.includes('列數上限'), '清單要寫不要假設快到列數上限還會自動長高');
  assert(checklist.includes('只擋這支腳本'), '清單要寫 LockService 只擋這支腳本');
  assert(checklist.includes('寫入後再讀回目標列'), '清單要寫寫入後再讀回目標列');
  assert(checklist.includes('對不上就回未知') && checklist.includes('不寄信'), '清單要寫對不上就回未知，而且不寄信');
}

function itemNit() {
  const booked = loadIsolated();
  booked.sandbox.acceptBooking_(payload({ _testOrderId: 'SMC910901' }));
  assert(booked.box.logs.some((line) => line.includes('tableRange=') && line.includes('推算') && line.includes('updatedRange=')), '記錄裡的 tableRange 要標成推算');

  const missing = loadIsolated();
  missing.box.byId['isolated-test-sheet'].timeZone = '';
  const res = missing.sandbox.acceptBooking_(payload({ _testOrderId: 'SMC910902' }));
  const message = res.response ? String(res.response.message || '') : '';
  assert(res.response && res.response.status === 'error', '找不到時區要回錯誤，不可收成成功，實際 ' + (res.response && res.response.status));
  assert(message.includes('找不到試算表時區'), '錯誤要寫找不到試算表時區，實際 ' + message);
  assert(message.includes('這筆訂單沒有寫入'), '錯誤要寫這筆訂單沒有寫入，實際 ' + message);
  assert(message.includes('表頭'), '錯誤要寫明表頭可能已寫上，不可說成完全沒碰到試算表，實際 ' + message);
  assert(!/完全沒碰到|零寫入|沒有碰到試算表/.test(message), '不可把已經可能寫過表頭說成完全沒碰到試算表，實際 ' + message);
  assert(missing.box.mails.length === 0, '找不到時區不可寄信');
  const sheet = orderSheet(missing);
  const placed = sheet && sheet.rows().some((row) => row[0] === 'SMC910902');
  assert(!placed, '找不到時區時，這筆訂單編號不可寫進表');
}

const items = { range: itemRange, occupy: itemOccupy, checklist: itemChecklist, nit: itemNit };
const asked = process.argv.includes('--item') ? process.argv[process.argv.indexOf('--item') + 1] : 'all';
const selected = asked === 'all' ? Object.keys(items) : [asked];
if (selected.some((name) => !items[name])) {
  console.error('未知項目 ' + asked);
  process.exit(2);
}
for (const name of selected) items[name]();
if (failures.length) {
  console.error('pr47 r2 item ' + asked + ' failed: ' + failures.length);
  failures.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
console.log('pr47 r2 item ' + asked + ': pass');
