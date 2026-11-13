#!/usr/bin/env node
// Offline unit tests for the Jev duplicate-booking judge. No network, no sheet writes.
// Usage: node --test tools/jev-dup-judge/test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const J = require('./dupJudge.js');
const fx = JSON.parse(readFileSync(new URL('./fixtures/bookings.json', import.meta.url), 'utf8'));

const dine = J.rowsToBookings(fx.dineIn, 'dine_in');
const take = J.rowsToBookings(fx.takeout, 'takeout');
const cands = J.generateCandidates(dine, take);
const pairIds = cands.map((c) => [c.a.id, c.b.id].sort().join('+'));

test('parses rows, skips header, ignores column M', () => {
  assert.equal(dine.length, 8);
  assert.equal(take.length, 1);
  for (const b of dine) assert.ok(!('estimate' in b) && !JSON.stringify(b).includes('9999'));
  assert.equal(dine[0].planCode, '4.5k2a');
  assert.equal(dine[0].date, '09-27');
  assert.equal(dine[0].meal, 'lunch');
  assert.equal(take[0].meal, 'lunch', 'takeout meal derived from time when 餐別 blank');
});

test('helpers', () => {
  assert.equal(J.normalizePhone('line訂'), '');
  assert.ok(J.isPhonePlaceholder('line訂'));
  assert.equal(J.normalizePhone('0912-000-111'), '0912000111');
  assert.equal(J.parsePlanCode('4.5k2a 大人4 小朋友1'), '4.5k2a');
  assert.equal(J.nameSimilarity('測試同學', '測試同學'), 1);
  assert.equal(J.nameSimilarity('陳先生', '陳小姐'), 0);
  assert.equal(J.normalizeDate('9/27'), '09-27');
});

test('anonymised case: 9/27 lunch 測試同學 SMC900001 / SMC900002 is a candidate', () => {
  const c = cands.find((x) => [x.a.id, x.b.id].sort().join('+') === 'SMC900001+SMC900002');
  assert.ok(c, 'expected 測試同學 pair');
  assert.deepEqual(c.reasons.slice(0, 3), ['same_phone', 'similar_name', 'same_plan_code']);
  assert.equal(c.signals.anyCancelled, true);
});

test('real case still detected by name alone (no phone)', () => {
  const rows = fx.dineIn.map((r) => r.slice());
  rows[1][2] = ''; rows[2][2] = 'line訂';
  const c = J.generateCandidates(J.rowsToBookings(rows, 'dine_in'), []);
  assert.ok(c.some((x) => x.a.id === 'SMC900001' && x.b.id === 'SMC900002'));
});

test('negative: separate line訂 bookings are NOT candidates just because phone matches', () => {
  for (const p of ['SMC100001+SMC100002', 'SMC100001+SMC100003', 'SMC100002+SMC100003']) {
    assert.ok(!pairIds.includes(p), p + ' must not be a candidate');
  }
  // and even with same plan code + same time, line訂 alone is not enough
  const c = cands.filter((x) => x.signals.phonePlaceholder);
  for (const x of c) assert.ok(x.reasons.includes('similar_name'), 'placeholder pairs need a real name match');
});

test('negative: 陳先生 vs 陳小姐 (surname-only, different phone) not a candidate', () => {
  assert.ok(!pairIds.includes('SMC100004+SMC100005'));
});

test('dine-in vs takeout cross-check is flagged, not auto-merged', () => {
  const c = cands.find((x) => x.signals.crossChannel);
  assert.ok(c);
  assert.ok(c.reasons.includes('dine_in_vs_takeout'));
});

test('activeOnly drops pairs with a cancelled side', () => {
  const c = J.generateCandidates(dine, take, { activeOnly: true });
  assert.ok(!c.some((x) => x.signals.anyCancelled));
});

test('candidate list is exactly the expected set', () => {
  assert.deepEqual(pairIds.sort(), ['SMC100006+SMC200001', 'SMC900001+SMC900002']);
});

test('buildJevRequest: typed questions, no key, no column M', () => {
  const req = J.buildJevRequest(cands[0]);
  assert.equal(req.questions.verdict.type, 'choice');
  assert.deepEqual(Object.keys(req.questions.verdict.criteria), ['MERGE', 'REVIEW', 'SEPARATE']);
  assert.equal(req.questions.same_booking.type, 'noul');
  const s = JSON.stringify(req);
  assert.ok(!/sk-or-/.test(s) && !s.includes('預估金額'));
});

const ok = (choice, p) => ({ status: 200, body: JSON.stringify({ answers: {
  verdict: { type: 'choice', choice, confidence: 0.8, probabilities: { MERGE: 0.8, REVIEW: 0.15, SEPARATE: 0.05 } },
  same_booking: { type: 'noul', noul: p } } }) });

test('judgeCandidates: typed verdict logged, never acts', () => {
  const logs = [];
  const calls = [];
  const out = J.judgeCandidates(cands, {
    config: { apiKey: 'test-key', model: 'x', enabled: true },
    transport: (url, o) => { calls.push({ url, o }); return ok('MERGE', 0.93); },
    log: (e) => logs.push(e), now: () => 't'
  });
  assert.equal(calls.length, cands.length);
  assert.equal(calls[0].url, J.DECISIONS_URL);
  assert.equal(out[0].verdict, 'MERGE');
  assert.equal(out[0].probability, 0.93);
  assert.ok(out.every((e) => e.action === 'none' && e.shadow === true && e.followed === false));
  assert.equal(logs.length, out.length);
});

test('consistency guard: MERGE with low probability -> REVIEW', () => {
  const [e] = J.judgeCandidates(cands.slice(0, 1), { config: { apiKey: 'k', enabled: true }, transport: () => ok('MERGE', 0.3) });
  assert.equal(e.verdict, 'REVIEW');
});

test('fail-open: HTTP error, throw, bad shape, missing key, disabled, no transport', () => {
  const one = cands.slice(0, 1);
  const run = (deps) => J.judgeCandidates(one, deps)[0];
  assert.match(run({ config: { apiKey: 'k', enabled: true }, transport: () => ({ status: 500, body: '' }) }).error, /HTTP 500/);
  assert.match(run({ config: { apiKey: 'k', enabled: true }, transport: () => { throw new Error('timeout sk-or-abc123'); } }).error, /timeout \[redacted\]/);
  assert.match(run({ config: { apiKey: 'k', enabled: true }, transport: () => ({ status: 200, body: '{}' }) }).error, /shape/);
  assert.match(run({ config: { apiKey: '', enabled: true }, transport: () => ok('MERGE', 1) }).error, /missing/);
  assert.equal(run({ config: { apiKey: 'k', enabled: false }, transport: () => { throw new Error('should not call'); } }).skipped, 'disabled');
  assert.equal(run({ config: { apiKey: 'k', enabled: true } }).skipped, 'no_transport');
  // a throwing logger must not break the run
  assert.equal(J.judgeCandidates(one, { config: { apiKey: 'k', enabled: false }, log: () => { throw new Error('x'); } }).length, 1);
});

test('readConfig: from Script Properties / env, kill switches', () => {
  assert.deepEqual(J.readConfig({ OPENROUTER_API_KEY: 'k' }), { apiKey: 'k', model: '~typesafe/jev-latest', enabled: true });
  assert.equal(J.readConfig({ JEV_DUP_JUDGE_ENABLED: '0' }).enabled, false);
  assert.equal(J.readConfig({ JEV_ROUTER_ENABLED: '0' }).enabled, false);
});

test('source contains no hardcoded keys', () => {
  const src = readFileSync(new URL('./dupJudge.js', import.meta.url), 'utf8');
  assert.ok(!/sk-or-v1-[A-Za-z0-9]{8,}/.test(src));
});
