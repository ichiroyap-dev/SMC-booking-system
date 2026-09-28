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
    // 阿拉伯數字＋百／千、全形、万／佰 → null（沿用 parsePeople），不可把「1百」讀成 1
    ['大人1百位小孩2位', null], ['大人１百位 小孩2位', null], ['大人一万位小孩2位', null], ['大人一佰位小孩2位', null],
    ['大人1千位小孩2位', null], ['1百大2小', null], ['大人2位小孩1百位', null], ['大人一仟位小孩2位', null],
    // 中間有空白也不算
    ['大人1 百位小孩2位', null], ['大人１ 百位 小孩2位', null], ['大人1 千位小孩2位', null], ['大人一 百位小孩2位', null], ['1 百大2小', null], ['大人2位小孩1 百位', null],
    // 句中別處的大數（訂金／預算／紅包）不影響人數（Cursor nit on ed14f24）
    ['大人8位小孩2位，訂金兩百', 10], ['大人6位小孩6位，訂金兩百', 12], ['大人8位小孩2位 預算5千', 10], ['大人8位小孩2位 紅包一百', 10],
    ['8大2小 訂金兩百', 10], ['大人8位小孩2位 預算5 千', 10], ['大人一 百 位小孩2位', null],
]) eq(CP(m), want, `分類加總 ${m}`);
eq(L.lineNumToInt_('一百'), 0, '一百 → 0（無效）'); eq(L.lineNumToInt_('十二'), 12, '十二 → 12');
eq(L.parseLineTables_('一百桌'), null, '一百桌 不是 1 桌'); eq(L.parseLineTables_('十桌'), 10, '十桌');
for (const w of ['一万', '一佰', '一仟', '1百', '１百']) eq(L.lineNumToInt_(w), 0, `${w} → 0（無效）`);
eq(L.parseLineTables_('一万桌'), null, '一万桌 不是 1 桌'); eq(L.parseLineTables_('1 百桌'), null, '1 百桌 不是 1 桌'); eq(L.parseLineTables_('一佰桌'), null, '一佰桌 不是 1 桌');

console.log('# 桌數／價位補強（blocker 3＋nits）');
for (const [m, wantPlan, wantTables] of [
    ['一桌是5000', { price: 5000, tables: null }, 1], ['一桌要5000', { price: 5000, tables: null }, 1],
    ['一桌大約5000', { price: 5000, tables: null }, 1], ['一桌5000', { price: 5000, tables: null }, null],
    ['一桌要5000，共兩桌', { price: 5000, tables: null }, 2], ['5000兩桌', { price: 5000, tables: null }, 2],
    ['2桌菜5000', { price: 5000, tables: null }, 2], ['5k×2a', { price: 5000, tables: 2 }, null],
    ['５ｋ２ａ', { price: 5000, tables: 2 }, null], ['４．５ｋ１ａ', { price: 4500, tables: 1 }, null],
    ['iPhone 5k', null, null], ['iPhone5k', null, null], ['要5kg雞', null, null],
]) { eq(plan(m), wantPlan, `價位 ${m}`); eq(L.parseLineTables_(m), wantTables, `桌數 ${m}`); }

console.log('# 方案線索（0／1 個照舊；2 個以上不同 → 待確認，不猜）');
const PC = (m) => { const r = L.lineMergePlanClues_([], L.lineFindPlanClues_(m)); return { ambiguous: r.ambiguous, plan: r.plan ? { price: r.plan.price, tables: r.plan.tables } : null }; };
for (const m of [
    '5k1a 4.5k2a 靠窗', '5k1a 5k2a', '5.5k 5k1a 靠窗', '不要5k了改成桌菜5500', '改成桌菜5500，不要5k1a', '5k1a 改成5.5k',
    '5K1A 4.5K 2A', '５ｋ１ａ ５ｋ２ａ', '桌菜5000 不對是每桌5500', '5000的桌菜還是5500的桌菜', '4.5k2a、5k2a',
    '5k1a or 5.5k2a', '5k1a vs 5.5k2a', '5k1a OR 5.5K2A', '5k1a and 5.5k2a', '5k1a versus 5.5k2a',
]) { eq(PC(m).ambiguous, true, `待確認 ${m}`); eq(plan(m), null, `待確認不猜價 ${m}`); }
for (const [m, want] of [
    ['5k 5k1a', { price: 5000, tables: 1 }], ['5k1a 桌菜5000', { price: 5000, tables: 1 }], ['桌菜5000 5k1a 靠窗', { price: 5000, tables: 1 }],
    ['5k1a 5k1a', { price: 5000, tables: 1 }], ['桌菜4500 兩桌', { price: 4500, tables: null }], ['12位 5000的桌菜 一桌就好', { price: 5000, tables: null }],
    ['iPhone 5k', null], ['要5kg雞', null], ['for 5k', null], ['Pro 5k', null], ['靠窗', null], ['2026/10/03 18:30 0900000000', null],
    ['5k1a or 5k1a', { price: 5000, tables: 1 }],
]) { eq(PC(m).ambiguous, false, `單一線索 ${m}`); eq(PC(m).plan, want, `單一線索價位 ${m}`); }
eq(L.lineFindCodes_('5k1a 4.5k2a').length, 2, '空白隔開的第二個代碼也要找到');
eq(L.lineFindCodes_('5K 1A 5k2a').length, 2, '大寫空白代碼後面接第二個代碼');
eq(L.lineFindCodes_('5k1a or 5.5k2a').length, 2, 'or 後面的完整方案碼也要找到');
eq(L.lineFindCodes_('5k1a vs 5.5k2a').length, 2, 'vs 後面的完整方案碼也要找到');
eq(L.lineFindCodes_('iPhone 5k').length, 0, 'iPhone 5k 前綴仍排除');
eq(L.lineFindCodes_('iPhone5k').length, 0, 'iPhone5k 仍排除');
eq(L.lineFindCodes_('要5kg雞').length, 0, '5kg 仍排除');
{
    // 多輪：先 5k1a、再不同價 → 待確認；之後同價的線索也不會把它變回確定價
    const st = {};
    L.lineApplyPlanClues_(st, { planClues: L.lineFindPlanClues_('備註 5k1a 靠窗') });
    eq([st.planAmbiguous, st.plan && st.plan.price], [false, 5000], '多輪第 1 則：5k1a → 單一方案');
    L.lineApplyPlanClues_(st, { planClues: L.lineFindPlanClues_('不要5k了改成桌菜5500') });
    eq([st.planAmbiguous, st.plan], [true, null], '多輪第 2 則：不同價 → 待確認、不寫確定價');
    L.lineApplyPlanClues_(st, { planClues: L.lineFindPlanClues_('桌菜5500') });
    eq([st.planAmbiguous, st.plan], [true, null], '多輪第 3 則：仍待確認');
    const st2 = {};
    L.lineApplyPlanClues_(st2, { planClues: L.lineFindPlanClues_('5k') });
    L.lineApplyPlanClues_(st2, { planClues: L.lineFindPlanClues_('5k1a') });
    eq([st2.planAmbiguous, st2.plan], [false, { price: 5000, tables: 1 }], '多輪同價（5k → 5k1a）→ 仍是單一方案');
    eq(L.lineResolvePlan_({ plan: { price: 5500 }, note: '5k1a 靠窗' }).ambiguous, true, '舊 state.plan＋備註不同代碼 → 待確認');
    eq(L.lineResolvePlan_({ plan: { price: 5000 }, note: '5k1a 靠窗' }).ambiguous, false, 'state.plan 與備註同價 → 單一');
}

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
    ['備註 5k1a＋不同方案 5500（沒標 ambiguous 也不猜）', { plan: { price: 5500 }, tables: 1, note: '5k1a 靠窗' }, '方案待確認；靠窗（客人提過：每桌5500元、每桌5000元1桌）'],
    ['待確認：兩個不同代碼', { ambiguous: true, clues: [{ price: 5000, tables: 1 }, { price: 4500, tables: 2 }], tables: 1, note: '5k1a 4.5k2a 靠窗' }, '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌4500元2桌）'],
    ['待確認：沒有備註', { ambiguous: true, clues: [{ price: 5000, tables: null }, { price: 5500, tables: null }], tables: 1, note: '' }, '方案待確認；（客人提過：每桌5000元、每桌5500元）'],
    ['待確認：備註只寫一個代碼（另一個在對話中）', { ambiguous: true, clues: [{ price: 5000, tables: 1 }, { price: 5500, tables: null }], tables: 3, note: '靠窗' }, '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）'],
    ['同價位代碼＋桌菜 → 單一', { plan: { price: 5000, tables: 1 }, tables: 1, note: '桌菜5000 5k1a 靠窗' }, '5k1a；桌菜5000 靠窗'],
    ['沒有方案資訊、只有備註代碼 → 沿用備註代碼', { tables: 1, note: '5k1a 靠窗' }, '5k1a；靠窗'],
    ['備註 iPhone 5k 不是代碼', { plan: { price: 5000 }, tables: 1, people: 10, note: 'iPhone 5k 充電' }, '5k1a；iPhone 5k 充電'],
    ['全空 → 空字串', { tables: 1, people: 4 }, ''],
];
for (const [label, o, want] of cases) eq(C(o), want, label);

console.log('# lineCustomerNote_（客人看到的備註不含方案代碼）');
const CN = (n) => L.lineCustomerNote_(n);
// 店內短碼（半形後比對）：散客／大型＋數字＋a，允許空白、大寫；「散客很多」「大型聚會」不算
const SHORT_CODE_RE = /(?:散客|大型)\s*[1-9][0-9]*\s*[aA]/;
const SHORT_CODE = { test: (t) => SHORT_CODE_RE.test(L.lineHalfWidth_(t)) };
// 任何像方案代碼的東西（半形後比對）：數字＋k、數字＋a、x2a
const CODE_LIKE_RE = /\d\s*[Kk](?![Gg])|\d\s*[Aa](?![A-Za-z])|[Xx×]\s*\d+\s*[Aa]/;
const CODE_LIKE = { test: (t) => CODE_LIKE_RE.test(L.lineHalfWidth_(t)) };
ok(!SHORT_CODE.test('散客很多想靠窗') && !SHORT_CODE.test('大型聚會') && SHORT_CODE.test('大型 4a') && SHORT_CODE.test('大型４ａ') && SHORT_CODE.test('散客3A'), 'SHORT_CODE 測試式本身');
const cnCases = [
    ['5k2a', ''], ['4.5k2a', ''], ['5k1a', ''], ['5K 1A', ''], ['5k', ''], ['4.5K', ''],
    ['5k1a 慶生', '慶生'], ['靠窗、4.5k2a', '靠窗'], ['4.5k2a、靠窗、慶生', '靠窗、慶生'],
    ['5K1A5k2a 靠窗', '靠窗'], ['備註：5k1a', '備註'], ['５ｋ２ａ 靠窗', '靠窗'], ['5k×2a 慶生', '慶生'],
    ['需要兒童椅', '需要兒童椅'], ['靠窗、慶生／生日', '靠窗、慶生／生日'],
    ['大型4a 靠窗', '靠窗'], ['散客3a、慶生', '慶生'], ['靠窗、大型2a、慶生', '靠窗、慶生'], ['散客', ''], ['大型4a', ''],
    ['散客 大人6位；不吃辣', '大人6位；不吃辣'], ['散客很多想靠窗', '散客很多想靠窗'], ['大型聚會 靠窗', '大型聚會 靠窗'],
    // 拿不乾淨（像代碼但不是方案）→ 寧可整段不給客人看
    ['要5kg雞', ''], ['iPhone5k 充電', ''], ['iPhone 5k 充電', ''], ['', ''],
    // Cursor 反例：空白隔開的第二個代碼、全形、大寫 A、大型 4a 變形
    ['5k1a 4.5k2a 靠窗', '靠窗'], ['5k1a 5k2a', ''], ['5.5k 5k1a 靠窗', '靠窗'], ['5K 1A 5k2a 慶生', '慶生'], ['4.5K 2A、5K 1A、靠窗', '靠窗'],
    ['大型 4a 靠窗', '靠窗'], ['大型４a 靠窗', '靠窗'], ['大型４ａ 靠窗', '靠窗'], ['靠窗／大型4a', '靠窗'], ['靠窗/大型 4A', '靠窗'], ['大型4A', ''],
    ['散客 3A、慶生', '慶生'], ['散客３ａ 慶生', '慶生'], ['靠窗 x2a', ''], ['慶生 5k×2a', '慶生'], ['不要5k了改成桌菜5500', ''],
    ['大型聚會 5k1a 靠窗', '大型聚會 靠窗'],
    ['桌菜5000 5k1a 靠窗', ''], ['每桌5500 靠窗', ''], ['靠窗 慶生 5000的桌菜', ''],
];
for (const [inp, want] of cnCases) {
    eq(CN(inp), want, `客人備註 ${JSON.stringify(inp)}`);
    ok(!CODE_LIKE.test(CN(inp)) && !SHORT_CODE.test(CN(inp)), `客人備註仍含代碼：${inp} → ${CN(inp)}`);
}
for (const [label, o] of cases) {
    const shown = CN(o.note || '');
    ok(!CODE_LIKE.test(shown) && !SHORT_CODE.test(shown), `客人備註仍含代碼：${label} → ${shown}`);
}

console.log('# linePlanFriendly_／customerNoteText_／lineCustomerPlanText_（客人看的方案友善文字）');
const PF = (t) => L.linePlanFriendly_(t);
for (const [inp, want] of [
    ['4.5k1a', '每桌 4500 元、1 桌'], ['5k2a', '每桌 5000 元、2 桌'], ['5.5k3a', '每桌 5500 元、3 桌'],
    ['5K 2A', '每桌 5000 元、2 桌'], ['5k', '每桌 5000 元'], ['5k1a；靠窗', '每桌 5000 元、1 桌'],
    ['4.5k2a；慶生', '每桌 4500 元、2 桌'], ['5k×2a', '每桌 5000 元、2 桌'], ['５ｋ２ａ', '每桌 5000 元、2 桌'], ['iPhone 5k', ''], ['散客 大人6位', ''], ['大型4a 大人30位', ''], ['靠窗', ''], ['2k1a', ''], ['', ''],
    ['方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）', '方案將由店家確認'], ['5k1a 4.5k2a', '方案將由店家確認'], ['5k1a 5k2a；靠窗', '方案將由店家確認'],
]) eq(PF(inp), want, `友善方案 ${JSON.stringify(inp)}`);
eq(L.lineCustomerPlanLine_('每桌 5000 元、1 桌'), '方案：每桌 5000 元、1 桌', '方案行：確定價');
eq(L.lineCustomerPlanLine_('方案將由店家確認'), '方案將由店家確認', '方案行：待確認（不加「方案：」）');
eq(L.lineCustomerPlanLine_(''), '', '方案行：沒方案');
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
eq(SP({ plan: { price: 5500 }, tables: 1, people: '10', note: '5k1a 靠窗' }), '方案將由店家確認', '對話中：備註 5k1a＋不同價 → 待確認');
eq(SP({ planAmbiguous: true, planClues: [{ price: 5000, tables: 1 }, { price: 5500, tables: null }], people: '10', note: '靠窗' }), '方案將由店家確認', '對話中：planAmbiguous → 待確認');
eq(SP({ note: '5k1a 5k2a', people: '20' }), '方案將由店家確認', '對話中：備註兩個不同代碼 → 待確認');
eq(SP({ plan: { price: 5000, tables: 1 }, planClues: [{ price: 5000, tables: 1 }], note: '5k1a 靠窗', people: '10' }), '每桌 5000 元、1 桌', '對話中：同一方案 → 照舊');

console.log('# DailyBookingSync 相容性');
// 待確認 H：轉半形後不得匹配 KA_RE（parseRemarkAndCode_ 會抓第一個代碼入帳），也不得有任何「數字＋k」
function assertPendingH(h, label) {
    const hw = L.lineHalfWidth_(h);
    ok(h.indexOf('方案待確認；') === 0, `${label}: 待確認 H 應以「方案待確認；」開頭：${h}`);
    ok(!KA_RE.test(hw), `${label}: 待確認 H 不可被 KA_RE 抓到代碼：${h}`);
    ok(!/\d\s*k/i.test(hw), `${label}: 待確認 H 不可有「數字＋k」：${h}`);
}
{
    // Cursor 列的五種待確認 H＋多輪「備註5k1a靠窗→改成桌菜5500」
    const two = [{ price: 5000, tables: 1 }, { price: 5500, tables: null }];
    for (const [note, want] of [
        ['5k1a 靠窗', '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）'],
        ['5k1a 4.5k2a 靠窗', '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）'],
        ['5k1a 5k2a', '方案待確認；（客人提過：每桌5000元1桌、每桌5500元）'],
        ['5.5k 5k1a 靠窗', '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）'],
        ['５ｋ１ａ 4.5K 2A 慶生', '方案待確認；慶生（客人提過：每桌5000元1桌、每桌5500元）'],
        ['5K 1A、靠窗', '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）'],
        ['靠窗 5k×2a', '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）'],
        ['iPhone 5k 充電', '方案待確認；iPhone 充電（客人提過：每桌5000元1桌、每桌5500元）'],
        ['５ｋ 靠窗', '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）'],
    ]) {
        const h = C({ ambiguous: true, clues: two, tables: 1, note });
        eq(h, want, `待確認 H 去 k 形狀：${note}`);
        assertPendingH(h, `待確認 H ${note}`);
    }
    // 沒標 ambiguous、由 compose 自己判斷出待確認的情況也一樣
    for (const note of ['5k1a 4.5k2a 靠窗', '5k1a 5k2a', '5.5k 5k1a 靠窗', '５ｋ１ａ 4.5K 2A 慶生', '5k1a or 5.5k2a', '5k1a vs 5.5k2a']) assertPendingH(C({ tables: 1, note }), `自動待確認 ${note}`);
    // 連接詞後的完整方案碼要進待確認；去碼後孤立的 or／vs／and 要清掉，客人看不到「備註：or」
    const conjCases = [
        ['5k1a or 5.5k2a', ''],
        ['5k1a vs 5.5k2a', ''],
        ['5k1a OR 5.5k2a 靠窗', '靠窗'],
        ['5k1a and 5.5k2a', ''],
        ['5k1a versus 5.5k2a、靠窗', '靠窗'],
    ];
    for (const [msg, noteLeft] of conjCases) {
        const clues = L.lineFindPlanClues_(msg);
        eq(clues.map((c) => ({ price: c.price, tables: c.tables })), [{ price: 5000, tables: 1 }, { price: 5500, tables: 2 }], `連接詞線索 ${msg}`);
        const st = { note: msg };
        L.lineApplyPlanClues_(st, { planClues: clues });
        const rp = L.lineResolvePlan_(st);
        eq([rp.ambiguous, rp.plan], [true, null], `apply→resolve 待確認 ${msg}`);
        const h = C({ plan: rp.plan, tables: 1, note: msg, ambiguous: rp.ambiguous, clues: rp.clues });
        eq(h, `方案待確認；${noteLeft}（客人提過：每桌5000元1桌、每桌5500元2桌）`, `連接詞 H ${msg}`);
        assertPendingH(h, `連接詞 H ${msg}`);
        ok(!/方案待確認；\s*(?:or|vs|versus|and)\b/i.test(h), `H 無孤立連接詞 ${msg}`);
        eq(L.linePlanFriendly_(h), '方案將由店家確認', `H 的客人方案文字 ${msg}`);
        st.tables = 1;
        eq(L.lineCustomerPlanText_(st), '方案將由店家確認', `客人只看到待確認 ${msg}`);
        ok(!/\d/.test(L.lineCustomerPlanText_(st)) && !/\d\s*k/i.test(L.lineCustomerPlanText_(st)), `客人方案文字無價位無代碼 ${msg}`);
        eq(L.lineCustomerNote_(msg), noteLeft, `客人備註 ${msg}`);
        const remarkLine = L.lineCustomerNote_(msg) ? `備註：${L.lineCustomerNote_(msg)}` : '';
        ok(!/備註：\s*(?:or|vs|versus|and)\b/i.test(remarkLine), `客人訊息沒有備註：or ${msg} → ${remarkLine}`);
        ok(!KA_RE.test(L.lineHalfWidth_(L.lineCustomerNote_(msg))) && !/\d\s*k/i.test(L.lineHalfWidth_(remarkLine)), `客人備註無 k 代碼 ${msg}`);
    }
    // 一般備註裡的 and／or 不是貼著代碼的連接詞，要整句保留
    eq(L.lineCustomerNote_('wheelchair and stroller'), 'wheelchair and stroller', '保留 wheelchair and stroller');
    eq(L.lineStripCodes_('wheelchair and stroller'), 'wheelchair and stroller', '去碼不碰 wheelchair and stroller');
    eq(L.linePendingNote_('5k1a or 5.5k2a wheelchair and stroller'), 'wheelchair and stroller', '只拿掉貼著代碼的 or，保留 wheelchair and stroller');
    eq(L.lineCustomerNote_('5k1a or 5.5k2a wheelchair and stroller'), 'wheelchair and stroller', '客人備註保留 wheelchair and stroller');
    eq(C({ tables: 1, note: '5k1a or 5.5k2a wheelchair and stroller' }), '方案待確認；wheelchair and stroller（客人提過：每桌5000元1桌、每桌5500元2桌）', 'H 保留 wheelchair and stroller');
    eq(L.lineCustomerNote_('靠窗 or 慶生'), '靠窗 or 慶生', '沒有代碼時 or 留在備註裡');
    eq(L.lineCustomerNote_('5k1a 靠窗 or 慶生'), '靠窗 or 慶生', 'or 夾在真正備註中間要保留');
    // 多輪：備註 5k1a 靠窗 → 改成桌菜5500 → finalize 用 lineResolvePlan_
    const st = { note: '5k1a 靠窗' };
    L.lineApplyPlanClues_(st, { planClues: L.lineFindPlanClues_('備註 5k1a 靠窗') });
    L.lineApplyPlanClues_(st, { planClues: L.lineFindPlanClues_('改成桌菜5500') });
    const rp = L.lineResolvePlan_(st);
    const h = C({ plan: rp.plan, tables: 1, note: st.note, ambiguous: rp.ambiguous, clues: rp.clues });
    eq(h, '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）', '多輪 備註5k1a靠窗→改成桌菜5500 的 H');
    assertPendingH(h, '多輪 備註5k1a靠窗→改成桌菜5500');
}
for (const [label, o] of cases) {
    const r = C(o);
    if (r.indexOf('方案待確認') === 0) { assertPendingH(r, label); continue; } // 待確認：H 不可留任何 k 形狀
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
ok(/^\+.*lineApplyPlanClues_\(state, parsed\)/m.test(patch) && !/^\+.*if \(parsed\.plan\)/m.test(patch), 'handleLineWebhook 必須累積方案線索（不再以最新方案覆蓋）');
ok(/^\+.*planClues:\s*lineFindPlanClues_\(msg\)/m.test(patch), 'parseBookingMessage 必須回傳 planClues');
ok(/^\+.*lineResolvePlan_\(state\)/m.test(patch) && /^\+.*ambiguous:\s*planInfo\.ambiguous/m.test(patch), 'finalizeBooking 必須依整段對話判斷待確認');
ok(/^\+.*successMsg.*custPlanText.*custNoteText/m.test(patch) && /^-.*successMsg.*params\.note \|\| "無"/m.test(patch), 'patch 必須讓預約成功訊息改用友善方案＋去代碼備註');
ok(/^\+.*customerPlan:\s*linePlanFriendly_\(note\)/m.test(patch), 'finalizeBooking 必須帶 customerPlan = linePlanFriendly_(H 欄備註)');
ok(/^\+.*"🍽️ " \+ lineCustomerPlanLine_\(lineCustomerPlanText_\(state\)\)/m.test(patch) && /^\+.*"🍽️ " \+ lineCustomerPlanLine_\(lineCustomerPlanText_\(s\)\)/m.test(patch), '核對／還差資料訊息必須顯示友善方案文字（或方案將由店家確認）');
ok(/^\+.*successMsg.*lineCustomerPlanLine_\(custPlanText\)/m.test(patch), '預約成功訊息方案行必須用 lineCustomerPlanLine_');
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
        ['iPhone 5k 不是方案（拿不乾淨 → 客人不顯示備註）', [`${base} 4位 備註 iPhone 5k 充電`, '確認'], { people: '4', note: 'iPhone 5k 充電', tables: 1 }, { shown: '無', plan: null }],
        // [Owner 18:41] 2 個以上不同方案線索（含多輪）→ 不猜：H「方案待確認；原備註」、客人看到「方案將由店家確認」、不顯示價錢／代碼
        ['待確認：先備註 5k1a，再改桌菜5500', [`${base} 10位 備註 5k1a 靠窗`, '改成桌菜5500', '確認'], { people: '10', note: '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）', tables: 1 }, { shown: '靠窗', pending: true, tablesShown: 1 }],
        ['待確認：先備註 5k1a，再改桌菜5500 三桌', [`${base} 20位 備註 5k1a 靠窗`, '改成桌菜5500 三桌', '確認'], { people: '20', note: '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）', tables: 3 }, { shown: '靠窗', pending: true, tablesShown: 3 }],
        ['待確認：先 5k1a，改兩桌，再改 5.5k', [`${base} 20位 備註 5k1a 靠窗`, '兩桌', '改成5.5k', '確認'], { people: '20', note: '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）', tables: 2 }, { shown: '靠窗', pending: true, tablesShown: 2 }],
        ['待確認：先桌菜5500，再備註 5k1a', [`${base} 10位 桌菜5500`, '備註 5k1a 靠窗', '確認'], { people: '10', note: '方案待確認；靠窗（客人提過：每桌5500元、每桌5000元1桌）', tables: 1 }, { shown: '靠窗', pending: true, tablesShown: 1 }],
        ['待確認：同句 5k1a 4.5k2a 靠窗', [`${base} 10位 備註 5k1a 4.5k2a 靠窗`, '確認'], { people: '10', note: '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌4500元2桌）', tables: 1 }, { shown: '靠窗', pending: true }],
        ['待確認：同句 5k1a 5k2a', [`${base} 20位 備註 5k1a 5k2a`, '確認'], { people: '20', note: '方案待確認；（客人提過：每桌5000元1桌、每桌5000元2桌）', tables: 2 }, { shown: '無', pending: true }],
        ['待確認：同句 5.5k 5k1a 靠窗', [`${base} 10位 備註 5.5k 5k1a 靠窗`, '確認'], { people: '10', note: '方案待確認；靠窗（客人提過：每桌5500元、每桌5000元1桌）', tables: 1 }, { shown: '靠窗', pending: true }],
        ['待確認：先 5k，再「不要5k了改成桌菜5500」', [`${base} 10位 5k`, '不要5k了改成桌菜5500', '確認'], { people: '10', note: '方案待確認；（客人提過：每桌5000元、每桌5500元）', tables: 1 }, { shown: '無', pending: true }],
        ['待確認：同句「不要5k了改成桌菜5500」', [`${base} 10位 不要5k了改成桌菜5500`, '確認'], { people: '10', note: '方案待確認；（客人提過：每桌5000元、每桌5500元）', tables: 1 }, { shown: '無', pending: true }],
        ['待確認：備註 5k1a 後「改成桌菜5500，不要5k1a」', [`${base} 10位 備註 5k1a 靠窗`, '改成桌菜5500，不要5k1a', '確認'], { people: '10', note: '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）', tables: 1 }, { shown: '靠窗', pending: true }],
        ['待確認：同句「5k1a 改成5.5k」', [`${base} 10位 5k1a 改成5.5k`, '確認'], { people: '10', note: '方案待確認；（客人提過：每桌5000元1桌、每桌5500元）', tables: 1 }, { shown: '無', pending: true }],
        ['待確認：多輪 備註5k1a →「不要5k了改成桌菜5500」', [`${base} 10位 備註 5k1a 靠窗`, '不要5k了改成桌菜5500', '確認'], { people: '10', note: '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）', tables: 1 }, { shown: '靠窗', pending: true }],
        ['待確認：多輪（先缺手機 → 還差資料摘要也待確認）', [`${y}/10/03 18:30 姓名測試同學 10位 備註 5k1a 靠窗`, '不要5k了改成桌菜5500', '0900000000', '確認'], { people: '10', note: '方案待確認；靠窗（客人提過：每桌5000元1桌、每桌5500元）', tables: 1 }, { shown: '靠窗', pending: true, minReplies: 4, summaryPending: true }],
        ['待確認：同句全形／大寫 ５ｋ１ａ 4.5K 2A', [`${base} 10位 備註 ５ｋ１ａ 4.5K 2A 慶生`, '確認'], { people: '10', note: '方案待確認；慶生（客人提過：每桌5000元1桌、每桌4500元2桌）', tables: 1 }, { shown: '慶生', pending: true }],
        // 同一個方案說兩次（價位相同）→ 仍是單一方案
        ['單一：桌菜5000＋備註 5k1a', [`${base} 10位 桌菜5000 備註 5k1a 靠窗`, '確認'], { people: '10', note: '5k1a；靠窗', tables: 1 }, { shown: '靠窗', plan: '每桌 5000 元、1 桌' }],
        ['單一：先 5k，再 5k1a', [`${base} 10位 5k`, '5k1a', '確認'], { people: '10', note: '5k1a', tables: 1 }, { shown: '無', plan: '每桌 5000 元、1 桌' }],
        ['單一：備註 5K 1A 靠窗（大寫空白）', [`${base} 10位 備註 5K 1A 靠窗`, '確認'], { people: '10', note: '5k1a；靠窗', tables: 1 }, { shown: '靠窗', plan: '每桌 5000 元、1 桌' }],
        // 散客Na／大型Na 不給客人看（核對、還差資料摘要、成功訊息 customerNote）
        ['大型4a 靠窗 → 客人只看到靠窗', [`${base} 20位 備註 大型4a 靠窗`, '確認'], { people: '20', note: '大型4a 靠窗', tables: 2 }, { shown: '靠窗', plan: null, confirmNote: '靠窗' }],
        ['大型4a 靠窗（先缺手機 → 還差資料摘要）', [`${y}/10/03 18:30 姓名測試同學 20位 備註 大型4a 靠窗`, '0900000000', '確認'], { people: '20', note: '大型4a 靠窗', tables: 2 }, { shown: '靠窗', plan: null, minReplies: 3, summaryNote: '靠窗', confirmNote: '靠窗' }],
        ['散客3a、慶生 → 客人只看到慶生', [`${base} 6位 備註 散客3a、慶生`, '確認'], { people: '6', note: '散客3a、慶生', tables: 1 }, { shown: '慶生', plan: null, confirmNote: '慶生' }],
        ['5.5k3a 簡寫、30位', [`${base} 30位 5.5k3a`, '確認'], { people: '30', note: '5.5k3a', tables: 3 }, { shown: '無', plan: '每桌 5500 元、3 桌' }],
        // 大型 Na 變形（空白、全形、斜線）客人都看不到
        ['大型 4a 靠窗（空白）', [`${base} 20位 備註 大型 4a 靠窗`, '確認'], { people: '20', note: '大型 4a 靠窗', tables: 2 }, { shown: '靠窗', plan: null, confirmNote: '靠窗' }],
        ['大型４a 靠窗（全形）', [`${base} 20位 備註 大型４a 靠窗`, '確認'], { people: '20', note: '大型４a 靠窗', tables: 2 }, { shown: '靠窗', plan: null, confirmNote: '靠窗' }],
        ['靠窗／大型4a', [`${base} 20位 備註 靠窗／大型4a`, '確認'], { people: '20', note: '靠窗／大型4a', tables: 2 }, { shown: '靠窗', plan: null, confirmNote: '靠窗' }],
        ['大型4A（大寫）只有短碼', [`${base} 20位 備註 大型4A`, '確認'], { people: '20', note: '大型4A', tables: 2 }, { shown: '無', plan: null }],
        ['散客很多／大型聚會 是一般字', [`${base} 20位 備註 大型聚會 靠窗`, '確認'], { people: '20', note: '大型聚會 靠窗', tables: 2 }, { shown: '大型聚會 靠窗', plan: null, confirmNote: '大型聚會 靠窗' }],
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
        if (rw.pending) {
            // 待確認：核對／成功訊息方案行 = 「方案將由店家確認」，任何回覆都不顯示價錢
            ok(confirm.includes('🍽️ 方案將由店家確認\n'), `${label}: 核對訊息應顯示「方案將由店家確認」：${confirm}`);
            ok(success.includes('\n方案將由店家確認\n') && !/\n方案：/.test(success), `${label}: 成功訊息應顯示「方案將由店家確認」：${success}`);
            ok(!/每桌\s*\d+\s*元/.test(confirm) && !/每桌\s*\d+\s*元/.test(success), `${label}: 待確認不可顯示價錢`);
            ok(!/\d{4}\s*元/.test(replies[replies.length - 1]) && !/\d{4}\s*元/.test(confirm), `${label}: 最後核對／成功不可有價錢`);
            ok(want.note.indexOf('方案待確認；') === 0, `${label}: H 欄應以「方案待確認；」開頭`);
        } else if (rw.plan) {
            ok(confirm.includes(`🍽️ 方案：${rw.plan}\n`), `${label}: 核對訊息應顯示「${rw.plan}」：${confirm}`);
            eq((success.match(/\n方案：([^\n]*)/) || [])[1], rw.plan, `整合 ${label}：成功訊息方案友善文字`);
        } else {
            replies.forEach((t, k) => ok(!/方案/.test(t), `${label}: 沒方案卻多了方案行（第 ${k + 1} 則）：${t}`));
        }
        if (rw.summaryPending) {
            const sms = replies.filter((t) => /目前已記下/.test(t));
            const last = sms[sms.length - 1] || '';
            ok(last.includes('🍽️ 方案將由店家確認') && !/每桌\s*\d+/.test(last), `${label}: 還差資料摘要應顯示「方案將由店家確認」：${last}`);
        }
        if (rw.summaryPlan) {
            const summary = replies.find((t) => /目前已記下/.test(t)) || '';
            ok(summary.includes(`🍽️ 方案：${rw.plan}`), `${label}: 還差資料訊息應顯示方案友善文字：${summary}`);
        }
        replies.forEach((t, k) => ok(!SHORT_CODE.test(t) && !/(?:^|[^聚])散客(?!很多)|大型(?!聚)/.test(L.lineHalfWidth_(t).replace(/大型聚會/g, '')), `${label}: 第 ${k + 1} 則含店內短碼：${t}`));
        if (rw.confirmNote) ok(confirm.includes(`📝 備註：${rw.confirmNote}\n`), `${label}: 核對備註應為「${rw.confirmNote}」：${confirm}`);
        if (rw.summaryNote) { const sm = replies.find((t) => /目前已記下/.test(t)) || ''; ok(sm.includes(`📝 備註：${rw.summaryNote}`) && !SHORT_CODE.test(sm), `${label}: 還差資料摘要備註應為「${rw.summaryNote}」：${sm}`); }
        if (rw.tablesShown) ok(new RegExp(`桌數：${rw.tablesShown} 桌`).test(success), `${label}: 成功訊息桌數應為 ${rw.tablesShown}：${success}`);
        ok(rows.length === 1, `${label}: 應寫入 1 列，實際 ${rows.length}（replies: ${replies.join(' / ')}）`);
        if (rows.length !== 1) continue;
        const r = rows[0];
        eq({ people: r[3], note: r[7], tables: r[8] }, want, `整合 ${label}`);
        if (rw.pending) assertPendingH(r[7], `整合 ${label}`);
        ok(r.length === 12, `${label}: 只寫 A:L（12 欄），M 預估金額不寫；實際 ${r.length} 欄`);
    }

    console.log('# 整合測試：中文大數解析不了 → 與 parsePeople 相同');
    {
        const { c } = run([]);
        for (const m of ['大人一百位小孩2位', '一百位', '大人一千位 小孩2位', '一百大2小 靠窗', '大人1百位小孩2位', '大人１百位 小孩2位', '大人一万位小孩2位', '大人一佰位小孩2位', '大人1千位小孩2位', '1百大2小', '大人1 百位小孩2位', '大人１ 百位 小孩2位', '大人一 百位小孩2位', '1 百大2小', '大人2位小孩1 百位']) {
            ok(c.parseBookingMessage(m).people === c.parsePeople(m), `${m}: parseBookingMessage.people 應等於 parsePeople（${c.parseBookingMessage(m).people} vs ${c.parsePeople(m)}）`);
        }
        eq(c.parseBookingMessage('大人八位小孩兩位').people, 10, '大人八位小孩兩位 → 10');
        eq(c.parseBookingMessage('大人8位小孩2位，訂金兩百').people, 10, '大人8位小孩2位，訂金兩百 → 10');
        eq(c.parseBookingMessage('大人6位小孩6位，訂金兩百').people, 12, '大人6位小孩6位，訂金兩百 → 12');
        eq(c.parseBookingMessage('大人8位小孩2位 預算5千').people, 10, '預算5千 不影響 → 10');
        eq(c.parseBookingMessage('大人8位小孩2位 紅包一百').people, 10, '紅包一百 不影響 → 10');
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
        ['大型 4a（空白）', '大型 4a 大人30位', null, '大人30位'],
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
        // 網頁備註若有 2 個不同代碼（手動改過）→ 確認信方案行「方案將由店家確認」，不顯示價錢／代碼
        const { rows, mails } = run({ ...web('5k1a 4.5k2a 靠窗'), tables: '1' });
        const html = (mails[0] || {}).htmlBody || '';
        const text = html.replace(/<[^>]+>/g, ' ');
        ok(rows.length === 1 && rows[0][7] === '5k1a 4.5k2a 靠窗', '確認信 待確認：H 欄原樣');
        ok(/<li><strong>方案將由店家確認<\/strong><\/li>/.test(html) && !/每桌\s*\d+/.test(text) && !CODE_LIKE.test(text), `確認信 待確認：方案將由店家確認、無價錢／代碼：${text}`);
        eq((html.match(/<strong>備註事項：<\/strong>([^<]*)<\/li>/) || [])[1], '靠窗', '確認信 待確認：備註事項');
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
