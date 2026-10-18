#!/usr/bin/env node
// PR47 round 7. Does not call script.google.com, send mail, or open a real sheet.
// Red: this file against the pinned script fa16c43. Green: the same commands after the fix.
// Usage: node tools/test-pr47-r7.mjs [--item eight|single|other|docs]
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

function armOtherAlert(isolated, message) {
  isolated.sandbox.SpreadsheetApp.getUi = function () {
    return {
      alert() { throw new Error(message); },
      createMenu() { return { addItem() { return this; }, addToUi() {} }; },
    };
  };
}

function itemEight() {
  const isolated = loadIsolated();
  armEditorUi(isolated);
  const msg = String(isolated.sandbox.runIsolatedEightCases());
  assert(!msg.includes('結果未知'), '八案例：編輯器 getUi 失敗不可降成結果未知，實際 ' + msg);
  assert(!msg.includes('alert 沒有彈出'), '八案例：編輯器無彈窗不可改寫摘要，實際 ' + msg);
  assert(msg.includes('四種前綴都通過') && msg.includes('確認寄出 14 封') && msg.includes('未確認寄出 0 封'), '八案例：回傳仍是成功摘要，實際 ' + msg);
  assert(isolated.box.logs.includes(msg), '八案例：回傳與執行紀錄的摘要要同一句，紀錄 ' + isolated.box.logs.join(' | '));
  assert(isolated.box.logs.some((line) => line.includes(EDITOR_NOTE)), '八案例：執行紀錄要寫「' + EDITOR_NOTE + '」');
  assert(isolated.box.mails.length === 14, '八案例：仍要寄 14 封，實際 ' + isolated.box.mails.length);
}

function itemSingle() {
  for (const id of ['SMC900201', 'SMC900202', 'SMC900203']) {
    const isolated = loadIsolated();
    armEditorUi(isolated);
    const fn = isolated.sandbox['runIsolatedOneBooking' + id.slice(-3)];
    const msg = String(fn());
    const label = '單筆 ' + id;
    assert(!msg.includes('結果未知'), label + '：編輯器 getUi 失敗不可降成結果未知，實際 ' + msg);
    assert(!msg.includes('alert 沒有彈出'), label + '：編輯器無彈窗不可改寫摘要，實際 ' + msg);
    assert(msg.includes('已收單') && msg.includes(id) && msg.includes('確認寄出 2 封'), label + '：回傳仍是成功摘要，實際 ' + msg);
    assert(isolated.box.logs.includes(msg), label + '：回傳與執行紀錄的摘要要同一句，紀錄 ' + isolated.box.logs.join(' | '));
    assert(isolated.box.logs.some((line) => line.includes(EDITOR_NOTE)), label + '：執行紀錄要寫「' + EDITOR_NOTE + '」');
    assert(orderIdsOf(isolated).includes(id), label + '：仍要寫入，實際 ' + orderIdsOf(isolated).join(','));
    assert(isolated.box.mails.length === 2, label + '：仍要寄 2 封，實際 ' + isolated.box.mails.length);
  }
}

function itemOther() {
  const eight = loadIsolated();
  armOtherAlert(eight, '沒有試算表介面');
  const eightMsg = String(eight.sandbox.runIsolatedEightCases());
  assert(eightMsg.includes('結果未知') && eightMsg.includes('沒有試算表介面'), '八案例：其他 alert 錯誤仍要結果未知，實際 ' + eightMsg);
  assert(!eightMsg.includes('四種前綴都通過'), '八案例：其他 alert 錯誤不可回成功摘要，實際 ' + eightMsg);

  const one = loadIsolated();
  armOtherAlert(one, 'alert dialog failed');
  const oneMsg = String(one.sandbox.runIsolatedOneBooking201());
  assert(oneMsg.includes('結果未知') && oneMsg.includes('alert dialog failed'), '單筆：其他 alert 錯誤仍要結果未知，實際 ' + oneMsg);
  assert(!oneMsg.includes('已收單') || oneMsg.includes('結果未知'), '單筆：其他 alert 錯誤不可只報已收單，實際 ' + oneMsg);

  const realEight = loadIsolated();
  armEditorUi(realEight);
  realEight.box.lieUpdatedRange = "'其他'!A2:V2";
  realEight.box.lieAtRow = 2;
  const realEightMsg = String(realEight.sandbox.runIsolatedEightCases());
  assert(realEightMsg.includes('結果未知'), '八案例：真失敗即使無彈窗仍要結果未知，實際 ' + realEightMsg);
  assert(!realEightMsg.includes('四種前綴都通過'), '八案例：真失敗不可寫通過，實際 ' + realEightMsg);

  const realOne = loadIsolated();
  armEditorUi(realOne);
  realOne.box.lieUpdatedRange = "'其他'!A2:V2";
  realOne.box.lieAtRow = 2;
  const realOneMsg = String(realOne.sandbox.runIsolatedOneBooking201());
  assert(realOneMsg.includes('結果未知'), '單筆：真失敗即使無彈窗仍要結果未知，實際 ' + realOneMsg);
  assert(!realOneMsg.includes('已收單'), '單筆：真失敗不可寫已收單，實際 ' + realOneMsg);
}

function itemDocs() {
  assert(!gs.includes('不可從編輯器選單'), '註解不可再說私有函式從編輯器選單看不到');
  assert(gs.includes('網頁呼叫不到') && gs.includes('google.script.run'), '註解只寫官方已確認的限制：網頁呼叫不到');
  assert(/function runIsolatedOneBooking201\s*\(/.test(gs) && /function runIsolatedOneBooking202\s*\(/.test(gs) && /function runIsolatedOneBooking203\s*\(/.test(gs), '三個無參數入口要留著');
  assert(!/^function doPost\s*\(/m.test(gs), '不可新增 doPost');
  assert(!html.includes('runIsolatedFixedBooking') && !html.includes('runIsolatedOneBooking'), '網頁不可加單筆入口');
  assert(runbook.includes('編輯器執行，無彈窗，以執行紀錄為準'), '手冊要寫編輯器執行無彈窗，以執行紀錄為準');
  assert(runbook.includes('保留') && runbook.includes('fa16c43') && (runbook.includes('從頭重跑') || runbook.includes('重新跑')), '手冊要寫 fa16c43 測試表當證據保留，核准後從頭重跑');
  assert(runbook.includes('需 Owner GO'), '手冊仍要需 Owner GO');
}

const items = { eight: itemEight, single: itemSingle, other: itemOther, docs: itemDocs };
const asked = process.argv.includes('--item') ? process.argv[process.argv.indexOf('--item') + 1] : 'all';
const selected = asked === 'all' ? Object.keys(items) : [asked];
if (selected.some((name) => !items[name])) {
  console.error('未知項目 ' + asked);
  process.exit(2);
}
for (const name of selected) items[name]();
if (failures.length) {
  console.error('pr47 r7 item ' + asked + ' failed: ' + failures.length);
  failures.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
console.log('pr47 r7 item ' + asked + ': pass');
