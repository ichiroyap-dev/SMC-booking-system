#!/usr/bin/env node
// Re-check that GitHub Pages does not publish .github/pages-unpublished
// or the removed isolated test pages.
// Reads the live site and the latest Pages build log. Does not deploy or write a sheet.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const repo = 'ichiroyap-dev/SMC-booking-system';
const origin = 'https://www.sweetmeichicken.com';
// Deleted harness paths plus the unpublished files the build must keep off the site.
const paths = [
  '/tools/isolated-dining-check.html',
  '/tools/isolated-check-guard.js',
  '/.github/pages-unpublished/isolated-dining-check.html',
  '/.github/pages-unpublished/isolated-check-guard.js',
  '/.github/pages-unpublished/booking-attribution-isolated.gs',
  '/.github/pages-unpublished/IsolatedCheck.html',
  '/.github/pages-unpublished/booking-attribution-isolated-runbook.md',
];
const failures = [];
const blocked = [];
const requiredEnv = [
  '需要的環境：可連到 https://www.sweetmeichicken.com',
  '需要的環境：gh 已登入，能讀 Pages 設定與 pages-build-deployment 的建置紀錄',
];

function fail(message) {
  failures.push(message);
}

function block(message) {
  blocked.push(message);
}

function curlStatus(url) {
  const ran = spawnSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-L', '--max-time', '30', url], { encoding: 'utf8' });
  if (ran.error || ran.status !== 0) return '';
  return String(ran.stdout || '').trim();
}

function gh(args) {
  const ran = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (ran.error || ran.status !== 0) {
    block('gh ' + args.join(' ') + ' 無法完成');
    return '';
  }
  return ran.stdout || '';
}

for (const path of paths) {
  const url = origin + path;
  const status = curlStatus(url);
  if (!status) {
    block(url + ' 連不到，不能當成 404');
    continue;
  }
  console.log(status + ' ' + url);
  if (status !== '404') fail(url + ' 應為 404，實際 ' + status);
}

const pagesRaw = gh(['api', 'repos/' + repo + '/pages']);
if (pagesRaw) {
  const pages = JSON.parse(pagesRaw);
  console.log('pages build_type=' + pages.build_type + ' branch=' + (pages.source && pages.source.branch) + ' path=' + (pages.source && pages.source.path));
  if (pages.build_type !== 'legacy') fail('Pages 不是從分支建置（legacy）');
  if (!pages.source || pages.source.branch !== 'main' || pages.source.path !== '/') fail('Pages 來源應是 main 的 /');
}

const runsRaw = gh(['run', 'list', '--repo', repo, '--workflow', 'pages-build-deployment', '--limit', '1', '--json', 'databaseId,conclusion,headSha,status']);
let runId = '';
if (runsRaw) {
  const runs = JSON.parse(runsRaw);
  const run = runs[0];
  if (!run || run.conclusion !== 'success') fail('找不到成功的 pages-build-deployment');
  else {
    runId = String(run.databaseId);
    console.log('pages run=' + runId + ' sha=' + run.headSha + ' conclusion=' + run.conclusion);
  }
}
if (runId) {
  const log = gh(['run', 'view', runId, '--repo', repo, '--log']);
  if (log && !log.includes('--exclude=.github')) fail('最近一次 Pages 建置的 tar 沒有 --exclude=.github');
  if (log && !log.includes('actions/upload-pages-artifact')) fail('最近一次 Pages 建置沒有使用 upload-pages-artifact');
  else if (log) console.log('build excludes .github via upload-pages-artifact');
}

const workflowDir = '.github/workflows';
if (existsSync(workflowDir)) {
  const names = readdirSync(workflowDir);
  if (names.length) fail('repo 出現自訂 workflow：' + names.join(','));
}

if (failures.length) {
  console.error('pages unpublished check failed: ' + failures.length);
  failures.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
if (blocked.length) {
  console.error('BLOCKED');
  blocked.forEach((line) => console.error(' - ' + line));
  requiredEnv.forEach((line) => console.error(line));
  process.exit(2);
}
console.log('pages unpublished check: pass');
