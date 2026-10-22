#!/usr/bin/env node
// Confirm GitHub Pages does not serve isolated test pages.
// Curl only. Expect HTTP 404. Does not deploy, does not read Pages build logs.
import { spawnSync } from 'node:child_process';

const origin = 'https://www.sweetmeichicken.com';
// Concrete paths stand in for /tools/isolated-* and /.github/pages-unpublished/*.
const paths = [
  '/tools/isolated-dining-check.html',
  '/tools/isolated-check-guard.js',
  '/.github/pages-unpublished/isolated-dining-check.html',
  '/.github/pages-unpublished/isolated-check-guard.js',
  '/.github/pages-unpublished/booking-attribution-isolated.gs',
  '/.github/pages-unpublished/IsolatedCheck.html',
  '/.github/pages-unpublished/booking-attribution-isolated-runbook.md',
];

function curlStatus(url) {
  const ran = spawnSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-L', '--max-time', '30', url], { encoding: 'utf8' });
  if (ran.error || ran.status !== 0) return '';
  return String(ran.stdout || '').trim();
}

const failures = [];
for (const path of paths) {
  const url = origin + path;
  const status = curlStatus(url);
  console.log((status || 'ERR') + ' ' + url);
  if (status !== '404') failures.push(url + ' 應為 404，實際 ' + (status || '連不到'));
}

if (failures.length) {
  console.error('pages unpublished check failed: ' + failures.length);
  failures.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
console.log('pages unpublished check: pass');
