#!/usr/bin/env node
// Option 甲 web-form note tests (offline; no network, no live submit).
// Usage: node tools/test-webform-note.mjs [path/to/index.html] [path/to/baseline.html]
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = process.argv[2] || join(root, 'index.html');
const basePath = process.argv[3] || join(root, 'baseline', 'index.html.orig');
const html = readFileSync(htmlPath, 'utf8');
const failures = [];
const ok = (c, m) => { if (!c) failures.push(m); };

function extractFn(src, name) {
    const start = src.indexOf(`function ${name}(`);
    if (start === -1) return null;
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    return null;
}
const need = ['planCode', 'peopleWords', 'vegetarianNoteLine', 'composeDiningNote', 'buildDiningNote'];
for (const n of need) ok(extractFn(html, n), `missing function ${n}`);
if (failures.length) { console.error('FAIL\n- ' + failures.join('\n- ')); process.exit(1); }

const { planCode, peopleWords, vegetarianNoteLine, composeDiningNote } = new Function(
    ['planCode', 'peopleWords', 'vegetarianNoteLine', 'composeDiningNote'].map((n) => extractFn(html, n)).join('\n') +
    '\nreturn { planCode, peopleWords, vegetarianNoteLine, composeDiningNote };')();

// Owner 2026-09-28: shop shorthand "Na" = number of TABLES (4.5k2a = NT$4,500/table × 2 tables), never people.
// People are written in full words (大人N位、小朋友N位、幼兒N位), zero omitted; no 幼N/國N abbreviations.
const C = (type, plan, tables, o) => composeDiningNote(planCode(type, plan, tables), o || {});
const cases = [
    ['散客6人，無選項（無 a）', C('casual', '', 1, { adults: 6 }), '散客 大人6位'],
    ['散客6人＋自填', C('casual', '', 1, { adults: 6, extra: '不吃辣' }), '散客 大人6位；不吃辣'],
    ['自填含「成人6」「桌數2」整句保留', C('casual', '', 1, { adults: 6, extra: '我們成人6個不吃辣，靠窗桌數2' }), '散客 大人6位；我們成人6個不吃辣，靠窗桌數2'],
    ['散客 2 桌仍不寫 a（桌數另有欄位）', C('casual', '', 2, { adults: 12 }), '散客 大人12位'],
    ['桌菜5000 1桌 10人＋素食1＋加購1＋常見需求＋自填',
        C('banquet', '5000', 1, { adults: 10, vegTag: vegetarianNoteLine(true, 1), extraChicken: 1, needs: ['不吃辣', '需要兒童椅'], extra: '慶生' }),
        '5k1a 大人10位 素食1位 加購烤雞1隻 不吃辣 需要兒童椅；慶生'],
    ['Owner 例：5k1a 10人 小朋友2＋素食1＋慶生',
        C('banquet', '5000', 1, { adults: 10, kidsElem: 2, vegTag: vegetarianNoteLine(true, 1), extra: '慶生' }),
        '5k1a 大人10位、小朋友2位 素食1位；慶生'],
    ['a = 桌數：4500 × 2 桌、2 人 → 4.5k2a（不是 2 人）', C('banquet', '4500', 2, { adults: 2 }), '4.5k2a 大人2位'],
    ['a = 桌數：4500 × 2 桌、20 人 → 4.5k2a（不是 4.5k20a）', C('banquet', '4500', 2, { adults: 20 }), '4.5k2a 大人20位'],
    ['a = 桌數：5500 × 3 桌、30 人＋小朋友2＋幼兒1', C('banquet', '5500', 3, { adults: 30, kidsElem: 2, kidsKinder: 1 }), '5.5k3a 大人30位、小朋友2位、幼兒1位'],
    ['大型聚餐 4 桌 30 人＋素食未填人數', C('large', '', 4, { adults: 30, vegTag: vegetarianNoteLine(true, 0) }), '大型4a 大人30位 素食'],
    ['未勾素食／加購0不寫', composeDiningNote('散客', { adults: 4, vegTag: vegetarianNoteLine(false, 3), extraChicken: 0, needs: [] }), '散客 大人4位'],
    ['自填前後空白修剪', composeDiningNote('散客', { adults: 2, extra: '  靠窗  ' }), '散客 大人2位；靠窗'],
    ['真實列191：散客 大人9＋小朋友1＋幼兒1', C('casual', '', 1, { adults: 9, kidsKinder: 1, kidsElem: 1 }), '散客 大人9位、小朋友1位、幼兒1位'],
    ['大人0＋幼兒2（大人0不寫）', C('casual', '', 1, { adults: 0, kidsKinder: 2, kidsElem: 0 }), '散客 幼兒2位'],
    ['兒童為0不寫', composeDiningNote('散客', { adults: 4, kidsKinder: 0, kidsElem: '0' }), '散客 大人4位'],
];
ok(planCode('banquet', '4500', 2) === '4.5k2a' && planCode('banquet', '4500', 3) === '4.5k3a', 'planCode: a must follow the table count');
ok(planCode('casual', '', 3) === '散客' && !/\da/.test(planCode('casual', '', 3)), 'planCode: 散客 must not emit "a"');
ok(peopleWords(10, 2, 1) === '大人10位、小朋友2位、幼兒1位' && peopleWords(0, 0, 0) === '', 'peopleWords full words / zero omitted');
for (const [, got] of cases) {
    ok(!/(^|[\s、])(幼|國)\d/.test(got), `abbreviated child label left: ${got}`);
    ok(!/散客\d+a/.test(got), `散客 must not carry "a": ${got}`);
}
ok(/planCode\(partyType, plan, estimatedTableCount\(\)\)/.test(extractFn(html, 'buildDiningNote')), 'buildDiningNote must pass the table-count field to planCode');
ok(/adults: counts\.adults,\s*kidsKinder: counts\.kidsKinder,\s*kidsElem: counts\.kidsElem/.test(extractFn(html, 'buildDiningNote')), 'buildDiningNote must pass adult + child counts');
for (const [label, got, want] of cases) {
    ok(got === want, `${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    console.log(`  ${label}: ${got}`);
}

const build = extractFn(html, 'buildDiningNote') + extractFn(html, 'composeDiningNote') + extractFn(html, 'peopleWords') + extractFn(html, 'vegetarianNoteLine');
for (const bad of ['用餐類型', '人頭NT', '成人${', '合計', '桌數${', '原則含烤雞', '方案代碼', '桌菜價位', "join('\\n')"]) {
    ok(!build.includes(bad), `note builder still contains boilerplate: ${bad}`);
}

// Payload shape unchanged vs baseline (same keys, same note wiring).
const payload = (src) => { const m = src.match(/const data = \{[\s\S]*?\n\s*\};/); return m ? m[0] : null; };
if (existsSync(basePath)) {
    const base = readFileSync(basePath, 'utf8');
    ok(payload(html) && payload(html) === payload(base), 'submit payload block changed vs baseline');
} else {
    console.log('SKIP payload-vs-baseline check: baseline not found');
}
ok(/note: currentMode === 'dining' \? buildDiningNote\(\) : document\.getElementById\('note'\)\.value/.test(html), 'note wiring changed');

if (failures.length) { console.error('FAIL\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS webform Option 甲 note: a = tables, people in full words, ；customer text kept');
