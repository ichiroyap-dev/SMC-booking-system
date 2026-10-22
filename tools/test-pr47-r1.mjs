#!/usr/bin/env node
// PR47 r1 must-fix. Does not call script.google.com, send mail, or open a real sheet.
// F2 must be run with TZ=UTC so the script timezone differs from Asia/Taipei.
// Usage: TZ=UTC node tools/test-pr47-r1.mjs [--item f1|f2|f6|checklist|nit-doc|nit-pages]
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gsPath = join(root, '.github/pages-unpublished/booking-attribution-isolated.gs');
const gs = readFileSync(gsPath, 'utf8');
const runbook = readFileSync(join(root, '.github/pages-unpublished/booking-attribution-isolated-runbook.md'), 'utf8');
const verification = readFileSync(join(root, '.github/pages-unpublished/isolated-e2e-verification.md'), 'utf8');
const checklistPath = join(root, '.github/pages-unpublished/production-port-checklist.md');
const checklist = existsSync(checklistPath) ? readFileSync(checklistPath, 'utf8') : '';
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

const EPOCH = Date.UTC(1899, 11, 30);
const INPUT_0700Z = '2026-10-18T07:00:00Z';
const TAIPEI_1500 = (Date.UTC(2026, 9, 18, 15, 0, 0) - EPOCH) / 86400000;
const UTC_0700 = (Date.parse(INPUT_0700Z) - EPOCH) / 86400000;
const DATE_SERIAL = (Date.UTC(2026, 9, 22) - EPOCH) / 86400000;

function sheetSerial(iso, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const part of fmt.formatToParts(new Date(iso))) parts[part.type] = part.value;
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(hour), Number(parts.minute), Number(parts.second));
  return (wall - EPOCH) / 86400000;
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

function columnIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

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
  if (!cells) return { name, entire: true };
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

function cellHas(grid, row, col) {
  const line = grid[row];
  if (!line) return false;
  const value = line[col];
  return value != null && value !== '';
}

// Google Sheets values.append table detection.
// https://developers.google.com/workspace/sheets/api/guides/values#appending_values
function tablesIn(grid) {
  const tables = [];
  let row = 0;
  while (row < grid.length) {
    let width = 0;
    for (let i = row; i < grid.length; i += 1) width = Math.max(width, (grid[i] || []).length);
    let any = false;
    for (let col = 0; col < width; col += 1) if (cellHas(grid, row, col)) any = true;
    if (!any) {
      row += 1;
      continue;
    }
    let end = row;
    while (end + 1 < grid.length) {
      let next = false;
      const nextWidth = Math.max(width, (grid[end + 1] || []).length);
      for (let col = 0; col < nextWidth; col += 1) if (cellHas(grid, end + 1, col)) next = true;
      if (!next) break;
      end += 1;
      width = nextWidth;
    }
    let minCol = Infinity;
    let maxCol = -1;
    for (let r = row; r <= end; r += 1) {
      for (let col = 0; col < (grid[r] || []).length; col += 1) {
        if (!cellHas(grid, r, col)) continue;
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
      }
    }
    tables.push({ r1: row, c1: minCol, r2: end, c2: maxCol });
    row = end + 1;
  }
  return tables;
}

function rangeRect(range) {
  if (!range || range.entire) return null;
  return { r1: range.row - 1, c1: range.col - 1, r2: range.endRow - 1, c2: range.endCol - 1 };
}

function overlaps(table, rect) {
  if (!rect) return true;
  return table.r1 <= rect.r2 && rect.r1 <= table.r2 && table.c1 <= rect.c2 && rect.c1 <= table.c2;
}

function appendTarget(grid, a1) {
  const parsed = parseA1(a1);
  const rect = rangeRect(parsed);
  const tables = tablesIn(grid).filter((table) => overlaps(table, rect));
  if (!tables.length) {
    const row = rect ? rect.r1 + 1 : 1;
    const col = rect ? rect.c1 + 1 : 1;
    return { row, col, tableRange: '' };
  }
  tables.sort((a, b) => (a.r2 - b.r2) || (a.c2 - b.c2));
  const table = tables[tables.length - 1];
  const colLetter = (n) => {
    let out = '';
    let x = n;
    while (x > 0) {
      const rem = (x - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      x = Math.floor((x - 1) / 26);
    }
    return out;
  };
  const tableRange = colLetter(table.c1 + 1) + (table.r1 + 1) + ':' + colLetter(table.c2 + 1) + (table.r2 + 1);
  return { row: table.r2 + 2, col: table.c1 + 1, tableRange };
}

function loadIsolated() {
  const props = {
    SMC_ATTRIBUTION_ISOLATED: 'yes',
    SMC_SHOP_EMAIL: 'shop-test@example.com',
    SMC_TEST_SHEET_ID: 'isolated-test-sheet',
  };
  const logs = [];
  const box = { byId: {}, mails: [], rawWrites: [], logs, lockHeld: false, lieUpdatedRange: '' };
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
      const cache = [];
      const server = [];
      function put(list, r, c, value) {
        const line = list[r] ? list[r].slice() : [];
        line[c] = value;
        list[r] = line;
      }
      return {
        getMaxRows() { return 1000; },
        getLastRow() { return cache.length; },
        padFormattedTail(n) {
          for (let i = 0; i < n; i += 1) cache.push([]);
        },
        plant(rows) {
          server.length = 0;
          cache.length = 0;
          rows.forEach((row) => {
            server.push(row.slice());
            cache.push(row.slice());
          });
        },
        rows() {
          const out = [];
          for (let i = 0; i < server.length; i += 1) out.push(server[i] ? server[i].slice() : []);
          return out;
        },
        appendDetected(matrix, insertRows) {
          const target = appendTarget(server.map((row) => (row ? row.slice() : [])), "'x'!A1");
          const at = target.row - 1;
          for (let r = 0; r < matrix.length; r += 1) {
            const stored = (matrix[r] || []).map((cell) => (typeof cell === 'number' && Number.isFinite(cell) ? cell : (cell == null ? '' : String(cell))));
            const placed = [];
            for (let c = 0; c < target.col - 1; c += 1) placed.push('');
            stored.forEach((cell) => placed.push(cell));
            if (insertRows) {
              server.splice(at + r, 0, placed);
              cache.splice(at + r, 0, placed.slice());
            } else {
              server[at + r] = placed;
              cache[at + r] = placed.slice();
            }
          }
          return target;
        },
        getRange(row, col, numRows, numCols) {
          const rowsN = numRows == null ? 1 : numRows;
          const colsN = numCols == null ? 1 : numCols;
          return {
            setNumberFormat() { return this; },
            setRawValues(values) {
              for (let r = 0; r < values.length; r += 1) {
                for (let c = 0; c < values[r].length; c += 1) {
                  const cell = values[r][c];
                  const stored = typeof cell === 'number' && Number.isFinite(cell) ? cell : (cell == null ? '' : String(cell));
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
        getName() { return name; },
        getParent() { return ss; },
      };
    }
    return ss;
  }
  const marked = makeBook();
  const marker = marked.insertSheet('隔離標記');
  marker.plant([['SMC-ISOLATED-TEST']]);
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
            return { updatedRange: box.lieUpdatedRange || range };
          },
          append(resource, spreadsheetId, range, options) {
            const parsed = parseA1(range);
            const sheet = box.byId[spreadsheetId].getSheetByName(parsed.name);
            const target = sheet.appendDetected(resource.values || [], options && options.insertDataOption === 'INSERT_ROWS');
            const updated = "'x'!A" + target.row;
            box.rawWrites.push({ op: 'append', range, insert: options && options.insertDataOption, tableRange: target.tableRange, updatedRange: updated, row: target.row });
            return { tableRange: target.tableRange, updates: { updatedRange: box.lieUpdatedRange || updated } };
          },
          clear() {},
          get(spreadsheetId, range) {
            const parsed = parseA1(range);
            return { values: trimApiGrid(box.byId[spreadsheetId].getSheetByName(parsed.name).rows()) };
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

function orderRows(isolated) {
  const sheet = isolated.box.byId['isolated-test-sheet'].getSheetByName('訂單');
  return sheet ? sheet.rows() : [];
}

function itemF1() {
  const independent = sheetSerial(INPUT_0700Z, 'Asia/Taipei');
  assert(Math.abs(independent - TAIPEI_1500) < 1e-9, '獨立計算：2026-10-18T07:00:00Z 在台北應是 15:00 序號');
  assert(Math.abs(TAIPEI_1500 - UTC_0700 - 8 / 24) < 1e-6, 'UTC 序號比台北牆鐘早 8 小時');
  const isolated = loadIsolated();
  isolated.sandbox.nowIso_ = () => INPUT_0700Z;
  const res = isolated.sandbox.acceptBooking_(payload({ _testOrderId: 'SMC910301' }));
  const rows = orderRows(isolated);
  const stored = rows[1] ? rows[1][1] : null;
  assert(res.response && res.response.status === 'success', '時區換算後仍要收單，實際 ' + (res.response && res.response.status));
  assert(typeof stored === 'number' && Math.abs(stored - TAIPEI_1500) < 1e-6, '2026-10-18T07:00:00Z 要存成台北 15:00 的序號，實際 ' + stored);
  assert(!(typeof stored === 'number' && Math.abs(stored - UTC_0700) < 1e-6), '不可把 UTC 瞬時直接當成序號');
  const withMillis = loadIsolated();
  withMillis.sandbox.nowIso_ = () => '2026-10-18T07:00:00.000Z';
  withMillis.sandbox.acceptBooking_(payload({ _testOrderId: 'SMC910302' }));
  const millisStored = orderRows(withMillis)[1] ? orderRows(withMillis)[1][1] : null;
  assert(typeof millisStored === 'number' && Math.abs(millisStored - TAIPEI_1500) < 1e-6, '帶毫秒的同一瞬間也要是台北 15:00，實際 ' + millisStored);
  assert(!(typeof millisStored === 'number' && Math.abs(millisStored - UTC_0700) < 1e-6), '帶毫秒時不可沿用 UTC 序號');
}

function itemF2() {
  const probe = new Date(INPUT_0700Z);
  if (probe.getTimezoneOffset() !== 0) console.error('F2 紅燈請用 TZ=UTC。這次行程時區不是 UTC，仍會用試算表時區比對。');
  const isolated = loadIsolated();
  const midnightTaipei = new Date('2026-10-21T16:00:00.000Z');
  const gotDate = isolated.sandbox.serialOf_(midnightTaipei, 'Asia/Taipei');
  assert(typeof gotDate === 'number' && Math.abs(gotDate - DATE_SERIAL) < 1e-6, '日期 Date 要用試算表時區換回 2026-10-22，實際 ' + gotDate);
  const gotTime = isolated.sandbox.serialOf_(probe, 'Asia/Taipei');
  assert(typeof gotTime === 'number' && Math.abs(gotTime - TAIPEI_1500) < 1e-6, '同一 Date 在 UTC 專案時區仍要用台北牆鐘，實際 ' + gotTime);
  const book = isolated.box.byId['isolated-test-sheet'];
  const sheet = book.insertSheet('訂單');
  const expected = ['SMC910201', '', '', '', '', '', '', '', '', DATE_SERIAL];
  const planted = expected.slice();
  planted[9] = midnightTaipei;
  sheet.plant([
    ['訂單編號', '收到時間', '動作', '類型', '姓名', '電話', '信箱', '人數', '桌數', '日期'],
    planted,
  ]);
  const check = isolated.sandbox.confirmOrderRow_(sheet, 'SMC910201', expected);
  assert(check.ok === true, '試算表是台北、專案是 UTC 時，讀回 Date 仍要判成同一序號');
  assert(gs.includes('getSpreadsheetTimeZone'), '讀回要比對試算表時區，不可只用本地 getters');
  assert(gs.includes('Utilities.formatDate'), 'Date 換算要走 Utilities.formatDate 並帶入試算表時區');
}

function itemF6() {
  const sample = [
    ['x', 'y', 'z'],
    ['x', 'y', 'z'],
    [],
    [null, 'x', 'y'],
    [null, null, 'y', 'z'],
    [null, 'x', 'y', 'z'],
  ];
  const atA1 = appendTarget(sample, 'Sheet1!A1');
  const atSheet = appendTarget(sample, 'Sheet1!A:E');
  assert(atA1.row === 3 && atA1.col === 1 && atA1.tableRange === 'A1:C2', '官方例子：A1 接在 A1:C2 後面，從 A3 寫');
  assert(atSheet.row === 7 && atSheet.col === 2 && atSheet.tableRange === 'B4:D6', '官方例子：整張表範圍接在最後一個表格 B4:D6 後面，從 B7 寫');

  const isolated = loadIsolated();
  const book = isolated.box.byId['isolated-test-sheet'];
  book.id = 'isolated-test-sheet';
  const sheet = book.insertSheet('訂單');
  sheet.plant([['訂單編號'], ['SMC910401'], [], ['下方仍有資料']]);
  const before = sheet.rows().map((row) => row.slice());
  isolated.sandbox.writeRow_(sheet, ['SMC910402']);
  const after = sheet.rows();
  assert(after[4] && after[4][0] === 'SMC910402', '中段空白、下方還有資料時，新列要接在整張表最後一筆後面，實際 ' + JSON.stringify(after.map((row) => row[0])));
  assert(after[2] && !after[2].some((cell) => cell != null && cell !== ''), '中段空白列要留著');
  assert(after[3] && after[3][0] === before[3][0], '下方原列不可被插入列挪走');
  assert(isolated.box.logs.some((line) => line.includes('tableRange=') && line.includes('updatedRange=')), '執行記錄要寫出 tableRange 和 updatedRange');

  const tail = loadIsolated();
  const tailBook = tail.box.byId['isolated-test-sheet'];
  tailBook.id = 'isolated-test-sheet';
  const tailSheet = tailBook.insertSheet('訂單');
  tailSheet.plant([['訂單編號'], ['SMC910411']]);
  tailSheet.padFormattedTail(4);
  assert(tailSheet.getLastRow() > tailSheet.rows().length, '表尾只有格式時 getLastRow 會比有值的列多');
  tail.sandbox.writeRow_(tailSheet, ['SMC910412']);
  const tailRows = tailSheet.rows();
  assert(tailRows[2] && tailRows[2][0] === 'SMC910412', '表尾只有格式時，新列要接在最後一筆有值的列後面');
  assert(tailRows[1] && tailRows[1][0] === 'SMC910411', '原列不可被改掉');

  const pair = loadIsolated();
  pair.sandbox.nowIso_ = () => '2026-10-18T07:00:00.000Z';
  const first = pair.sandbox.acceptBooking_(payload({ _testOrderId: 'SMC910421' }));
  const second = pair.sandbox.acceptBooking_(payload({ _testOrderId: 'SMC910422' }));
  const ids = orderRows(pair).map((row) => row[0]);
  assert(first.response && first.response.status === 'success' && second.response && second.response.status === 'success', '連續兩筆都要收單');
  assert(ids[1] === 'SMC910421' && ids[2] === 'SMC910422', '連續兩筆要各佔一列，實際 ' + ids.join(','));

  const lied = loadIsolated();
  lied.box.lieUpdatedRange = "'訂單'!A1:A1";
  const liedRes = lied.sandbox.acceptBooking_(payload({ _testOrderId: 'SMC910431' }));
  assert(liedRes.response && liedRes.response.status === 'unknown', '寫入位置和 updatedRange 不符要回未知');
  assert(lied.box.mails.length === 0, '位置不符不可寄信');
}

function itemChecklist() {
  assert(checklist.includes('工作表1'), '清單要寫正式內用工作表1');
  assert(checklist.includes('A–M') || checklist.includes('A-M'), '清單要寫 A–M 十三欄維持不動');
  assert(checklist.includes('外帶'), '外帶分頁要另外列映射');
  assert(checklist.includes('22'), '清單要寫不可照搬隔離的 22 欄');
  assert(checklist.includes('normalizedPhone'), '清單要保留正式電話正規化');
  assert(checklist.includes('0936 677 616'), '清單要寫中間有空格的電話仍要比對到');
  assert(checklist.includes('parseInt'), '清單要保留桌數 parseInt');
  assert(checklist.includes('整欄') && (checklist.includes('不重設') || checklist.includes('不要重設') || checklist.includes('不可重設')), '清單要寫不可每次重設整欄格式');
  assert(checklist.includes('DailyBookingSync') || checklist.includes('LINE'), '清單要含每日同步或 LINE 總覽');
  assert(checklist.includes('new Date(46317)'), '清單要寫裸序號不能用 new Date(46317)');
  assert(checklist.includes('背景') && checklist.includes('店內'), '清單要核對正式背景通知會不會多寄一封店內信');
  assert(checklist.includes('需 Owner') || checklist.includes('Owner 決定'), '正式客人信失敗後要不要寄店內信，清單要標成待 Owner 決定');
}

function itemNitDoc() {
  assert(/這輪的測試留著|測試留在這輪/.test(verification), '14／13 要寫明這輪的測試留著');
  assert(!/測試、腳本、兩份文件都換回[\s\S]{0,80}13/.test(verification), '不可把 14／13 寫成連測試也換回 355da77');
  assert(runbook.includes('未確認全部寄出'), '手冊要把 mailed false 寫成未確認全部寄出');
  assert(!runbook.includes('沒有全部寄出'), '手冊不可再寫沒有全部寄出');
  assert(runbook.includes('需 Owner GO'), '執行步驟要有需 Owner GO');
  const merged = verification + '\n' + runbook;
  assert(merged.includes('合併到 main') && merged.includes('原文'), '要寫合併到 main 後公開 JS 立刻改送原文');
  assert(merged.includes('最後才開旗標') || merged.includes('最後才打開旗標'), '要寫先驗證正式 RAW，最後才開旗標');
  assert(merged.includes('只保證') && merged.includes('不解析輸入'), '要寫 Google 只保證 RAW 不解析輸入');
}

function itemNitPages() {
  const dir = '/tmp/pr47-fakebin';
  mkdirSync(dir, { recursive: true });
  const script = join(root, 'tools/check-pages-unpublished.mjs');
  const source = readFileSync(script, 'utf8');
  assert(source.includes('/tools/isolated-') && source.includes('/.github/pages-unpublished/'), 'Pages 檢查要含測試頁路徑');
  assert(!source.includes('pages-build-deployment'), 'Pages 檢查只 curl，不再讀建置紀錄');
  writeFileSync(join(dir, 'curl'), '#!/bin/sh\necho 404\n');
  chmodSync(join(dir, 'curl'), 0o755);
  const ok = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: dir },
  });
  const okOut = (ok.stdout || '') + (ok.stderr || '');
  assert(ok.status === 0, 'curl 回 404 要通過，實際 ' + ok.status + '\n' + okOut);
  assert(okOut.includes('pages unpublished check: pass'), '404 要印 pass');
  writeFileSync(join(dir, 'curl'), '#!/bin/sh\necho 200\n');
  chmodSync(join(dir, 'curl'), 0o755);
  const bad = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: dir },
  });
  const badOut = (bad.stdout || '') + (bad.stderr || '');
  assert(bad.status === 1, '不是 404 要失敗，實際 ' + bad.status + '\n' + badOut);
  assert(badOut.includes('應為 404'), '失敗要寫明應為 404');
  assert(!/pages unpublished check: pass/.test(badOut), '不是 404 不可印 pass');
}

const items = { f1: itemF1, f2: itemF2, f6: itemF6, checklist: itemChecklist, 'nit-doc': itemNitDoc, 'nit-pages': itemNitPages };
const asked = process.argv.includes('--item') ? process.argv[process.argv.indexOf('--item') + 1] : 'all';
const selected = asked === 'all' ? Object.keys(items) : [asked];
if (selected.some((name) => !items[name])) {
  console.error('未知項目 ' + asked);
  process.exit(2);
}
for (const name of selected) items[name]();
if (failures.length) {
  console.error('pr47 item ' + asked + ' failed: ' + failures.length);
  failures.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
console.log('pr47 item ' + asked + ': pass');
