#!/usr/bin/env node
// PR47 Codex r4 / round 5 must-fix. Does not call script.google.com, send mail, or open a real sheet.
// Red: this file against the pinned script b7a67f5. Green: the same commands after the fix.
// Usage: node tools/test-pr47-r5.mjs [--item probe|case7|single|matrix|nit|docs]
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

function resultRows(isolated) {
  const sheet = isolated.box.byId['isolated-test-sheet'].getSheetByName('驗收結果');
  return sheet ? sheet.rows() : [];
}

function itemProbe() {
  const isolated = loadIsolated();
  const realRead = isolated.sandbox.readColumn_;
  isolated.sandbox.readColumn_ = function (sheet, col) {
    if (sheet && sheet.getName && sheet.getName() === '訂單' && isolated.box.mails.length >= 12) {
      throw new Error('probe column read failed');
    }
    return realRead(sheet, col);
  };
  let threw = '';
  let msg = '';
  try {
    msg = String(isolated.sandbox.runIsolatedEightCases());
  } catch (err) {
    threw = String(err && err.message ? err.message : err);
  }
  assert(!threw, '案例 6 公式核對讀取丟錯不可再往外拋，實際 ' + threw);
  assert(msg.includes('6 公式開頭'), '摘要要寫停在案例 6，實際 ' + msg);
  assert(msg.includes('公式核對讀取'), '摘要要寫停在公式核對讀取，實際 ' + msg);
  assert(msg.includes('probe column read failed'), '摘要要寫出錯誤文字，實際 ' + msg);
  assert(msg.includes('確認寄出 12 封') && msg.includes('未確認寄出 0 封'), '摘要要寫當時確認與未確認封數，實際 ' + msg);
  assert(isolated.box.mails.length === 12, '讀取丟錯時已寄 12 封，不可再寄，實際 ' + isolated.box.mails.length);
  assert(!orderIds(isolated).includes('SMC900106'), '不可再跑案例 7');
  noPassWording('案例 6 公式核對讀取丟錯', isolated, msg);
  assert(resultRows(isolated).length >= 2, '盡力寫驗收結果，實際列數 ' + resultRows(isolated).length);

  const hidden = loadIsolated();
  const realRead2 = hidden.sandbox.readColumn_;
  hidden.sandbox.readColumn_ = function (sheet, col) {
    if (sheet && sheet.getName && sheet.getName() === '訂單' && hidden.box.mails.length >= 12) {
      throw new Error('probe column read failed');
    }
    return realRead2(sheet, col);
  };
  hidden.sandbox.writeResultSheet_ = function () { throw new Error('report write fail'); };
  let hiddenMsg = '';
  let hiddenThrew = '';
  try {
    hiddenMsg = String(hidden.sandbox.runIsolatedEightCases());
  } catch (err) {
    hiddenThrew = String(err && err.message ? err.message : err);
  }
  assert(!hiddenThrew, '驗收結果寫入失敗不可蓋掉摘要、也不可往外拋，實際 ' + hiddenThrew);
  assert(hiddenMsg.includes('公式核對讀取') && hiddenMsg.includes('probe column read failed'), '報告寫入失敗時仍要有公式核對讀取摘要，實際 ' + hiddenMsg);
  assert(hiddenMsg.includes('確認寄出 12 封'), '報告寫入失敗時仍要有封數，實際 ' + hiddenMsg);
  noPassWording('報告寫入失敗仍要有摘要', hidden, hiddenMsg);
}

function itemCase7() {
  function checkStop(label, isolated, msg, mails) {
    assert(msg.includes('7 格式壞掉'), label + '：摘要要寫停在案例 7，實際 ' + msg);
    assert(msg.includes('結果未知'), label + '：要寫結果未知，實際 ' + msg);
    assert(isolated.box.mails.length === mails, label + '：信數應是 ' + mails + '，實際 ' + isolated.box.mails.length);
    assert(!orderIds(isolated).some((id, i) => i > 0 && id === 'SMC900101' && isolated.box.mails.filter((m) => String(m.subject).includes('SMC900101')).length > 2), label + '：案例 8 不可再寄信');
    const labels = resultRows(isolated).map((row) => row[0]);
    assert(!labels.includes('8 同一編號再送'), label + '：驗收結果不可出現案例 8，實際 ' + labels.join(','));
    noPassWording(label, isolated, msg);
  }

  const position = loadIsolated();
  position.box.lieUpdatedRange = "'其他'!A8:V8";
  position.box.lieAtRow = 8;
  const positionMsg = String(position.sandbox.runIsolatedEightCases());
  checkStop('案例 7 位置錯誤', position, positionMsg, 12);

  const readBack = loadIsolated();
  const realConfirm = readBack.sandbox.confirmOrderRow_;
  readBack.sandbox.confirmOrderRow_ = function (sheet, orderId, expectedRow) {
    if (orderId === 'SMC900106') return { ok: false, header: '姓名', want: '測試同學', actual: '被改掉', formula: '' };
    return realConfirm(sheet, orderId, expectedRow);
  };
  const readBackMsg = String(readBack.sandbox.runIsolatedEightCases());
  checkStop('案例 7 讀回不符', readBack, readBackMsg, 12);

  const mail = loadIsolated();
  mail.sandbox.MailApp.sendEmail = function (to, subject, body) {
    if (String(subject).includes('預約申請已收到') && String(subject).includes('SMC900106')) throw new Error('guest send failed');
    mail.box.mails.push({ to, subject, body });
  };
  const mailMsg = String(mail.sandbox.runIsolatedEightCases());
  checkStop('案例 7 寄信未確認', mail, mailMsg, 13);
  assert(mailMsg.includes('寄信未確認'), '案例 7 寄信未確認：原因要寫寄信未確認，實際 ' + mailMsg);
}

function itemSingle() {
  assert(!/^function doPost\s*\(/m.test(gs), '不可新增 doPost');
  assert(!html.includes('runIsolatedOneBooking') && !html.includes('runIsolatedFixedBooking'), '不可在網頁加單筆入口');
  assert(typeof loadIsolated().sandbox.runIsolatedOneBooking201 === 'function', '編輯器要能跑 runIsolatedOneBooking201');
  assert(typeof loadIsolated().sandbox.runIsolatedOneBooking202 === 'function', '編輯器要能跑 runIsolatedOneBooking202');
  assert(typeof loadIsolated().sandbox.runIsolatedOneBooking203 === 'function', '編輯器要能跑 runIsolatedOneBooking203');
  if (typeof loadIsolated().sandbox.runIsolatedOneBooking201 !== 'function') return;

  const first = loadIsolated();
  const firstMsg = String(first.sandbox.runIsolatedOneBooking201());
  const firstRes = first.sandbox.acceptBooking_ ? null : null;
  assert(orderIds(first).includes('SMC900201'), '第一次要寫入 SMC900201，實際 ' + orderIds(first).join(','));
  assert(first.box.mails.length === 2, '第一次要寄 2 封，實際 ' + first.box.mails.length);
  assert(!firstMsg.includes('四種前綴都通過'), '單筆成功不可寫八案例通過字樣');

  const again = first.sandbox.runIsolatedOneBooking201();
  const againText = typeof again === 'string' ? again : JSON.stringify(again);
  assert(againText.includes('duplicate') || (again && again.response && again.response.duplicate === true) || /重複/.test(againText), '同一編號再跑要是重複，實際 ' + againText);
  assert(orderIds(first).filter((id) => id === 'SMC900201').length === 1, '重複不可再寫一列');
  assert(first.box.mails.length === 2, '重複不可再寄信，實際 ' + first.box.mails.length);

  const via202 = loadIsolated();
  via202.sandbox.runIsolatedOneBooking202();
  assert(orderIds(via202).includes('SMC900202'), 'runIsolatedOneBooking202 要送 SMC900202');

  const lied = loadIsolated();
  lied.box.lieUpdatedRange = "'其他'!A2:V2";
  lied.box.lieAtRow = 2;
  const liedMsg = String(lied.sandbox.runIsolatedOneBooking203());
  assert(liedMsg.includes('結果未知') || liedMsg.includes('unknown'), '單筆位置不符要停，實際 ' + liedMsg);
  assert(lied.box.mails.length === 0, '單筆位置不符不可寄信');
  noPassWording('單筆位置不符', lied, liedMsg);
}

function itemMatrix() {
  const ids = ['SMC900001', 'SMC900101', 'SMC900102', 'SMC900103', 'SMC900104', 'SMC900105', 'SMC900106', 'SMC900101'];
  const expected = [
    ['case1 wrong position', 0, '1 只有原來的 11 欄', false, true],
    ['case1 readback mismatch', 0, '1 只有原來的 11 欄', false, true],
    ['case1 shop mail fail', 1, '1 只有原來的 11 欄', false, true],
    ['case2 wrong position', 2, '2 廣告品牌', false, true],
    ['case2 readback mismatch', 2, '2 廣告品牌', false, true],
    ['case2 shop mail fail', 3, '2 廣告品牌', false, true],
    ['case3 wrong position', 4, '3 廣告非品牌', false, true],
    ['case3 readback mismatch', 4, '3 廣告非品牌', false, true],
    ['case3 shop mail fail', 5, '3 廣告非品牌', false, true],
    ['case4 wrong position', 6, '4 非廣告', false, true],
    ['case4 readback mismatch', 6, '4 非廣告', false, true],
    ['case4 shop mail fail', 7, '4 非廣告', false, true],
    ['case5 wrong position', 8, '5 來源不明', false, true],
    ['case5 readback mismatch', 8, '5 來源不明', false, true],
    ['case5 shop mail fail', 9, '5 來源不明', false, true],
    ['case6 wrong position', 10, '6 公式開頭', false, true],
    ['case6 readback mismatch', 10, '6 公式開頭', false, true],
    ['case6 shop mail fail', 11, '6 公式開頭', false, true],
    ['case7 wrong position', 12, '7 格式壞掉', false, true],
    ['case7 readback mismatch', 12, '7 格式壞掉', false, true],
    ['case7 shop mail fail', 13, '7 格式壞掉', false, true],
    ['case5 acceptBooking_ throws', 8, '5 來源不明', false, true],
    ['case8 acceptBooking_ throws', 14, '8 同一編號再送', false, true],
    ['case8 error status', 14, '8 同一編號再送', false, true],
    ['case6 probe mismatch', 12, '公式核對', false, false],
    ['report 驗收結果 readback short', 14, '', false, true],
    ['report 驗收結果 write throws', 14, '', false, true],
    ['happy path', 14, '', true, false],
  ];

  function summarize(iso, msg) {
    const pass = /四種前綴都通過/.test(msg) || iso.box.alerts.some((a) => /四種前綴都通過/.test(a));
    const stopAt = (msg.match(/停在「([^」]+)」/) || [])[1] || (/公式核對失敗/.test(msg) ? '公式核對' : '');
    return { mails: iso.box.mails.length, stop: stopAt, pass, unknown: /結果未知/.test(msg) };
  }

  const rows = [];
  for (let k = 0; k < 7; k += 1) {
    let iso = loadIsolated();
    iso.box.lieUpdatedRange = "'其他'!A2:V2";
    iso.box.lieAtRow = k + 2;
    rows.push(['case' + (k + 1) + ' wrong position', summarize(iso, String(iso.sandbox.runIsolatedEightCases()))]);

    iso = loadIsolated();
    const rc = iso.sandbox.confirmOrderRow_;
    iso.sandbox.confirmOrderRow_ = function (s, id, row) {
      if (id === ids[k]) return { ok: false, header: '姓名', want: 'a', actual: 'b', formula: '' };
      return rc(s, id, row);
    };
    rows.push(['case' + (k + 1) + ' readback mismatch', summarize(iso, String(iso.sandbox.runIsolatedEightCases()))]);

    iso = loadIsolated();
    const box = iso.box;
    iso.sandbox.MailApp.sendEmail = function (to, subject, body) {
      if (String(subject).includes(ids[k]) && !String(subject).includes('預約申請已收到')) throw new Error('shop fail');
      box.mails.push({ to, subject, body });
    };
    rows.push(['case' + (k + 1) + ' shop mail fail', summarize(iso, String(iso.sandbox.runIsolatedEightCases()))]);
  }
  for (const k of [4, 7]) {
    const iso = loadIsolated();
    const real = iso.sandbox.acceptBooking_;
    let n = 0;
    iso.sandbox.acceptBooking_ = function (p) {
      n += 1;
      if (n === k + 1) throw new Error('boom');
      return real(p);
    };
    rows.push(['case' + (k + 1) + ' acceptBooking_ throws', summarize(iso, String(iso.sandbox.runIsolatedEightCases()))]);
  }
  {
    const iso = loadIsolated();
    const real = iso.sandbox.acceptBooking_;
    let n = 0;
    iso.sandbox.acceptBooking_ = function (p) {
      n += 1;
      const r = real(p);
      if (n === 8) return { response: { status: 'error', message: 'x' }, wrote: false, mailed: false };
      return r;
    };
    rows.push(['case8 error status', summarize(iso, String(iso.sandbox.runIsolatedEightCases()))]);
  }
  {
    const iso = loadIsolated();
    const real = iso.sandbox.inspectFormulaProbes_;
    iso.sandbox.inspectFormulaProbes_ = function (...a) {
      const c = real(...a);
      if (c[0]) c[0].ok = false;
      return c;
    };
    rows.push(['case6 probe mismatch', summarize(iso, String(iso.sandbox.runIsolatedEightCases()))]);
  }
  {
    const iso = loadIsolated();
    const real = iso.sandbox.readSheetValues_;
    iso.sandbox.readSheetValues_ = function (sheet) {
      const v = real(sheet);
      if (sheet.getName && sheet.getName() === '驗收結果') return v.slice(0, 3);
      return v;
    };
    rows.push(['report 驗收結果 readback short', summarize(iso, String(iso.sandbox.runIsolatedEightCases()))]);
  }
  {
    const iso = loadIsolated();
    iso.sandbox.writeResultSheet_ = function () { throw new Error('report write fail'); };
    rows.push(['report 驗收結果 write throws', summarize(iso, String(iso.sandbox.runIsolatedEightCases()))]);
  }
  {
    const iso = loadIsolated();
    rows.push(['happy path', summarize(iso, String(iso.sandbox.runIsolatedEightCases()))]);
  }

  assert(rows.length === expected.length, '矩陣列數要是 ' + expected.length + '，實際 ' + rows.length);
  for (let i = 0; i < expected.length; i += 1) {
    const [tag, mails, stop, pass, unknown] = expected[i];
    const got = rows[i];
    assert(got && got[0] === tag, '矩陣第 ' + (i + 1) + ' 列應是 ' + tag + '，實際 ' + (got && got[0]));
    const row = got[1];
    assert(row.mails === mails, tag + '：信數應是 ' + mails + '，實際 ' + row.mails);
    if (stop) assert(String(row.stop).includes(stop) || String(row.stop).includes('公式核對'), tag + '：應停在 ' + stop + '，實際 ' + row.stop);
    assert(row.pass === pass, tag + '：pass 應是 ' + pass + '，實際 ' + row.pass);
    if (unknown) assert(row.unknown === true, tag + '：應是結果未知');
    else if (tag === 'happy path') assert(row.unknown === false && row.pass === true, '全對時不可寫結果未知');
  }
}

function itemNit() {
  const early = loadIsolated();
  early.box.lieUpdatedRange = "'其他'!A2:V2";
  early.box.lieAtRow = 2;
  const earlyMsg = String(early.sandbox.runIsolatedEightCases());
  assert(earlyMsg.includes('本輪公式核對未執行'), '案例 6 前停下要寫本輪公式核對未執行，實際 ' + earlyMsg);
  const earlyResult = resultRows(early);
  assert(earlyResult.slice(1).every((row) => String(row[2] || '').includes('未驗證')), '中途停下時，驗收結果已寫的列要標未驗證，實際 ' + JSON.stringify(earlyResult));

  const late = loadIsolated();
  const realRead = late.sandbox.readColumn_;
  late.sandbox.readColumn_ = function (sheet, col) {
    if (sheet && sheet.getName && sheet.getName() === '訂單' && late.box.mails.length >= 12) throw new Error('probe column read failed');
    return realRead(sheet, col);
  };
  let lateMsg = '';
  try {
    lateMsg = String(late.sandbox.runIsolatedEightCases());
  } catch (err) {
    lateMsg = String(err && err.message ? err.message : err);
  }
  assert(!lateMsg.includes('本輪公式核對未執行'), '已經進案例 6 時不可寫本輪公式核對未執行，實際 ' + lateMsg);
}

function itemDocs() {
  const ownerBlock = runbook.slice(0, runbook.indexOf('## 2026-10-18 14:59') >= 0 ? runbook.indexOf('## 2026-10-18 14:59') : 800);
  assert(ownerBlock.includes('重跑前清空四張分頁'), '手冊主步驟要寫重跑前清空四張分頁');
  assert(ownerBlock.includes('訂單') && ownerBlock.includes('郵件預覽') && ownerBlock.includes('驗收結果') && ownerBlock.includes('公式核對'), '清空要點名四張分頁');
  assert(ownerBlock.includes('表頭以下'), '清空範圍是表頭以下');
  assert(runbook.includes('runIsolatedOneBooking') && runbook.includes('SMC900201') && runbook.includes('SMC900202') && runbook.includes('SMC900203'), '手冊要寫單筆編輯器入口與三個編號');
  assert(runbook.includes('需 Owner GO'), '單筆入口仍需 Owner GO');
  assert(verification.includes('本機 PASS') && verification.includes('Pages BLOCKED'), 'Evidence 仍要分開寫 PASS 與 BLOCKED');
}

const items = { probe: itemProbe, case7: itemCase7, single: itemSingle, matrix: itemMatrix, nit: itemNit, docs: itemDocs };
const asked = process.argv.includes('--item') ? process.argv[process.argv.indexOf('--item') + 1] : 'all';
const selected = asked === 'all' ? Object.keys(items) : [asked];
if (selected.some((name) => !items[name])) {
  console.error('未知項目 ' + asked);
  process.exit(2);
}
for (const name of selected) items[name]();
if (failures.length) {
  console.error('pr47 r5 item ' + asked + ' failed: ' + failures.length);
  failures.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
console.log('pr47 r5 item ' + asked + ': pass');
