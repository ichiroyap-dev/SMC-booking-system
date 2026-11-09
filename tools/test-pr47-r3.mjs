#!/usr/bin/env node
// PR47 Codex r3 must-fix. Does not call script.google.com, send mail, or open a real sheet.
// Red: this file against the pinned script 5ad73c1. Green: the same commands after the fix.
// Usage: node tools/test-pr47-r3.mjs [--item stop|checklist|nit|evidence]
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

function itemStop() {
  const happy = loadIsolated();
  const happyMsg = String(happy.sandbox.runIsolatedEightCases());
  assert(happyMsg.includes('四種前綴都通過') && happy.box.mails.length === 14, '八案例全對時仍要通過並寄 14 封，實際 ' + happy.box.mails.length + ' 封：' + happyMsg);

  const position = loadIsolated();
  position.box.lieUpdatedRange = "'其他'!A2:V2";
  position.box.lieAtRow = 2;
  const positionMsg = String(position.sandbox.runIsolatedEightCases());
  assert(positionMsg.includes('1 只有原來的 11 欄'), '案例 1 位置錯誤：摘要要寫停在哪個案例，實際 ' + positionMsg);
  assert(positionMsg.includes('結果未知'), '案例 1 位置錯誤：摘要要寫原因是結果未知，實際 ' + positionMsg);
  assert(position.box.mails.length === 0, '案例 1 位置錯誤：不可再寄信，實際 ' + position.box.mails.length + ' 封');
  assert(!orderIds(position).includes('SMC900101'), '案例 1 位置錯誤：不可再跑案例 2');
  assert(positionMsg.includes('確認寄出 0 封'), '案例 1 位置錯誤：要寫確認寄出 0 封，實際 ' + positionMsg);
  noPassWording('案例 1 位置錯誤', position, positionMsg);

  const readBack = loadIsolated();
  const realConfirm = readBack.sandbox.confirmOrderRow_;
  readBack.sandbox.confirmOrderRow_ = function (sheet, orderId, expectedRow) {
    if (orderId === 'SMC900101') return { ok: false, header: '姓名', want: '測試同學', actual: '被改掉', formula: '' };
    return realConfirm(sheet, orderId, expectedRow);
  };
  const readBackMsg = String(readBack.sandbox.runIsolatedEightCases());
  assert(readBackMsg.includes('2 廣告品牌'), '案例 2 讀回不符：摘要要寫停在案例 2，實際 ' + readBackMsg);
  assert(readBackMsg.includes('結果未知'), '案例 2 讀回不符：要寫結果未知，實際 ' + readBackMsg);
  assert(readBack.box.mails.length === 2, '案例 2 讀回不符：只有案例 1 的 2 封，實際 ' + readBack.box.mails.length + ' 封');
  assert(!orderIds(readBack).includes('SMC900102'), '案例 2 讀回不符：不可再跑案例 3');
  assert(readBackMsg.includes('確認寄出 2 封'), '案例 2 讀回不符：要寫確認寄出 2 封，實際 ' + readBackMsg);
  noPassWording('案例 2 讀回不符', readBack, readBackMsg);

  const mail = loadIsolated();
  mail.sandbox.MailApp.sendEmail = function (to, subject, body) {
    if (String(subject).includes('預約申請已收到') && String(subject).includes('SMC900102')) throw new Error('guest send failed');
    mail.box.mails.push({ to, subject, body });
  };
  const mailMsg = String(mail.sandbox.runIsolatedEightCases());
  assert(mailMsg.includes('3 廣告非品牌'), '案例 3 寄信未確認：摘要要寫停在案例 3，實際 ' + mailMsg);
  assert(mailMsg.includes('寄信未確認'), '案例 3 寄信未確認：原因要寫寄信未確認，實際 ' + mailMsg);
  assert(mail.box.mails.length === 5, '案例 3 寄信未確認：案例 1、2 各 2 封加案例 3 的店內信，共 5 封，實際 ' + mail.box.mails.length);
  assert(!orderIds(mail).includes('SMC900103'), '案例 3 寄信未確認：不可再跑案例 4');
  assert(mailMsg.includes('確認寄出 5 封') && mailMsg.includes('未確認寄出 1 封') && mailMsg.includes('不要補寄'), '案例 3 寄信未確認：要寫 5 封確認、1 封未確認、不要補寄，實際 ' + mailMsg);
  noPassWording('案例 3 寄信未確認', mail, mailMsg);

  const notDup = loadIsolated();
  const realCases = notDup.sandbox.isolatedEightPayloads_;
  notDup.sandbox.isolatedEightPayloads_ = function (email) {
    const list = realCases(email);
    list[7].payload._testOrderId = 'SMC900107';
    return list;
  };
  const notDupMsg = String(notDup.sandbox.runIsolatedEightCases());
  assert(notDupMsg.includes('8 同一編號再送'), '案例 8 沒有被判成重複：摘要要寫停在案例 8，實際 ' + notDupMsg);
  assert(notDupMsg.includes('duplicate'), '案例 8 沒有被判成重複：原因要寫 duplicate，實際 ' + notDupMsg);
  noPassWording('案例 8 沒有被判成重複', notDup, notDupMsg);
}

function itemChecklist() {
  assert(checklist.includes('共用同一個協調機制'), '清單要寫所有寫入者共用同一個協調機制');
  assert(checklist.includes('不會覆蓋'), '清單要寫或改用不會覆蓋的寫法');
  assert(checklist.includes('只能發現') && checklist.includes('不能防止'), '清單要寫讀回只能發現、不能防止');
  assert(!checklist.includes('移植時要有對策：寫入後再讀回目標列'), '不可再把寫入後讀回寫成足夠的對策');
  assert(checklist.includes('實際大小') && checklist.includes('列數') && checklist.includes('欄數'), '清單要寫用正式表的實際列數、欄數測整張 FORMULA 讀取');
  assert(checklist.includes('延遲') && checklist.includes('6 分鐘'), '清單要寫量延遲，並對照 Apps Script 6 分鐘上限');
  assert(checklist.includes('FORMULA'), '效能評估要點名 FORMULA 讀取');
}

function itemNit() {
  const cash = loadIsolated();
  const cashBook = cash.box.byId['isolated-test-sheet'];
  cashBook.id = 'isolated-test-sheet';
  const cashSheet = cashBook.insertSheet('Cash$1');
  cashSheet.plantCell(0, 0, '表頭', '');
  let cashError = '';
  try { cash.sandbox.writeRow_(cashSheet, ['SMC911001', '', 'x']); } catch (err) { cashError = String(err && err.message ? err.message : err); }
  assert(cashError === '', "分頁名稱有 $ 時（'Cash$1'!A2:C2）要對得上，實際錯誤 " + cashError);
  assert(cash.sandbox.updatedRangeMatches_("'Cash$1'!$A$5:$V$5", 'Cash$1', 5, 22) === true, "'Cash$1'!$A$5:$V$5 要對得上 Cash$1 第 5 列 A:V");
  assert(cash.sandbox.updatedRangeMatches_("'Cash1'!A5:V5", 'Cash$1', 5, 22) === false, '不可把分頁名稱裡的 $ 刪掉再比');

  const single = loadIsolated();
  single.box.singleCellForm = true;
  const singleBook = single.box.byId['isolated-test-sheet'];
  singleBook.id = 'isolated-test-sheet';
  const singleSheet = singleBook.insertSheet('單欄');
  singleSheet.plantCell(0, 0, '表頭', '');
  let singleError = '';
  try { single.sandbox.writeRow_(singleSheet, ['SMC911002']); } catch (err) { singleError = String(err && err.message ? err.message : err); }
  assert(singleError === '', "一欄的列回 '單欄'!A2 時要接受，實際錯誤 " + singleError);
  assert(single.sandbox.updatedRangeMatches_("'訂單'!A5", '訂單', 5, 1) === true, '單格 A5 對一欄第 5 列要接受');
  assert(single.sandbox.updatedRangeMatches_("'訂單'!A5", '訂單', 5, 22) === false, '單格 A5 對 22 欄的列不可接受');
  assert(single.sandbox.updatedRangeMatches_("'訂單'!B5", '訂單', 5, 1) === false, '單格 B5 起欄不是 A，不可接受');
}

function itemEvidence() {
  assert(verification.includes('本機 PASS'), '文件要把本機 PASS 分開寫');
  assert(verification.includes('Pages BLOCKED'), '文件要把 Pages BLOCKED 分開寫');
  assert(verification.includes('結束碼 2'), '文件要寫 BLOCKED 是結束碼 2');
  assert(verification.includes('test-preflag-fixes.mjs --item 5'), '文件要點名 test-preflag-fixes 項目 5 在 gh 未登入時是 BLOCKED');
}

const items = { stop: itemStop, checklist: itemChecklist, nit: itemNit, evidence: itemEvidence };
const asked = process.argv.includes('--item') ? process.argv[process.argv.indexOf('--item') + 1] : 'all';
const selected = asked === 'all' ? Object.keys(items) : [asked];
if (selected.some((name) => !items[name])) {
  console.error('未知項目 ' + asked);
  process.exit(2);
}
for (const name of selected) items[name]();
if (failures.length) {
  console.error('pr47 r3 item ' + asked + ' failed: ' + failures.length);
  failures.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
console.log('pr47 r3 item ' + asked + ': pass');
