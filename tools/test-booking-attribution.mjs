#!/usr/bin/env node
// Booking-source attribution. No network calls to the live booking script.
// Usage: node tools/test-booking-attribution.mjs
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const attr = require(join(root, 'js/booking-attribution.js'));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const faq = readFileSync(join(root, 'faq.html'), 'utf8');
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

function extractFn(src, name) {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) return '';
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
            depth -= 1;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    return '';
}

const t0 = 1700000000000;
const landing = '?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=rsa_family&utm_adgroup=brand&gclid=TESTGCLID9000';
const store = attr.memoryStorage();
attr.capture(landing, store, t0);
const branded = attr.bookingFields(store, t0);
assert(branded.source === 'google', `品牌進站 source：${branded.source}`);
assert(branded.utmCampaign === 'launch_202610', '活動代碼要原樣保留');
assert(branded.utmContent === 'rsa_family', 'utm_content 仍是素材，不拿來當群組');
assert(branded.utmAdgroup === 'brand' && branded.adgroupBucket === '品牌', 'brand 對到品牌');
assert(branded.gclid === 'TESTGCLID9000', '有 utm 時 gclid 一併保留');
attr.capture('', store, t0 + 60 * 1000);
assert(attr.bookingFields(store, t0 + 60 * 1000).utmAdgroup === 'brand', '沒參數的站內導覽不可清掉這次造訪的來源');
assert(attr.bookingFields(store, t0 + 20 * 60 * 1000).source === 'google', '30 分鐘內返回仍要保留來源');
attr.capture('?utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_adgroup=non-brand', store, t0 + 2 * 60 * 1000);
const nonbrand = attr.bookingFields(store, t0 + 2 * 60 * 1000);
assert(nonbrand.utmAdgroup === 'non-brand' && nonbrand.adgroupBucket === '非品牌', `非品牌原值與分類：${nonbrand.utmAdgroup}/${nonbrand.adgroupBucket}`);
assert(nonbrand.adgroupBucket !== branded.adgroupBucket, '品牌與非品牌必須分得開');
assert(nonbrand.gclid === '' && nonbrand.utmContent === '', '新的帶標記進站要整組替換，缺的 gclid 與 utm 要清空');
attr.capture('?gclid=TESTGCLID9001', store, t0 + 3 * 60 * 1000);
const replacedClick = attr.bookingFields(store, t0 + 3 * 60 * 1000);
assert(replacedClick.source === attr.GCLID_ONLY_SOURCE, '只有新 gclid 時不可沿用舊 utm');
assert(replacedClick.utmSource === '' && replacedClick.utmAdgroup === '' && replacedClick.gclid === 'TESTGCLID9001', '新 gclid 進站要清掉舊 utm');

const fresh = attr.memoryStorage();
attr.capture('?utm_source=google&utm_adgroup=brand&gclid=TESTGCLID9000', fresh, t0);
assert(attr.bookingFields(fresh, t0 + attr.VISIT_TTL_MS - 1000).source === 'google', '未滿 30 分鐘的返回仍要保留來源');
assert(attr.bookingFields(fresh, t0 + attr.VISIT_TTL_MS).source === 'direct/unknown', '閒置滿 30 分鐘要改記 direct/unknown');
assert(attr.bookingFields(fresh, t0 + attr.VISIT_TTL_MS).gclid === '', '過期後不可留下 gclid');
attr.capture('', fresh, t0 + attr.VISIT_TTL_MS + 1000);
assert(attr.bookingFields(fresh, t0 + attr.VISIT_TTL_MS + 1000).source === 'direct/unknown', '過期後的直接造訪不可恢復舊來源');

const bare = attr.memoryStorage();
assert(attr.bookingFields(bare).source === 'direct/unknown', '沒進站紀錄不可當成廣告');
assert(attr.bookingFields(bare).gclid === '' && attr.bookingFields(bare).adgroupBucket === '', '空造訪不可帶群組或 gclid');
const gclidOnly = attr.memoryStorage();
attr.capture('?gclid=TESTGCLID9000', gclidOnly, t0);
const onlyClick = attr.bookingFields(gclidOnly, t0);
assert(onlyClick.source === '有點擊識別碼、來源待核對', '只有 gclid 要另列待核對');
assert(onlyClick.source !== 'direct/unknown' && onlyClick.source !== 'google', '只有 gclid 不可混進 direct/unknown 或廣告');
assert(onlyClick.gclid === 'TESTGCLID9000' && onlyClick.utmSource === '', 'gclid 原值保留、utm 維持空白');

const partial = attr.memoryStorage();
attr.capture('?utm_campaign=launch_202610&utm_adgroup=brand', partial, t0);
assert(attr.bookingFields(partial, t0).source === 'utm_missing_source', '有 utm 但沒有 utm_source 時不可填 google');
assert(attr.normalizeAdgroup('品牌') === 'brand', '中文群組代碼可對回 brand');
assert(attr.normalizeAdgroup('br!and') === '', 'br!and 不可洗成 brand');
assert(attr.adgroupBucket('br!and') === '' && attr.classifyAdgroup('br!and').raw === 'br!and', '錯誤代碼原值保留、分類留白');
assert(attr.adgroupBucket('other_group') === '', '不認得的群組代碼不要猜成品牌或非品牌');
const other = attr.memoryStorage();
attr.capture('?utm_source=google&utm_adgroup=br!and', other, t0);
const badGroup = attr.bookingFields(other, t0);
assert(badGroup.utmAdgroup === 'br!and' && badGroup.adgroupBucket === '', `錯誤群組：${badGroup.utmAdgroup}/${badGroup.adgroupBucket}`);
const formula = attr.memoryStorage();
attr.capture('?utm_source=' + encodeURIComponent('=IMPORTDATA("http://example.test")') + '&utm_campaign=' + encodeURIComponent('+cmd') + '&utm_adgroup=' + encodeURIComponent('@brand'), formula, t0);
const safe = attr.bookingFields(formula, t0);
assert(safe.source.startsWith("'") && safe.utmSource.startsWith("'") && !safe.utmSource.startsWith('='), '公式開頭要加單引號');
assert(safe.utmCampaign.startsWith("'") && safe.utmAdgroup.startsWith("'") && safe.adgroupBucket === '', '@brand 不是白名單，分類留白');
assert(attr.plainSheetText('=1+1').startsWith("'") && attr.plainSheetText('brand') === 'brand', '公式防護不改一般文字');

function assertStringFields(fields, label) {
    const round = JSON.parse(JSON.stringify(fields));
    for (const key of attr.ATTRIBUTION_KEYS) {
        assert(typeof fields[key] === 'string', `${label} ${key} 必須是字串`);
        assert(Object.prototype.hasOwnProperty.call(round, key) && typeof round[key] === 'string', `${label} JSON 後 ${key} 必須仍是字串`);
    }
}
assertStringFields(branded, '一般進站');
for (const raw of ['__proto__', 'constructor', 'toString']) {
    const protoStore = attr.memoryStorage();
    attr.capture('?utm_source=google&utm_adgroup=' + encodeURIComponent(raw), protoStore, t0);
    const protoFields = attr.bookingFields(protoStore, t0);
    assert(protoFields.utmAdgroup === raw, `${raw} 原值要保留，實際 ${protoFields.utmAdgroup}`);
    assert(protoFields.adgroupBucket === '', `${raw} 不可分成品牌或非品牌，實際 ${protoFields.adgroupBucket}`);
    assert(attr.classifyAdgroup(raw).bucket === '', `${raw} 分類必須留白`);
    assertStringFields(protoFields, raw);
}

let writesAfterProbe = 0;
const nativeBag = {};
const flakyNative = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(nativeBag, key) ? nativeBag[key] : null; },
    setItem(key, value) {
        writesAfterProbe += 1;
        if (writesAfterProbe > 2) throw new Error('QuotaExceededError');
        nativeBag[key] = String(value);
    },
    removeItem(key) { delete nativeBag[key]; },
};
const flakyWin = {
    document: { addEventListener() {}, dispatchEvent() {} },
    location: { search: '' },
    addEventListener() {},
    sessionStorage: flakyNative,
};
const flakyStore = attr.resolveStorage(flakyWin);
attr.capture('?utm_source=google&utm_medium=cpc&utm_adgroup=brand&gclid=TESTGCLID9000', flakyStore, t0);
attr.capture('?utm_source=facebook&utm_medium=cpc&utm_adgroup=nonbrand', attr.resolveStorage(flakyWin), t0 + 1000);
const latestStore = attr.resolveStorage(flakyWin);
const afterWriteFail = attr.bookingFields(latestStore, t0 + 1000);
assert(latestStore !== flakyNative, '寫入失敗後不可再讀原生儲存');
assert(afterWriteFail.source === 'facebook' && afterWriteFail.utmAdgroup === 'nonbrand', `寫入失敗後應改記最新來源，實際 ${afterWriteFail.source}/${afterWriteFail.utmAdgroup}`);
assert(afterWriteFail.adgroupBucket === '非品牌' && afterWriteFail.gclid === '', '寫入失敗後不可留下舊的 gclid 或品牌分類');
assertStringFields(afterWriteFail, '寫入失敗後');
assert(attr.bookingFields(flakyNative, t0 + 1000).source === 'facebook', '就算還拿著舊的 storage 參考，也要讀到最新來源');

const life = attr.memoryStorage();
const lifeUrl = '?utm_source=google&utm_adgroup=brand&gclid=TESTGCLID9000';
const lifeWin = {
    document: { addEventListener() {}, dispatchEvent() {} },
    location: { search: lifeUrl },
    addEventListener() {},
    sessionStorage: life,
};
attr.capture(lifeUrl, attr.resolveStorage(lifeWin), t0);
const keptOnReturn = attr.handlePageShow(lifeWin, { persisted: true }, t0 + 5 * 60 * 1000);
assert(keptOnReturn.gclid === 'TESTGCLID9000', '未過期的快取返回要保留來源');
assert(attr.bookingFields(attr.resolveStorage(lifeWin), t0 + 5 * 60 * 1000).source === 'google', '未過期返回不可清成 direct/unknown');
const seenBeforeRefresh = JSON.parse(life.getItem(attr.STORAGE_KEY)).seenAt;
attr.capture(lifeUrl, life, t0 + 10 * 60 * 1000);
assert(JSON.parse(life.getItem(attr.STORAGE_KEY)).seenAt === seenBeforeRefresh, '同一條帶標記網址不可把閒置計時重新起算');
attr.handlePageShow(lifeWin, { persisted: true }, t0 + attr.VISIT_TTL_MS);
const expiredReturn = attr.bookingFields(attr.resolveStorage(lifeWin), t0 + attr.VISIT_TTL_MS);
assert(expiredReturn.source === 'direct/unknown' && expiredReturn.gclid === '' && expiredReturn.utmAdgroup === '', '快取返回不可用舊網址救回過期來源');
attr.capture(lifeUrl, life, t0 + attr.VISIT_TTL_MS + 1000);
assert(attr.bookingFields(life, t0 + attr.VISIT_TTL_MS + 1000).source === 'direct/unknown', '重新整理同一條過期網址不可重建來源');
attr.capture('?utm_source=facebook&utm_adgroup=nonbrand', life, t0 + attr.VISIT_TTL_MS + 2000);
const replacedAfterExpiry = attr.bookingFields(life, t0 + attr.VISIT_TTL_MS + 2000);
assert(replacedAfterExpiry.source === 'facebook' && replacedAfterExpiry.adgroupBucket === '非品牌' && replacedAfterExpiry.gclid === '', '另一條帶標記網址在過期後仍要整組換成新來源');
assertStringFields(replacedAfterExpiry, '過期後新進站');

const prePrKeys = ['action', 'type', 'name', 'phone', 'email', 'people', 'tables', 'date', 'time', 'note', 'orderItems'];
function prePrOrder(type) {
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
assert(attr.attributionSendingEnabled() === false, '來源欄位預設不送後端');
for (const type of ['dining', 'takeout']) {
    const plain = prePrOrder(type);
    const withTags = attr.payloadForBooking(plain, branded);
    const withoutTags = attr.payloadForBooking(plain, attr.emptyBookingFields());
    assert(JSON.stringify(withTags) === JSON.stringify(plain), `${type} 有來源時正式 payload 仍要與改動前逐字相同`);
    assert(JSON.stringify(withoutTags) === JSON.stringify(plain), `${type} 沒來源時正式 payload 仍要與改動前逐字相同`);
    assert(JSON.stringify(Object.keys(withTags)) === JSON.stringify(prePrKeys), `${type} 欄位集合與順序要與改動前相同`);
}

let storageThrew = false;
const broken = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('QuotaExceededError'); },
};
try {
    attr.capture('?utm_source=google&utm_adgroup=brand', broken, t0);
    const unread = attr.bookingFields(broken, t0);
    const unstored = attr.recordSubmission(broken, 'SMC900051');
    assert(unread.source === 'google' && unread.utmAdgroup === 'brand', '讀寫都丟錯時要改記在記憶體備援');
    assert(unstored && unstored.counted === true, '備援記憶體要能記下這次編號，且不可拋錯');
} catch (err) {
    storageThrew = true;
}
assert(!storageThrew, '儲存讀寫失敗不可拋出');

let getterGets = 0;
const blockedWin = {
    document: { addEventListener() {}, dispatchEvent() {} },
    location: { search: '?utm_source=google&utm_medium=cpc&utm_adgroup=brand&gclid=TESTGCLID9000' },
    addEventListener() {},
};
Object.defineProperty(blockedWin, 'sessionStorage', {
    configurable: true,
    get() {
        getterGets += 1;
        throw new DOMException('The operation is insecure.', 'SecurityError');
    },
});
let installThrew = false;
try { attr.install(blockedWin); } catch (err) { installThrew = true; }
assert(!installThrew, 'sessionStorage getter 被拒時 install 不可拋錯');
const memoryA = blockedWin.__smcAttrStorage;
const memoryB = attr.resolveStorage(blockedWin);
assert(memoryA && memoryA === memoryB, '失敗時要沿用同一個記憶體備援');
assert(getterGets === 1, `備援建立後不可再讀 sessionStorage，實際 ${getterGets}`);
const remembered = attr.bookingFields(memoryA, Date.now());
assert(remembered.source === 'google' && remembered.utmAdgroup === 'brand' && remembered.gclid === 'TESTGCLID9000', '備援記憶體仍要記住這次進站');

assert(attr.manualSource('phone', '') === '未知', '電話沒來源要記未知');
assert(attr.manualSource('line', '  ') === '未知', 'LINE 沒來源要記未知');
assert(attr.manualSource('web', '') === 'direct/unknown', '官網沒來源不是未知');
assert(attr.manualSource('phone', 'google') === 'google', '電話若已確認來源就照實記');

const counts = attr.bookingOutcomeCounts([
    { orderId: 'SMC900001', confirmed: '是', cancelled: '', arrived: '是', revenue: '4,500', noshow: '' },
    { orderId: 'SMC900001', confirmed: '是', cancelled: '', arrived: '是', revenue: 4500 },
    { orderId: 'SMC900002', confirmed: '是', cancelled: '是', arrived: '', revenue: 0 },
    { orderId: 'SMC900003', confirmed: '', cancelled: '', arrived: '', revenue: '' },
    { orderId: 'SMC900004', confirmed: '是', cancelled: '', noshow: '是', arrived: '', revenue: 0 },
    { orderId: '', confirmed: '是', arrived: '是', revenue: 9999 },
]);
assert(counts.submitted === 4, `預約送出應為 4（重複編號與空編號不算），實際 ${counts.submitted}`);
assert(counts.valid === 2, `有效預約應為 SMC900001 與 SMC900004，實際 ${counts.valid}`);
assert(counts.arrived === 1, `到店實收筆數應為 1，實際 ${counts.arrived}`);
assert(counts.arrivedAmount === 4500, `到店金額只加總到店那筆，實際 ${counts.arrivedAmount}`);
assert(!Object.prototype.hasOwnProperty.call(counts, 'total'), '三個筆數不可有加總欄');
assert(counts.submitted + counts.valid + counts.arrived !== counts.submitted, '分開的筆數不能被拿去當預約送出');
assert(!('confirmed' in attr.bookingFields(store)), '網站送出的來源欄不含人工狀態');
const labels = attr.MANUAL_STATUS_FIELDS.map((field) => field.label);
for (const label of ['人工確認', '取消', '未到', '到店', '實收金額', '更新時間']) {
    assert(labels.includes(label), `缺少人工欄 ${label}`);
}

const once = attr.memoryStorage();
assert(attr.recordSubmission(once, 'SMC900011').counted === true, '第一次訂單編號要計入');
assert(attr.recordSubmission(once, 'SMC900011').reason === 'duplicate', '同一編號不可再計一次');
assert(attr.recordSubmission(once, 'SMC900012').counted === true, '另一個編號仍要計');
assert(attr.recordSubmission(once, '').counted === false, '沒有編號不計');

const receiptFn = extractFn(html, 'showReceipt');
assert(receiptFn && !/utm|gclid|attribution|direct\/unknown|adgroup/i.test(receiptFn), '收件畫面不可帶來源');
assert(html.includes('src="js/booking-attribution.js"'), '首頁要載入來源腳本');
assert(faq.includes('src="js/booking-attribution.js"'), '常見問題頁也要記住進站參數');
assert(/note: currentMode === 'dining' \? buildDiningNote\(\) : document\.getElementById\('note'\)\.value/.test(html), '備註仍只含餐點內容');
assert(html.includes('payloadForBooking(data, attribution)'), '送出要經過來源旗標');
assert(!html.includes('source: attribution.source'), '預設的送出物件不可直接帶來源欄');
assert(readFileSync(join(root, 'js/booking-attribution.js'), 'utf8').includes('SEND_ATTRIBUTION_TO_BACKEND = false'), '旗標預設必須關閉');
assert(!html.slice(html.indexOf("action: 'cancel'"), html.indexOf("action: 'cancel'") + 500).includes('utm'), '取消申請不附來源欄');
assert(html.includes('recordBookingSubmission(orderId)'), '轉換以訂單編號記一次');
assert(!receiptFn.includes('recordBookingSubmission'), '不可在每次顯示收件時重計');
const submitAt = html.indexOf("form.addEventListener('submit'");
const successAt = html.indexOf("if (res && res.status === 'success')", submitAt);
const uncertainAt = html.indexOf("showUncertainResult(btn, '預約申請'", successAt);
const successBlock = html.slice(successAt, uncertainAt);
const showAt = successBlock.indexOf('showReceipt(data, orderId)');
const buttonAt = successBlock.indexOf("btn.innerText = '送出預約申請'");
const trackAt = successBlock.lastIndexOf('recordBookingSubmission(orderId)');
assert(showAt > 0 && buttonAt > showAt && trackAt > buttonAt, '收件與按鈕復原要先於追蹤');
assert(successBlock.includes('訂單編號：'), '收件失敗時成功提示要含訂單編號');
assert(!/showReceipt\(data, orderId\);\s*\}\s*catch\s*\(err\)\s*\{\s*\}/.test(successBlock), '不可空 catch 吞掉收件錯誤');
assert(successBlock.includes('receiptShown'), '收件失敗時不可照常清空表單');
assert(successBlock.includes('lockBookingForm()'), '收件失敗要鎖住表單');
assert(successBlock.includes('請勿重複送出'), '收件失敗提示要寫請勿重複送出');
assert(html.includes('id="anotherBookingBtn"') && html.includes('再預約一筆'), '要提供再預約一筆');
assert(html.includes('表單未能清空。請重新整理頁面後，再進行新的預約。'), '清空失敗要提示重新整理後再預約');
assert(!html.includes('請再確認欄位後送出'), '清空失敗不可請客人確認後送出');
const anotherAt = html.indexOf("getElementById('anotherBookingBtn').addEventListener");
const anotherBlock = html.slice(anotherAt, html.indexOf("form.addEventListener('submit'", anotherAt));
const anotherUnlock = anotherBlock.indexOf('unlockBookingForm()');
const anotherCatch = anotherBlock.indexOf('catch (err)');
assert(anotherUnlock > anotherBlock.indexOf('clearBookingForm()') && anotherCatch > anotherUnlock, '再預約一筆只有清空成功才解開表單');
assert(!anotherBlock.slice(anotherCatch).includes('unlockBookingForm()'), '清空失敗的分支不可解開表單');
assert(readFileSync(join(root, 'js/booking-attribution.js'), 'utf8').includes('打開 SEND_ATTRIBUTION_TO_BACKEND 之前必須先修'), '過期後同一廣告網址要留待開旗標前再修');
assert(extractFn(html, 'recordBookingSubmission').includes('catch'), '追蹤函式本身要接住例外');
assert(extractFn(html, 'attributionStore').includes('catch'), '取得 sessionStorage 要接住 SecurityError');
assert(html.includes('不會當成廣告'), '隱私權說明要講沒有參數時不當成廣告');
assert(!html.includes('>launch_202610<') && !html.includes('utm_adgroup=brand'), '頁面內文不要寫出活動代碼');
assert(attr.ATTRIBUTION_KEYS.length === 9, '送出的來源欄位維持 9 個');

if (failures.length) {
    console.error('unit checks failed:');
    failures.forEach((line) => console.error(' -', line));
    process.exit(1);
}
console.log('unit: attribution, manual counts, payload wiring OK');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.xml': 'application/xml',
    '.txt': 'text/plain; charset=utf-8',
    '.ico': 'image/x-icon',
};

function startStaticServer() {
    return new Promise((resolve) => {
        const server = createServer((req, res) => {
            const path = (req.url || '/').split('?')[0];
            const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
            const file = join(root, rel);
            if (!file.startsWith(root)) {
                res.writeHead(403);
                res.end();
                return;
            }
            try {
                const body = readFileSync(file);
                const ext = file.slice(file.lastIndexOf('.'));
                res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
                res.end(body);
            } catch {
                res.writeHead(404);
                res.end();
            }
        });
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
        });
    });
}

function cdp(wsUrl, method, params = {}) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const id = 1;
        ws.addEventListener('open', () => ws.send(JSON.stringify({ id, method, params })));
        ws.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id !== id) return;
            ws.close();
            if (msg.error) reject(new Error(JSON.stringify(msg.error)));
            else resolve(msg.result);
        });
        ws.addEventListener('error', () => reject(new Error(`CDP socket error for ${method}`)));
    });
}

async function withChrome(fn) {
    const chrome = spawn('/usr/bin/google-chrome', [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--remote-debugging-port=0',
        `--user-data-dir=/tmp/smc-attr-chrome-${process.pid}`,
        'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('chrome debug port timeout')), 15000);
        const onData = (buf) => {
            const match = buf.toString().match(/DevTools listening on [^\n]+:(\d+)/);
            if (!match) return;
            clearTimeout(timer);
            chrome.stderr.off('data', onData);
            resolve(match[1]);
        };
        chrome.stderr.on('data', onData);
        chrome.on('exit', (code) => reject(new Error(`chrome exited ${code}`)));
    });
    try {
        const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
        const page = targets.find((t) => t.type === 'page') || targets[0];
        await fn(page.webSocketDebuggerUrl);
    } finally {
        chrome.kill('SIGKILL');
    }
}

async function evalExpr(wsUrl, expression) {
    const result = await cdp(wsUrl, 'Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
}

function navigateAndWait(wsUrl, url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error('navigate timeout'));
        }, 10000);
        ws.addEventListener('open', () => {
            ws.send(JSON.stringify({ id: 1, method: 'Page.enable' }));
        });
        ws.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id === 1) {
                ws.send(JSON.stringify({ id: 2, method: 'Page.navigate', params: { url } }));
                return;
            }
            if (msg.id === 2 && msg.error) {
                clearTimeout(timer);
                ws.close();
                reject(new Error(JSON.stringify(msg.error)));
                return;
            }
            if (msg.method === 'Page.loadEventFired') {
                clearTimeout(timer);
                ws.close();
                resolve();
            }
        });
        ws.addEventListener('error', () => {
            clearTimeout(timer);
            reject(new Error('navigate failed'));
        });
    });
}

async function goto(wsUrl, url) {
    await cdp(wsUrl, 'Page.enable');
    await cdp(wsUrl, 'Page.navigate', { url });
    await evalExpr(wsUrl, `new Promise((resolve) => {
        if (document.readyState === 'complete') resolve('ready');
        else window.addEventListener('load', () => resolve('load'), { once: true });
    })`);
    await evalExpr(wsUrl, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve('frame'))))`);
}

const { server, url } = await startStaticServer();
try {
    await withChrome(async (wsUrl) => {
        await cdp(wsUrl, 'Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true,
        });
        const tagged = `${url}?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=rsa_family&utm_adgroup=brand&gclid=TESTGCLID9000#booking-section`;
        await goto(wsUrl, tagged);
        const mobile = await evalExpr(wsUrl, `(() => {
            const section = document.getElementById('booking-section');
            const title = document.getElementById('formTitle');
            const sectionBox = section.getBoundingClientRect();
            const titleBox = title.getBoundingClientRect();
            return {
                title: document.getElementById('formTitleText').textContent,
                diningHidden: document.getElementById('diningFields').classList.contains('hidden'),
                takeoutHidden: document.getElementById('takeoutFields').classList.contains('hidden'),
                diningSelected: document.getElementById('tabDining').getAttribute('aria-selected'),
                afterHero: document.getElementById('brand-hero').nextElementSibling.id,
                sectionTop: Math.round(sectionBox.top),
                titleTop: Math.round(titleBox.top),
                titleBottom: Math.round(titleBox.bottom),
                innerHeight: window.innerHeight,
                innerWidth: window.innerWidth,
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
                fields: bookingAttributionFields(),
                visible: document.body.innerText,
                hash: location.hash,
                search: location.search,
            };
        })()`);
        assert(mobile.innerWidth === 390, `手機寬度應為 390，實際 ${mobile.innerWidth}`);
        assert(mobile.title === '內用訂位', `mode=dining 應顯示內用訂位，實際 ${mobile.title}`);
        assert(mobile.diningHidden === false && mobile.takeoutHidden === true, '內用欄位要顯示、外帶欄位要收起');
        assert(mobile.diningSelected === 'true', '內用頁籤要選取');
        assert(mobile.hash === '#booking-section', `錨點應停在訂位表，實際 ${mobile.hash}`);
        assert(mobile.afterHero === 'booking-tabs', '訂位區應緊接在主視覺後面');
        assert(mobile.sectionTop >= 0 && mobile.sectionTop <= 24, `訂位區應貼齊錨點，top=${mobile.sectionTop}`);
        assert(mobile.titleTop >= 0 && mobile.titleTop < 180, `訂位標題應在手機上半部，top=${mobile.titleTop}`);
        assert(mobile.titleBottom <= mobile.innerHeight, `訂位標題應完整出現在畫面內，bottom=${mobile.titleBottom}`);
        assert(mobile.scrollWidth <= mobile.clientWidth + 1, `手機寬度溢出 ${mobile.scrollWidth} > ${mobile.clientWidth}`);
        assert(mobile.fields.source === 'google' && mobile.fields.utmAdgroup === 'brand' && mobile.fields.adgroupBucket === '品牌', '進站當下就要記到品牌來源');
        assert(mobile.fields.gclid === 'TESTGCLID9000', '頁面要留住 gclid');
        assert(!mobile.visible.includes('launch_202610') && !mobile.visible.includes('TESTGCLID9000') && !mobile.visible.includes('direct/unknown'), '客人看得到的文字不可出現活動代碼或 gclid');

        const kept = await evalExpr(wsUrl, `(() => {
            switchMode('takeout');
            const afterTakeout = {
                title: document.getElementById('formTitleText').textContent,
                takeoutHidden: document.getElementById('takeoutFields').classList.contains('hidden'),
                search: location.search,
                hash: location.hash,
            };
            switchMode('dining');
            return {
                afterTakeout,
                title: document.getElementById('formTitleText').textContent,
                search: location.search,
                hash: location.hash,
                fields: bookingAttributionFields(),
            };
        })()`);
        assert(kept.afterTakeout.title === '外帶預約' && kept.afterTakeout.takeoutHidden === false && kept.afterTakeout.hash === '#takeout', '切到外帶時模式要跟著變');
        assert(kept.afterTakeout.search.includes('utm_source=google') && kept.afterTakeout.search.includes('utm_adgroup=brand'), '切換外帶不可弄丟網址上的來源');
        assert(kept.title === '內用訂位' && kept.hash === '#booking-section', '切回內用要回到訂位錨點');
        assert(kept.fields.utmAdgroup === 'brand', '切換模式後來源仍在');

        await goto(wsUrl, `${url}faq.html`);
        const faqState = await evalExpr(wsUrl, `({
            hasApi: typeof SmcAttribution === 'object',
            fields: SmcAttribution.bookingFields(sessionStorage),
        })`);
        assert(faqState.hasApi === true, '常見問題頁要載入同一套來源腳本');
        assert(faqState.fields.utmAdgroup === 'brand' && faqState.fields.source === 'google', '先去常見問題不可清掉來源');

        await goto(wsUrl, `${url}?mode=dining#booking-section`);
        const afterRefresh = await evalExpr(wsUrl, `({
            title: document.getElementById('formTitleText').textContent,
            search: location.search,
            fields: bookingAttributionFields(),
            sectionTop: Math.round(document.getElementById('booking-section').getBoundingClientRect().top),
            titleTop: Math.round(document.getElementById('formTitle').getBoundingClientRect().top),
        })`);
        assert(!afterRefresh.search.includes('utm_') && afterRefresh.search.includes('mode=dining'), `回訂位頁不應再帶 utm，實際 ${afterRefresh.search}`);
        assert(afterRefresh.fields.source === 'google' && afterRefresh.fields.utmAdgroup === 'brand' && afterRefresh.fields.gclid === 'TESTGCLID9000', '重新整理／返回後送出前仍要留著來源');
        assert(afterRefresh.title === '內用訂位', '沒有 utm 時 mode=dining 仍開內用');
        assert(afterRefresh.sectionTop >= 0 && afterRefresh.sectionTop <= 24, `返回後訂位區應貼齊錨點，top=${afterRefresh.sectionTop}`);
        assert(afterRefresh.titleTop >= 0 && afterRefresh.titleTop < 180, `返回後訂位標題應在上半部，top=${afterRefresh.titleTop}`);

        const submitted = await evalExpr(wsUrl, `(async () => {
            window.__alerts = [];
            window.alert = (message) => { window.__alerts.push(String(message)); };
            window.__events = [];
            document.addEventListener('smc:booking-submitted', () => { window.__events.push('submit'); });
            document.addEventListener('smc:contact-click', (event) => { window.__events.push(event.detail.kind); });
            const tel = document.querySelector('a[href^="tel:"]');
            tel.addEventListener('click', (event) => event.preventDefault());
            tel.click();
            window.__posts = [];
            window.fetch = async (resource, opts) => {
                window.__posts.push(JSON.parse(opts.body));
                return { json: async () => ({ status: 'success', orderId: 'SMC900021', message: '訂位成功，已為您保留座位。' }) };
            };
            const day = new Date();
            day.setDate(day.getDate() + 2);
            while (day.getDay() === 3) day.setDate(day.getDate() + 1);
            const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
            const date = document.getElementById('date');
            date.value = iso;
            date.dispatchEvent(new Event('change', { bubbles: true }));
            document.querySelector('input[name="partyType"][value="casual"]').checked = true;
            document.getElementById('adults').value = '2';
            document.getElementById('name').value = '測試同學';
            document.getElementById('phone').value = '0900000000';
            document.getElementById('note').value = '靠窗';
            document.getElementById('privacyConsent').checked = true;
            const time = document.getElementById('time');
            time.value = '12:00';
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 50));
            showReceipt(window.__posts[0], 'SMC900021');
            recordBookingSubmission('SMC900021');
            const receipt = document.getElementById('receiptContent').textContent;
            return {
                alerts: window.__alerts,
                events: window.__events,
                post: window.__posts[0],
                receipt,
                message: document.getElementById('messageBox').textContent,
            };
        })()`);
        assert(submitted.alerts.length === 0, `假送出被擋住：${submitted.alerts.join(' / ')}`);
        assert(submitted.events.includes('tel') && !submitted.events.includes('line'), '市話點擊要記成互動');
        assert(submitted.events.filter((item) => item === 'submit').length === 1, '同一編號顯示收件兩次也只能計一次轉換');
        const post = submitted.post;
        const prePrKeys = ['action', 'type', 'name', 'phone', 'email', 'people', 'tables', 'date', 'time', 'note', 'orderItems'];
        assert(post && !('source' in post) && !('utmAdgroup' in post) && !('gclid' in post), '旗標關閉時正式請求不可帶來源');
        assert(JSON.stringify(Object.keys(post)) === JSON.stringify(prePrKeys), `正式請求欄位要與改動前相同：${Object.keys(post).join(',')}`);
        assert(post.name === '測試同學' && post.phone === '0900000000' && post.type === 'dining', '原有訂位欄位仍要送出');
        assert(post.note.includes('靠窗') && !post.note.includes('utm') && !post.note.includes('TESTGCLID9000'), `備註不可混入來源：${post.note}`);
        assert(!('confirmed' in post) && !('revenue' in post) && !('cancelled' in post), '人工狀態不可跟著表單送出');
        assert(!submitted.receipt.includes('google') && !submitted.receipt.includes('TESTGCLID9000') && !submitted.receipt.includes('launch_202610'), '收件文字不可出現來源');
        assert(!submitted.message.includes('TESTGCLID9000') && !submitted.message.includes('launch_202610'), '成功訊息不可出現來源');

        await evalExpr(wsUrl, `sessionStorage.clear()`);
        await goto(wsUrl, `${url}?mode=dining#booking-section`);
        const direct = await evalExpr(wsUrl, `(async () => {
            window.alert = () => {};
            window.__posts = [];
            window.fetch = async (resource, opts) => {
                window.__posts.push(JSON.parse(opts.body));
                return { json: async () => ({ status: 'success', orderId: 'SMC900022', message: '已保留座位' }) };
            };
            const day = new Date();
            day.setDate(day.getDate() + 2);
            while (day.getDay() === 3) day.setDate(day.getDate() + 1);
            const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
            const date = document.getElementById('date');
            date.value = iso;
            date.dispatchEvent(new Event('change', { bubbles: true }));
            document.querySelector('input[name="partyType"][value="casual"]').checked = true;
            document.getElementById('adults').value = '2';
            document.getElementById('tables').value = '1';
            document.getElementById('name').value = '測試同學';
            document.getElementById('phone').value = '0900000000';
            document.getElementById('privacyConsent').checked = true;
            document.getElementById('time').value = '12:00';
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 50));
            return {
                title: document.getElementById('formTitleText').textContent,
                diningHidden: document.getElementById('diningFields').classList.contains('hidden'),
                fields: bookingAttributionFields(),
                post: window.__posts[0] || null,
                receiptHidden: document.getElementById('bookingReceipt').classList.contains('hidden') === false,
            };
        })()`);
        assert(direct.title === '內用訂位' && direct.diningHidden === false, '沒有 utm 時仍可用 mode=dining');
        assert(direct.fields.source === 'direct/unknown' && direct.fields.gclid === '' && direct.fields.utmAdgroup === '', '沒有 utm 要記 direct/unknown');
        assert(direct.post && !('source' in direct.post) && !('gclid' in direct.post), '沒有 utm 的正式請求也不加來源欄');
        assert(direct.post.action === 'book' && direct.post.note && direct.post.people === '2' && direct.post.tables === '1', '沒有 utm 時原訂位內容要維持');
        assert(!direct.post.note.includes('direct/unknown'), 'direct/unknown 不可寫進備註');

        const matrix = await evalExpr(wsUrl, `(async () => {
            window.alert = () => {};
            const originalKeys = ['action', 'type', 'name', 'phone', 'email', 'people', 'tables', 'date', 'time', 'note', 'orderItems'];
            const day = new Date();
            day.setDate(day.getDate() + 2);
            while (day.getDay() === 3) day.setDate(day.getDate() + 1);
            const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
            const tagged = '?utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=rsa_family&utm_adgroup=brand&gclid=TESTGCLID9000';
            const store = SmcAttribution.resolveStorage(window);
            async function send(mode, withTags) {
                sessionStorage.removeItem(SmcAttribution.STORAGE_KEY);
                if (store !== sessionStorage) store.removeItem(SmcAttribution.STORAGE_KEY);
                SmcAttribution.capture(withTags ? tagged : '', store);
                switchMode(mode);
                const date = document.getElementById('date');
                date.value = iso;
                date.dispatchEvent(new Event('change', { bubbles: true }));
                if (mode === 'dining') {
                    document.querySelector('input[name="partyType"][value="casual"]').checked = true;
                    document.getElementById('adults').value = '2';
                    document.getElementById('tables').value = '1';
                    document.getElementById('note').value = '靠窗';
                } else {
                    document.querySelector('#takeoutFields [data-item="桶仔雞"]').value = '1';
                    document.getElementById('note').value = '客製包裝';
                }
                document.getElementById('name').value = '測試同學';
                document.getElementById('phone').value = '0900000000';
                document.getElementById('email').value = '';
                document.getElementById('privacyConsent').checked = true;
                document.getElementById('time').value = '12:00';
                let post = null;
                window.fetch = async (resource, opts) => {
                    post = JSON.parse(opts.body);
                    return { json: async () => ({ status: 'success', orderId: 'SMC900031', message: '已保留座位' }) };
                };
                document.getElementById('submitBtn').disabled = false;
                document.getElementById('submitBtn').innerText = '送出預約申請';
                document.getElementById('bookingForm').requestSubmit();
                await new Promise((resolve) => setTimeout(resolve, 40));
                const original = {};
                originalKeys.forEach((key) => { original[key] = post ? post[key] : null; });
                return {
                    original,
                    keys: post ? Object.keys(post) : [],
                    body: post ? JSON.stringify(post) : '',
                    fields: bookingAttributionFields(),
                    receipt: document.getElementById('receiptContent').textContent,
                    button: document.getElementById('submitBtn').innerText,
                    enabled: document.getElementById('submitBtn').disabled === false,
                };
            }
            return {
                diningPlain: await send('dining', false),
                diningTagged: await send('dining', true),
                takeoutPlain: await send('takeout', false),
                takeoutTagged: await send('takeout', true),
            };
        })()`);
        const sameOriginal = (a, b) => JSON.stringify(a.original) === JSON.stringify(b.original);
        assert(sameOriginal(matrix.diningPlain, matrix.diningTagged), `內用有無標記的原欄位與備註要相同：${JSON.stringify(matrix.diningPlain.original)} vs ${JSON.stringify(matrix.diningTagged.original)}`);
        assert(sameOriginal(matrix.takeoutPlain, matrix.takeoutTagged), `外帶有無標記的原欄位與備註要相同：${JSON.stringify(matrix.takeoutPlain.original)} vs ${JSON.stringify(matrix.takeoutTagged.original)}`);
        assert(matrix.diningPlain.original.type === 'dining' && matrix.diningPlain.original.note.includes('靠窗'), '內用備註仍是餐點內容');
        assert(matrix.takeoutPlain.original.type === 'takeout' && matrix.takeoutPlain.original.note === '客製包裝', '外帶備註仍是客人自填');
        assert(matrix.takeoutPlain.original.orderItems.includes('桶仔雞'), '外帶品項維持原欄位');
        assert(!matrix.diningPlain.original.note.includes('utm') && !matrix.takeoutTagged.original.note.includes('TESTGCLID9000'), '備註不可混入來源');
        assert(matrix.diningPlain.body === matrix.diningTagged.body, `內用有無 UTM 的正式 payload 要逐字相同：${matrix.diningPlain.body} vs ${matrix.diningTagged.body}`);
        assert(matrix.takeoutPlain.body === matrix.takeoutTagged.body, `外帶有無 UTM 的正式 payload 要逐字相同：${matrix.takeoutPlain.body} vs ${matrix.takeoutTagged.body}`);
        assert(JSON.stringify(matrix.diningTagged.keys) === JSON.stringify(['action', 'type', 'name', 'phone', 'email', 'people', 'tables', 'date', 'time', 'note', 'orderItems']), '內用正式請求不可多出來源欄');
        assert(matrix.diningPlain.fields.source === 'direct/unknown' && matrix.takeoutPlain.fields.source === 'direct/unknown', '沒標記時瀏覽器內仍記 direct/unknown');
        assert(matrix.diningTagged.fields.source === 'google' && matrix.takeoutTagged.fields.utmAdgroup === 'brand' && matrix.takeoutTagged.fields.gclid === 'TESTGCLID9000', '有標記時來源留在瀏覽器，不進正式請求');
        assert(matrix.diningTagged.enabled && matrix.diningTagged.button === '送出預約申請', '成功後按鈕要恢復');
        console.log('PAYLOAD dine-in no-utm ' + matrix.diningPlain.body);
        console.log('PAYLOAD dine-in utm ' + matrix.diningTagged.body);
        console.log('PAYLOAD takeout no-utm ' + matrix.takeoutPlain.body);
        console.log('PAYLOAD takeout utm ' + matrix.takeoutTagged.body);
        for (const row of [matrix.diningPlain, matrix.diningTagged, matrix.takeoutPlain, matrix.takeoutTagged]) {
            assert(!row.receipt.includes('launch_202610') && !row.receipt.includes('TESTGCLID9000'), '收件畫面不可出現來源');
        }

        await goto(wsUrl, `${url}?mode=dining#booking-section`);
        const guarded = await evalExpr(wsUrl, `(async () => {
            window.alert = () => {};
            const day = new Date();
            day.setDate(day.getDate() + 2);
            while (day.getDay() === 3) day.setDate(day.getDate() + 1);
            const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
            function fill() {
                const date = document.getElementById('date');
                date.value = iso;
                date.dispatchEvent(new Event('change', { bubbles: true }));
                document.querySelector('input[name="partyType"][value="casual"]').checked = true;
                document.getElementById('adults').value = '2';
                document.getElementById('name').value = '測試同學';
                document.getElementById('phone').value = '0900000000';
                document.getElementById('note').value = '靠窗';
                document.getElementById('privacyConsent').checked = true;
                document.getElementById('time').value = '12:00';
                document.getElementById('submitBtn').disabled = false;
                document.getElementById('submitBtn').innerText = '送出預約申請';
            }
            const button = () => ({
                text: document.getElementById('submitBtn').innerText,
                disabled: document.getElementById('submitBtn').disabled,
                message: document.getElementById('messageBox').textContent,
                receipt: document.getElementById('receiptContent').textContent,
                receiptHidden: document.getElementById('bookingReceipt').classList.contains('hidden'),
            });
            fill();
            let fetches = 0;
            window.fetch = () => {
                fetches += 1;
                return new Promise(() => {});
            };
            document.getElementById('bookingForm').requestSubmit();
            document.getElementById('bookingForm').requestSubmit();
            const inflight = { fetches, ...button() };

            fill();
            window.fetch = async () => ({ json: async () => ({ status: 'error', message: '暫時無法受理' }) });
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 40));
            const rejected = { fetches, ...button() };

            fill();
            window.fetch = async () => { throw new Error('offline'); };
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 40));
            const offline = button();

            fill();
            SmcAttribution.bookingFields = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
            SmcAttribution.recordSubmission = () => { throw new Error('QuotaExceededError'); };
            let post = null;
            window.fetch = async (resource, opts) => {
                post = JSON.parse(opts.body);
                return { json: async () => ({ status: 'success', orderId: 'SMC900041', message: '已保留座位' }) };
            };
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 40));
            const tracked = { postSource: post && post.source, note: post && post.note, ...button() };
            return { inflight, rejected, offline, tracked };
        })()`);
        assert(guarded.inflight.fetches === 1, `重複點擊只能送一次，實際 ${guarded.inflight.fetches}`);
        assert(guarded.inflight.disabled && guarded.inflight.text.includes('正在傳送'), `傳送中按鈕：${guarded.inflight.text}`);
        assert(guarded.rejected.disabled && guarded.rejected.text.includes('請先來電確認預約申請結果'), `後端拒絕按鈕：${guarded.rejected.text}`);
        assert(guarded.rejected.message.includes('目前無法確認預約申請結果') && guarded.rejected.message.includes('請勿重複送出'), '後端拒絕要顯示不確定提示');
        assert(guarded.offline.disabled && guarded.offline.text.includes('請先來電確認預約申請結果'), `網路失敗按鈕：${guarded.offline.text}`);
        assert(guarded.offline.message.includes('目前無法確認預約申請結果'), '網路失敗要顯示不確定提示');
        assert(guarded.tracked.postSource == null && guarded.tracked.note.includes('靠窗'), '來源函式拋錯時仍要送出，且正式請求不含來源欄');
        assert(guarded.tracked.receiptHidden === false && guarded.tracked.receipt.includes('SMC900041'), '追蹤拋錯後仍要顯示收件畫面');
        assert(guarded.tracked.disabled === false && guarded.tracked.text === '送出預約申請', '追蹤拋錯後按鈕仍要恢復');

        async function submitDining(orderId) {
            return evalExpr(wsUrl, `(async () => {
                window.alert = () => {};
                const day = new Date();
                day.setDate(day.getDate() + 2);
                while (day.getDay() === 3) day.setDate(day.getDate() + 1);
                const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
                const date = document.getElementById('date');
                date.value = iso;
                date.dispatchEvent(new Event('change', { bubbles: true }));
                document.querySelector('input[name="partyType"][value="casual"]').checked = true;
                document.getElementById('adults').value = '2';
                document.getElementById('name').value = '測試同學';
                document.getElementById('phone').value = '0900000000';
                document.getElementById('note').value = '靠窗';
                document.getElementById('privacyConsent').checked = true;
                document.getElementById('time').value = '12:00';
                document.getElementById('submitBtn').disabled = false;
                document.getElementById('submitBtn').innerText = '送出預約申請';
                window.fetch = async () => ({ json: async () => ({ status: 'success', orderId: '${orderId}', message: '已保留座位' }) });
                document.getElementById('bookingForm').requestSubmit();
                await new Promise((resolve) => setTimeout(resolve, 40));
                return {
                    name: document.getElementById('name').value,
                    message: document.getElementById('messageBox').textContent,
                    button: document.getElementById('submitBtn').innerText,
                    disabled: document.getElementById('submitBtn').disabled,
                    receipt: document.getElementById('receiptContent').textContent,
                    receiptHidden: document.getElementById('bookingReceipt').classList.contains('hidden'),
                    replaced: String(showReceipt).includes('receipt render failed'),
                    anotherHidden: document.getElementById('anotherBookingBtn').classList.contains('hidden'),
                    locked: document.getElementById('bookingForm').getAttribute('data-booking-locked') === '1',
                    nameDisabled: document.getElementById('name').disabled,
                };
            })()`);
        }

        await navigateAndWait(wsUrl, `${url}?mode=dining&probe=reset#booking-section`);
        await evalExpr(wsUrl, `document.getElementById('bookingForm').reset = function () { throw new Error('reset failed'); };`);
        const resetFailed = await submitDining('SMC900061');
        assert(resetFailed.message.includes('訂單編號：SMC900061'), `表單重設失敗時成功提示要留下編號：${resetFailed.message}`);
        assert(resetFailed.message.includes('請重新整理頁面'), '內用自動清空失敗要提示重新整理後再預約');
        assert(resetFailed.disabled === true && resetFailed.button === '申請已收到', '內用自動清空失敗後送出要維持停用');
        assert(resetFailed.locked === true && resetFailed.nameDisabled === true && resetFailed.name === '測試同學', '內用自動清空失敗後要鎖住並保留已填姓名');
        assert(resetFailed.receiptHidden === false && resetFailed.receipt.includes('SMC900061'), '重設失敗時收件畫面本身仍在');
        const resetRetry = await evalExpr(wsUrl, `(async () => {
            let fetches = 0;
            window.fetch = async () => {
                fetches += 1;
                return { json: async () => ({ status: 'success', orderId: 'SMC900071', message: '已保留座位' }) };
            };
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 40));
            return { fetches, name: document.getElementById('name').value, message: document.getElementById('messageBox').textContent };
        })()`);
        assert(resetRetry.fetches === 0, `內用自動清空失敗後再送出必須是 0 次，實際 ${resetRetry.fetches}`);
        assert(resetRetry.name === '測試同學' && resetRetry.message.includes('訂單編號：SMC900061'), '再送出失敗後仍要留下原編號與已填姓名');

        await navigateAndWait(wsUrl, `${url}?mode=dining&probe=receipt#booking-section`);
        const receiptFailed = await evalExpr(wsUrl, `(async () => {
            window.alert = () => {};
            showReceipt = function () { throw new Error('receipt render failed'); };
            let fetches = 0;
            window.fetch = async () => {
                fetches += 1;
                return { json: async () => ({ status: 'success', orderId: 'SMC900062', message: '已保留座位' }) };
            };
            const day = new Date();
            day.setDate(day.getDate() + 2);
            while (day.getDay() === 3) day.setDate(day.getDate() + 1);
            const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
            const date = document.getElementById('date');
            date.value = iso;
            date.dispatchEvent(new Event('change', { bubbles: true }));
            document.querySelector('input[name="partyType"][value="casual"]').checked = true;
            document.getElementById('adults').value = '2';
            document.getElementById('name').value = '測試同學';
            document.getElementById('phone').value = '0900000000';
            document.getElementById('note').value = '靠窗';
            document.getElementById('privacyConsent').checked = true;
            document.getElementById('time').value = '12:00';
            document.getElementById('submitBtn').disabled = false;
            document.getElementById('submitBtn').innerText = '送出預約申請';
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 40));
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 40));
            return {
                name: document.getElementById('name').value,
                message: document.getElementById('messageBox').textContent,
                button: document.getElementById('submitBtn').innerText,
                disabled: document.getElementById('submitBtn').disabled,
                receipt: document.getElementById('receiptContent').textContent,
                receiptHidden: document.getElementById('bookingReceipt').classList.contains('hidden'),
                replaced: String(showReceipt).includes('receipt render failed'),
                anotherHidden: document.getElementById('anotherBookingBtn').classList.contains('hidden'),
                locked: document.getElementById('bookingForm').getAttribute('data-booking-locked') === '1',
                nameDisabled: document.getElementById('name').disabled,
                fetches,
            };
        })()`);
        const resent = receiptFailed.fetches;
        assert(receiptFailed.message.includes('訂單編號：SMC900062'), `收件失敗時要顯示訂單編號：${receiptFailed.message}`);
        assert(receiptFailed.message.includes('請勿重複送出'), '收件失敗時要提示不要重送');
        assert(receiptFailed.message.includes('申請已收到'), '收件失敗時要顯示申請已收到');
        assert(receiptFailed.name === '測試同學', '收件失敗時不可清掉已填的姓名');
        assert(receiptFailed.disabled === true && receiptFailed.button === '申請已收到', '收件失敗後送出按鈕要維持停用');
        assert(receiptFailed.locked === true && receiptFailed.nameDisabled === true, '收件失敗後表單要鎖住');
        assert(receiptFailed.anotherHidden === false, '收件失敗後要出現再預約一筆');
        assert(receiptFailed.replaced === true, '測試要讓 showReceipt 丟錯');
        assert(receiptFailed.receiptHidden === true && !receiptFailed.receipt.includes('SMC900062'), '收件畫不出來時面板維持隱藏');
        assert(resent === 1, `鎖住後不可再送出，實際送出 ${resent} 次`);
        const anotherDining = await evalExpr(wsUrl, `(() => {
            document.getElementById('anotherBookingBtn').click();
            return {
                name: document.getElementById('name').value,
                button: document.getElementById('submitBtn').innerText,
                disabled: document.getElementById('submitBtn').disabled,
                anotherHidden: document.getElementById('anotherBookingBtn').classList.contains('hidden'),
                locked: document.getElementById('bookingForm').getAttribute('data-booking-locked') === '1',
            };
        })()`);
        assert(anotherDining.name === '' && anotherDining.locked === false, '再預約一筆要清空並解開內用表單');
        assert(anotherDining.disabled === false && anotherDining.button === '送出預約申請' && anotherDining.anotherHidden === true, '再預約一筆後才能再送出');

        await navigateAndWait(wsUrl, `${url}?mode=takeout&probe=receipt#takeout`);
        const takeoutFallback = await evalExpr(wsUrl, `(async () => {
            window.alert = () => {};
            showReceipt = function () { throw new Error('receipt render failed'); };
            switchMode('takeout');
            const day = new Date();
            day.setDate(day.getDate() + 2);
            while (day.getDay() === 3) day.setDate(day.getDate() + 1);
            const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
            const date = document.getElementById('date');
            date.value = iso;
            date.dispatchEvent(new Event('change', { bubbles: true }));
            document.querySelector('#takeoutFields [data-item="桶仔雞"]').value = '1';
            document.getElementById('name').value = '測試同學';
            document.getElementById('phone').value = '0900000000';
            document.getElementById('note').value = '客製包裝';
            document.getElementById('privacyConsent').checked = true;
            document.getElementById('time').value = '12:00';
            document.getElementById('submitBtn').disabled = false;
            document.getElementById('submitBtn').innerText = '送出預約申請';
            window.fetch = async () => ({ json: async () => ({ status: 'success', orderId: 'SMC900063', message: '已保留座位' }) });
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 40));
            const locked = {
                name: document.getElementById('name').value,
                chicken: document.querySelector('#takeoutFields [data-item="桶仔雞"]').value,
                message: document.getElementById('messageBox').textContent,
                button: document.getElementById('submitBtn').innerText,
                disabled: document.getElementById('submitBtn').disabled,
                anotherHidden: document.getElementById('anotherBookingBtn').classList.contains('hidden'),
            };
            document.getElementById('anotherBookingBtn').click();
            return {
                locked,
                name: document.getElementById('name').value,
                chicken: document.querySelector('#takeoutFields [data-item="桶仔雞"]').value,
                button: document.getElementById('submitBtn').innerText,
                disabled: document.getElementById('submitBtn').disabled,
                anotherHidden: document.getElementById('anotherBookingBtn').classList.contains('hidden'),
            };
        })()`);
        assert(takeoutFallback.locked.disabled === true && takeoutFallback.locked.button === '申請已收到', '外帶收件失敗後送出按鈕要維持停用');
        assert(takeoutFallback.locked.message.includes('訂單編號：SMC900063') && takeoutFallback.locked.message.includes('請勿重複送出'), '外帶收件失敗要顯示編號並請勿重送');
        assert(takeoutFallback.locked.name === '測試同學' && takeoutFallback.locked.chicken === '1' && takeoutFallback.locked.anotherHidden === false, '外帶收件失敗時先保留已填內容並提供再預約');
        assert(takeoutFallback.name === '' && takeoutFallback.chicken === '0', '再預約一筆要清空外帶表單');
        assert(takeoutFallback.disabled === false && takeoutFallback.button === '送出預約申請' && takeoutFallback.anotherHidden === true, '外帶再預約一筆後才能再送出');

        async function retryWhileResetThrows(mode, orderId) {
            await navigateAndWait(wsUrl, `${url}?mode=${mode}&probe=reset-again#booking-section`);
            return evalExpr(wsUrl, `(async () => {
                window.alert = () => {};
                showReceipt = function () { throw new Error('receipt render failed'); };
                if ('${mode}' === 'takeout') switchMode('takeout');
                const day = new Date();
                day.setDate(day.getDate() + 2);
                while (day.getDay() === 3) day.setDate(day.getDate() + 1);
                const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
                const date = document.getElementById('date');
                date.value = iso;
                date.dispatchEvent(new Event('change', { bubbles: true }));
                if ('${mode}' === 'dining') {
                    document.querySelector('input[name="partyType"][value="casual"]').checked = true;
                    document.getElementById('adults').value = '2';
                } else {
                    document.querySelector('#takeoutFields [data-item="桶仔雞"]').value = '1';
                }
                document.getElementById('name').value = '測試同學';
                document.getElementById('phone').value = '0900000000';
                document.getElementById('note').value = '${mode}' === 'dining' ? '靠窗' : '客製包裝';
                document.getElementById('privacyConsent').checked = true;
                document.getElementById('time').value = '12:00';
                document.getElementById('submitBtn').disabled = false;
                document.getElementById('submitBtn').innerText = '送出預約申請';
                let booked = 0;
                window.fetch = async () => {
                    booked += 1;
                    return { json: async () => ({ status: 'success', orderId: '${orderId}', message: '已保留座位' }) };
                };
                document.getElementById('bookingForm').requestSubmit();
                await new Promise((resolve) => setTimeout(resolve, 40));
                document.getElementById('bookingForm').reset = function () { throw new Error('reset failed'); };
                document.getElementById('anotherBookingBtn').click();
                let extra = 0;
                window.fetch = async () => {
                    extra += 1;
                    return { json: async () => ({ status: 'success', orderId: 'SMC900079', message: '已保留座位' }) };
                };
                document.getElementById('bookingForm').requestSubmit();
                await new Promise((resolve) => setTimeout(resolve, 40));
                return {
                    booked,
                    extra,
                    name: document.getElementById('name').value,
                    chicken: document.querySelector('#takeoutFields [data-item="桶仔雞"]').value,
                    message: document.getElementById('messageBox').textContent,
                    button: document.getElementById('submitBtn').innerText,
                    disabled: document.getElementById('submitBtn').disabled,
                    locked: document.getElementById('bookingForm').getAttribute('data-booking-locked') === '1',
                };
            })()`);
        }

        await navigateAndWait(wsUrl, `${url}?mode=takeout&probe=reset#takeout`);
        const takeoutResetFailed = await evalExpr(wsUrl, `(async () => {
            window.alert = () => {};
            switchMode('takeout');
            document.getElementById('bookingForm').reset = function () { throw new Error('reset failed'); };
            const day = new Date();
            day.setDate(day.getDate() + 2);
            while (day.getDay() === 3) day.setDate(day.getDate() + 1);
            const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
            const date = document.getElementById('date');
            date.value = iso;
            date.dispatchEvent(new Event('change', { bubbles: true }));
            document.querySelector('#takeoutFields [data-item="桶仔雞"]').value = '1';
            document.getElementById('name').value = '測試同學';
            document.getElementById('phone').value = '0900000000';
            document.getElementById('note').value = '客製包裝';
            document.getElementById('privacyConsent').checked = true;
            document.getElementById('time').value = '12:00';
            document.getElementById('submitBtn').disabled = false;
            document.getElementById('submitBtn').innerText = '送出預約申請';
            window.fetch = async () => ({ json: async () => ({ status: 'success', orderId: 'SMC900072', message: '已保留座位' }) });
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 40));
            const after = {
                name: document.getElementById('name').value,
                chicken: document.querySelector('#takeoutFields [data-item="桶仔雞"]').value,
                message: document.getElementById('messageBox').textContent,
                button: document.getElementById('submitBtn').innerText,
                disabled: document.getElementById('submitBtn').disabled,
                locked: document.getElementById('bookingForm').getAttribute('data-booking-locked') === '1',
                receipt: document.getElementById('receiptContent').textContent,
            };
            let extra = 0;
            window.fetch = async () => {
                extra += 1;
                return { json: async () => ({ status: 'success', orderId: 'SMC900078', message: '已保留座位' }) };
            };
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 40));
            return { after, extra };
        })()`);
        assert(takeoutResetFailed.after.message.includes('訂單編號：SMC900072'), `外帶自動清空失敗要留下編號：${takeoutResetFailed.after.message}`);
        assert(takeoutResetFailed.after.message.includes('請重新整理頁面'), '外帶自動清空失敗要提示重新整理後再預約');
        assert(takeoutResetFailed.after.disabled === true && takeoutResetFailed.after.button === '申請已收到', '外帶自動清空失敗後送出要維持停用');
        assert(takeoutResetFailed.after.locked === true && takeoutResetFailed.after.name === '測試同學' && takeoutResetFailed.after.chicken === '1', '外帶自動清空失敗後要鎖住並保留已填品項');
        assert(takeoutResetFailed.after.receipt.includes('SMC900072'), '外帶自動清空失敗時收件畫面仍要有編號');
        assert(takeoutResetFailed.extra === 0, `外帶自動清空失敗後再送出必須是 0 次，實際 ${takeoutResetFailed.extra}`);

        const anotherResetDining = await retryWhileResetThrows('dining', 'SMC900073');
        assert(anotherResetDining.booked === 1, `內用再預約前應只送出一次，實際 ${anotherResetDining.booked}`);
        assert(anotherResetDining.extra === 0, `內用再預約清空失敗後再送出必須是 0 次，實際 ${anotherResetDining.extra}`);
        assert(anotherResetDining.disabled === true && anotherResetDining.locked === true && anotherResetDining.button === '申請已收到', '內用再預約清空失敗要維持鎖定');
        assert(anotherResetDining.name === '測試同學' && anotherResetDining.message.includes('訂單編號：SMC900073') && anotherResetDining.message.includes('請重新整理頁面'), '內用再預約清空失敗要留下編號並請重新整理');

        const anotherResetTakeout = await retryWhileResetThrows('takeout', 'SMC900074');
        assert(anotherResetTakeout.booked === 1, `外帶再預約前應只送出一次，實際 ${anotherResetTakeout.booked}`);
        assert(anotherResetTakeout.extra === 0, `外帶再預約清空失敗後再送出必須是 0 次，實際 ${anotherResetTakeout.extra}`);
        assert(anotherResetTakeout.disabled === true && anotherResetTakeout.locked === true && anotherResetTakeout.button === '申請已收到', '外帶再預約清空失敗要維持鎖定');
        assert(anotherResetTakeout.name === '測試同學' && anotherResetTakeout.chicken === '1' && anotherResetTakeout.message.includes('訂單編號：SMC900074') && anotherResetTakeout.message.includes('請重新整理頁面'), '外帶再預約清空失敗要留下編號、品項，並請重新整理');

        await navigateAndWait(wsUrl, `${url}?mode=dining&probe=reset-ok#booking-section`);
        const resetOk = await evalExpr(wsUrl, `(async () => {
            window.alert = () => {};
            const day = new Date();
            day.setDate(day.getDate() + 2);
            while (day.getDay() === 3) day.setDate(day.getDate() + 1);
            const iso = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
            function fill(note) {
                const date = document.getElementById('date');
                date.value = iso;
                date.dispatchEvent(new Event('change', { bubbles: true }));
                document.querySelector('input[name="partyType"][value="casual"]').checked = true;
                document.getElementById('adults').value = '2';
                document.getElementById('name').value = '測試同學';
                document.getElementById('phone').value = '0900000000';
                document.getElementById('note').value = note;
                document.getElementById('privacyConsent').checked = true;
                document.getElementById('time').value = '12:00';
            }
            let posts = [];
            window.fetch = async (resource, opts) => {
                posts.push(JSON.parse(opts.body));
                const orderId = posts.length === 1 ? 'SMC900081' : 'SMC900082';
                return { json: async () => ({ status: 'success', orderId, message: '已保留座位' }) };
            };
            fill('靠窗');
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 40));
            const unlocked = {
                name: document.getElementById('name').value,
                disabled: document.getElementById('submitBtn').disabled,
                button: document.getElementById('submitBtn').innerText,
                locked: document.getElementById('bookingForm').getAttribute('data-booking-locked') === '1',
                receipt: document.getElementById('receiptContent').textContent,
            };
            fill('靠窗再一筆');
            document.getElementById('bookingForm').requestSubmit();
            await new Promise((resolve) => setTimeout(resolve, 40));
            return {
                unlocked,
                count: posts.length,
                secondNote: posts[1] ? posts[1].note : '',
                keys: posts[1] ? Object.keys(posts[1]) : [],
                receipt: document.getElementById('receiptContent').textContent,
            };
        })()`);
        assert(resetOk.unlocked.name === '' && resetOk.unlocked.disabled === false && resetOk.unlocked.button === '送出預約申請' && resetOk.unlocked.locked === false, '成功清空後要解開內用表單');
        assert(resetOk.unlocked.receipt.includes('SMC900081'), '第一筆成功後收件畫面要有編號');
        assert(resetOk.count === 2, `成功清空後只能再送出一筆，實際共 ${resetOk.count} 次`);
        assert(resetOk.secondNote.includes('靠窗再一筆') && resetOk.receipt.includes('SMC900082'), '第二筆要送出新備註並顯示新編號');
        assert(JSON.stringify(resetOk.keys) === JSON.stringify(['action', 'type', 'name', 'phone', 'email', 'people', 'tables', 'date', 'time', 'note', 'orderItems']), '成功後再送出的正式請求仍是原欄位');
    });
} finally {
    server.close();
}

if (failures.length) {
    console.error('browser checks failed:');
    failures.forEach((line) => console.error(' -', line));
    process.exit(1);
}
console.log('browser: mobile dining anchor, visit persistence, mock submit OK (no live booking)');
