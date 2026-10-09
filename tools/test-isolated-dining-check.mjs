#!/usr/bin/env node
// Acceptance-page guards. Does not call script.google.com or the live site.
// Usage: node tools/test-isolated-dining-check.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const guard = require(join(root, 'tools/isolated-check-guard.js'));
const page = readFileSync(join(root, 'tools/isolated-dining-check.html'), 'utf8');
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

const LIVE = guard.LIVE_ID;
const OK = 'https://script.google.com/macros/s/ISOLATEDTEST/exec';
const encodedLive = '%41' + LIVE.slice(1);
const doubleEncodedLive = '%2541' + LIVE.slice(1);

assert(guard.endpointProblem(OK) === '', '正確的隔離 exec 網址可以送');
assert(guard.endpointProblem('  ' + OK + '  ') === '', '前後空白不影響正確網址');
assert(guard.endpointProblem('') !== '', '空白網址不可送');

const rejected = [
  ['查詢夾帶', 'https://example.invalid/?next=script.google.com/macros/s/TEST/exec'],
  ['使用者資訊在正確主機', 'https://user@script.google.com/macros/s/TEST/exec'],
  ['使用者資訊把主機換掉', 'https://script.google.com@evil.example/macros/s/TEST/exec'],
  ['其他主機', 'https://example.invalid/macros/s/TEST/exec'],
  ['看起來像子網域', 'https://script.google.com.evil.example/macros/s/TEST/exec'],
  ['真正的子網域', 'https://evil.script.google.com/macros/s/TEST/exec'],
  ['http', 'http://script.google.com/macros/s/TEST/exec'],
  ['正式編號', 'https://script.google.com/macros/s/' + LIVE + '/exec'],
  ['百分比編碼的正式編號', 'https://script.google.com/macros/s/' + encodedLive + '/exec'],
  ['雙重編碼的正式編號', 'https://script.google.com/macros/s/' + doubleEncodedLive + '/exec'],
  ['結尾斜線', 'https://script.google.com/macros/s/TEST/exec/'],
  ['多一段路徑', 'https://script.google.com/macros/s/TEST/exec/extra'],
  ['查詢', 'https://script.google.com/macros/s/TEST/exec?next=1'],
  ['錨點', 'https://script.google.com/macros/s/TEST/exec#booking'],
  ['正式官網', 'https://www.sweetmeichicken.com/'],
  ['指定連接埠', 'https://script.google.com:444/macros/s/TEST/exec'],
];
for (const [label, url] of rejected) {
  assert(guard.endpointProblem(url) !== '', `${label} 不可送出`);
}

const errorVerdict = guard.classifyResponse('{"status":"error"}');
assert(errorVerdict.kind === 'error' && errorVerdict.ok === false, 'status error 不可算成功');
const successVerdict = guard.classifyResponse('{"status":"success","orderId":"SMC900222","message":"訂位成功，已為您保留座位。"}');
assert(successVerdict.kind === 'success' && successVerdict.ok === true && successVerdict.orderId === 'SMC900222', '成功要有訂單編號');
assert(guard.classifyResponse('{"status":"success"}').kind === 'unknown', '沒有訂單編號的成功不可算成功');
assert(guard.classifyResponse('{"status":"success","orderId":"  "}').kind === 'unknown', '空白訂單編號不可算成功');
assert(guard.classifyResponse('not-json').kind === 'unknown' && guard.classifyResponse('not-json').message === guard.UNKNOWN_MESSAGE, '無法解析要顯示結果未知');
assert(guard.classifyResponse('[]').kind === 'unknown', '陣列回應要當結果未知');
assert(guard.classifyFetch({ type: 'opaque', status: 0 }, '').kind === 'unknown', '不透明回應要當結果未知');
assert(guard.classifyFetch({ type: 'basic', status: 200 }, '{"status":"error"}').kind === 'error', '有內文的錯誤仍是錯誤');
const unknownBody = guard.classifyResponse('{"status":"unknown","orderId":"SMC900401","mailed":false,"message":"結果未知，先核對試算表、勿重送"}');
assert(unknownBody.kind === 'unknown' && unknownBody.orderId === 'SMC900401' && unknownBody.message.includes('SMC900401') && unknownBody.message.includes('勿重送'), 'unknown 回應要帶訂單編號與勿重送');
const mailedOk = guard.classifyResponse('{"status":"success","orderId":"SMC900222","mailed":true}');
const mailedNo = guard.classifyResponse('{"status":"success","orderId":"SMC900222","mailed":false}');
assert(mailedOk.kind === 'success' && mailedOk.mailed === true, '收單成功且寄信成功要分開標示');
assert(mailedNo.kind === 'success' && mailedNo.mailed === false, '收單成功但寄信失敗仍是成功，並標明沒寄出');
assert(page.includes('classifyFetch') && page.includes('isolated-check-guard.js'), '驗收頁要呼叫同一套判斷');
assert(!page.includes('沒有送到'), '驗收頁不可寫沒有送到');
assert(!page.includes("className = 'ok'") || page.includes("verdict.kind === 'success'"), '綠色成功只能在判定成功之後');

function cdp(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = cdp.next++;
    cdp.pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
cdp.next = 1;
cdp.pending = new Map();

async function withPage(fn) {
  const chrome = spawn('/usr/bin/google-chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--remote-debugging-port=0',
    `--user-data-dir=/tmp/smc-isolated-check-${process.pid}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chrome debug port timeout')), 15000);
    chrome.stderr.on('data', (buf) => {
      const match = buf.toString().match(/DevTools listening on [^\n]+:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    chrome.on('exit', (code) => reject(new Error('chrome exited ' + code)));
  });
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const pageTarget = targets.find((item) => item.type === 'page') || targets[0];
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !cdp.pending.has(msg.id)) return;
    const waiter = cdp.pending.get(msg.id);
    cdp.pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)));
    else waiter.resolve(msg.result);
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  async function evalExpr(expression) {
    const result = await cdp(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  try {
    await cdp(ws, 'Page.enable');
    await cdp(ws, 'Page.navigate', { url: 'file://' + join(root, 'tools/isolated-dining-check.html') });
    await evalExpr(`new Promise((resolve) => { if (document.readyState === 'complete') setTimeout(resolve, 30); else window.addEventListener('load', () => resolve()); })`);
    await fn(evalExpr);
  } finally {
    ws.close();
    chrome.kill('SIGKILL');
  }
}

await withPage(async (evalExpr) => {
  const blocked = await evalExpr(`(() => {
    window.__fetches = 0;
    window.fetch = () => { window.__fetches += 1; return Promise.resolve({ status: 200, type: 'basic', text: () => Promise.resolve('{"status":"success","orderId":"SMC1"}') }); };
    const input = document.getElementById('endpoint');
    input.value = 'https://example.invalid/?next=script.google.com/macros/s/TEST/exec';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('booking-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const encoded = document.getElementById('endpoint');
    encoded.value = 'https://script.google.com/macros/s/${encodedLive}/exec';
    encoded.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      smuggleDisabled: document.getElementById('submit').disabled,
      encodedDisabled: document.getElementById('submit').disabled,
      fetches: window.__fetches,
      text: document.getElementById('result').textContent
    };
  })()`);
  assert(blocked.encodedDisabled === true && blocked.fetches === 0, '夾帶網址與編碼過的正式編號都不可送出');
  assert(!blocked.text.includes('已送到'), '被擋下的網址不可顯示成功');

  async function submitWith(fetchSource) {
    return evalExpr(`new Promise((resolve) => {
      window.__fetches = 0;
      const ack = document.getElementById('ack-sheet');
      if (ack && !ack.hidden) ack.click();
      window.fetch = ${fetchSource};
      const input = document.getElementById('endpoint');
      input.value = ${JSON.stringify(OK)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('email').value = 'test@example.com';
      document.getElementById('submit').click();
      setTimeout(() => resolve({
        className: document.getElementById('result').className,
        text: document.getElementById('result').textContent,
        fetches: window.__fetches
      }), 40);
    })`);
  }

  const errorUi = await submitWith(`() => { window.__fetches += 1; return Promise.resolve({ status: 200, type: 'basic', text: () => Promise.resolve('{"status":"error"}') }); }`);
  assert(errorUi.fetches === 1 && errorUi.className === 'bad' && !errorUi.text.includes('已送到'), '錯誤 JSON 不可顯示綠色成功');

  const successUi = await submitWith(`() => { window.__fetches += 1; return Promise.resolve({ status: 200, type: 'basic', text: () => Promise.resolve('{"status":"success","orderId":"SMC900222","mailed":true}') }); }`);
  assert(successUi.className === 'ok' && successUi.text.includes('SMC900222') && successUi.text.includes('寄信：已寄出'), '有訂單編號的成功才顯示綠色，並寫出寄信結果');

  const holdUi = await evalExpr(`new Promise((resolve) => {
    window.__fetches = 0;
    let release;
    window.fetch = () => {
      window.__fetches += 1;
      return new Promise((done) => { release = done; });
    };
    const input = document.getElementById('endpoint');
    input.value = ${JSON.stringify(OK)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const form = document.getElementById('booking-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const during = {
      fetches: window.__fetches,
      disabled: document.getElementById('submit').disabled,
      text: document.getElementById('result').textContent
    };
    release({
      status: 200,
      type: 'basic',
      text: () => Promise.resolve('{"status":"unknown","orderId":"SMC900401","mailed":false,"message":"結果未知，先核對試算表、勿重送"}')
    });
    setTimeout(() => {
      const after = {
        fetches: window.__fetches,
        disabled: document.getElementById('submit').disabled,
        ackHidden: document.getElementById('ack-sheet').hidden,
        className: document.getElementById('result').className,
        text: document.getElementById('result').textContent
      };
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      document.getElementById('note').value = '改備註';
      document.getElementById('note').dispatchEvent(new Event('input', { bubbles: true }));
      const afterRefresh = {
        fetches: window.__fetches,
        disabled: document.getElementById('submit').disabled,
        ackHidden: document.getElementById('ack-sheet').hidden
      };
      resolve({ during: during, after: after, afterRefresh: afterRefresh });
    }, 40);
  })`);
  assert(holdUi.during.fetches === 1 && holdUi.during.disabled === true && holdUi.during.text.includes('送出中'), '送出中連按只送一次');
  assert(holdUi.after.fetches === 1 && holdUi.after.className === 'warn' && holdUi.after.disabled === true && holdUi.after.ackHidden === false && holdUi.after.text.includes('SMC900401') && holdUi.after.text.includes('勿重送'), '寫入後未知要顯示訂單編號並鎖住');
  assert(holdUi.afterRefresh.fetches === 1 && holdUi.afterRefresh.disabled === true && holdUi.afterRefresh.ackHidden === false, 'UNKNOWN 後再按與 refresh 都不會送出或解鎖');
  console.log('test 送出鎖: pass');

  const unknownUi = await submitWith(`() => { window.__fetches += 1; return Promise.reject(new Error('network')); }`);
  assert(unknownUi.className !== 'ok' && unknownUi.text.includes('結果未知，先核對試算表、勿重送'), '網路失敗要顯示結果未知');

  const opaqueUi = await submitWith(`() => { window.__fetches += 1; return Promise.resolve({ status: 0, type: 'opaque', text: () => Promise.resolve('') }); }`);
  assert(opaqueUi.className !== 'ok' && opaqueUi.text.includes('結果未知，先核對試算表、勿重送'), '不透明回應要顯示結果未知');

  const junkUi = await submitWith(`() => { window.__fetches += 1; return Promise.resolve({ status: 200, type: 'basic', text: () => Promise.resolve('<html>oops</html>') }); }`);
  assert(junkUi.className !== 'ok' && junkUi.text.includes('結果未知，先核對試算表、勿重送'), '無法解析的回應要顯示結果未知');
});

if (failures.length) {
  console.error('isolated check failed:');
  failures.forEach((line) => console.error(' -', line));
  process.exit(1);
}
console.log('isolated check: endpoint, response verdict, and page states agree');
