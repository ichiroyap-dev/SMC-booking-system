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
assert(guard.classifyFetch({ type: 'basic', status: 500 }, '{"status":"error","message":"boom"}').kind === 'unknown', '非 2xx 一律結果未知，避免錯誤 JSON 把頁面解鎖');
assert(guard.endpointProblem('https://script.google.com/macros/s/OTHERDEPLOY/exec') !== '', '白名單以外的部署編號不可送');
const allowCount = guard.ALLOWED_DEPLOYMENT_IDS.length;
guard.ALLOWED_DEPLOYMENT_IDS.push(LIVE);
assert(guard.endpointProblem('https://script.google.com/macros/s/' + LIVE + '/exec') !== '', '正式編號即使寫進白名單也不可送');
guard.ALLOWED_DEPLOYMENT_IDS.length = allowCount;
const duplicateVerdict = guard.classifyResponse('{"status":"success","orderId":"SMC900101","duplicate":true,"wrote":false,"mailed":false,"message":"這個編號已經收過，這次沒有新增。"}');
assert(duplicateVerdict.ok === false && duplicateVerdict.kind !== 'success' && duplicateVerdict.message.includes('沒有新增'), '重複回應不可當成這次新增成功');
const unknownBody = guard.classifyResponse('{"status":"unknown","orderId":"SMC900401","mailed":false,"message":"結果未知，先核對試算表、勿重送"}');
assert(unknownBody.kind === 'unknown' && unknownBody.orderId === 'SMC900401' && unknownBody.message.includes('SMC900401') && unknownBody.message.includes('勿重送'), 'unknown 回應要帶訂單編號與勿重送');
const mailedOk = guard.classifyResponse('{"status":"success","orderId":"SMC900222","mailed":true}');
const mailedNo = guard.classifyResponse('{"status":"success","orderId":"SMC900222","mailed":false}');
assert(mailedOk.kind === 'success' && mailedOk.mailed === true, '收單成功且寄信成功要分開標示');
assert(mailedNo.kind === 'success' && mailedNo.mailed === false, '收單成功但寄信失敗仍是成功，並標明沒寄出');
const sessionStore = guard.memoryStore();
const localStore = guard.memoryStore();
assert(guard.readLock(sessionStore, localStore) === null, '還沒送出時沒有鎖');
guard.writeLock(sessionStore, localStore, 'submitting', '');
assert(JSON.parse(sessionStore.getItem(guard.LOCK_KEY)).state === 'submitting', '送出中寫進 sessionStorage');
assert(JSON.parse(localStore.getItem(guard.LOCK_KEY)).state === 'submitting', '送出中寫進 localStorage');
guard.writeLock(sessionStore, localStore, 'unknown', 'SMC900401');
const freshSession = guard.memoryStore();
const fromLocal = guard.readLock(freshSession, localStore);
assert(fromLocal && fromLocal.state === 'unknown' && fromLocal.orderId === 'SMC900401', '新分頁只看 localStorage 也讀得到鎖與訂單編號');
const sessionOnly = guard.memoryStore();
sessionOnly.setItem(guard.LOCK_KEY, JSON.stringify({ state: 'done', orderId: 'SMC900222' }));
const fromSession = guard.readLock(sessionOnly, guard.memoryStore());
assert(fromSession && fromSession.state === 'done' && fromSession.orderId === 'SMC900222', '重新整理只看 sessionStorage 也讀得到鎖與訂單編號');
guard.clearLock(sessionStore, localStore);
assert(sessionStore.getItem(guard.LOCK_KEY) === null && localStore.getItem(guard.LOCK_KEY) === null, '核對後兩種儲存的鎖都清掉');
assert(guard.readLock(sessionStore, localStore) === null, '清掉之後讀不到鎖');
sessionStore.setItem(guard.LOCK_KEY, '{"state":"idle"}');
assert(guard.readLock(sessionStore, guard.memoryStore()) === null, '不認得的狀態不當成鎖');
assert(guard.SUBMIT_TIMEOUT_MS === 30000, '送出逾時預設 30 秒');
function throwingStore() {
  return {
    getItem() { return null; },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
}
function lyingStore() {
  return {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };
}
const blockedCommit = guard.commitLock(throwingStore(), throwingStore(), 'submitting', '');
assert(blockedCommit.ok === false && blockedCommit.reason === guard.STORAGE_BLOCKED, '兩種儲存寫不進去不可當成已鎖住');
const unreadCommit = guard.commitLock(lyingStore(), guard.memoryStore(), 'submitting', '');
assert(unreadCommit.ok === false && unreadCommit.reason === guard.STORAGE_BLOCKED, '寫入後讀不回不可當成已鎖住');
const storedCommit = guard.commitLock(guard.memoryStore(), guard.memoryStore(), 'unknown', 'SMC900401');
assert(storedCommit.ok === true && storedCommit.body.includes('SMC900401'), '寫入後讀得回才算鎖住');
const secureStores = guard.storesFrom(() => { throw new Error('SecurityError'); }, () => { throw new Error('SecurityError'); });
assert(secureStores.sessionStore === null && secureStores.localStore === null, '取得儲存物件失敗要留在保護範圍內，不可讓頁面初始化中斷');
assert(guard.canPersist(secureStores.sessionStore, secureStores.localStore) === false, '拿不到儲存時不可送出');
assert(guard.locksFrom(() => { throw new Error('SecurityError'); }) === null, '取得互斥物件失敗要留在保護範圍內');
const noMutex = await guard.claimSubmit(guard.memoryStore(), guard.memoryStore(), null);
assert(noMutex.ok === false && noMutex.claimed === false && noMutex.reason === guard.MUTEX_BLOCKED, '瀏覽器沒有互斥時不可送出');
const throwingLocks = { request() { throw new Error('no locks'); } };
const thrownMutex = await guard.claimSubmit(guard.memoryStore(), guard.memoryStore(), throwingLocks);
assert(thrownMutex.ok === false && thrownMutex.claimed === false, '互斥丟出例外時不可送出');
const hungLocks = { request() { return new Promise(() => {}); } };
const hungMutex = await guard.claimSubmit(guard.memoryStore(), guard.memoryStore(), hungLocks, { waitMs: 30 });
assert(hungMutex.ok === false && hungMutex.claimed === false && hungMutex.reason === guard.MUTEX_BLOCKED, '拿不到互斥時不可送出');
function scriptedLocks() {
  let held = false;
  const queue = [];
  function pump() {
    if (!held && queue.length) queue.shift()();
  }
  return {
    request(name, callback) {
      return new Promise((resolve, reject) => {
        const run = () => {
          held = true;
          let result;
          try { result = callback(); }
          catch (err) {
            held = false;
            reject(err);
            pump();
            return;
          }
          Promise.resolve(result).then((value) => {
            held = false;
            resolve(value);
            pump();
          }, (err) => {
            held = false;
            reject(err);
            pump();
          });
        };
        if (held) queue.push(run);
        else run();
      });
    },
  };
}
const raceSession = guard.memoryStore();
const raceLocal = guard.memoryStore();
const raceLocks = scriptedLocks();
assert(guard.readLock(raceSession, raceLocal) === null, 'A 先讀到沒有鎖');
let raceFetches = 0;
const raceB = await guard.claimSubmit(raceSession, raceLocal, raceLocks);
assert(raceB.claimed === true, 'B 在 A 停住時要能取得送出權');
raceFetches += 1;
assert(guard.commitLock(raceSession, raceLocal, 'unknown', 'SMC900888').ok === true, 'B 的結果未知要寫得回去');
const raceA = await guard.claimSubmit(raceSession, raceLocal, raceLocks);
if (raceA.claimed) raceFetches += 1;
assert(raceFetches === 1, 'A 繼續後只能有 B 那一次送出');
assert(raceA.claimed === false && raceA.existing && raceA.existing.state === 'unknown' && raceA.existing.orderId === 'SMC900888', 'A 要看到 B 的結果未知，不可再占鎖');
const raceLeft = guard.readLock(raceSession, raceLocal);
assert(raceLeft && raceLeft.state === 'unknown' && raceLeft.orderId === 'SMC900888', 'SMC900888 這個結果未知的編號要保留下來');
console.log('test 讀寫鎖交錯只送一次: pass');
const guardSource = readFileSync(join(root, 'tools/isolated-check-guard.js'), 'utf8');
const insideStart = guardSource.indexOf('function claimInsideMutex');
const insideEnd = guardSource.indexOf('function claimSubmit');
const inside = guardSource.slice(insideStart, insideEnd);
const read1 = inside.indexOf('readLock');
const writeAt = inside.indexOf('commitLock');
const read2 = inside.indexOf('readLock', read1 + 1);
assert(read1 >= 0 && writeAt > read1 && read2 > writeAt, '互斥區內要先重讀、再寫入、再讀回');
assert(page.includes('classifyFetch') && page.includes('isolated-check-guard.js'), '驗收頁要呼叫同一套判斷');
assert(page.includes('commitLock') && page.includes('readLock') && page.includes('sessionStorage') && page.includes('localStorage') && page.includes('AbortController'), '驗收頁要把鎖寫進兩種儲存並讀回，並用 AbortController 逾時');
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
    async function reload() {
      const loaded = new Promise((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), 5000);
        const onMsg = (event) => {
          let msg;
          try { msg = JSON.parse(event.data); } catch (err) { return; }
          if (msg.method === 'Page.loadEventFired' || msg.method === 'Page.frameStoppedLoading') {
            clearTimeout(timer);
            ws.removeEventListener('message', onMsg);
            resolve(msg.method);
          }
        };
        ws.addEventListener('message', onMsg);
      });
      await evalExpr('location.reload()');
      await loaded;
      await evalExpr('new Promise((resolve) => setTimeout(resolve, 40))');
    }
    await fn(evalExpr, reload, (method, params) => cdp(ws, method, params));
  } finally {
    ws.close();
    chrome.kill('SIGKILL');
  }
}

await withPage(async (evalExpr, reload, cdpCall) => {
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
        fetches: window.__fetches,
        disabled: document.getElementById('submit').disabled,
        ackHidden: document.getElementById('ack-sheet').hidden
      }), 40);
    })`);
  }

  const errorUi = await submitWith(`() => { window.__fetches += 1; return Promise.resolve({ status: 200, type: 'basic', text: () => Promise.resolve('{"status":"error"}') }); }`);
  assert(errorUi.fetches === 1 && errorUi.className === 'bad' && !errorUi.text.includes('已送到'), '錯誤 JSON 不可顯示綠色成功');

  const httpUi = await submitWith(`() => { window.__fetches += 1; return Promise.resolve({ status: 500, type: 'basic', text: () => Promise.resolve('{"status":"error","message":"boom"}') }); }`);
  assert(httpUi.fetches === 1 && httpUi.className === 'warn' && httpUi.text.includes('結果未知') && !httpUi.text.includes('已送到'), '非 2xx 要當結果未知');
  assert(httpUi.disabled === true && httpUi.ackHidden === false, '非 2xx 不可把頁面解鎖');

  const successUi = await submitWith(`() => { window.__fetches += 1; return Promise.resolve({ status: 200, type: 'basic', text: () => Promise.resolve('{"status":"success","orderId":"SMC900222","mailed":true}') }); }`);
  assert(successUi.className === 'ok' && successUi.text.includes('SMC900222') && successUi.text.includes('寄信：已寄出'), '有訂單編號的成功才顯示綠色，並寫出寄信結果');

  const partialMail = await submitWith(`() => { window.__fetches += 1; return Promise.resolve({ status: 200, type: 'basic', text: () => Promise.resolve('{"status":"success","orderId":"SMC900333","mailed":false}') }); }`);
  assert(partialMail.className === 'ok' && partialMail.text.includes('SMC900333') && partialMail.text.includes('未全部寄出，請核對信箱'), '寄信沒有全部成功時要寫未全部寄出');

  const holdUi = await evalExpr(`new Promise((resolve) => {
    const ack = document.getElementById('ack-sheet');
    if (ack && !ack.hidden) ack.click();
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
    const finishDuring = () => {
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
    };
    const waitFetch = () => {
      if (typeof release === 'function') {
        finishDuring();
        return;
      }
      setTimeout(waitFetch, 10);
    };
    waitFetch();
  })`);
  assert(holdUi.during.fetches === 1 && holdUi.during.disabled === true && holdUi.during.text.includes('送出中'), '送出中連按只送一次');
  assert(holdUi.after.fetches === 1 && holdUi.after.className === 'warn' && holdUi.after.disabled === true && holdUi.after.ackHidden === false && holdUi.after.text.includes('SMC900401') && holdUi.after.text.includes('勿重送'), '寫入後未知要顯示訂單編號並鎖住');
  assert(holdUi.afterRefresh.fetches === 1 && holdUi.afterRefresh.disabled === true && holdUi.afterRefresh.ackHidden === false, 'UNKNOWN 後再按與 refresh 都不會送出或解鎖');
  console.log('test 送出鎖: pass');

  const lockKey = JSON.stringify(guard.LOCK_KEY);
  const storedDuringHold = await evalExpr(`(() => ({
    session: sessionStorage.getItem(${lockKey}),
    local: localStorage.getItem(${lockKey})
  }))()`);
  assert(storedDuringHold.session && storedDuringHold.session.includes('"state":"unknown"') && storedDuringHold.session.includes('SMC900401'), 'UNKNOWN 要寫進 sessionStorage');
  assert(storedDuringHold.local && storedDuringHold.local.includes('"state":"unknown"') && storedDuringHold.local.includes('SMC900401'), 'UNKNOWN 要寫進 localStorage');

  await reload();
  const restored = await evalExpr(`new Promise((resolve) => {
    window.__fetches = 0;
    window.fetch = () => { window.__fetches += 1; return new Promise(() => {}); };
    document.getElementById('note').value = '重新整理後改備註';
    document.getElementById('note').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('booking-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    setTimeout(() => resolve({
      fetches: window.__fetches,
      disabled: document.getElementById('submit').disabled,
      ackHidden: document.getElementById('ack-sheet').hidden,
      text: document.getElementById('result').textContent
    }), 40);
  })`);
  assert(restored.fetches === 0 && restored.disabled === true && restored.ackHidden === false && restored.text.includes('SMC900401') && restored.text.includes('勿重送'), '重新整理後仍鎖住並保留訂單編號');
  console.log('test 重新整理還原鎖: pass');

  await evalExpr(`sessionStorage.removeItem(${lockKey})`);
  const localBeforeNewTab = await evalExpr(`localStorage.getItem(${lockKey})`);
  assert(localBeforeNewTab && localBeforeNewTab.includes('SMC900401'), '清掉這個分頁的 session 後，localStorage 仍留著鎖');
  await reload();
  const newTab = await evalExpr(`new Promise((resolve) => {
    window.__fetches = 0;
    window.fetch = () => { window.__fetches += 1; return new Promise(() => {}); };
    document.getElementById('booking-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    setTimeout(() => resolve({
      fetches: window.__fetches,
      disabled: document.getElementById('submit').disabled,
      ackHidden: document.getElementById('ack-sheet').hidden,
      text: document.getElementById('result').textContent,
      session: sessionStorage.getItem(${lockKey})
    }), 40);
  })`);
  assert(newTab.fetches === 0 && newTab.disabled === true && newTab.ackHidden === false && newTab.text.includes('SMC900401') && newTab.session && newTab.session.includes('"state":"unknown"'), '新分頁只靠 localStorage 也會鎖住並保留訂單編號');
  console.log('test 新分頁還原鎖: pass');

  const unknownUi = await submitWith(`() => { window.__fetches += 1; return Promise.reject(new Error('network')); }`);
  assert(unknownUi.className !== 'ok' && unknownUi.text.includes('結果未知，先核對試算表、勿重送'), '網路失敗要顯示結果未知');

  const opaqueUi = await submitWith(`() => { window.__fetches += 1; return Promise.resolve({ status: 0, type: 'opaque', text: () => Promise.resolve('') }); }`);
  assert(opaqueUi.className !== 'ok' && opaqueUi.text.includes('結果未知，先核對試算表、勿重送'), '不透明回應要顯示結果未知');

  const junkUi = await submitWith(`() => { window.__fetches += 1; return Promise.resolve({ status: 200, type: 'basic', text: () => Promise.resolve('<html>oops</html>') }); }`);
  assert(junkUi.className !== 'ok' && junkUi.text.includes('結果未知，先核對試算表、勿重送'), '無法解析的回應要顯示結果未知');

  const timeoutUi = await evalExpr(`new Promise((resolve) => {
    const ack = document.getElementById('ack-sheet');
    if (ack && !ack.hidden) ack.click();
    window.SmcIsolatedCheck.SUBMIT_TIMEOUT_MS = 40;
    window.__fetches = 0;
    window.fetch = (url, opts) => {
      window.__fetches += 1;
      return new Promise((resolveFetch, rejectFetch) => {
        const signal = opts && opts.signal;
        if (signal) signal.addEventListener('abort', () => rejectFetch(new DOMException('Aborted', 'AbortError')));
      });
    };
    const input = document.getElementById('endpoint');
    input.value = ${JSON.stringify(OK)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('submit').click();
    setTimeout(() => {
      const mid = window.__fetches;
      document.getElementById('booking-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      resolve({
        mid: mid,
        fetches: window.__fetches,
        className: document.getElementById('result').className,
        text: document.getElementById('result').textContent,
        disabled: document.getElementById('submit').disabled,
        ackHidden: document.getElementById('ack-sheet').hidden,
        lock: localStorage.getItem(${lockKey})
      });
    }, 160);
  })`);
  assert(timeoutUi.mid === 1 && timeoutUi.fetches === 1, '逾時後再按不會重送');
  assert(timeoutUi.className !== 'ok' && timeoutUi.text.includes('結果未知，先核對試算表、勿重送'), '逾時要當結果未知，不是成功');
  assert(timeoutUi.disabled === true && timeoutUi.ackHidden === false, '逾時後頁面仍鎖住');
  assert(timeoutUi.lock && timeoutUi.lock.includes('"state":"unknown"'), '逾時的鎖要寫進 localStorage');
  console.log('test 送出逾時: pass');

  const beginAt = page.indexOf('function beginClaim');
  const submitAt = page.indexOf("addEventListener('submit'");
  const rereadAt = page.indexOf('readLock', submitAt);
  const claimCall = page.indexOf('beginClaim()', submitAt);
  const claimAt = page.indexOf('claimSubmit', beginAt);
  const fetchAt = page.indexOf('fetch(url', beginAt);
  assert(rereadAt > submitAt && claimCall > rereadAt, '送出前要先重讀鎖，沒有鎖才進入互斥');
  assert(claimAt > beginAt && fetchAt > claimAt, '取得跨分頁互斥並確認鎖之後才送出');

  const priorTab = await evalExpr(`new Promise((resolve) => {
    const ack = document.getElementById('ack-sheet');
    if (ack && !ack.hidden) ack.click();
    sessionStorage.removeItem(${lockKey});
    localStorage.setItem(${lockKey}, JSON.stringify({ state: 'unknown', orderId: 'SMC900888' }));
    window.__fetches = 0;
    window.fetch = () => {
      window.__fetches += 1;
      return Promise.resolve({ status: 200, type: 'basic', text: () => Promise.resolve('{"status":"success","orderId":"SMC900999","mailed":true}') });
    };
    const input = document.getElementById('endpoint');
    input.value = ${JSON.stringify(OK)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('submit').click();
    setTimeout(() => resolve({
      fetches: window.__fetches,
      disabled: document.getElementById('submit').disabled,
      ackHidden: document.getElementById('ack-sheet').hidden,
      className: document.getElementById('result').className,
      text: document.getElementById('result').textContent,
      lock: localStorage.getItem(${lockKey})
    }), 40);
  })`);
  assert(priorTab.fetches === 0, '事先開啟的分頁在別頁鎖住後不可再送');
  assert(priorTab.disabled === true && priorTab.ackHidden === false, '事先開啟的分頁要改成鎖住');
  assert(priorTab.text.includes('SMC900888') && priorTab.text.includes('勿重送'), '事先開啟的分頁要顯示已存在的訂單編號');
  assert(priorTab.lock && priorTab.lock.includes('"state":"unknown"') && priorTab.lock.includes('SMC900888') && !priorTab.lock.includes('submitting'), '事先開啟的分頁不可把別人的未知鎖覆寫成空編號');
  assert(priorTab.className !== 'ok' && !priorTab.text.includes('已送到'), '事先開啟的分頁不可顯示成功');
  console.log('test 事先開啟的分頁不可重送: pass');

  const lateUi = await evalExpr(`new Promise((resolve) => {
    const ack = document.getElementById('ack-sheet');
    if (ack && !ack.hidden) ack.click();
    window.SmcIsolatedCheck.SUBMIT_TIMEOUT_MS = 40;
    window.__fetches = 0;
    window.fetch = () => {
      window.__fetches += 1;
      return new Promise((resolveFetch) => {
        setTimeout(() => resolveFetch({
          status: 200,
          type: 'basic',
          text: () => Promise.resolve('{"status":"success","orderId":"SMC900777","mailed":true}')
        }), 150);
      });
    };
    const input = document.getElementById('endpoint');
    input.value = ${JSON.stringify(OK)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('submit').click();
    setTimeout(() => resolve({
      fetches: window.__fetches,
      className: document.getElementById('result').className,
      text: document.getElementById('result').textContent,
      disabled: document.getElementById('submit').disabled,
      ackHidden: document.getElementById('ack-sheet').hidden,
      lock: localStorage.getItem(${lockKey})
    }), 260);
  })`);
  assert(lateUi.fetches === 1 && lateUi.className === 'warn' && lateUi.text.includes('結果未知，先核對試算表、勿重送'), '逾時後晚到的成功不可翻成綠燈');
  assert(!lateUi.text.includes('已送到') && !lateUi.text.includes('SMC900777'), '晚到的訂單編號不可覆蓋未知結果');
  assert(lateUi.disabled === true && lateUi.ackHidden === false, '晚到的成功不可把頁面解鎖');
  assert(lateUi.lock && lateUi.lock.includes('"state":"unknown"') && !lateUi.lock.includes('SMC900777'), '晚到的成功不可把鎖改成完成');
  console.log('test 逾時後晚到的成功: pass');

  const crossed = await evalExpr(`(async () => {
    const ack = document.getElementById('ack-sheet');
    if (ack && !ack.hidden) ack.click();
    sessionStorage.removeItem(${lockKey});
    localStorage.removeItem(${lockKey});
    window.__fetches = 0;
    window.fetch = () => {
      window.__fetches += 1;
      return Promise.resolve({ status: 200, type: 'basic', text: () => Promise.resolve('{"status":"success","orderId":"SMC1","mailed":true}') });
    };
    let release;
    const paused = new Promise((resolve) => { release = resolve; });
    window.__smcYieldBeforeClaim = () => paused;
    const input = document.getElementById('endpoint');
    input.value = ${JSON.stringify(OK)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('submit').click();
    const seen = window.SmcIsolatedCheck.readLock(sessionStorage, localStorage);
    const b = await window.SmcIsolatedCheck.claimSubmit(sessionStorage, localStorage, navigator.locks);
    if (b && b.claimed) {
      window.__fetches += 1;
      window.SmcIsolatedCheck.commitLock(sessionStorage, localStorage, 'unknown', 'SMC900888');
    }
    release();
    await new Promise((resolve) => setTimeout(resolve, 40));
    return {
      seenEmpty: !seen,
      bClaimed: !!(b && b.claimed),
      fetches: window.__fetches,
      disabled: document.getElementById('submit').disabled,
      text: document.getElementById('result').textContent,
      lock: localStorage.getItem(${lockKey})
    };
  })()`);
  assert(crossed.seenEmpty === true && crossed.bClaimed === true, 'A 讀到沒有鎖並停住時，B 要能送出');
  assert(crossed.fetches === 1, 'A 繼續後頁面不可再送出第二次');
  assert(crossed.disabled === true && crossed.text.includes('SMC900888') && crossed.text.includes('勿重送'), 'A 要停在 B 的結果未知');
  assert(crossed.lock && crossed.lock.includes('"state":"unknown"') && crossed.lock.includes('SMC900888') && !crossed.lock.includes('"state":"submitting"'), 'SMC900888 不可被 A 蓋掉');
  console.log('test 事先開啟的分頁讀寫交錯: pass');

  const noLockUi = await evalExpr(`(async () => {
    const ack = document.getElementById('ack-sheet');
    if (ack && !ack.hidden) ack.click();
    const original = window.SmcIsolatedCheck.locksFrom;
    window.SmcIsolatedCheck.locksFrom = function () { return null; };
    window.__fetches = 0;
    window.fetch = () => { window.__fetches += 1; return new Promise(() => {}); };
    const input = document.getElementById('endpoint');
    input.value = ${JSON.stringify(OK)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('booking-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const blocked = {
      fetches: window.__fetches,
      disabled: document.getElementById('submit').disabled,
      text: document.getElementById('result').textContent
    };
    window.SmcIsolatedCheck.locksFrom = original;
    return blocked;
  })()`);
  assert(noLockUi.fetches === 0 && noLockUi.disabled === true && noLockUi.text.includes('無法鎖定這次送出'), '瀏覽器不支援互斥時要停用送出並顯示原因');
  await reload();

  const hungUi = await evalExpr(`(async () => {
    const ack = document.getElementById('ack-sheet');
    if (ack && !ack.hidden) ack.click();
    const original = window.SmcIsolatedCheck.locksFrom;
    window.SmcIsolatedCheck.locksFrom = function () {
      return { request: function () { return new Promise(function () {}); } };
    };
    window.SmcIsolatedCheck.setMutexWaitMs(40);
    window.__fetches = 0;
    window.fetch = () => { window.__fetches += 1; return new Promise(() => {}); };
    const input = document.getElementById('endpoint');
    input.value = ${JSON.stringify(OK)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('booking-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const blocked = {
      fetches: window.__fetches,
      disabled: document.getElementById('submit').disabled,
      text: document.getElementById('result').textContent
    };
    window.SmcIsolatedCheck.locksFrom = original;
    window.SmcIsolatedCheck.setMutexWaitMs(5000);
    return blocked;
  })()`);
  assert(hungUi.fetches === 0 && hungUi.disabled === true && hungUi.text.includes('無法鎖定這次送出'), '拿不到互斥時要停用送出並顯示原因');
  console.log('test 沒有互斥時停用送出: pass');
  await reload();

  const storageBlocked = await evalExpr(`new Promise((resolve) => {
    const ack = document.getElementById('ack-sheet');
    if (ack && !ack.hidden) ack.click();
    Storage.prototype.setItem = function () { throw new Error('storage blocked'); };
    window.__fetches = 0;
    window.fetch = () => {
      window.__fetches += 1;
      return Promise.resolve({ status: 200, type: 'basic', text: () => Promise.resolve('{"status":"success","orderId":"SMC1","mailed":true}') });
    };
    const input = document.getElementById('endpoint');
    input.value = ${JSON.stringify(OK)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('booking-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    setTimeout(() => resolve({
      fetches: window.__fetches,
      disabled: document.getElementById('submit').disabled,
      text: document.getElementById('result').textContent
    }), 40);
  })`);
  assert(storageBlocked.fetches === 0, '存不了鎖時不可送出');
  assert(storageBlocked.disabled === true && storageBlocked.text.includes('存不了這次的鎖'), '存不了鎖時要停用送出並顯示原因');

  await cdpCall('Page.addScriptToEvaluateOnNewDocument', {
    source: `Storage.prototype.setItem = function () { throw new Error('storage blocked'); };
      window.__fetches = 0;
      window.fetch = function () { window.__fetches += 1; return new Promise(function () {}); };`,
  });
  await reload();
  const storageReload = await evalExpr(`new Promise((resolve) => {
    const input = document.getElementById('endpoint');
    input.value = ${JSON.stringify(OK)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('booking-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    setTimeout(() => resolve({
      fetches: window.__fetches || 0,
      disabled: document.getElementById('submit').disabled,
      text: document.getElementById('result').textContent
    }), 40);
  })`);
  assert(storageReload.fetches === 0 && storageReload.disabled === true && storageReload.text.includes('存不了這次的鎖'), '重新載入後儲存仍失敗時，送出鍵維持停用且沒有送出');
  console.log('test 儲存失敗與重新載入: pass');
});

if (failures.length) {
  console.error('isolated check failed:');
  failures.forEach((line) => console.error(' -', line));
  process.exit(1);
}
console.log('isolated check: endpoint, response verdict, and page states agree');
