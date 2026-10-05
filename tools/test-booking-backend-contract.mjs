#!/usr/bin/env node
// Client contract only. Does not call script.google.com and does not touch a sheet.
// The live Apps Script behavior is 待驗證. See docs/booking-attribution.md.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const attr = require(join(root, 'js/booking-attribution.js'));
const doc = readFileSync(join(root, 'docs/booking-attribution.md'), 'utf8');
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

const ORIGINAL_KEYS = ['action', 'type', 'name', 'phone', 'email', 'people', 'tables', 'date', 'time', 'note', 'orderItems'];
const t0 = 1700000000000;

function baseOrder(type) {
    return {
        action: 'book',
        type,
        name: '測試同學',
        phone: '0900000000',
        email: '',
        people: '2',
        tables: '1',
        date: '2026-10-22',
        time: '12:00',
        note: type === 'takeout' ? '客製包裝' : '散客 大人2位；靠窗',
        orderItems: type === 'takeout' ? '桶仔雞 x 1\n' : '',
    };
}

function withAttribution(order, fields) {
    const next = { ...order };
    for (const key of attr.ATTRIBUTION_KEYS) next[key] = fields[key];
    return next;
}

const store = attr.memoryStorage();
attr.capture('?utm_source==HYPERLINK("http://example.test")&utm_medium=cpc&utm_campaign=launch_202610&utm_adgroup=brand&gclid=TESTGCLID9000', store, t0);
const fields = attr.bookingFields(store, t0);
const plain = baseOrder('dining');
const tagged = withAttribution(plain, fields);

assert(attr.ATTRIBUTION_KEYS.length === 9, '契約鎖定 9 個新增欄位');
for (const key of ORIGINAL_KEYS) {
    assert(tagged[key] === plain[key], `新欄位不可改到原欄位 ${key}`);
}
for (const key of attr.ATTRIBUTION_KEYS) {
    assert(typeof tagged[key] === 'string', `${key} 必須是字串`);
    assert(!Object.prototype.hasOwnProperty.call(plain, key), `原訂單物件不含 ${key}`);
}
assert(tagged.source.startsWith("'") && !tagged.utmSource.startsWith('='), '公式開頭的 utm 在送出前要變成純文字');
assert(!tagged.note.includes('utm') && !tagged.note.includes('TESTGCLID9000'), '備註不是來源欄');
assert(!('confirmed' in tagged) && !('revenue' in tagged), '人工狀態不在送出契約裡');

for (const phrase of ['待驗證', '寫表', '寄信', '公式', '測試同學', 'SMC900001', '不部署']) {
    assert(doc.includes(phrase), `隔離檢查清單缺少「${phrase}」`);
}
assert(!doc.includes('忽略不認得'), '文件不可宣稱既有腳本會忽略新欄位');
assert(doc.includes('網址列') && doc.includes('gclid'), '文件要說明網址列仍看得到參數');
assert(doc.includes('cleanToken') && doc.includes('不是'), '文件要說明 cleanToken 不是公式防護');

if (failures.length) {
    console.error('contract checks failed:');
    failures.forEach((line) => console.error(' -', line));
    process.exit(1);
}
console.log('contract: 9 attribution fields stay additive; live Apps Script remains 待驗證 (no network)');
