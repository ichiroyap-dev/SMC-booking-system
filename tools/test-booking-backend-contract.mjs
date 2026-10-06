#!/usr/bin/env node
// Client payload shape only. Does not call script.google.com and does not touch a sheet.
// This file cannot prove the live Apps Script accepts new fields. See docs/booking-attribution.md.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const attr = require(join(root, 'js/booking-attribution.js'));
const doc = readFileSync(join(root, 'docs/booking-attribution.md'), 'utf8');
const source = readFileSync(join(root, 'js/booking-attribution.js'), 'utf8');
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

const store = attr.memoryStorage();
attr.capture('?utm_source==HYPERLINK("http://example.test")&utm_medium=cpc&utm_campaign=launch_202610&utm_adgroup=brand&gclid=TESTGCLID9000', store, t0, 'navigate');
const fields = attr.bookingFields(store, t0);

assert(attr.attributionSendingEnabled() === false, '來源欄位預設不送後端');
assert(source.includes('SEND_ATTRIBUTION_TO_BACKEND = false'), '程式裡的旗標必須維持 false');
assert(attr.ATTRIBUTION_KEYS.length === 9, '瀏覽器內仍計算 9 個來源欄位');
for (const key of attr.ATTRIBUTION_KEYS) {
    assert(typeof fields[key] === 'string', `${key} 必須是字串`);
}
assert(fields.source.startsWith("'") && !fields.utmSource.startsWith('='), '公式開頭的 utm 在瀏覽器內要變成純文字');

for (const type of ['dining', 'takeout']) {
    const plain = baseOrder(type);
    const tagged = attr.payloadForBooking(plain, fields);
    const untagged = attr.payloadForBooking(plain, attr.emptyBookingFields());
    assert(JSON.stringify(tagged) === JSON.stringify(plain), `${type} 有 UTM 時正式 payload 要與改動前逐字相同`);
    assert(JSON.stringify(untagged) === JSON.stringify(plain), `${type} 沒有 UTM 時正式 payload 要與改動前逐字相同`);
    assert(JSON.stringify(Object.keys(tagged)) === JSON.stringify(ORIGINAL_KEYS), `${type} 欄位集合與順序要與改動前相同`);
    assert(tagged.note === plain.note, `${type} 備註不可被來源改寫`);
    for (const key of attr.ATTRIBUTION_KEYS) {
        assert(!Object.prototype.hasOwnProperty.call(tagged, key), `預設 payload 不可含 ${key}`);
    }
}
assert(!('confirmed' in attr.payloadForBooking(baseOrder('dining'), fields)), '人工狀態不在送出契約裡');

for (const phrase of ['待驗證', '寫表', '寄信', '公式', '測試同學', 'SMC900001', '不部署', '不能證明後端', '預設關閉', 'SEND_ATTRIBUTION_TO_BACKEND']) {
    assert(doc.includes(phrase), `文件缺少「${phrase}」`);
}
assert(!doc.includes('忽略不認得'), '文件不可宣稱既有腳本會忽略新欄位');
assert(!doc.includes('證明後端相容') || doc.includes('不能證明後端'), '文件不可宣稱本機測試證明後端相容');
assert(doc.includes('網址列') && doc.includes('gclid'), '文件要說明網址列仍看得到參數');
assert(doc.includes('cleanToken') && doc.includes('不是'), '文件要說明 cleanToken 不是公式防護');

if (failures.length) {
    console.error('contract checks failed:');
    failures.forEach((line) => console.error(' -', line));
    process.exit(1);
}
console.log('contract: default payload matches pre-PR shape; flag off; local test does not prove backend compatibility');
