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

console.log('# parseLineHeadcount_');
const hc = (m) => { const h = L.parseLineHeadcount_(m); return h ? [h.adults, h.kids, h.infants, h.total] : null; };
eq(hc('大人8位小孩2位幼兒1位'), [8, 2, 1, 11], '分類在前');
eq(hc('8個大人2個小孩'), [8, 2, 0, 10], '數字在前');
eq(hc('大人10位 小朋友2位'), [10, 2, 0, 12], '大人＋小朋友');
eq(hc('4大2小'), [4, 2, 0, 6], '4大2小');
eq(hc('成人3位、嬰兒1位'), [3, 0, 1, 4], '成人＋嬰兒');
eq(hc('10位 需要寶寶椅'), null, '寶寶椅不是人數');
eq(hc('10位'), null, '沒分類 → null');
eq(hc('2026/10/03 18:30 大人4位 0900000000'), [4, 0, 0, 4], '去除日期時間手機');

console.log('# composeLineRemark_');
const C = (o) => L.composeLineRemark_(o);
const H = (a, k, i) => ({ adults: a, kids: k, infants: i, total: a + k + i });
const cases = [
    ['5000 × 1 桌、無分類、無備註', { plan: { price: 5000 }, tables: 1, people: 10 }, '5k1a'],
    ['4500 × 2 桌（a = 桌數，不是人數）', { plan: { price: 4500 }, tables: 2, people: 20 }, '4.5k2a'],
    ['4500 × 2 桌、2 人 → 仍是 4.5k2a', { plan: { price: 4500 }, tables: 2, people: 2 }, '4.5k2a'],
    ['方案＋分類＋原備註', { plan: { price: 5000 }, tables: 1, people: 12, head: H(10, 2, 0), note: '靠窗、需要兒童椅' }, '5k1a 大人10位、小朋友2位；靠窗、需要兒童椅'],
    ['0 不寫（幼兒 0）', { plan: { price: 5500 }, tables: 3, people: 32, head: H(30, 2, 0) }, '5.5k3a 大人30位、小朋友2位'],
    ['0 不寫（小朋友 0）', { plan: { price: 5000 }, tables: 1, people: 9, head: H(8, 0, 1) }, '5k1a 大人8位、幼兒1位'],
    ['大人 0 不寫', { head: H(0, 0, 2), people: 2 }, '幼兒2位'],
    ['備註已有代碼 → 不重複，移到最前', { plan: { price: 5000 }, tables: 1, people: 10, note: '5k1a 靠窗' }, '5k1a；靠窗'],
    ['備註已有代碼（大寫空白）→ 正規化', { plan: { price: 5000 }, tables: 1, people: 10, note: '靠窗、5K 1A' }, '5k1a；靠窗'],
    ['備註已有代碼＋分類', { plan: { price: 4500 }, tables: 2, people: 20, head: H(18, 2, 0), note: '4.5k2a' }, '4.5k2a 大人18位、小朋友2位'],
    ['備註已有人數字 → 不重複', { plan: { price: 5000 }, tables: 1, people: 10, head: H(10, 0, 0), note: '大人10位 慶生' }, '5k1a；大人10位 慶生'],
    ['分類合計≠人數 → 不寫分類', { plan: { price: 5000 }, tables: 2, people: 12, head: H(8, 2, 0) }, '5k2a'],
    ['沒方案、沒分類 → 原備註不變', { tables: 1, people: 4, note: '靠窗' }, '靠窗'],
    ['全空 → 空字串', { tables: 1, people: 4 }, ''],
];
for (const [label, o, want] of cases) eq(C(o), want, label);

console.log('# lineCustomerNote_（客人看到的備註不含方案代碼）');
const CN = (n) => L.lineCustomerNote_(n);
const CODE_LIKE = /(?:^|[^0-9A-Za-z.])\d{1,2}(?:\.\d+)?\s*[Kk](?![A-Za-z])|\d\s*[Kk]\s*[Xx]?\d*\s*[Aa]/;
const cnCases = [
    ['5k2a', ''], ['4.5k2a', ''], ['5k1a', ''], ['5K 1A', ''], ['5k', ''], ['4.5K', ''],
    ['5k1a 慶生', '慶生'], ['靠窗、4.5k2a', '靠窗'], ['4.5k2a、靠窗、慶生', '靠窗、慶生'],
    ['5K1A5k2a 靠窗', '靠窗'], ['備註：5k1a', '備註'],
    ['需要兒童椅', '需要兒童椅'], ['靠窗、慶生／生日', '靠窗、慶生／生日'],
    ['要5kg雞', '要5kg雞'], ['iPhone5k 充電', 'iPhone5k 充電'], ['', ''],
];
for (const [inp, want] of cnCases) eq(CN(inp), want, `客人備註 ${JSON.stringify(inp)}`);
for (const [label, o] of cases) {
    const shown = CN(o.note || '');
    ok(!CODE_LIKE.test(shown), `客人備註仍含代碼：${label} → ${shown}`);
}

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
ok(/^\+.*successMsg.*customerNote/m.test(patch) && /^-.*successMsg.*params\.note \|\| "無"/m.test(patch), 'patch 必須讓預約成功訊息改用 customerNote');
ok(/^\+.*customerNote:\s*lineCustomerNote_\(/m.test(patch), 'finalizeBooking 必須帶 customerNote = lineCustomerNote_(原備註)');
ok(/^\+.*confirmMsg|^\+.*📝 備註：" \+ lineCustomerNote_\(state\.note\)/m.test(patch), '核對訊息必須用 lineCustomerNote_');
ok(/^\+.*parts\.push\("📝 備註：" \+ lineCustomerNote_\(s\.note\)\)/m.test(patch), '還差資料訊息必須用 lineCustomerNote_');
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
            CalendarApp: { getDefaultCalendar: () => ({ createEvent() {} }) }, MailApp: { sendEmail() {} }, GmailApp: { sendEmail() {} },
            PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
        };
        const c = vm.createContext(g);
        vm.runInContext(modSrc + '\n' + mainSrc, c);
        let i = 0;
        for (const text of messages) c.handleLineWebhook({ type: 'message', replyToken: 'r' + i, source: { userId: 'Utest' }, message: { type: 'text', id: 'm' + (i++), text } });
        return { rows: rows.slice(1), replies };
    }
    const y = new Date().getUTCFullYear() + 1;
    const base = `${y}/10/03 18:30 姓名測試同學 0900000000`;
    const I = [
        ['桌菜5000、大人10位小朋友2位、靠窗', [`${base} 大人10位小朋友2位 5000的桌菜 靠窗`, '確認'], { people: '12', note: '5k2a 大人10位、小朋友2位；靠窗', tables: 2 }],
        ['4.5k2a 簡寫、20位', [`${base} 20位 4.5k2a`, '確認'], { people: '20', note: '4.5k2a', tables: 2 }],
        ['桌菜4500 兩桌、2位', [`${base} 2位 桌菜4500 兩桌`, '確認'], { people: '2', note: '4.5k2a', tables: 2 }],
        ['分兩則訊息', [`${base} 10位`, '5000的桌菜 大人8位小孩2位', '確認'], { people: '10', note: '5k1a 大人8位、小朋友2位', tables: 1 }],
        ['備註已有代碼', [`${base} 10位 備註 5k1a 慶生`, '確認'], { people: '10', note: '5k1a；慶生', tables: 1 }],
        ['沒講方案 → 備註不變（回歸）', [`${base} 4位 靠窗`, '確認'], { people: '4', note: '靠窗', tables: 1 }],
        ['12位＋一桌就好 → 1 桌、5k1a', [`${base} 12位 5000的桌菜 一桌就好`, '確認'], { people: '12', note: '5k1a', tables: 1 }, { tablesShown: 1 }],
        ['12位沒講桌數 → ceil(12/10)=2 桌', [`${base} 12位 5000的桌菜`, '確認'], { people: '12', note: '5k2a', tables: 2 }, { tablesShown: 2 }],
        ['客人打 5k2a 簡寫＋靠窗', [`${base} 20位 5k2a 靠窗`, '確認'], { people: '20', note: '5k2a；靠窗', tables: 2 }, { shown: '靠窗' }],
        ['客人自己打 備註 5k1a', [`${base} 10位 備註 5k1a`, '確認'], { people: '10', note: '5k1a', tables: 1 }, { shown: '無' }],
        ['客人打 備註 4.5k2a 慶生（先缺手機）', [`${y}/10/03 18:30 姓名測試同學 20位 備註 4.5k2a 慶生`, '0900000000', '確認'], { people: '20', note: '4.5k2a；慶生', tables: 2 }, { shown: '慶生', minReplies: 3 }],
    ];
    for (const [label, msgs, want, rw = {}] of I) {
        const { rows, replies } = run(msgs);
        // 客人看到的所有 LINE 回覆（還差資料／核對／預約成功）都不可含方案代碼
        ok(replies.length >= (rw.minReplies || 2), `${label}: 應有 ${rw.minReplies || 2}+ 則客人回覆，實際 ${replies.length}`);
        replies.forEach((t, k) => ok(!CODE_LIKE.test(t), `${label}: 第 ${k + 1} 則客人回覆含方案代碼：${t}`));
        const success = replies.find((t) => /預約成功/.test(t)) || '';
        ok(!!success, `${label}: 找不到預約成功回覆（replies: ${replies.join(' / ')}）`);
        const shownNote = (success.match(/\n備註：([^\n]*)/) || [])[1];
        const wantShown = rw.shown != null ? rw.shown : (want.note.includes('；') ? want.note.split('；').slice(1).join('；') : (/k\d*a/.test(want.note) ? '無' : (want.note || '無')));
        eq(shownNote, wantShown, `整合 ${label}：客人看到的備註`);
        if (rw.tablesShown) ok(new RegExp(`桌數：${rw.tablesShown} 桌`).test(success), `${label}: 成功訊息桌數應為 ${rw.tablesShown}：${success}`);
        ok(rows.length === 1, `${label}: 應寫入 1 列，實際 ${rows.length}（replies: ${replies.join(' / ')}）`);
        if (rows.length !== 1) continue;
        const r = rows[0];
        eq({ people: r[3], note: r[7], tables: r[8] }, want, `整合 ${label}`);
        ok(r.length === 12, `${label}: 只寫 A:L（12 欄），M 預估金額不寫；實際 ${r.length} 欄`);
    }
} else {
    console.log('# 整合測試略過（未設定 SMC_GAS_MAIN；正式 程式碼.js 含機密不進公開 repo）');
}

if (failures.length) { console.error(`\nFAIL (${failures.length})\n- ` + failures.join('\n- ')); process.exit(1); }
console.log(`\nPASS ${passed} checks`);
