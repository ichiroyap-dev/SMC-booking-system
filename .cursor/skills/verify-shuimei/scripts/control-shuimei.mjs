#!/usr/bin/env node
// Local verification harness for the 水美土雞城 static site.
// Serves the repo on 127.0.0.1, drives headless Chrome, and refuses every
// mutation plus every host outside the read-only allowlist. It never posts
// to Apps Script, Sheets, LINE, or mail.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, statSync, realpathSync } from 'node:fs';
import { dirname, join, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = realpathSync(join(scriptDir, '../../../..'));
const ALLOW_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);
const BOOKING_HOSTS = [
  'script.google.com',
  'script.googleusercontent.com',
  'docs.google.com',
  'sheets.google.com',
  'sheets.googleapis.com',
  'line.me',
  'line-apps.com',
  'line.naver.jp',
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const AX_ROLES = new Set([
  'heading', 'link', 'button', 'tab', 'radio', 'checkbox', 'textbox',
  'combobox', 'status', 'paragraph', 'listitem',
]);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function runId() {
  const raw = process.env.SHUIMEI_RUN_ID || 'local';
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(raw)) {
    throw new Error('SHUIMEI_RUN_ID must be 1-40 letters, digits, _ or -');
  }
  return raw;
}

function dirs(id = runId()) {
  return {
    id,
    stateDir: `/tmp/shuimei-verify/${id}`,
    evidenceDir: `/tmp/shuimei-verify-evidence/${id}`,
  };
}

function statePath(id) {
  return join(dirs(id).stateDir, 'state.json');
}

function readState() {
  const file = statePath(runId());
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function assertSupportedRuntime() {
  if (process.platform !== 'linux') {
    throw new Error('This harness is Linux/cloud-agent only. Refusing to start.');
  }
  const major = Number(String(process.versions.node || '0').split('.')[0]);
  if (major < 22 || typeof WebSocket !== 'function') {
    throw new Error('Node 22+ with a global WebSocket is required. Refusing to start Chrome. This harness is Linux/cloud-agent only.');
  }
}

function chromeBinary() {
  return process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
}

function assertChromePresent() {
  const bin = chromeBinary();
  if (!existsSync(bin)) throw new Error(`Chrome is required but was not found at ${bin}`);
  return bin;
}

function killTree(pid) {
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone, or not a process group */ }
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
}

function readPidFile(id = runId()) {
  const file = join(dirs(id).stateDir, 'pids.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function killRecordedChrome() {
  const pids = readPidFile();
  if (pids.chromePid) killTree(pids.chromePid);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hostMatches(host, bases) {
  return bases.some((base) => host === base || host.endsWith(`.${base}`));
}

function decisionFor(url, method) {
  const upper = String(method || 'GET').toUpperCase();
  if (upper !== 'GET' && upper !== 'HEAD') {
    return { decision: 'blocked', reason: 'mutation' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { decision: 'blocked', reason: 'bad-url' };
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
    return { decision: 'continue', reason: 'inline' };
  }
  const host = parsed.hostname.toLowerCase();
  if (ALLOW_HOSTS.has(host)) return { decision: 'continue', reason: 'allowlist' };
  if (hostMatches(host, BOOKING_HOSTS)) return { decision: 'blocked', reason: 'booking-host' };
  return { decision: 'blocked', reason: 'not-allowlisted' };
}

function safeRepoFile(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent((urlPath || '/').split('?')[0]);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!rel || rel.split('/').some((part) => part === '..' || part === '')) return null;
  const blockedName = rel.split('/').some((part) => (
    part === '.git' || part === '.env' || part.startsWith('.env') || part === 'tokens.json'
  ));
  if (blockedName || /\.(pem|key)$/i.test(rel)) return null;
  const candidate = resolve(repoRoot, rel);
  if (candidate !== repoRoot && !candidate.startsWith(repoRoot + sep)) return null;
  if (!existsSync(candidate)) return null;
  let resolved;
  try {
    resolved = realpathSync(candidate);
  } catch {
    return null;
  }
  if (resolved !== repoRoot && !resolved.startsWith(repoRoot + sep)) return null;
  if (!statSync(resolved).isFile()) return null;
  return resolved;
}

function evidenceFile(evidenceDir, relPath) {
  if (!relPath || typeof relPath !== 'string') throw new Error('path is required');
  const target = relPath.startsWith('/') ? resolve(relPath) : resolve(evidenceDir, relPath);
  const root = resolve(evidenceDir);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`evidence path must stay inside ${root}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  return target;
}

function controlRequest(state, op, extra = {}) {
  const body = JSON.stringify({ op, ...extra });
  return fetch(`http://127.0.0.1:${state.controlPort}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }).then(async (res) => {
    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { ok: false, error: text };
    }
    if (!res.ok || payload.ok === false) throw new Error(payload.error || `control ${res.status}`);
    return payload;
  });
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws = new WebSocket(wsUrl);
    this.open = new Promise((resolvePromise, reject) => {
      this.ws.addEventListener('open', () => resolvePromise());
      this.ws.addEventListener('error', () => reject(new Error('chrome devtools socket failed')));
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve: ok, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else ok(msg.result || {});
        return;
      }
      if (msg.method) {
        const params = msg.params || {};
        if (msg.sessionId && params.sessionId == null) params.sessionId = msg.sessionId;
        for (const handler of this.listeners.get(msg.method) || []) handler(params);
      }
    });
  }

  on(method, handler) {
    const list = this.listeners.get(method) || [];
    list.push(handler);
    this.listeners.set(method, list);
  }

  send(method, params = {}, sessionId) {
    return new Promise((resolvePromise, reject) => {
      const id = this.nextId;
      this.nextId += 1;
      this.pending.set(id, { resolve: resolvePromise, reject });
      const message = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      this.open.then(() => this.ws.send(JSON.stringify(message))).catch(reject);
    });
  }

  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

async function daemon() {
  assertSupportedRuntime();
  const id = runId();
  const { stateDir, evidenceDir } = dirs(id);
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  const logFile = join(stateDir, 'daemon.log');
  const log = (line) => appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  const token = randomBytes(8).toString('hex');
  const head = gitHead();
  const networkLog = join(evidenceDir, 'network.jsonl');
  writeFileSync(networkLog, '');

  const site = createServer((req, res) => {
    const file = safeRepoFile(req.url || '/');
    if (!file) {
      res.writeHead(404, { 'X-Shuimei-Verify': `${id}:${process.pid}`, 'Cache-Control': 'no-store' });
      res.end('not found');
      return;
    }
    const ext = file.slice(file.lastIndexOf('.'));
    const body = readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Shuimei-Verify': `${id}:${process.pid}`,
      'X-Shuimei-Head': head,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });
  await new Promise((resolvePromise) => site.listen(0, '127.0.0.1', resolvePromise));
  const sitePort = site.address().port;
  const siteUrl = `http://127.0.0.1:${sitePort}/`;
  log(`site ${siteUrl}`);

  const chromeBin = assertChromePresent();
  const userDataDir = join(stateDir, 'chrome-profile');
  mkdirSync(userDataDir, { recursive: true });
  const blockedHostRules = BOOKING_HOSTS
    .flatMap((host) => [`MAP ${host} 127.0.0.1`, `MAP *.${host} 127.0.0.1`])
    .join(', ');
  const chrome = spawn(chromeBin, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-sync',
    '--no-first-run',
    '--metrics-recording-only',
    '--remote-debugging-port=0',
    `--host-resolver-rules=${blockedHostRules}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  writeFileSync(join(stateDir, 'pids.json'), JSON.stringify({
    daemonPid: process.pid,
    chromePid: chrome.pid,
  }));
  const debugPort = await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('chrome debug port timeout')), 15000);
    const onData = (buf) => {
      const match = buf.toString().match(/DevTools listening on [^\n]+:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      chrome.stderr.off('data', onData);
      resolvePromise(match[1]);
    };
    chrome.stderr.on('data', onData);
    chrome.on('exit', (code) => reject(new Error(`chrome exited ${code}`)));
  });
  log(`chrome pid ${chrome.pid} debug ${debugPort}`);
  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((res) => res.json());
  const page = targets.find((item) => item.type === 'page') || targets[0];
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open;
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const record = (entry) => {
    appendFileSync(networkLog, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);
  };
  cdp.on('Fetch.requestPaused', (params) => {
    const url = params.request?.url || '';
    const method = params.request?.method || 'GET';
    const choice = decisionFor(url, method);
    record({ method, url, host: hostOf(url), resourceType: params.resourceType || '', ...choice });
    if (choice.decision === 'continue') {
      cdp.send('Fetch.continueRequest', { requestId: params.requestId }).catch((err) => log(`continue ${err.message}`));
    } else {
      cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch((err) => log(`block ${err.message}`));
    }
  });

  const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((res) => res.json());
  const browserCdp = new Cdp(version.webSocketDebuggerUrl);
  await browserCdp.open;
  const mainTargetId = page.id;
  browserCdp.on('Target.attachedToTarget', (params) => {
    const info = params.targetInfo || {};
    const sessionId = params.sessionId;
    if (info.type === 'page' && info.targetId && info.targetId !== mainTargetId) {
      record({
        method: 'GET',
        url: info.url || 'about:blank',
        host: hostOf(info.url || 'about:blank'),
        decision: 'blocked',
        reason: 'extra-target',
      });
      if (sessionId) {
        browserCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId)
          .catch((err) => log(`extra fetch ${err.message}`));
      }
      browserCdp.send('Target.closeTarget', { targetId: info.targetId }).catch((err) => log(`close target ${err.message}`));
      return;
    }
    if ((info.type === 'worker' || info.type === 'service_worker') && sessionId) {
      const resume = () => {
        if (!params.waitingForDebugger) return;
        browserCdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch((err) => log(`resume ${err.message}`));
      };
      browserCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId)
        .then(resume, (err) => { log(`worker fetch ${err.message}`); resume(); });
      return;
    }
    if (params.waitingForDebugger && sessionId) {
      browserCdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch((err) => log(`resume ${err.message}`));
    }
  });
  browserCdp.on('Fetch.requestPaused', (params) => {
    const url = params.request?.url || '';
    const method = params.request?.method || 'GET';
    const choice = decisionFor(url, method);
    record({ method, url, host: hostOf(url), resourceType: params.resourceType || '', ...choice, session: 'extra' });
    browserCdp.send('Fetch.failRequest', {
      requestId: params.requestId,
      errorReason: 'BlockedByClient',
    }, params.sessionId).catch((err) => log(`extra block ${err.message}`));
  });
  await browserCdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
  });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__shuimeiVerify=${JSON.stringify(token)};`,
  });

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'eval failed';
      throw new Error(text);
    }
    return result.result?.value;
  }

  async function markPage() {
    await evaluate(`window.__shuimeiVerify = ${JSON.stringify(token)};`);
  }

  async function navigate(url) {
    let finished = false;
    const loaded = new Promise((resolvePromise) => {
      const timer = setTimeout(() => resolvePromise(), 8000);
      cdp.on('Page.loadEventFired', () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolvePromise();
      });
    });
    await cdp.send('Page.navigate', { url });
    await loaded;
    await markPage();
  }

  await navigate(siteUrl);
  const started = Date.now();
  let styled = false;
  while (Date.now() - started < 10000) {
    const probe = await evaluate(`(() => {
      const form = document.getElementById('bookingForm');
      const title = document.getElementById('brand-title');
      const size = title ? parseFloat(getComputedStyle(title).fontSize) : 0;
      return { form: !!form, title: title ? title.textContent : '', size };
    })()`);
    if (probe && probe.form && String(probe.title).includes('水美土雞城')) {
      styled = probe.size >= 40;
      if (styled) break;
    }
    await sleep(200);
  }
  const usable = await evaluate(`!!document.getElementById('bookingForm') && (document.getElementById('brand-title') || {}).textContent`);
  if (!String(usable).includes('水美土雞城')) throw new Error('homepage did not reach a usable booking form');
  log(`ready styled=${styled}`);

  async function axNodes() {
    const tree = await cdp.send('Accessibility.getFullAXTree');
    return tree.nodes || [];
  }

  async function partialAx(selector) {
    try {
      const doc = await cdp.send('DOM.getDocument', { depth: 0 });
      const found = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
      if (!found.nodeId) return [];
      const described = await cdp.send('DOM.describeNode', { nodeId: found.nodeId });
      const backendNodeId = described.node?.backendNodeId;
      if (!backendNodeId) return [];
      const tree = await cdp.send('Accessibility.getPartialAXTree', { backendNodeId });
      return tree.nodes || [];
    } catch {
      return [];
    }
  }

  function axName(node) {
    return String(node.name?.value || '').replace(/\s+/g, ' ').trim();
  }

  function axRole(node) {
    return String(node.role?.value || '').toLowerCase();
  }

  async function clickNode(node) {
    if (!node.backendDOMNodeId) throw new Error('accessibility node has no DOM id');
    const resolved = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId });
    const objectId = resolved.object?.objectId;
    if (!objectId) throw new Error('could not resolve accessibility node');
    const result = await cdp.send('Runtime.callFunctionOn', {
      objectId,
      returnByValue: true,
      functionDeclaration: `function() {
        const href = this.href || this.getAttribute?.('href') || '';
        if (/^(tel:|mailto:)/i.test(href)) return 'refuse-external';
        try {
          const url = new URL(href, location.href);
          if (url.hostname && url.hostname !== location.hostname) return 'refuse-external';
        } catch (err) {}
        const id = this.id || '';
        const label = (this.getAttribute?.('aria-label') || this.textContent || '').replace(/\\s+/g, ' ').trim();
        if (id === 'submitBtn' || id === 'cancelSubmitBtn' || /送出預約申請|確認取消此筆預約/.test(label)) {
          return 'refuse-submit';
        }
        if (this.type === 'radio' || this.type === 'checkbox') {
          this.checked = true;
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
          return 'ok';
        }
        this.click();
        return 'ok';
      }`,
    });
    return result.result?.value;
  }

  const control = createServer(async (req, res) => {
    const remote = req.socket.remoteAddress || '';
    if (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1' && remote !== '::1') {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const payload = await handle(body);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, ...payload }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });

  async function handle(body) {
    if (body.op === 'doctor') {
      const pageInfo = await evaluate(`({
        href: location.href,
        title: document.title,
        token: window.__shuimeiVerify || '',
        form: !!document.getElementById('bookingForm'),
        brand: (document.getElementById('brand-title') || document.querySelector('h1') || {}).textContent || ''
      })`);
      return { pageInfo, styled, siteUrl, runId: id, head, pid: process.pid, chromePid: chrome.pid };
    }
    if (body.op === 'open') {
      const path = String(body.path || '/');
      if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
        throw new Error('open path must be a site-relative path');
      }
      await navigate(new URL(path, siteUrl).toString());
      return { href: await evaluate('location.href') };
    }
    if (body.op === 'click') {
      if (body.selector) {
        const outcome = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(body.selector)});
          if (!el) return 'missing';
          const id = el.id || '';
          const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
          if (id === 'submitBtn' || id === 'cancelSubmitBtn' || /送出預約申請|確認取消此筆預約/.test(label)) return 'refuse-submit';
          const href = el.href || el.getAttribute('href') || '';
          if (/^(tel:|mailto:)/i.test(href)) return 'refuse-external';
          try {
            const url = new URL(href, location.href);
            if (url.hostname && url.hostname !== location.hostname) return 'refuse-external';
          } catch (err) {}
          if (el.type === 'radio' || el.type === 'checkbox') {
            el.checked = true;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return 'ok';
          }
          el.click();
          return 'ok';
        })()`);
        if (outcome === 'missing') throw new Error(`selector not found: ${body.selector}`);
        if (outcome === 'refuse-submit') throw new Error('refused: verification does not submit booking or cancel');
        if (outcome === 'refuse-external') throw new Error('refused: verification does not open external or tel links');
        return { clicked: body.selector };
      }
      const role = String(body.role || '').toLowerCase();
      const name = String(body.name || '').replace(/\s+/g, ' ').trim();
      if (!role || !name) throw new Error('click needs --role and --name, or --selector');
      const nodes = await axNodes();
      const matches = nodes.filter((node) => axRole(node) === role && axName(node) && (
        axName(node) === name || axName(node).startsWith(`${name} `)
      ));
      if (!matches.length) {
        const nearby = nodes.filter((node) => axRole(node) === role).map(axName).filter(Boolean).slice(0, 12);
        throw new Error(`no ${role} named ${name}. nearby: ${nearby.join(' | ') || '(none)'}`);
      }
      matches.sort((a, b) => axName(a).length - axName(b).length);
      const outcome = await clickNode(matches[0]);
      if (outcome === 'refuse-submit') throw new Error('refused: verification does not submit booking or cancel');
      if (outcome === 'refuse-external') throw new Error('refused: verification does not open external or tel links');
      return { clicked: axName(matches[0]), role };
    }
    if (body.op === 'fill') {
      const selector = String(body.selector || '');
      const value = String(body.value ?? '');
      const outcome = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'missing';
        if (el.id === 'submitBtn' || el.id === 'cancelSubmitBtn') return 'refuse-submit';
        el.focus();
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'ok';
      })()`);
      if (outcome === 'missing') throw new Error(`selector not found: ${selector}`);
      if (outcome === 'refuse-submit') throw new Error('refused: verification does not submit booking or cancel');
      return { filled: selector };
    }
    if (body.op === 'text') {
      const text = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(body.selector)});
        if (!el) return null;
        return (el.textContent || '').replace(/\\s+/g, ' ').trim();
      })()`);
      if (text == null) throw new Error(`selector not found: ${body.selector}`);
      return { text };
    }
    if (body.op === 'attr') {
      const value = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(body.selector)});
        if (!el) return null;
        return el.getAttribute(${JSON.stringify(body.name)});
      })()`);
      if (value == null) throw new Error(`attribute ${body.name} missing on ${body.selector}`);
      return { value };
    }
    if (body.op === 'wait') {
      const timeoutMs = Number(body.timeoutMs || 3000);
      const startedAt = Date.now();
      let last = '';
      while (Date.now() - startedAt < timeoutMs) {
        last = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(body.selector)});
          if (!el) return '';
          const hidden = el.classList.contains('hidden') || el.getAttribute('hidden') != null;
          if (hidden) return '';
          return (el.textContent || '').replace(/\\s+/g, ' ').trim();
        })()`) || '';
        if (last && (!body.text || last.includes(body.text))) return { text: last };
        await sleep(100);
      }
      throw new Error(`timed out waiting for ${body.selector} ${body.text || ''} (last: ${last || 'empty'})`);
    }
    if (body.op === 'scroll') {
      const outcome = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(body.selector)});
        if (!el) return 'missing';
        el.scrollIntoView({ block: 'center' });
        return 'ok';
      })()`);
      if (outcome === 'missing') throw new Error(`selector not found: ${body.selector}`);
      return { scrolled: body.selector };
    }
    if (body.op === 'snapshot') {
      const nodes = await axNodes();
      const lines = [`url ${await evaluate('location.href')}`];
      for (const node of nodes) {
        const role = axRole(node);
        const name = axName(node);
        if (!name) continue;
        if (!AX_ROLES.has(role) && role !== 'statictext') continue;
        lines.push(`${role} ${JSON.stringify(name)}`);
        if (lines.length >= 500) break;
      }
      const proofSelectors = ['#brand-title', '#formTitleText', '#peopleDisplay', '#banquetSummary', '#takeoutSummaryTotal', '#faq-title'];
      for (const selector of proofSelectors) {
        const partial = await partialAx(selector);
        if (!partial.length) continue;
        lines.push(`# ${selector}`);
        for (const node of partial) {
          const role = axRole(node);
          const name = axName(node);
          if (!name) continue;
          lines.push(`${role} ${JSON.stringify(name)}`);
        }
      }
      const file = evidenceFile(evidenceDir, body.path);
      writeFileSync(file, `${lines.join('\n')}\n`);
      return { path: file, lines: lines.length };
    }
    if (body.op === 'screenshot') {
      await evaluate(`(() => {
        const brand = document.getElementById('brand-title');
        if (brand) brand.setAttribute('data-verify-visible', '1');
      })()`);
      const metrics = await cdp.send('Page.getLayoutMetrics');
      const width = Math.ceil(metrics.cssContentSize?.width || 1280);
      const height = Math.min(5000, Math.ceil(metrics.cssContentSize?.height || 900));
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 },
      });
      const file = evidenceFile(evidenceDir, body.path);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      return { path: file, bytes: statSync(file).size, width, height };
    }
    if (body.op === 'selftest-post') {
      const nonce = String(body.nonce || '');
      if (!/^[a-f0-9]{16}$/.test(nonce)) throw new Error('selftest nonce is missing');
      const url = `https://script.google.com/macros/s/SHUIMEI-VERIFY-SELFTEST-${nonce}/exec`;
      const fetchResult = await evaluate(`fetch(${JSON.stringify(url)}, { method: 'POST', body: '{}', signal: AbortSignal.timeout(3000) }).then((res) => 'completed ' + res.status).catch((err) => 'fetch-error ' + (err && err.name ? err.name : 'Error'))`);
      return { fetchResult, url, nonce };
    }
    if (body.op === 'network') {
      const summary = summarizeNetwork(networkLog);
      if (body.expectNoBooking && summary.bookingAttempts.length) {
        throw new Error(`booking host was touched: ${summary.bookingAttempts.join(', ')}`);
      }
      return summary;
    }
    throw new Error(`unknown op ${body.op}`);
  }

  await new Promise((resolvePromise) => control.listen(0, '127.0.0.1', resolvePromise));
  const controlPort = control.address().port;
  const state = {
    ready: true,
    runId: id,
    pid: process.pid,
    chromePid: chrome.pid,
    sitePort,
    siteUrl,
    controlPort,
    token,
    head,
    styled,
    evidenceDir,
    userDataDir,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(statePath(id), JSON.stringify(state, null, 2));
  log(`control ${controlPort}`);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('shutdown');
    try { chrome.kill('SIGTERM'); } catch { /* already gone */ }
    setTimeout(() => {
      try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
      site.close();
      control.close();
      cdp.close();
      try { browserCdp.close(); } catch { /* browser socket may already be closed */ }
      process.exit(0);
    }, 300);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  chrome.on('exit', () => {
    if (!shuttingDown) log('chrome exited unexpectedly');
  });
}

function summarizeNetwork(file) {
  if (!existsSync(file)) throw new Error('insufficient evidence: network log is missing');
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  if (!lines.length) throw new Error('insufficient evidence: network log is empty');
  const hosts = new Set();
  const blocked = [];
  const bookingAttempts = [];
  let continued = 0;
  let continuedMutations = 0;
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error('insufficient evidence: network log is unparseable');
    }
    if (row.host) hosts.add(row.host);
    if (row.decision === 'continue') continued += 1;
    if (row.decision === 'blocked') blocked.push(`${row.reason} ${row.method} ${row.url}`);
    if (hostMatches(row.host || '', BOOKING_HOSTS)) bookingAttempts.push(row.url);
    if (row.decision === 'continue' && row.method && !['GET', 'HEAD'].includes(row.method)) continuedMutations += 1;
  }
  return {
    requests: lines.length,
    continued,
    blocked: blocked.length,
    continuedMutations,
    bookingAttempts,
    hosts: [...hosts].sort(),
    blockedSample: blocked.slice(0, 8),
    evidenceFile: file,
  };
}

function daemonTail(id) {
  const logFile = join(dirs(id).stateDir, 'daemon.log');
  return existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').slice(-30).join('\n') : 'no daemon log';
}

async function waitForState(child) {
  const id = runId();
  const file = statePath(id);
  const started = Date.now();
  let exitCode = null;
  if (child) child.once('exit', (code) => { exitCode = code ?? 0; });
  while (Date.now() - started < 25000) {
    if (exitCode != null) {
      throw new Error(`daemon exited ${exitCode} before ready\n${daemonTail(id)}`);
    }
    if (existsSync(file)) {
      const state = JSON.parse(readFileSync(file, 'utf8'));
      if (state.ready && alive(state.pid)) return state;
    }
    await sleep(200);
  }
  throw new Error(`launch timed out\n${daemonTail(id)}`);
}

async function launch() {
  assertSupportedRuntime();
  assertChromePresent();
  const id = runId();
  const existing = readState();
  if (existing && alive(existing.pid)) {
    throw new Error(`run ${id} is already up at ${existing.siteUrl}. Use another SHUIMEI_RUN_ID or cleanup this one.`);
  }
  const { stateDir } = dirs(id);
  rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
  const logFd = join(stateDir, 'daemon.log');
  writeFileSync(logFd, '');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'daemon'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, SHUIMEI_RUN_ID: id },
  });
  try {
    const state = await waitForState(child);
    child.unref();
    console.log(`ready url=${state.siteUrl} run=${state.runId} evidence=${state.evidenceDir} pid=${state.pid} head=${state.head} styled=${state.styled}`);
  } catch (err) {
    killTree(child.pid);
    killRecordedChrome();
    throw err;
  }
}

async function doctor() {
  const state = readState();
  if (!state || !state.ready) throw new Error('no verification instance. Run launch first.');
  if (!alive(state.pid)) throw new Error(`supervisor pid ${state.pid} is not running`);
  if (!alive(state.chromePid)) throw new Error(`chrome pid ${state.chromePid} is not running`);
  const head = gitHead();
  if (head !== state.head) throw new Error(`instance was launched at ${state.head} but repo is ${head}. cleanup and launch again.`);
  const response = await fetch(state.siteUrl);
  const header = response.headers.get('x-shuimei-verify') || '';
  const body = await response.text();
  if (header !== `${state.runId}:${state.pid}`) throw new Error(`port is not owned by this run (header ${header || 'missing'})`);
  if (!body.includes('水美土雞城') || !body.includes('id="bookingForm"')) {
    throw new Error('homepage is not the usable booking page');
  }
  const remote = await controlRequest(state, 'doctor');
  if (remote.pageInfo?.token !== state.token) throw new Error('chrome page is not the page this run opened');
  if (!String(remote.pageInfo?.href || '').startsWith(state.siteUrl)) {
    throw new Error(`chrome is on ${remote.pageInfo?.href}, not ${state.siteUrl}`);
  }
  const network = summarizeNetwork(join(state.evidenceDir, 'network.jsonl'));
  if (network.continuedMutations) throw new Error('a mutation request was allowed out');
  if (network.bookingAttempts.length) throw new Error(`booking host was touched: ${network.bookingAttempts.join(', ')}`);
  const report = {
    ok: true,
    url: state.siteUrl,
    runId: state.runId,
    pid: state.pid,
    chromePid: state.chromePid,
    head,
    styled: remote.styled,
    evidenceDir: state.evidenceDir,
    hosts: network.hosts,
    blocked: network.blocked,
    continuedMutations: network.continuedMutations,
    bookingAttempts: network.bookingAttempts,
  };
  console.log(JSON.stringify(report, null, 2));
}

async function browser(args) {
  const state = readState();
  if (!state || !alive(state.pid)) throw new Error('verification instance is not running');
  const action = args._[1];
  if (action === 'open') return controlRequest(state, 'open', { path: args.path || '/' });
  if (action === 'click') return controlRequest(state, 'click', { role: args.role, name: args.name, selector: args.selector });
  if (action === 'fill') return controlRequest(state, 'fill', { selector: args.selector, value: args.value });
  if (action === 'text') return controlRequest(state, 'text', { selector: args.selector });
  if (action === 'attr') return controlRequest(state, 'attr', { selector: args.selector, name: args.name });
  if (action === 'wait') return controlRequest(state, 'wait', { selector: args.selector, text: args.text, timeoutMs: args.timeout ? Number(args.timeout) : 3000 });
  if (action === 'scroll') return controlRequest(state, 'scroll', { selector: args.selector });
  if (action === 'snapshot') return controlRequest(state, 'snapshot', { path: args.path });
  if (action === 'screenshot') return controlRequest(state, 'screenshot', { path: args.path });
  throw new Error('browser actions: open, click, fill, text, attr, wait, scroll, snapshot, screenshot');
}

async function network(args) {
  const state = readState();
  if (!state || !alive(state.pid)) throw new Error('verification instance is not running');
  return controlRequest(state, 'network', { expectNoBooking: Boolean(args['expect-no-booking']) });
}

async function selftest() {
  const state = readState();
  if (!state || !alive(state.pid)) throw new Error('no verification instance. Run launch first.');
  const nonce = randomBytes(8).toString('hex');
  const probe = await controlRequest(state, 'selftest-post', { nonce });
  const logFile = join(state.evidenceDir, 'network.jsonl');
  const summary = summarizeNetwork(logFile);
  const rows = readFileSync(logFile, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const mine = rows.filter((row) => String(row.url || '').includes(nonce));
  const blockedPost = mine.find((row) => String(row.method || '').toUpperCase() === 'POST' && row.decision === 'blocked');
  if (!blockedPost) {
    const seen = mine.map((row) => `${row.method || '?'} ${row.decision || 'missing'}`).join(', ') || 'no row';
    throw new Error(`safety net is broken: probe POST row was ${seen}, not POST blocked`);
  }
  if (summary.continuedMutations !== 0) {
    throw new Error(`safety net is broken: continuedMutations is ${summary.continuedMutations}, not 0`);
  }
  let failedAsRequired = false;
  let message = '';
  try {
    await controlRequest(state, 'network', { expectNoBooking: true });
  } catch (err) {
    failedAsRequired = true;
    message = err.message;
  }
  if (!failedAsRequired || !/script\.google\.com|booking host was touched/.test(message)) {
    throw new Error(`safety net is broken: network --expect-no-booking stayed clean (${message || 'no error'})`);
  }
  console.log(JSON.stringify({
    ok: true,
    head: gitHead(),
    expectNoBooking: 'failed-as-required',
    continuedMutations: summary.continuedMutations,
    probeDecision: blockedPost.decision,
    fetchResult: probe.fetchResult,
    message,
    probe: probe.url,
  }, null, 2));
}

async function cleanup() {
  const id = runId();
  const state = readState();
  const pids = readPidFile(id);
  const evidenceDir = state?.evidenceDir || dirs(id).evidenceDir;
  const daemonPid = state?.pid || pids.daemonPid;
  const chromePid = state?.chromePid || pids.chromePid;
  if (daemonPid) killTree(daemonPid);
  if (chromePid) killTree(chromePid);
  rmSync(dirs(id).stateDir, { recursive: true, force: true });
  console.log(`cleaned run=${id} evidence retained at ${evidenceDir}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (command !== 'cleanup') assertSupportedRuntime();
  if (command === 'daemon') return daemon();
  if (command === 'launch') return launch();
  if (command === 'doctor') return doctor();
  if (command === 'browser') {
    const payload = await browser(args);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (command === 'network') {
    const payload = await network(args);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (command === 'selftest') return selftest();
  if (command === 'cleanup') return cleanup();
  console.error('usage: control-shuimei.mjs launch|doctor|browser|network|selftest|cleanup');
  process.exit(2);
}

main().catch((err) => {
  if (process.argv[2] === 'daemon') killRecordedChrome();
  try {
    appendFileSync(join(dirs().stateDir, 'daemon.log'), `fatal ${err.stack || err.message}\n`);
  } catch {
    // state dir may not exist yet
  }
  console.error(err.message);
  process.exit(1);
});
