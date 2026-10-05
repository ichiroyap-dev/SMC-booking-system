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

const landing = '?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=rsa_family&utm_adgroup=brand&gclid=TESTGCLID9000';
const store = attr.memoryStorage();
attr.capture(landing, store);
const branded = attr.bookingFields(store);
assert(branded.source === 'google', `品牌進站 source：${branded.source}`);
assert(branded.utmCampaign === 'launch_202610', '活動代碼要原樣保留');
assert(branded.utmContent === 'rsa_family', 'utm_content 仍是素材，不拿來當群組');
assert(branded.utmAdgroup === 'brand' && branded.adgroupBucket === '品牌', 'brand 對到品牌');
assert(branded.gclid === 'TESTGCLID9000', '有 utm 時 gclid 一併保留');
attr.capture('', store);
assert(attr.bookingFields(store).utmAdgroup === 'brand', '沒參數的網址不可清掉這次造訪的來源');
attr.capture('?utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_adgroup=non-brand', store);
const nonbrand = attr.bookingFields(store);
assert(nonbrand.utmAdgroup === 'nonbrand' && nonbrand.adgroupBucket === '非品牌', `非品牌代碼：${nonbrand.utmAdgroup}/${nonbrand.adgroupBucket}`);
assert(nonbrand.adgroupBucket !== branded.adgroupBucket, '品牌與非品牌必須分得開');
assert(nonbrand.gclid === 'TESTGCLID9000', '新的 utm 沒帶 gclid 時保留原本的 gclid');

const bare = attr.memoryStorage();
assert(attr.bookingFields(bare).source === 'direct/unknown', '沒進站紀錄不可當成廣告');
assert(attr.bookingFields(bare).gclid === '' && attr.bookingFields(bare).adgroupBucket === '', '空造訪不可帶群組或 gclid');
const gclidOnly = attr.memoryStorage();
attr.capture('?gclid=TESTGCLID9000', gclidOnly);
const onlyClick = attr.bookingFields(gclidOnly);
assert(onlyClick.source === 'direct/unknown', '只有 gclid、沒有 utm 時仍是 direct/unknown');
assert(onlyClick.gclid === 'TESTGCLID9000', 'gclid 仍附上，供事後對照');
assert(onlyClick.source !== 'google', '不可把 gclid 推測成 google');

const partial = attr.memoryStorage();
attr.capture('?utm_campaign=launch_202610&utm_adgroup=brand', partial);
assert(attr.bookingFields(partial).source === 'utm_missing_source', '有 utm 但沒有 utm_source 時不可填 google');
assert(attr.normalizeAdgroup('品牌') === 'brand', '中文群組代碼可對回 brand');
assert(attr.adgroupBucket('other_group') === '', '不認得的群組代碼不要猜成品牌或非品牌');
const other = attr.memoryStorage();
attr.capture('?utm_source=google&utm_adgroup=other_group', other);
assert(attr.bookingFields(other).utmAdgroup === 'other_group' && attr.bookingFields(other).adgroupBucket === '', '新代碼原樣保留、分類留白');

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
assert(html.includes('source: attribution.source'), '送出要附 source');
assert(!html.slice(html.indexOf("action: 'cancel'"), html.indexOf("action: 'cancel'") + 500).includes('utm'), '取消申請不附來源欄');
assert(html.includes('recordBookingSubmission(orderId)'), '轉換以訂單編號記一次');
assert(!receiptFn.includes('recordBookingSubmission'), '不可在每次顯示收件時重計');
assert(html.includes('不會當成廣告'), '隱私權說明要講沒有參數時不當成廣告');
assert(!html.includes('>launch_202610<') && !html.includes('utm_adgroup=brand'), '頁面內文不要寫出活動代碼');

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
        assert(post && post.source === 'google' && post.utmAdgroup === 'brand' && post.gclid === 'TESTGCLID9000', '送出內容要帶進站來源');
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
        assert(direct.post && direct.post.source === 'direct/unknown', '沒有 utm 的送出不可填成廣告');
        assert(direct.post.action === 'book' && direct.post.note && direct.post.people === '2' && direct.post.tables === '1', '沒有 utm 時原訂位內容要維持');
        assert(!direct.post.note.includes('direct/unknown'), 'direct/unknown 不可寫進備註');
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
