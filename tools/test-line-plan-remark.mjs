#!/usr/bin/env node
// LINE 訂位：方案代碼 → 備註（H 欄）測試。離線；不連網、不碰正式試算表／Apps Script。
// Usage:
//   node tools/test-line-plan-remark.mjs
//   SMC_GAS_MAIN=/path/to/程式碼.js node tools/test-line-plan-remark.mjs   # 另跑整合測試（套 patch 後模擬 LINE 對話）
// 測試資料全部是假的（測試同學／0900000000／SMC9000xx）。
import { readFileSync, existsSync, mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modPath = join(root, 'apps-script', 'official', 'LinePlanRemark.js');
const patchPath = join(root, 'apps-script', 'official', 'line-plan-remark.patch');
const modSrc = readFileSync(modPath, 'utf8');
const failures = [];
let passed = 0;
const eq = (got, want, label) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { passed++; console.log(`  ok  ${label}: ${g}`); }
    else failures.push(`${label}: got ${g} want ${w}`);
};
const ok = (c, label) => { if (c) passed++; else failures.push(label); };

const ctx = vm.createContext({});
vm.runInContext(modSrc, ctx, { filename: 'LinePlanRemark.js' });
const L = ctx;

// DailyBookingSync（line_smart_notify）辨識式，逐字複製自 r7 版本：
const KA_RE = /(\d+(?:\.\d+)?\s*[Kk]\s*[Xx]?\d*\s*[Aa])/;               // parseRemarkAndCode_
const PEOPLE_WORDS = '(?:大人[1-9][0-9]*位(?:、小朋友[1-9][0-9]*位)?(?:、幼兒[1-9][0-9]*位)?' +
    '|小朋友[1-9][0-9]*位(?:、幼兒[1-9][0-9]*位)?|幼兒[1-9][0-9]*位)';
const FORM_NEW_PREFIX_RE = new RegExp('^(?:散客|大型(?:[1-9][0-9]*a)?|[0-9]+(?:\\.[0-9]+)?k(?:[1-9][0-9]*a)?) ' +
    PEOPLE_WORDS + '(?= |；|$)');                                           // FORM_NEW_PREFIX_RE_

console.log('# parseLinePlan_');
const plan = (m) => { const p = L.parseLinePlan_(m); return p ? { price: p.price, tables: p.tables } : null; };
eq(plan('10位 5000的桌菜'), { price: 5000, tables: null }, '5000的桌菜');
eq(plan('桌菜4500 兩桌'), { price: 4500, tables: null }, '桌菜4500');
eq(plan('每桌5500'), { price: 5500, tables: null }, '每桌5500');
eq(plan('一桌5000，共兩桌'), { price: 5000, tables: null }, '一桌5000');
eq(plan('5k1a'), { price: 5000, tables: 1 }, '簡寫 5k1a');
eq(plan('4.5k2a 靠窗'), { price: 4500, tables: 2 }, '簡寫 4.5k2a');
eq(plan('4.5K 2A'), { price: 4500, tables: 2 }, '簡寫大寫含空白');
eq(plan('5.5k'), { price: 5500, tables: null }, '簡寫無桌數');
eq(plan('明天晚上6點 測試同學 0900000000 10位'), null, '沒講方案 → null');
eq(plan('2026/10/03 18:30 4位 0900000123'), null, '日期／時間／手機不當價位');
eq(plan('取消 SMC900001 0900000000'), null, '訂單編號不當價位');
eq(plan('2k'), null, '不合理價位');

console.log('# parseLineTables_');
eq(L.parseLineTables_('訂2桌'), 2, '2桌');
eq(L.parseLineTables_('兩桌 5000的桌菜'), 2, '兩桌');
eq(L.parseLineTables_('5000兩桌'), 2, '5000兩桌');
eq(L.parseLineTables_('桌菜5000'), null, '桌菜不算桌數');
eq(L.parseLineTables_('每桌5000'), null, '每桌不算');
eq(L.parseLineTables_('一桌5000'), null, '一桌5000 = 價位');
eq(L.parseLineTables_('5000一桌 12人'), null, '5000一桌 = 價位');
eq(L.parseLineTables_('一桌5000，共兩桌'), 2, '一桌5000，共兩桌');

console.log('# lineCategoryPeople_（D 欄唯一修正：分類在前要加總；其他 → null 沿用 parsePeople）');
const CP = (m) => L.lineCategoryPeople_(m);
for (const [m, want] of [
    ['大人8位小孩2位', 10], ['大人8位、小孩2位', 10], ['8大2小', 10], ['大人 8 位，小孩 2 位', 10], ['成人3位 小朋友1位', 4],
    ['10位 大人8位小孩2位', 10],
    ['大人8位小孩2位，素食1位', 10], ['大人8位小孩2位 需要1位素食', 10], ['大人8位小孩2位 第1位置', 10],
    ['大人8位小孩2位 5k2a', 10], ['2026/10/03 18:30 大人4位小孩1位 0900000000', 5],
    // 以下回 null → 程式碼.js 原本 parsePeople 決定（行為不變）
    ['大人8位，2位不吃辣', null], ['需要1位素食', null], ['第1位置', null], ['8位 第1位置', null], ['素食1位', null],
    ['8個大人2個小孩', null], ['大人8位、2個小孩', null], ['20位，小朋友2位要兒童椅', null], ['大人8位', null],
    ['10位 需要兒童椅', null], ['4大2小 共10位', null], ['12位 5000的桌菜', null], ['大人2桌', null],
    // 中文「一百」「一千」解析不了 → null（沿用 parsePeople），不可被讀成 1
    ['大人一百位小孩2位', null], ['大人兩位小孩一百位', null], ['一百位', null], ['大人一千位 小孩2位', null], ['一百大2小', null],
    ['大人八位小孩兩位', 10], ['大人十位小孩兩位', 12],
]) eq(CP(m), want, `分類加總 ${m}`);
eq(L.lineNumToInt_('一百'), 0, '一百 → 0（無效）'); eq(L.lineNumToInt_('十二'), 12, '十二 → 12');
eq(L.parseLineTables_('一百桌'), null, '一百桌 不是 1 桌'); eq(L.parseLineTables_('十桌'), 10, '十桌');

console.log('# 桌數／價位補強（blocker 3＋nits）');
for (const [m, wantPlan, wantTables] of [
    ['一桌是5000', { price: 5000, tables: null }, 1], ['一桌要5000', { price: 5000, tables: null }, 1],
    ['一桌大約5000', { price: 5000, tables: null }, 1], ['一桌5000', { price: 5000, tables: null }, null],
    ['一桌要5000，共兩桌', { price: 5000, tables: null }, 2], ['5000兩桌', { price: 5000, tables: null }, 2],
    ['2桌菜5000', { price: 5000, tables: null }, 2], ['5k×2a', { price: 5000, tables: 2 }, null],
    ['５ｋ２ａ', { price: 5000, tables: 2 }, null], ['４．５ｋ１ａ', { price: 4500, tables: 1 }, null],
    ['iPhone 5k', null, null], ['iPhone5k', null, null], ['要5kg雞', null, null],
]) { eq(plan(m), wantPlan, `價位 ${m}`); eq(L.parseLineTables_(m), wantTables, `桌數 ${m}`); }

console.log('# composeLineRemark_');
const C = (o) => L.composeLineRemark_(o);
const cases = [
    ['5000 × 1 桌、無備註', { plan: { price: 5000 }, tables: 1 }, '5k1a'],
    ['4500 × 2 桌（a = 桌數，不是人數）', { plan: { price: 4500 }, tables: 2 }, '4.5k2a'],
    ['方案＋原備註', { plan: { price: 5000 }, tables: 1, note: '靠窗、需要兒童椅' }, '5k1a；靠窗、需要兒童椅'],
    ['不自動加人數分類字', { plan: { price: 5500 }, tables: 3, note: '' }, '5.5k3a'],
    ['客人自己寫的人數字照原樣保留', { plan: { price: 5000 }, tables: 1, note: '大人10位 慶生' }, '5k1a；大人10位 慶生'],
    ['備註已有代碼 → 不重複，移到最前', { plan: { price: 5000 }, tables: 1, people: 10, note: '5k1a 靠窗' }, '5k1a；靠窗'],
    ['備註已有代碼（大寫空白）→ 正規化', { plan: { price: 5000 }, tables: 1, people: 10, note: '靠窗、5K 1A' }, '5k1a；靠窗'],
    ['沒方案、沒分類 → 原備註不變', { tables: 1, people: 4, note: '靠窗' }, '靠窗'],
    ['備註 5k1a＋明講 2 桌 → a 改成 2（blocker 4）', { plan: { price: 5000 }, tables: 2, people: 20, note: '5k1a 靠窗' }, '5k2a；靠窗'],
    ['備註只有 5k → 不重複', { plan: { price: 5000 }, tables: 1, people: 10, note: '5k' }, '5k1a'],
    ['備註全形代碼 → 半形＋最終桌數', { tables: 2, people: 20, note: '５ｋ２ａ 靠窗' }, '5k2a；靠窗'],
    ['備註 5k×2a → 正規化', { tables: 2, people: 20, note: '5k×2a' }, '5k2a'],
    ['P1 多輪改價：備註 5k1a＋最新方案 5500 → 5.5k1a', { plan: { price: 5500 }, tables: 1, note: '5k1a 靠窗' }, '5.5k1a；靠窗'],
    ['P1 多輪改價＋改桌數 → 5.5k2a', { plan: { price: 5500 }, tables: 2, note: '5k1a 靠窗' }, '5.5k2a；靠窗'],
    ['沒有方案資訊、只有備註代碼 → 沿用備註代碼', { tables: 1, note: '5k1a 靠窗' }, '5k1a；靠窗'],
    ['備註 iPhone 5k 不是代碼', { plan: { price: 5000 }, tables: 1, people: 10, note: 'iPhone 5k 充電' }, '5k1a；iPhone 5k 充電'],
    ['全空 → 空字串', { tables: 1, people: 4 }, ''],
];
for (const [label, o, want] of cases) eq(C(o), want, label);

console.log('# lineCustomerNote_（客人看到的備註不含方案代碼）');
const CN = (n) => L.lineCustomerNote_(n);
const SHORT_CODE = /(?:散客|大型)[1-9][0-9]*a/;
const CODE_LIKE = /(?:^|[^0-9A-Za-z.])\d{1,2}(?:\.\d+)?\s*[Kk](?![A-Za-z])|\d\s*[Kk]\s*[Xx]?\d*\s*[Aa]/;
const cnCases = [
    ['5k2a', ''], ['4.5k2a', ''], ['5k1a', ''], ['5K 1A', ''], ['5k', ''], ['4.5K', ''],
    ['5k1a 慶生', '慶生'], ['靠窗、4.5k2a', '靠窗'], ['4.5k2a、靠窗、慶生', '靠窗、慶生'],
    ['5K1A5k2a 靠窗', '靠窗'], ['備註：5k1a', '備註'], ['５ｋ２ａ 靠窗', '靠窗'], ['5k×2a 慶生', '慶生'],
    ['需要兒童椅', '需要兒童椅'], ['靠窗、慶生／生日', '靠窗、慶生／生日'],
    ['大型4a 靠窗', '靠窗'], ['散客3a、慶生', '慶生'], ['靠窗、大型2a、慶生', '靠窗、慶生'], ['散客', ''], ['大型4a', ''],
    ['散客 大人6位；不吃辣', '大人6位；不吃辣'], ['散客很多想靠窗', '散客很多想靠窗'], ['大型聚會 靠窗', '大型聚會 靠窗'],
    ['要5kg雞', '要5kg雞'], ['iPhone5k 充電', 'iPhone5k 充電'], ['iPhone 5k 充電', 'iPhone 5k 充電'], ['', ''],
];
for (const [inp, want] of cnCases) eq(CN(inp), want, `客人備註 ${JSON.stringify(inp)}`);
for (const [label, o] of cases) {
    const shown = CN(o.note || '');
    if (/iPhone/.test(shown)) continue; // 刻意保留的一般字（不是代碼）
    ok(!CODE_LIKE.test(shown) && !SHORT_CODE.test(shown), `客人備註仍含代碼：${label} → ${shown}`);
}

console.log('# linePlanFriendly_／customerNoteText_／lineCustomerPlanText_（客人看的方案友善文字）');
const PF = (t) => L.linePlanFriendly_(t);
for (const [inp, want] of [
    ['4.5k1a', '每桌 4500 元、1 桌'], ['5k2a', '每桌 5000 元、2 桌'], ['5.5k3a', '每桌 5500 元、3 桌'],
    ['5K 2A', '每桌 5000 元、2 桌'], ['5k', '每桌 5000 元'], ['5k1a；靠窗', '每桌 5000 元、1 桌'],
    ['4.5k2a；慶生', '每桌 4500 元、2 桌'], ['5k×2a', '每桌 5000 元、2 桌'], ['５ｋ２ａ', '每桌 5000 元、2 桌'], ['iPhone 5k', ''], ['散客 大人6位', ''], ['大型4a 大人30位', ''], ['靠窗', ''], ['2k1a', ''], ['', ''],
]) eq(PF(inp), want, `友善方案 ${JSON.stringify(inp)}`);
const NT = (t) => L.customerNoteText_(t);
for (const [inp, want] of [
    ['5k1a 大人10位、小朋友2位 素食1位；慶生', '大人10位、小朋友2位 素食1位；慶生'],
    ['4.5k1a', ''], ['5.5k3a 大人30位', '大人30位'], ['散客 大人6位；不吃辣', '大人6位；不吃辣'], ['散客', ''],
    ['大型4a 大人30位 素食', '大人30位 素食'], ['靠窗', '靠窗'], ['散客很多想靠窗', '散客很多想靠窗'],
]) eq(NT(inp), want, `客人備註（工作表→客人）${JSON.stringify(inp)}`);
const SP = (st) => L.lineCustomerPlanText_(st);
eq(SP({ plan: { price: 5000 }, people: '12' }), '每桌 5000 元、2 桌', '對話中：12位沒講桌數 → 2 桌');
eq(SP({ plan: { price: 5000 }, people: '12', tables: 1 }), '每桌 5000 元、1 桌', '對話中：12位＋一桌 → 1 桌');
eq(SP({ plan: { price: 4500 } }), '每桌 4500 元', '對話中：還沒人數 → 只顯示價位');
eq(SP({ note: '5k1a 慶生', people: '10' }), '每桌 5000 元、1 桌', '對話中：客人自己打代碼');
eq(SP({ people: '4', note: '靠窗' }), '', '對話中：沒方案 → ""');
eq(SP({ plan: { price: 5500 }, tables: 1, people: '10', note: '5k1a 靠窗' }), '每桌 5500 元、1 桌', '對話中：多輪改價以最新方案為準');

console.log('# DailyBookingSync 相容性');
for (const [label, o] of cases) {
    const r = C(o);
    if (!/k\d+a/.test(r)) continue;
    const recognized = FORM_NEW_PREFIX_RE.test(r) || (KA_RE.test(r) && r.match(KA_RE)[1].replace(/\s+/g, '').toLowerCase() === r.split(/[ ；]/)[0]);
    ok(recognized, `DailyBookingSync 無法辨識代碼：${label} → ${r}`);
    ok(!/預估金額|\$|NT/.test(r), `備註不可含金額：${r}`);
}

console.log('# patch 靜態檢查');
const patch = readFileSync(patchPath, 'utf8');
ok(!/CHANNEL_ACCESS_TOKEN|GEMINI_API_KEY|MY_USER_ID|SPREADSHEET_ID\s*=/.test(patch), 'patch 不可帶到機密常數行');
const patchCode = patch.split('\n').filter((l) => /^[+-](?![+-])/.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
ok(!/(appendRow|預估金額|estimatedAmount|resolveEstimatedAmount_|getRange\(\s*\w+\s*,\s*13)/.test(patchCode), 'patch 不可改 appendRow／預估金額（M 欄）');
ok(/^\+.*composeLineRemark_\(/m.test(patch) && /^\+.*parseLinePlan_\(/m.test(patch), 'patch 必須接上 composeLineRemark_／parseLinePlan_');
ok(/^\+.*successMsg.*custPlanText.*custNoteText/m.test(patch) && /^-.*successMsg.*params\.note \|\| "無"/m.test(patch), 'patch 必須讓預約成功訊息改用友善方案＋去代碼備註');
ok(/^\+.*customerPlan:\s*linePlanFriendly_\(note\)/m.test(patch), 'finalizeBooking 必須帶 customerPlan = linePlanFriendly_(H 欄備註)');
ok(/^\+.*🍽️ 方案：" \+ lineCustomerPlanText_\(state\)/m.test(patch) && /^\+.*🍽️ 方案：" \+ lineCustomerPlanText_\(s\)/m.test(patch), '核對／還差資料訊息必須顯示友善方案文字');
ok(/^-.*備註事項：.*data\.note \|\| "無"/m.test(patch) && /^\+.*備註事項：.*custNoteText/m.test(patch) && /^\+.*custPlanText = .*linePlanFriendly_\(data\.note\)/m.test(patch), '確認信必須改用友善方案＋去代碼備註');
ok(/^\+.*customerNote:\s*lineCustomerNote_\(/m.test(patch), 'finalizeBooking 必須帶 customerNote = lineCustomerNote_(原備註)');
ok(/^\+.*confirmMsg|^\+.*📝 備註：" \+ lineCustomerNote_\(state\.note\)/m.test(patch), '核對訊息必須用 lineCustomerNote_');
ok(/^\+.*parts\.push\("📝 備註：" \+ lineCustomerNote_\(s\.note\)\)/m.test(patch), '還差資料訊息必須用 lineCustomerNote_');
ok(/^\+.*people:\s*lineCategoryPeople_\(msg\) \|\| parsePeople\(msg\)/m.test(patch), 'patch：人數只加 lineCategoryPeople_ 修正，否則原本 parsePeople');
ok(!/^[+-].*if \(parsed\.people\)/m.test(patch), 'patch：handleLineWebhook 的 state.people 設定維持原樣');
ok(!/parseLineHeadcount_|parseLinePeopleInfo_|lineMessagePeople_|peopleFromBreakdown|state\.head|linePeopleWords_/.test(patch + modSrc), '已移除：自動人數分類字與以分類覆蓋 D 欄');
ok(/^\+.*tables:\s*parseLineTables_\(msg\) \|\|/m.test(patch), 'patch：明講桌數優先於代碼 a');
ok(!/09\d{8}/.test(patch.replace(/09\\d\{8\}/g, '')) && !/SMC\d{6}/.test(patch), 'patch 不可含真實手機／訂單編號');

// ---- 整合測試（可選）：套 patch 到 v149 程式碼.js，模擬 LINE 對話到「確認」，檢查寫進工作表1 的列 ----
const gasMain = process.env.SMC_GAS_MAIN;
if (gasMain && existsSync(gasMain)) {
    console.log('# 整合測試（SMC_GAS_MAIN）');
    const dir = mkdtempSync(join(tmpdir(), 'smc-line-'));
    const target = join(dir, 'main.js');
    copyFileSync(gasMain, target);
    execFileSync('patch', ['-s', target, patchPath]);
    const mainSrc = readFileSync(target, 'utf8');

    const pad = (n) => String(n).padStart(2, '0');
    const tw = (d) => new Date(d.getTime() + 8 * 3600e3);
    const fmt = (d, _tz, f) => { const t = tw(d); return f
        .replace('yyyy', t.getUTCFullYear()).replace('MM', pad(t.getUTCMonth() + 1)).replace('dd', pad(t.getUTCDate()))
        .replace('HH', pad(t.getUTCHours())).replace('mm', pad(t.getUTCMinutes())); };
    function run(messages) {
        const rows = [['ts', '姓名', '電話', '人數', '日期', '時段', '時間', '備註', '桌數', '編號', '狀態', 'email', '預估金額']];
        const replies = [];
        const mails = [];
        const tasks = [];
        const store = {};
        const range = () => ({ setNumberFormat() { return this; }, setValue(v) { return this; }, getValue: () => 99, getValues: () => [[]] });
        const bookingSheet = { getDataRange: () => ({ getValues: () => rows }), appendRow: (r) => rows.push(r), getLastRow: () => rows.length, getRange: range };
        const other = { getDataRange: () => ({ getValues: () => [[]] }), appendRow() {}, getLastRow: () => 1, getRange: range };
        const g = {
            SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => n === '工作表1' ? bookingSheet : other }), getActiveSpreadsheet: () => ({ getSheetByName: () => other }) },
            CacheService: { getScriptCache: () => ({ get: (k) => store[k] || null, put: (k, v) => { store[k] = v; }, remove: (k) => { delete store[k]; } }) },
            UrlFetchApp: { fetch: (url, o) => { if (/reply/.test(url)) replies.push(JSON.parse(o.payload).messages[0].text); return { getResponseCode: () => 200, getContentText: () => '' }; } },
            Utilities: { formatDate: fmt },
            ContentService: { createTextOutput: (t) => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
            Logger: { log() {} }, LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
            CalendarApp: { getDefaultCalendar: () => ({ createEvent() {} }) }, MailApp: { sendEmail: (o) => mails.push(o) }, GmailApp: { sendEmail() {} },
            PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
            // BackgroundTasks.js（另一個檔）：網頁訂位的通知／郵件排到背景；測試直接收下來，稍後照它的邏輯呼叫 sendConfirmationEmail
            enqueueBackgroundTask: (t) => tasks.push(t),
        };
        const c = vm.createContext(g);
        vm.runInContext(modSrc + '\n' + mainSrc, c);
        let i = 0;
        if (Array.isArray(messages)) {
            for (const text of messages) c.handleLineWebhook({ type: 'message', replyToken: 'r' + i, source: { userId: 'Utest' }, message: { type: 'text', id: 'm' + (i++), text } });
        } else {
            c.processBooking(messages, false, null); // 網頁表單路徑（doPost → processBooking）
            // 模擬 BackgroundTasks.processBackgroundTasks 的郵件步驟：if (data.email) sendConfirmationEmail(data, task.orderId)
            for (const t of tasks) if (t.params && t.params.email) c.sendConfirmationEmail(t.params, t.orderId);
        }
        return { rows: rows.slice(1), replies, mails, c };
    }
    const y = new Date().getUTCFullYear() + 1;
    const base = `${y}/10/03 18:30 姓名測試同學 0900000000`;
    const I = [
        ['桌菜5000、大人10位小朋友2位、靠窗', [`${base} 大人10位小朋友2位 5000的桌菜 靠窗`, '確認'], { people: '12', note: '5k2a；靠窗', tables: 2 }, { plan: '每桌 5000 元、2 桌' }],
        ['4.5k2a 簡寫、20位', [`${base} 20位 4.5k2a`, '確認'], { people: '20', note: '4.5k2a', tables: 2 }, { plan: '每桌 4500 元、2 桌' }],
        ['桌菜4500 兩桌、2位', [`${base} 2位 桌菜4500 兩桌`, '確認'], { people: '2', note: '4.5k2a', tables: 2 }, { plan: '每桌 4500 元、2 桌' }],
        ['分兩則訊息', [`${base} 10位`, '5000的桌菜', '確認'], { people: '10', note: '5k1a', tables: 1 }, { plan: '每桌 5000 元、1 桌' }],
        ['備註已有代碼', [`${base} 10位 備註 5k1a 慶生`, '確認'], { people: '10', note: '5k1a；慶生', tables: 1 }, { plan: '每桌 5000 元、1 桌' }],
        ['沒講方案 → 備註不變（回歸）', [`${base} 4位 靠窗`, '確認'], { people: '4', note: '靠窗', tables: 1 }, { plan: null }],
        ['12位＋一桌就好 → 1 桌、5k1a', [`${base} 12位 5000的桌菜 一桌就好`, '確認'], { people: '12', note: '5k1a', tables: 1 }, { tablesShown: 1, plan: '每桌 5000 元、1 桌' }],
        ['12位沒講桌數 → ceil(12/10)=2 桌', [`${base} 12位 5000的桌菜`, '確認'], { people: '12', note: '5k2a', tables: 2 }, { tablesShown: 2, plan: '每桌 5000 元、2 桌' }],
        ['客人打 5k2a 簡寫＋靠窗', [`${base} 20位 5k2a 靠窗`, '確認'], { people: '20', note: '5k2a；靠窗', tables: 2 }, { shown: '靠窗', plan: '每桌 5000 元、2 桌' }],
        ['客人自己打 備註 5k1a', [`${base} 10位 備註 5k1a`, '確認'], { people: '10', note: '5k1a', tables: 1 }, { shown: '無', plan: '每桌 5000 元、1 桌' }],
        ['客人打 備註 4.5k2a 慶生（先缺手機）', [`${y}/10/03 18:30 姓名測試同學 20位 備註 4.5k2a 慶生`, '0900000000', '確認'], { people: '20', note: '4.5k2a；慶生', tables: 2 }, { shown: '慶生', minReplies: 3, plan: '每桌 4500 元、2 桌', summaryPlan: true }],
        // 人數（D 欄）：唯一修正＝分類在前加總；素食1位／2位不吃辣／需要1位素食／第1位置 不算人數
        ['人數：大人8位小孩2位 → 10', [`${base} 大人8位小孩2位`, '確認'], { people: '10', note: '', tables: 1 }, { plan: null }],
        ['人數：大人8位、小孩2位 → 10', [`${base} 大人8位、小孩2位`, '確認'], { people: '10', note: '', tables: 1 }, { plan: null }],
        ['人數：8大2小 → 10', [`${base} 8大2小`, '確認'], { people: '10', note: '', tables: 1 }, { plan: null }],
        ['人數：大人8位小孩2位，素食1位 → 10', [`${base} 大人8位小孩2位，素食1位`, '確認'], { people: '10', note: '素食需求', tables: 1 }, { plan: null }],
        ['人數：大人8位，2位不吃辣 → 8', [`${base} 大人8位，2位不吃辣`, '確認'], { people: '8', note: '不吃辣', tables: 1 }, { plan: null }],
        ['人數：10位 大人8位小孩2位 → 10', [`${base} 10位 大人8位小孩2位`, '確認'], { people: '10', note: '', tables: 1 }, { plan: null }],
        ['人數：大人8位小孩2位 需要1位素食 → 10', [`${base} 大人8位小孩2位 需要1位素食`, '確認'], { people: '10', note: '素食需求', tables: 1 }, { plan: null }],
        ['人數：12位 第1位置 → 12（原本行為）', [`${base} 12位 第1位置`, '確認'], { people: '12', note: '', tables: 2 }, { plan: null }],
        ['人數：20位，小朋友2位要兒童椅 → 20（原本行為）', [`${base} 20位，小朋友2位要兒童椅`, '確認'], { people: '20', note: '需要兒童椅', tables: 2 }, { plan: null }],
        ['人數：4大2小 共10位 → 10（原本行為）', [`${base} 4大2小 共10位`, '確認'], { people: '10', note: '', tables: 1 }, { plan: null }],
        ['人數：8個大人2個小孩 → 10（原本行為）', [`${base} 8個大人2個小孩`, '確認'], { people: '10', note: '', tables: 1 }, { plan: null }],
        ['人數＋方案：大人10位小孩2位 一桌是5000', [`${base} 大人10位小孩2位 一桌是5000`, '確認'], { people: '12', note: '5k1a', tables: 1 }, { shown: '無', plan: '每桌 5000 元、1 桌', tablesShown: 1 }],
        // 桌數／價位
        ['8位 一桌是5000', [`${base} 8位 一桌是5000`, '確認'], { people: '8', note: '5k1a', tables: 1 }, { shown: '無', plan: '每桌 5000 元、1 桌' }],
        ['12位 一桌要5000 → 1 桌', [`${base} 12位 一桌要5000`, '確認'], { people: '12', note: '5k1a', tables: 1 }, { shown: '無', plan: '每桌 5000 元、1 桌', tablesShown: 1 }],
        ['10位 一桌大約5000', [`${base} 10位 一桌大約5000`, '確認'], { people: '10', note: '5k1a', tables: 1 }, { shown: '無', plan: '每桌 5000 元、1 桌' }],
        ['12位 一桌5000（價位，桌數照人數）', [`${base} 12位 一桌5000`, '確認'], { people: '12', note: '5k2a', tables: 2 }, { shown: '無', plan: '每桌 5000 元、2 桌' }],
        ['同一則 20位 兩桌 備註 5k1a 靠窗 → 5k2a', [`${base} 20位 兩桌 備註 5k1a 靠窗`, '確認'], { people: '20', note: '5k2a；靠窗', tables: 2 }, { shown: '靠窗', plan: '每桌 5000 元、2 桌', tablesShown: 2 }],
        ['多輪 備註 5k1a → 兩桌 → 5k2a', [`${base} 20位 備註 5k1a 靠窗`, '兩桌', '確認'], { people: '20', note: '5k2a；靠窗', tables: 2 }, { shown: '靠窗', plan: '每桌 5000 元、2 桌', tablesShown: 2 }],
        ['12位 5000兩桌', [`${base} 12位 5000兩桌`, '確認'], { people: '12', note: '5k2a', tables: 2 }, { shown: '無', plan: '每桌 5000 元、2 桌' }],
        ['12位 2桌菜5000', [`${base} 12位 2桌菜5000`, '確認'], { people: '12', note: '5k2a', tables: 2 }, { shown: '無', plan: '每桌 5000 元、2 桌' }],
        ['20位 5k×2a', [`${base} 20位 5k×2a`, '確認'], { people: '20', note: '5k2a', tables: 2 }, { shown: '無', plan: '每桌 5000 元、2 桌' }],
        ['20位 全形５ｋ２ａ', [`${base} 20位 ５ｋ２ａ`, '確認'], { people: '20', note: '5k2a', tables: 2 }, { shown: '無', plan: '每桌 5000 元、2 桌' }],
        ['備註只有 5k → 5k1a 不重複', [`${base} 10位 備註 5k`, '確認'], { people: '10', note: '5k1a', tables: 1 }, { shown: '無', plan: '每桌 5000 元、1 桌' }],
        ['iPhone 5k 不是方案', [`${base} 4位 備註 iPhone 5k 充電`, '確認'], { people: '4', note: 'iPhone 5k 充電', tables: 1 }, { shown: 'iPhone 5k 充電', plan: null, allowCodeLike: true }],
        // [P1] 多輪改價／改桌數：以最後一次有效的方案為準；H、核對、成功訊息、I 欄一致
        ['P1：先備註 5k1a，再改桌菜5500，再確認', [`${base} 10位 備註 5k1a 靠窗`, '改成桌菜5500', '確認'], { people: '10', note: '5.5k1a；靠窗', tables: 1 }, { shown: '靠窗', plan: '每桌 5500 元、1 桌', tablesShown: 1 }],
        ['P1：先備註 5k1a，再改桌菜5500 三桌', [`${base} 20位 備註 5k1a 靠窗`, '改成桌菜5500 三桌', '確認'], { people: '20', note: '5.5k3a；靠窗', tables: 3 }, { shown: '靠窗', plan: '每桌 5500 元、3 桌', tablesShown: 3 }],
        ['P1：先 5k1a，改兩桌，再改 5.5k', [`${base} 20位 備註 5k1a 靠窗`, '兩桌', '改成5.5k', '確認'], { people: '20', note: '5.5k2a；靠窗', tables: 2 }, { shown: '靠窗', plan: '每桌 5500 元、2 桌', tablesShown: 2 }],
        ['P1：先桌菜5500，再備註 5k1a（最新＝5k）', [`${base} 10位 桌菜5500`, '備註 5k1a 靠窗', '確認'], { people: '10', note: '5k1a；靠窗', tables: 1 }, { shown: '靠窗', plan: '每桌 5000 元、1 桌', tablesShown: 1 }],
        // 散客Na／大型Na 不給客人看（核對、還差資料摘要、成功訊息 customerNote）
        ['大型4a 靠窗 → 客人只看到靠窗', [`${base} 20位 備註 大型4a 靠窗`, '確認'], { people: '20', note: '大型4a 靠窗', tables: 2 }, { shown: '靠窗', plan: null, confirmNote: '靠窗' }],
        ['大型4a 靠窗（先缺手機 → 還差資料摘要）', [`${y}/10/03 18:30 姓名測試同學 20位 備註 大型4a 靠窗`, '0900000000', '確認'], { people: '20', note: '大型4a 靠窗', tables: 2 }, { shown: '靠窗', plan: null, minReplies: 3, summaryNote: '靠窗', confirmNote: '靠窗' }],
        ['散客3a、慶生 → 客人只看到慶生', [`${base} 6位 備註 散客3a、慶生`, '確認'], { people: '6', note: '散客3a、慶生', tables: 1 }, { shown: '慶生', plan: null, confirmNote: '慶生' }],
        ['5.5k3a 簡寫、30位', [`${base} 30位 5.5k3a`, '確認'], { people: '30', note: '5.5k3a', tables: 3 }, { shown: '無', plan: '每桌 5500 元、3 桌' }],
    ];
    for (const [label, msgs, want, rw = {}] of I) {
        const { rows, replies } = run(msgs);
        // 客人看到的所有 LINE 回覆（還差資料／核對／預約成功）都不可含方案代碼
        ok(replies.length >= (rw.minReplies || 2), `${label}: 應有 ${rw.minReplies || 2}+ 則客人回覆，實際 ${replies.length}`);
        if (!rw.allowCodeLike) replies.forEach((t, k) => ok(!CODE_LIKE.test(t), `${label}: 第 ${k + 1} 則客人回覆含方案代碼：${t}`));
        const success = replies.find((t) => /預約成功/.test(t)) || '';
        ok(!!success, `${label}: 找不到預約成功回覆（replies: ${replies.join(' / ')}）`);
        const shownNote = (success.match(/\n備註：([^\n]*)/) || [])[1];
        const wantShown = rw.shown != null ? rw.shown : (want.note.includes('；') ? want.note.split('；').slice(1).join('；') : (/k\d*a/.test(want.note) ? '無' : (want.note || '無')));
        eq(shownNote, wantShown, `整合 ${label}：客人看到的備註`);
        // 方案友善文字：有方案 → 核對與成功訊息各多一行；沒方案 → 任何回覆都不多「方案」行
        const confirm = replies.filter((t) => /請您核對/.test(t)).pop() || ''; // 最後一次核對（多則訊息時）
        // 成功訊息的「桌數」與「方案」的桌數必須一致
        const shownTables = (success.match(/桌數：(\d+) 桌/) || [])[1];
        const planTables = (success.match(/\n方案：每桌 \d+ 元、(\d+) 桌/) || [])[1];
        if (planTables) ok(shownTables === planTables, `${label}: 桌數 ${shownTables} 與方案 ${planTables} 桌不一致`);
        eq(shownTables, String(want.tables), `整合 ${label}：成功訊息桌數 = I 欄`);
        if (rw.plan) {
            ok(confirm.includes(`🍽️ 方案：${rw.plan}\n`), `${label}: 核對訊息應顯示「${rw.plan}」：${confirm}`);
            eq((success.match(/\n方案：([^\n]*)/) || [])[1], rw.plan, `整合 ${label}：成功訊息方案友善文字`);
        } else {
            replies.forEach((t, k) => ok(!/方案/.test(t), `${label}: 沒方案卻多了方案行（第 ${k + 1} 則）：${t}`));
        }
        if (rw.summaryPlan) {
            const summary = replies.find((t) => /目前已記下/.test(t)) || '';
            ok(summary.includes(`🍽️ 方案：${rw.plan}`), `${label}: 還差資料訊息應顯示方案友善文字：${summary}`);
        }
        replies.forEach((t, k) => ok(!SHORT_CODE.test(t) && !/散客|大型\d*a/.test(t), `${label}: 第 ${k + 1} 則含店內短碼`));
        if (rw.confirmNote) ok(confirm.includes(`📝 備註：${rw.confirmNote}\n`), `${label}: 核對備註應為「${rw.confirmNote}」：${confirm}`);
        if (rw.summaryNote) { const sm = replies.find((t) => /目前已記下/.test(t)) || ''; ok(sm.includes(`📝 備註：${rw.summaryNote}`) && !SHORT_CODE.test(sm), `${label}: 還差資料摘要備註應為「${rw.summaryNote}」：${sm}`); }
        if (rw.tablesShown) ok(new RegExp(`桌數：${rw.tablesShown} 桌`).test(success), `${label}: 成功訊息桌數應為 ${rw.tablesShown}：${success}`);
        ok(rows.length === 1, `${label}: 應寫入 1 列，實際 ${rows.length}（replies: ${replies.join(' / ')}）`);
        if (rows.length !== 1) continue;
        const r = rows[0];
        eq({ people: r[3], note: r[7], tables: r[8] }, want, `整合 ${label}`);
        ok(r.length === 12, `${label}: 只寫 A:L（12 欄），M 預估金額不寫；實際 ${r.length} 欄`);
    }

    console.log('# 整合測試：中文大數解析不了 → 與 parsePeople 相同');
    {
        const { c } = run([]);
        for (const m of ['大人一百位小孩2位', '一百位', '大人一千位 小孩2位', '一百大2小 靠窗']) {
            ok(c.parseBookingMessage(m).people === c.parsePeople(m), `${m}: parseBookingMessage.people 應等於 parsePeople（${c.parseBookingMessage(m).people} vs ${c.parsePeople(m)}）`);
        }
        eq(c.parseBookingMessage('大人八位小孩兩位').people, 10, '大人八位小孩兩位 → 10');
    }

    console.log('# 整合測試：網頁表單確認信（MailApp 以 mock 攔截，不寄信）');
    const web = (note) => ({ action: 'booking', type: 'dining', name: '測試同學', phone: '0900000000', date: `${y}-10-03`, time: '18:30',
        people: '12', tables: ((note.match(/k(\d+)a/) || [])[1] || (note.match(/大型(\d+)a/) || [])[1] || '1'), note, email: 'test@example.com', orderItems: '', orderId: '' });
    const W = [
        ['4.5k1a＋分類＋自填', '4.5k1a 大人10位、小朋友2位；慶生', '每桌 4500 元、1 桌', '大人10位、小朋友2位；慶生'],
        ['5k2a 只有代碼', '5k2a', '每桌 5000 元、2 桌', '無'],
        ['5.5k3a＋素食', '5.5k3a 大人30位 素食1位', '每桌 5500 元、3 桌', '大人30位 素食1位'],
        ['散客（沒方案）', '散客 大人6位；不吃辣', null, '大人6位；不吃辣'],
        ['大型4a（沒方案）', '大型4a 大人30位 素食', null, '大人30位 素食'],
        ['客人自填備註（沒代碼）', '靠窗', null, '靠窗'],
        ['空備註', '', null, '無'],
    ];
    for (const [label, note, wantPlan, wantNote] of W) {
        const { rows, mails } = run(web(note));
        ok(rows.length === 1 && rows[0][7] === note, `確認信 ${label}: H 欄必須原樣保存完整備註；實際 ${JSON.stringify(rows[0] && rows[0][7])}`);
        ok(rows.length === 1 && rows[0].length === 12, `確認信 ${label}: 只寫 A:L，M 不寫`);
        ok(mails.length === 1, `確認信 ${label}: 應寄 1 封（mock），實際 ${mails.length}`);
        if (mails.length !== 1) continue;
        const html = mails[0].htmlBody;
        const text = html.replace(/<[^>]+>/g, ' ');
        ok(!CODE_LIKE.test(text) && !/散客|大型\d*a/.test(text), `確認信 ${label}: 不可含代碼：${text}`);
        eq((html.match(/<strong>方案：<\/strong>([^<]*)<\/li>/) || [])[1] || null, wantPlan, `確認信 ${label}：方案友善文字`);
        eq((html.match(/<strong>備註事項：<\/strong>([^<]*)<\/li>/) || [])[1], wantNote, `確認信 ${label}：備註事項`);
    }
    {
        const { mails } = run({ ...web(''), type: 'takeout', note: '5k 不要辣', orderItems: '烤雞 x1\n', people: '', tables: '' });
        const html = (mails[0] || {}).htmlBody || '';
        ok(!/<strong>方案：/.test(html), '外帶確認信不多方案行');
    }
} else {
    console.log('# 整合測試略過（未設定 SMC_GAS_MAIN；正式 程式碼.js 含機密不進公開 repo）');
}

if (failures.length) { console.error(`\nFAIL (${failures.length})\n- ` + failures.join('\n- ')); process.exit(1); }
console.log(`\nPASS ${passed} checks`);
