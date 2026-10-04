#!/usr/bin/env node
/**
 * W1–W6 dine-in form simplify + special-needs checks.
 * Unit: parse helpers + FAQ copy from files (no network).
 * --browser: headless Chrome against a local static server; fetch is mocked (no live booking).
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const faq = readFileSync(join(root, 'faq.html'), 'utf8');
const failures = [];

function assert(cond, message) {
    if (!cond) failures.push(message);
}

function extractFn(name) {
    const start = html.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`Missing ${name} in index.html`);
    let i = html.indexOf('{', start);
    let depth = 0;
    for (; i < html.length; i += 1) {
        if (html[i] === '{') depth += 1;
        else if (html[i] === '}') {
            depth -= 1;
            if (depth === 0) return html.slice(start, i + 1);
        }
    }
    throw new Error(`Unclosed ${name}`);
}

const {
    banquetSummaryText,
    vegetarianNoteLine,
    discloseHint,
    planCode,
} = eval(`(function () {
    ${extractFn('extraChickenPart')}
    ${extractFn('banquetSummaryText')}
    ${extractFn('vegetarianNoteLine')}
    ${extractFn('discloseHint')}
    ${extractFn('planCode')}
    return { banquetSummaryText, vegetarianNoteLine, discloseHint, planCode };
})()`);

const extraPersonCopy = '每桌超過10位成人吃桌菜時，該桌超出部分每位加收300元；兒童及素食搭配由電話確認。';
const kidsCopy = '國小及以上兒童，份量與收費約2位折算1位成人，可再討論；座位依實際人數安排。';
const vegShortCopy = '有素食需求（另購套餐300／500元）';
const vegLongCopy = '每份300／500元另計，桌菜基本費不變，也不另收該位桌菜加人費';
const seatingCopy = '每桌建議最多坐12位；特殊人數與座位配置請由電話確認。';
const forbidden = [
    ['三人折', '三人折一位'],
    ['三位折', '三位折一位'],
    ['約三位小孩', '約三位小孩例子'],
    ['三位小孩算一位大人', '三孩折算例子'],
    ['可再擠', '可再擠13–14'],
    ['13–14', '13–14 座位說法'],
    ['13-14', '13-14 座位說法'],
];

assert(html.includes(extraPersonCopy), '表單短句加人費需含每桌');
assert(!html.includes('超過10位成人吃桌菜時，超出部分每位加收300元'), '表單不可殘留未限定每桌的加人費短句');
assert(html.includes('value="casual"'), '後端用餐類型值仍為 casual');
assert(html.includes('人頭計價'), '對外顯示人頭計價');
assert(!html.includes('每桌最多12'), '不新增每桌最多12人硬性上限');
assert(html.includes('有素食需求'), '素食入口可見');
assert(html.includes(vegShortCopy), '素食費用提示在標籤');
assert(html.includes(vegLongCopy), '勾選後素食說明含基本費不變與不另收人費');
assert(!html.includes('有素食需求（套餐每份300／500元，另外計費）'), '勾選框下不再重複素食短句');
assert(!html.includes('請先選擇人頭計價、桌菜或大型聚餐'), '用餐類型不再寫請先選擇');
assert(!html.includes('寫入訂位表'), '不對客人寫資料寫入訂位表');
assert(html.includes('預約成功後即保留座位'), '留位條件寫在成功之後');
assert(html.includes('未預約不保證供應烤雞'), '未預約不保證供應烤雞仍在');
assert(html.includes('每桌原則含烤雞 1 隻；超過 3 桌請電話／LINE。'), '預估桌數為短句');
assert(!html.includes('hero-reserve-methods'), '主視覺不再有第二組預約連結');
assert(!html.includes('<h3 class="dish-title">散客料理</h3>'), '招牌區移除散客價目卡');
assert(!html.includes('<h3 class="dish-title">桌菜方案</h3>'), '招牌區移除桌菜價目卡');
assert(html.includes('id="menu"') && html.includes('NT$500／位') && html.includes('NT$4,500／5,000／5,500'), '完整價目仍在菜單');
assert(html.includes('value="4500"') && html.includes('value="5000"') && html.includes('value="5500"'), '表單仍可選桌菜價位');
assert(html.includes('id="vegShortHint"'), '素食費用提示容器');
assert(html.includes('id="vegLongCopy"'), '勾選後素食長說明容器');
const planStart = html.indexOf('id="planPanel"');
const planEnd = html.indexOf('id="diningDetails"');
const planHtml = planStart >= 0 && planEnd > planStart ? html.slice(planStart, planEnd) : '';
assert((planHtml.match(/含烤雞|含雞/g) || []).length === 1, '三張方案卡只共用一次含雞說明');
assert(html.includes('加購烤雞（選填）'), '加購烤雞收合');
assert(html.includes('填寫Email接收通知（選填）'), 'Email 收合');
assert(html.includes('有兒童同行'), '兒童收合');
assert(html.includes('口味與其他需求（選填）'), '口味收合');
assert(html.includes(kidsCopy), '國小文案需含份量與收費');
assert(html.includes('座位依實際人數安排'), '兒童座位依實際人數');
assert(!html.includes('國小及以上約兩人折算一位大人'), '表單不可殘留舊國小短句');
assert(!html.includes('尚可討論'), '勿改成尚可討論');
for (const [needle, label] of forbidden) {
    assert(!html.includes(needle), `表單不含${label}`);
}
assert(!html.includes('每桌最多12'), '表單不暗示每桌硬性上限 12');
assert(html.includes('script.google.com/macros'), 'booking endpoint unchanged');
assert(/Dining extras are written into `note` only, in SHORT form/.test(html), '素食等選項走備註短句、不擴後端欄位');

const tenPlusVeg = banquetSummaryText('4500', 1, 1, 0);
assert(!tenPlusVeg.includes('4800'), '10桌菜+素食不在摘要套 300 加人費');
assert(!/總價|應付|全部費用/.test(tenPlusVeg), '摘要不寫誤導總價');

assert(vegetarianNoteLine(false, 2) === '', '未勾素食不寫入備註');
assert(vegetarianNoteLine(true, 1) === '素食1位', '勾選後備註為完整字「素食1位」');
assert(vegetarianNoteLine(true, 0) === '素食', '素食人數未填時只寫「素食」');
assert(discloseHint('兒童', 2) === '（兒童2位）', '兒童摘要');
assert(discloseHint('烤雞', 1) === '（烤雞1隻）', '烤雞摘要');
assert(discloseHint('兒童', 0) === '', '無資料不顯示摘要');
assert(planCode('casual', '', 1) === '散客', '散客不寫 a（a = 桌數）');
assert(planCode('banquet', '4500', 2) === '4.5k2a', 'a = 桌數：4500 × 2 桌');
assert(planCode('banquet', '5000', 1) === '5k1a', 'a = 桌數：5000 × 1 桌（不因 10 人寫成 5k10a）');

const faqNeedles = [
    extraPersonCopy,
    kidsCopy,
    seatingCopy,
    '4500：11 人 4800、12 人 5100',
    '5000：11 人 5300、12 人 5600',
    '5500：11 人 5800、12 人 6100',
    '10 位吃 4500 桌菜＋1 位 500 素食＝5000',
    '同行有人吃素，可以安排嗎？',
    '每份300／500元',
    '素食客人不另收桌菜加人費',
    '人頭計價每人',
    '不是每桌人數上限',
    'contact-link--wrap',
    'overflow-wrap: anywhere',
];
for (const needle of faqNeedles) {
    assert(faq.includes(needle), `FAQ 缺少：${needle}`);
}
assert((faq.match(new RegExp(extraPersonCopy, 'g')) || []).length >= 4, 'FAQ 正文與 JSON-LD 加人費皆含每桌');
assert((faq.match(new RegExp(kidsCopy, 'g')) || []).length >= 2, 'FAQ 正文與 JSON-LD 皆有國小份量與收費');
assert((faq.match(new RegExp(seatingCopy, 'g')) || []).length >= 2, 'FAQ 正文與 JSON-LD 皆有每桌建議最多坐12位');
assert(!faq.includes('超過10位成人吃桌菜時，超出部分每位加收300元'), 'FAQ 不可殘留未限定每桌的加人費短句');
assert(!faq.includes('國小及以上約兩人折算一位大人'), 'FAQ 不可殘留舊國小短句');
assert(!faq.includes('每桌最多12'), 'FAQ 不新增每桌人數硬性上限');
assert(!faq.includes('最多12人上限'), 'FAQ 不寫硬性 12 人上限');
for (const [needle, label] of forbidden) {
    assert(!faq.includes(needle), `FAQ 不含${label}`);
}
assert(faq.includes('<a href="./#booking-section" class="contact-link">線上預約內用</a>'), 'FAQ 第一題內用連結可點');
assert(faq.includes('<a href="./#takeout" class="contact-link">外帶</a>'), 'FAQ 第一題外帶連結可點');
const ldMatch = faq.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert(!!ldMatch, 'FAQ 有 JSON-LD');
JSON.parse(ldMatch[1]);

if (failures.length) {
    console.error('unit checks failed:');
    failures.forEach((line) => console.error(' -', line));
    process.exit(1);
}
console.log('unit: form copy + vegetarian note + FAQ OK');

if (!process.argv.includes('--browser')) process.exit(0);

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
            const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
            const file = join(root, path.replace(/^\/+/, ''));
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

async function cdp(wsUrl, method, params = {}) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const id = 1;
        ws.addEventListener('open', () => ws.send(JSON.stringify({ id, method, params })));
        ws.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id === id) {
                ws.close();
                if (msg.error) reject(new Error(JSON.stringify(msg.error)));
                else resolve(msg.result);
            }
        });
        ws.addEventListener('error', () => reject(new Error(`CDP socket error for ${method}`)));
    });
}

async function withChrome(baseUrl, fn) {
    const chrome = spawn('/usr/bin/google-chrome', [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--remote-debugging-port=0',
        '--user-data-dir=/tmp/smc-form-simplify-chrome',
        'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('chrome debug port timeout')), 15000);
        const onData = (buf) => {
            const text = buf.toString();
            const match = text.match(/DevTools listening on [^\n]+:(\d+)/);
            if (match) {
                clearTimeout(timer);
                chrome.stderr.off('data', onData);
                resolve(match[1]);
            }
        };
        chrome.stderr.on('data', onData);
        chrome.on('exit', (code) => reject(new Error(`chrome exited ${code}`)));
    });

    try {
        const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
        const page = targets.find((t) => t.type === 'page') || targets[0];
        await cdp(page.webSocketDebuggerUrl, 'Page.navigate', { url: `${baseUrl}#booking-section` });
        await cdp(page.webSocketDebuggerUrl, 'Page.enable');
        await new Promise((r) => setTimeout(r, 800));
        await fn(page.webSocketDebuggerUrl);
    } finally {
        chrome.kill('SIGKILL');
    }
}

const { server, url } = await startStaticServer();
try {
    await withChrome(url, async (wsUrl) => {
        const evalExpr = async (expression) => {
            const result = await cdp(wsUrl, 'Runtime.evaluate', {
                expression,
                awaitPromise: true,
                returnByValue: true,
            });
            if (result.exceptionDetails) {
                throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
            }
            return result.result.value;
        };

        const result = await evalExpr(`(async () => {
            const pick = (name, value) => {
                const el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
                el.checked = true;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            };
            const setNum = (id, value) => {
                const el = document.getElementById(id);
                el.value = String(value);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            };
            const visible = (id) => {
                const el = document.getElementById(id);
                if (!el) return false;
                const cs = getComputedStyle(el);
                return cs.display !== 'none' && !el.classList.contains('hidden');
            };
            window.__bookingPosts = [];
            window.fetch = async (resource, opts) => {
                window.__bookingPosts.push({ url: String(resource), body: JSON.parse(opts.body) });
                return { json: async () => ({ status: 'success', orderId: 'MOCK-ONLY' }) };
            };

            pick('partyType', 'banquet');
            const planVisible = visible('planPanel');
            const extraHint = document.getElementById('banquetExtraPersonHint').textContent;
            const vegCountHiddenBefore = document.getElementById('vegCountWrap').classList.contains('hidden');
            const vegShortHiddenBefore = document.getElementById('vegShortHint').classList.contains('hidden');
            const vegLongHiddenBefore = document.getElementById('vegLongCopy').classList.contains('hidden');
            const vegShortText = document.getElementById('vegShortHint').textContent;
            pick('diningPlan', '4500');
            setNum('adults', 10);
            setNum('tables', 1);
            const peopleBeforeKids = document.getElementById('people').value;
            const kidsOpenDefault = document.getElementById('kidsPanel').open;
            const chickenOpenDefault = document.getElementById('extraChickenPanel').open;
            const vegVisible = visible('vegPanel');

            document.getElementById('kidsPanel').open = true;
            setNum('kidsKinder', 1);
            setNum('kidsElem', 1);
            const peopleWithKids = document.getElementById('people').value;
            const kidsHint = document.getElementById('kidsDiscloseHint').textContent;
            const kidsCopyText = document.querySelector('#kidsElem').parentElement.querySelector('p').textContent;
            document.getElementById('kidsPanel').open = false;
            const kidsHintCollapsed = document.getElementById('kidsDiscloseHint').textContent;
            const kidsValueCollapsed = document.getElementById('kidsKinder').value;

            document.getElementById('hasVegetarian').checked = true;
            document.getElementById('hasVegetarian').dispatchEvent(new Event('change', { bubbles: true }));
            const vegCountHiddenAfter = document.getElementById('vegCountWrap').classList.contains('hidden');
            const vegShortHiddenAfter = document.getElementById('vegShortHint').classList.contains('hidden');
            const vegLongHiddenAfter = document.getElementById('vegLongCopy').classList.contains('hidden');
            const vegLongText = document.getElementById('vegLongCopy').textContent;
            setNum('vegetarianCount', 1);
            const peopleWithVeg = document.getElementById('people').value;

            document.getElementById('extraChickenPanel').open = true;
            setNum('extraChicken', 1);
            const chickenHint = document.getElementById('chickenDiscloseHint').textContent;
            document.getElementById('extraChickenPanel').open = false;
            const chickenValueCollapsed = document.getElementById('extraChicken').value;

            const summary10 = document.getElementById('banquetSummary').textContent;
            pick('partyType', 'casual');
            const summaryCasual = document.getElementById('banquetSummary').textContent;
            const extraAfterSwitch = document.getElementById('extraChicken').value;
            const vegAfterSwitch = document.getElementById('hasVegetarian').checked;
            pick('partyType', 'banquet');
            pick('diningPlan', '5000');
            const summary5000 = document.getElementById('banquetSummary').textContent;

            const note = buildDiningNote();
            const payloadPeople = document.getElementById('people').value;

            return {
                planVisible,
                extraHint,
                vegCountHiddenBefore,
                vegCountHiddenAfter,
                vegShortHiddenBefore,
                vegLongHiddenBefore,
                vegShortHiddenAfter,
                vegLongHiddenAfter,
                vegShortText,
                vegLongText,
                vegVisible,
                kidsOpenDefault,
                chickenOpenDefault,
                peopleBeforeKids,
                peopleWithKids,
                peopleWithVeg,
                kidsHint,
                kidsCopyText,
                kidsHintCollapsed,
                kidsValueCollapsed,
                chickenHint,
                chickenValueCollapsed,
                summary10,
                summaryCasual,
                summary5000,
                extraAfterSwitch,
                vegAfterSwitch,
                note,
                payloadPeople,
                partyValue: document.querySelector('input[name="partyType"]:checked').value,
            };
        })()`);

        assert(result.planVisible, '選桌菜後才顯示方案區');
        assert(result.extraHint.includes('每桌超過10位成人吃桌菜時'), '桌菜方案區顯示每桌加人費短句');
        assert(result.extraHint.includes('該桌超出部分每位加收300元'), '加人費限定該桌超出部分');
        assert(!result.extraHint.includes('整筆'), '加人費不依整筆總人數計算');
        assert(result.vegVisible, '素食入口維持可見');
        assert(result.vegCountHiddenBefore, '未勾選不顯示素食人數');
        assert(!result.vegShortHiddenBefore, '未勾選費用提示在標籤上');
        assert(result.vegLongHiddenBefore, '未勾選不顯示素食長說明');
        assert(result.vegShortText.includes('300／500'), `未勾選標籤需含價格：${result.vegShortText}`);
        assert(!result.vegCountHiddenAfter, '勾選後顯示素食人數');
        assert(!result.vegShortHiddenAfter, '勾選後費用提示仍留在標籤');
        assert(!result.vegLongHiddenAfter, '勾選後顯示素食長說明');
        assert(result.vegLongText.includes('每份300／500元'), `勾選後長說明需含價格：${result.vegLongText}`);
        assert(result.vegLongText.includes('桌菜基本費不變'), '勾選後長說明需含桌菜基本費不變');
        assert(result.vegLongText.includes('不另收該位桌菜加人費'), '勾選後長說明需含不另收該位加人費');
        assert(!result.vegLongText.includes('寫入訂位表'), '素食說明不寫訂位表');
        assert(result.kidsOpenDefault === false, '無兒童可直接略過兒童欄');
        assert(result.chickenOpenDefault === false, '無加購可直接略過烤雞欄');
        assert(result.peopleBeforeKids === '10', `成人10合計應為10，實際 ${result.peopleBeforeKids}`);
        assert(result.peopleWithKids === '12', `兒童應計入到店人數 12，實際 ${result.peopleWithKids}`);
        assert(result.peopleWithVeg === '12', `素食人數不可再加總，實際 ${result.peopleWithVeg}`);
        assert(result.kidsHint === '（兒童2位）', `兒童摘要：${result.kidsHint}`);
        assert(result.kidsCopyText.includes('份量與收費約2位折算1位成人'), `國小文案：${result.kidsCopyText}`);
        assert(result.kidsCopyText.includes('座位依實際人數安排'), '兒童座位依實際人數');
        assert(result.kidsHintCollapsed === '（兒童2位）', '收合後仍顯示兒童摘要');
        assert(result.kidsValueCollapsed === '1', '收合不清空兒童人數');
        assert(result.chickenHint === '（烤雞1隻）', `烤雞摘要：${result.chickenHint}`);
        assert(result.chickenValueCollapsed === '1', '收合不清空加購烤雞');
        assert(result.summary10.includes('桌菜基本費用：4500元×1桌'), `摘要基本費用：${result.summary10}`);
        assert(result.summary10.includes('另加購1隻1000元'), `摘要加購：${result.summary10}`);
        assert(!result.summary10.includes('4800'), '10桌菜+1素食不套 300 加人費');
        assert(!/總價|應付|全部費用/.test(result.summary10), `摘要誤導總價：${result.summary10}`);
        assert(result.summaryCasual.startsWith('人頭計價'), `切換後摘要：${result.summaryCasual}`);
        assert(result.extraAfterSwitch === '1', '切用餐類型後加購資料仍在');
        assert(result.vegAfterSwitch === true, '切用餐類型後素食勾選仍在');
        assert(result.summary5000.includes('桌菜基本費用：5000元×1桌'), `切回桌菜摘要：${result.summary5000}`);
        assert(/^5k1a 大人10位、小朋友1位、幼兒1位 素食1位 加購烤雞1隻/.test(result.note), `備註應為「5k1a（1 桌）大人10位、小朋友1位、幼兒1位 素食1位 加購烤雞1隻」：${result.note}`);
        assert(!/5k10a|(^|[\s、])(幼|國)\d/.test(result.note), `a 不可是人數、不可用幼/國縮寫：${result.note}`);
        assert(!/用餐類型|桌菜價位|方案代碼|人頭NT|成人\d|合計|桌數|原則含烤雞|\n/.test(result.note), `備註不應含定型稿：${result.note}`);
        assert(result.payloadPeople === '12', '送出人數為到店合計，不含重複素食');
        assert(result.partyValue === 'banquet', '後端值 banquet 不變');

        await cdp(wsUrl, 'Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 1,
            mobile: true,
        });
        await cdp(wsUrl, 'Page.navigate', { url: `${url}faq.html` });
        await new Promise((r) => setTimeout(r, 900));
        const faqOverflow = await evalExpr(`(() => {
            const items = Array.from(document.querySelectorAll('.faq-item'));
            const first = items[0];
            first.open = true;
            const links = Array.from(first.querySelectorAll('a.contact-link'));
            const dining = links.find((a) => (a.getAttribute('href') || '').includes('#booking-section'));
            const takeout = links.find((a) => (a.getAttribute('href') || '').includes('#takeout'));
            const measure = () => ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
                bodyScrollWidth: document.body.scrollWidth,
            });
            const fit = (link) => {
                if (!link) return { text: '', href: '', linkWidth: 0, parentWidth: 0 };
                const box = link.getBoundingClientRect();
                const parent = link.parentElement.getBoundingClientRect();
                return {
                    text: link.textContent,
                    href: link.getAttribute('href') || '',
                    linkWidth: Math.round(box.width),
                    parentWidth: Math.round(parent.width),
                };
            };
            const expandedFirst = measure();
            items.forEach((item) => { item.open = true; });
            const allOpen = measure();
            const feeItem = items.find((item) => (item.querySelector('summary') || {}).textContent === '桌菜加人費怎麼算？');
            const kidsItem = items.find((item) => (item.querySelector('summary') || {}).textContent === '兒童怎麼計費？有兒童椅嗎？');
            return {
                q1: (first.querySelector('summary') || {}).textContent,
                dining: fit(dining),
                takeout: fit(takeout),
                expandedFirst,
                allOpen,
                feeText: feeItem ? feeItem.textContent : '',
                kidsText: kidsItem ? kidsItem.textContent : '',
            };
        })()`);

        assert(faqOverflow.q1.includes('需要提前預約嗎'), `FAQ 第一題：${faqOverflow.q1}`);
        assert(faqOverflow.dining.text.includes('內用'), `內用連結文字：${faqOverflow.dining.text}`);
        assert(faqOverflow.dining.href.includes('#booking-section'), '內用連結仍可點進預約');
        assert(faqOverflow.takeout.text.includes('外帶'), `外帶連結文字：${faqOverflow.takeout.text}`);
        assert(faqOverflow.takeout.href.includes('#takeout'), '外帶連結仍可點進外帶');
        assert(faqOverflow.dining.linkWidth <= faqOverflow.dining.parentWidth + 1, `內用連結寬 ${faqOverflow.dining.linkWidth} 不可超過內容 ${faqOverflow.dining.parentWidth}`);
        assert(faqOverflow.takeout.linkWidth <= faqOverflow.takeout.parentWidth + 1, `外帶連結寬 ${faqOverflow.takeout.linkWidth} 不可超過內容 ${faqOverflow.takeout.parentWidth}`);
        assert(faqOverflow.expandedFirst.scrollWidth <= faqOverflow.expandedFirst.clientWidth, `展開第一題文件寬 ${faqOverflow.expandedFirst.scrollWidth} > ${faqOverflow.expandedFirst.clientWidth}`);
        assert(faqOverflow.allOpen.scrollWidth <= faqOverflow.allOpen.clientWidth, `展開全部題文件寬 ${faqOverflow.allOpen.scrollWidth} > ${faqOverflow.allOpen.clientWidth}`);
        assert(faqOverflow.feeText.includes('每桌超過10位成人吃桌菜時'), 'FAQ 加人費含每桌');
        assert(faqOverflow.feeText.includes('每桌建議最多坐12位'), 'FAQ 座位建議最多坐12');
        assert(!faqOverflow.feeText.includes('可再擠'), 'FAQ 加人費不含可再擠');
        assert(faqOverflow.kidsText.includes('份量與收費'), 'FAQ 兒童含份量與收費');
    });
} finally {
    server.close();
}

if (failures.length) {
    console.error('browser checks failed:');
    failures.forEach((line) => console.error(' -', line));
    process.exit(1);
}
console.log('browser: vegetarian/kids collapse + mock note payload OK (no live submit)');
