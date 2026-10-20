#!/usr/bin/env node
// 模擬正式「程式碼」內用桌數檢查。不連 Apps Script、不讀寫正式試算表。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'apps-script/dine-in-table-limit.js'), 'utf8');
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

function pad2(n) {
  return String(n).padStart(2, '0');
}

const context = vm.createContext({
  Object,
  String,
  Number,
  parseInt,
  isNaN,
  Date,
  Utilities: {
    formatDate(date, timeZone, format) {
      if (timeZone !== 'GMT+8') throw new Error('unexpected tz ' + timeZone);
      const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
      const y = shifted.getUTCFullYear();
      const m = pad2(shifted.getUTCMonth() + 1);
      const d = pad2(shifted.getUTCDate());
      const hh = pad2(shifted.getUTCHours());
      const mm = pad2(shifted.getUTCMinutes());
      if (format === 'yyyy-MM-dd') return `${y}-${m}-${d}`;
      if (format === 'HH:mm') return `${hh}:${mm}`;
      throw new Error('unexpected format ' + format);
    },
  },
});

// 與正式程式碼.js 的日期正規化相同：Date 用 GMT+8，純日期字串不依執行環境時區。
context.pad2_ = function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
};
context.isValidYmd_ = function isValidYmd_(y, m, d) {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === (m - 1) && dt.getUTCDate() === d;
};
context.sheetDayStr_ = function sheetDayStr_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return context.Utilities.formatDate(v, 'GMT+8', 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  if (/T\d{2}:\d{2}/.test(s) || /Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    const isoYmd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoYmd) {
      const iy = parseInt(isoYmd[1], 10);
      const im = parseInt(isoYmd[2], 10);
      const id = parseInt(isoYmd[3], 10);
      if (!context.isValidYmd_(iy, im, id)) return '';
    }
    const instant = new Date(s);
    if (isNaN(instant.getTime())) return '';
    return context.Utilities.formatDate(instant, 'GMT+8', 'yyyy-MM-dd');
  }
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (!m) return '';
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (!context.isValidYmd_(y, mo, day)) return '';
  return y + '-' + context.pad2_(mo) + '-' + context.pad2_(day);
};
context.resolveMealSession_ = function resolveMealSession_(params) {
  const rawPeriod = String(params.meal_period || '').trim();
  if (rawPeriod === '午' || rawPeriod === '中午') return '中午';
  if (rawPeriod === '晚' || rawPeriod === '晚上') return '晚上';
  const hourMatch = String(params.time || '').match(/\d{1,2}/);
  const hour = hourMatch ? parseInt(hourMatch[0], 10) : 18;
  return (hour >= 1 && hour < 15) ? '中午' : '晚上';
};

vm.runInContext(source, context, { filename: 'apps-script/dine-in-table-limit.js' });

const SHEET_LIMITS = { lunch: 9, dinner: 9 };
let limitCalls = 0;
const realLimit = context.dineInTableLimit_;
context.dineInTableLimit_ = function countedLimit(...args) {
  limitCalls += 1;
  return realLimit.apply(context, args);
};

function headerRow() {
  return ['時間戳記', '姓名', '電話', '人數', '日期', '時段(午/晚)', '抵達時間', '備註', '預訂桌數', '訂單編號', '狀態'];
}

function diningRow(date, session, tables, status) {
  const row = new Array(11).fill('');
  row[4] = date;
  row[5] = session;
  row[8] = tables;
  row[10] = status || '正常';
  return row;
}

function countUsedTables_(rows, bookingDate, session) {
  let usedTables = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    if (context.sheetDayStr_(rows[i][4]) === bookingDate && rows[i][5] === session && rows[i][10] !== '已取消') {
      usedTables += parseInt(rows[i][8] || 1, 10);
    }
  }
  return usedTables;
}

// 只模擬正式 processBooking 的內用／外帶分岔。外帶不讀桌數上限。
function screenBooking_(params, diningRows) {
  if (params.type !== 'dining') {
    return { ok: true, path: 'takeout', message: '', limit: null };
  }
  const session = context.resolveMealSession_(params);
  const bookingDate = context.sheetDayStr_(params.date);
  const currentLimit = context.dineInTableLimit_(bookingDate, session, SHEET_LIMITS.lunch, SHEET_LIMITS.dinner);
  const requestedTables = parseInt(params.tables || 1, 10);
  const usedTables = countUsedTables_(diningRows, bookingDate, session);
  if ((usedTables + requestedTables) > currentLimit) {
    return {
      ok: false,
      path: 'dining',
      session,
      bookingDate,
      usedTables,
      currentLimit,
      message: context.dineInOverCapMessage_(bookingDate, session, currentLimit, usedTables),
    };
  }
  return { ok: true, path: 'dining', session, bookingDate, usedTables, currentLimit, message: '' };
}

function taipeiMidnight(ymd) {
  return new Date(`${ymd}T00:00:00+08:00`);
}

function checkDining(label, params, rows, expect) {
  const result = screenBooking_({ type: 'dining', tables: 1, ...params }, [headerRow(), ...rows]);
  assert(result.ok === expect.ok, `${label}：預期${expect.ok ? '接受' : '拒絕'}，實際 ${result.ok ? '接受' : '拒絕'}（上限 ${result.currentLimit}，已用 ${result.usedTables}）`);
  if (expect.limit !== undefined) {
    assert(result.currentLimit === expect.limit, `${label}：上限應為 ${expect.limit}，實際 ${result.currentLimit}`);
  }
  if (expect.messageIncludes) {
    assert(String(result.message).includes(expect.messageIncludes), `${label}：訊息應含「${expect.messageIncludes}」，實際「${result.message}」`);
  }
  if (expect.messageExcludes) {
    assert(!String(result.message).includes(expect.messageExcludes), `${label}：訊息不應含「${expect.messageExcludes}」，實際「${result.message}」`);
  }
}

const noRows = [];

for (const date of ['2027-02-05', '2027/2/5', taipeiMidnight('2027-02-05'), new Date('2027-02-05T12:00:00+08:00'), '2027-02-04T16:00:00.000Z']) {
  const label = `除夕午 ${date instanceof Date ? date.toISOString() : date}`;
  checkDining(label, { date, meal_period: '午', tables: 1 }, noRows, {
    ok: false,
    limit: 0,
    messageIncludes: '不開放內用',
    messageExcludes: '剩餘桌位不足',
  });
}
checkDining('除夕晚、零桌', { date: '2027-02-05', meal_period: '晚', time: '18:00', tables: 1 }, noRows, {
  ok: false,
  limit: 0,
  messageIncludes: '不開放內用',
});

function fillCheck(label, date, mealPeriod, session) {
  for (let nth = 10; nth <= 15; nth++) {
    checkDining(`${label} 第 ${nth} 桌`, { date, meal_period: mealPeriod, tables: 1 }, [
      diningRow(date, session, nth - 1, '正常'),
    ], { ok: true, limit: 15 });
  }
  checkDining(`${label} 第 16 桌`, { date, meal_period: mealPeriod, tables: 1 }, [
    diningRow(date, session, 15, '正常'),
  ], { ok: false, limit: 15, messageIncludes: '剩餘桌位不足' });
  checkDining(`${label} 一次 10 桌`, { date, meal_period: mealPeriod, tables: 10 }, noRows, { ok: true, limit: 15 });
  checkDining(`${label} 一次 15 桌`, { date, meal_period: mealPeriod, tables: 15 }, noRows, { ok: true, limit: 15 });
  checkDining(`${label} 一次 16 桌`, { date, meal_period: mealPeriod, tables: 16 }, noRows, { ok: false, limit: 15 });
}

fillCheck('初一午', '2027-02-06', '午', '中午');
for (const day of ['2027-02-07', '2027-02-08', '2027-02-09']) {
  checkDining(`${day} 午第 15 桌`, { date: day, meal_period: '午', tables: 1 }, [
    diningRow(day, '中午', 14, '正常'),
  ], { ok: true, limit: 15 });
  checkDining(`${day} 晚第 16 桌`, { date: day, meal_period: '晚', tables: 1 }, [
    diningRow(day, '晚上', 15, '正常'),
  ], { ok: false, limit: 15, messageIncludes: '剩餘桌位不足' });
}
fillCheck('初一午斜線日期', '2027/2/6', '中午', '中午');
fillCheck('初五晚', '2027-02-10', '晚', '晚上');
fillCheck('初五晚午夜日期', taipeiMidnight('2027-02-10'), '晚上', '晚上');

checkDining('初一午不計已取消', { date: '2027-02-06', meal_period: '午', tables: 15 }, [
  diningRow('2027-02-06', '中午', 15, '已取消'),
], { ok: true, limit: 15 });
checkDining('初一午不計晚餐', { date: '2027-02-06', meal_period: '午', tables: 15 }, [
  diningRow('2027-02-06', '晚上', 15, '正常'),
], { ok: true, limit: 15 });
checkDining('初一午不計其他日期', { date: '2027-02-06', meal_period: '午', tables: 15 }, [
  diningRow(taipeiMidnight('2027-02-07'), '中午', 15, '正常'),
], { ok: true, limit: 15 });

function sheetCapCheck(label, date, mealPeriod) {
  checkDining(`${label} 第 9 桌`, { date, meal_period: mealPeriod, tables: 1 }, [
    diningRow(date, mealPeriod === '午' ? '中午' : '晚上', 8, '正常'),
  ], { ok: true, limit: 9 });
  checkDining(`${label} 第 10 桌`, { date, meal_period: mealPeriod, tables: 1 }, [
    diningRow(date, mealPeriod === '午' ? '中午' : '晚上', 9, '正常'),
  ], { ok: false, limit: 9, messageIncludes: '剩餘桌位不足', messageExcludes: '不開放內用' });
}

sheetCapCheck('初六午', '2027-02-11', '午');
sheetCapCheck('初六晚', '2027-02-11', '晚');
sheetCapCheck('一般日午', '2026-11-08', '午');
sheetCapCheck('一般日晚', '2026-11-08', '晚');

assert(context.dineInTableLimit_('2027-02-11', '中午', 8, 6) === 8, '非春節午仍應回傳系統設定午餐上限');
assert(context.dineInTableLimit_('2026-11-08', '晚上', 8, 6) === 6, '非春節晚仍應回傳系統設定晚餐上限');
assert(context.dineInTableLimit_('2027-02-04', '中午', 9, 9) === 9, '除夕前一日仍用系統設定');

limitCalls = 0;
const takeoutEve = screenBooking_({ type: 'takeout', date: '2027-02-05', meal_period: '午', tables: 20, time: '11:30' }, [
  headerRow(),
]);
const takeoutDay = screenBooking_({ type: 'takeout', date: '2027-02-06', meal_period: '晚', tables: 30, time: '17:30' }, [
  headerRow(),
]);
assert(takeoutEve.ok && takeoutEve.path === 'takeout', '除夕外帶不應被內用桌數拒絕');
assert(takeoutDay.ok && takeoutDay.path === 'takeout', '初一外帶不應被內用桌數拒絕');
assert(limitCalls === 0, `外帶不應讀內用上限，實際呼叫 ${limitCalls} 次`);
assert(!source.includes('外帶訂單'), '覆寫檔不應改到外帶分頁');

if (failures.length) {
  console.error(`cny2027 dine-in cap: ${failures.length} failed`);
  failures.forEach((line) => console.error(' -', line));
  process.exit(1);
}
console.log('cny2027 dine-in cap: 除夕內用關閉、初一至初五 15 桌、其餘沿用系統設定、外帶不套用');
