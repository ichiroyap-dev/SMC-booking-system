#!/usr/bin/env node
/**
 * Regression check: 散客／桌菜 原則含烤雞數 = 預估桌數；加購另列。
 * 1) Parses includedChickenCount from index.html (no browser).
 * 2) Optionally drives the form in headless Chrome when --browser is passed.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const failures = [];

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

const { parsePositiveInt, includedChickenCount } = eval(`(function () {
    ${extractFn('parsePositiveInt')}
    ${extractFn('includedChickenCount')}
    return { parsePositiveInt, includedChickenCount };
})()`);

function extraPart(extra) {
    return extra ? `；另加購${extra}隻${extra * 1000}元` : '';
}

function expectedCasualSummary(tables, extra) {
    const included = includedChickenCount('casual', tables);
    return `人頭計價，${tables}桌，原則含烤雞${included}隻${extraPart(extra)}`;
}

function assert(cond, message) {
    if (!cond) failures.push(message);
}

for (const tables of [1, 2, 3]) {
    for (const extra of [0, 1, 2]) {
        const included = includedChickenCount('casual', tables);
        assert(included === tables, `散客 tables=${tables} extra=${extra}: included=${included}, expected ${tables}`);
        const banquet = includedChickenCount('banquet', tables);
        assert(banquet === tables, `桌菜 tables=${tables} extra=${extra}: included=${banquet}, expected ${tables}`);
        const text = expectedCasualSummary(tables, extra);
        assert(
            text.includes(`原則含烤雞${tables}隻`),
            `摘要應含「原則含烤雞${tables}隻」：${text}`
        );
        if (extra) {
            assert(text.includes(`另加購${extra}隻${extra * 1000}元`), `加購列錯誤：${text}`);
            assert(!text.includes(`原則含烤雞${tables + extra}隻`), `加購不應併入含雞數：${text}`);
        }
    }
}

assert(includedChickenCount('large', 4) === 0, '大型聚餐不在摘要顯示原則含雞數');
assert(includedChickenCount('casual', 0) === 0, '桌數 0 時含雞數為 0');
assert(includedChickenCount('casual', '3') === 3, '字串桌數應解析為 3');
assert(parsePositiveInt('3') === 3, 'parsePositiveInt(3) === 3');

if (failures.length) {
    console.error('unit checks failed:');
    failures.forEach((line) => console.error(' -', line));
    process.exit(1);
}
console.log('unit: 9 combos + 桌菜 + 邊界值 OK');

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
        '--user-data-dir=/tmp/smc-chicken-summary-chrome',
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
                throw new Error(result.exceptionDetails.text || 'evaluate failed');
            }
            return result.result.value;
        };

        const rows = await evalExpr(`(async () => {
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
            const read = () => {
                const el = document.getElementById('banquetSummary');
                const hint = document.getElementById('tablesHint');
                return {
                    text: el.textContent,
                    hint: hint.textContent,
                    included: Number(el.dataset.includedChicken),
                    tables: Number(el.dataset.tables),
                    extra: Number(el.dataset.extraChicken),
                };
            };
            const out = [];
            pick('partyType', 'casual');
            for (const tables of [1, 2, 3]) {
                for (const extra of [0, 1, 2]) {
                    setNum('tables', tables);
                    setNum('extraChicken', extra);
                    out.push({ kind: 'casual', tables, extra, ...read() });
                }
            }
            pick('partyType', 'banquet');
            pick('diningPlan', '4500');
            setNum('tables', 3);
            setNum('extraChicken', 2);
            out.push({ kind: 'banquet', tables: 3, extra: 2, ...read() });
            pick('partyType', 'casual');
            out.push({ kind: 'switch', tables: 3, extra: 2, ...read() });
            return out;
        })()`);

        for (const row of rows) {
            if (row.included !== row.tables) {
                failures.push(`${row.kind} tables=${row.tables} extra=${row.extra}: data-included-chicken=${row.included}`);
            }
            if (!row.text.includes(`原則含烤雞${row.tables}隻`)) {
                failures.push(`${row.kind} summary missing 原則含烤雞${row.tables}隻: ${row.text}`);
            }
            if (!row.hint.includes(`目前原則含烤雞${row.tables}隻`)) {
                failures.push(`${row.kind} hint missing 目前原則含烤雞${row.tables}隻: ${row.hint}`);
            }
            if (row.extra) {
                if (!row.text.includes(`另加購${row.extra}隻${row.extra * 1000}元`)) {
                    failures.push(`${row.kind} extra line wrong: ${row.text}`);
                }
            }
        }
    });
} finally {
    server.close();
}

if (failures.length) {
    console.error('browser checks failed:');
    failures.forEach((line) => console.error(' -', line));
    process.exit(1);
}
console.log('browser: 9 combos + 桌菜 3 桌 + 切換散客 OK');
