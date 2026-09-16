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

assert(html.includes('超過10位成人吃桌菜時，超出部分每位加收300元；兒童及素食搭配由電話確認。'), '表單短句加人費');
assert(html.includes('value="casual"'), '後端用餐類型值仍為 casual');
assert(html.includes('人頭計價'), '對外顯示人頭計價');
assert(!html.includes('每桌最多12'), '不新增每桌最多12人政策');
assert(html.includes('有素食需求'), '素食入口可見');
assert(html.includes('加購烤雞（選填）'), '加購烤雞收合');
assert(html.includes('填寫Email接收通知（選填）'), 'Email 收合');
assert(html.includes('有兒童同行'), '兒童收合');
assert(html.includes('口味與其他需求（選填）'), '口味收合');
assert(html.includes('國小及以上約兩人折算一位大人'), '國小店規維持兩人折算一位大人');
assert(!html.includes('尚可討論'), '勿改成尚可討論');
assert(!html.includes('三人折'), '表單不含三人折一位');
assert(!html.includes('三位折'), '表單不含三位折一位');
assert(!/3\s*位.{0,16}(大人|成人)/.test(html), '表單不含 3 孩折算例子');
assert(html.includes('素食為向外部店家訂購的個人套餐，每份300／500元，另計費用'), '素食外訂文案');
assert(html.includes('script.google.com/macros'), 'booking endpoint unchanged');
assert(/Dining extras[\s\S]*vegetarian[\s\S]*`note` only/.test(html) || html.includes('vegetarian) are written into `note` only'), '素食走備註、不擴後端欄位');

const tenPlusVeg = banquetSummaryText('4500', 1, 1, 0);
assert(!tenPlusVeg.includes('4800'), '10桌菜+素食不在摘要套 300 加人費');
assert(!/總價|應付|全部費用/.test(tenPlusVeg), '摘要不寫誤導總價');

assert(vegetarianNoteLine(false, 2) === '', '未勾素食不寫入備註');
assert(vegetarianNoteLine(true, 1).includes('素食人數：1'), '勾選後備註含人數');
assert(vegetarianNoteLine(true, 1).includes('已含在合計人數'), '備註註明勿重複加總');
assert(discloseHint('兒童', 2) === '（兒童2位）', '兒童摘要');
assert(discloseHint('烤雞', 1) === '（烤雞1隻）', '烤雞摘要');
assert(discloseHint('兒童', 0) === '', '無資料不顯示摘要');
assert(planCode('casual', '', 8) === '散客8a', '方案代碼語意不變');

const faqNeedles = [
    '超過10位成人吃桌菜時，超出部分每位加收300元；兒童及素食搭配由電話確認。',
    '4500：11 人 4800、12 人 5100',
    '5000：11 人 5300、12 人 5600',
    '5500：11 人 5800、12 人 6100',
    '10 位吃 4500 桌菜＋1 位 500 素食＝5000',
    '同行有人吃素，可以安排嗎？',
    '每份300／500元',
    '素食客人不另收桌菜加人費',
    '國小及以上約兩人折算一位大人',
    '人頭計價每人',
];
for (const needle of faqNeedles) {
    assert(faq.includes(needle), `FAQ 缺少：${needle}`);
}
assert(!faq.includes('每桌最多12'), 'FAQ 不新增每桌人數上限');
assert(!faq.includes('可再討論'), 'FAQ 國小說明不改成可再討論');
assert(!faq.includes('三人折'), 'FAQ 不含三人折一位');
assert(!faq.includes('三位折'), 'FAQ 不含三位折一位');
assert(!/3\s*位.{0,16}(大人|成人)/.test(faq), 'FAQ 不含 3 孩折算例子');
assert((faq.match(/同行有人吃素，可以安排嗎？/g) || []).length >= 2, 'FAQ 正文與 JSON-LD 皆有素食題');

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
            document.getElementById('kidsPanel').open = false;
            const kidsHintCollapsed = document.getElementById('kidsDiscloseHint').textContent;
            const kidsValueCollapsed = document.getElementById('kidsKinder').value;

            document.getElementById('hasVegetarian').checked = true;
            document.getElementById('hasVegetarian').dispatchEvent(new Event('change', { bubbles: true }));
            const vegCountHiddenAfter = document.getElementById('vegCountWrap').classList.contains('hidden');
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
                vegVisible,
                kidsOpenDefault,
                chickenOpenDefault,
                peopleBeforeKids,
                peopleWithKids,
                peopleWithVeg,
                kidsHint,
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
        assert(result.extraHint.includes('超過10位成人吃桌菜時'), '桌菜方案區顯示加人費短句');
        assert(result.vegVisible, '素食入口維持可見');
        assert(result.vegCountHiddenBefore, '未勾選不顯示素食人數');
        assert(!result.vegCountHiddenAfter, '勾選後顯示素食人數');
        assert(result.kidsOpenDefault === false, '無兒童可直接略過兒童欄');
        assert(result.chickenOpenDefault === false, '無加購可直接略過烤雞欄');
        assert(result.peopleBeforeKids === '10', `成人10合計應為10，實際 ${result.peopleBeforeKids}`);
        assert(result.peopleWithKids === '12', `兒童應計入到店人數 12，實際 ${result.peopleWithKids}`);
        assert(result.peopleWithVeg === '12', `素食人數不可再加總，實際 ${result.peopleWithVeg}`);
        assert(result.kidsHint === '（兒童2位）', `兒童摘要：${result.kidsHint}`);
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
        assert(result.note.includes('素食需求：是｜素食人數：1'), `備註應含素食：${result.note}`);
        assert(result.note.includes('用餐類型：散客') === false || result.partyValue === 'banquet', '桌菜備註不應誤寫散客');
        assert(result.note.includes('桌菜價位：5000'), `備註方案：${result.note}`);
        assert(result.payloadPeople === '12', '送出人數為到店合計，不含重複素食');
        assert(result.partyValue === 'banquet', '後端值 banquet 不變');
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
