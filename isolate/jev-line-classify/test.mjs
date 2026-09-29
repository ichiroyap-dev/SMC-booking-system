#!/usr/bin/env node
// Offline tests. No network, no sheet, no clasp.
// Usage: node --test isolate/jev-line-classify/test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  CATEGORIES,
  LOG_PATH,
  RULE_EXAMPLES,
  classifyMessage,
  observeClassification
} from './classify.mjs';
import {
  createMockServices,
  parseBookingFields,
  runPipeline,
  textEvent
} from './bookingReplay.mjs';
import { compareToBaseline } from './harness.mjs';
import { runWeek, summarizeLogs } from './metrics.mjs';

const cases = JSON.parse(readFileSync(new URL('./fixtures/cases.json', import.meta.url), 'utf8'));
const GUEST = 'UFAKEGUEST0000000000000000000001';
const GUEST2 = 'UFAKEGUEST0000000000000000000002';
const OWNER = 'U0000000000000000000000000000aaaa';

function inputOf(text, context) {
  return {
    event: textEvent({ id: 'case-' + text.length, user: GUEST, text: text }),
    context: context || {}
  };
}

function parityEvents() {
  const phone = '0900000000';
  const details = '我要訂位，我是測試一，電話' + phone + '，10月2日12:00，4位';
  return [
    textEvent({ id: 'p-details', user: GUEST, text: details, ts: 1 }),
    textEvent({ id: 'p-confirm', user: GUEST, text: '確認', ts: 2 }),
    textEvent({ id: 'p-confirm', user: GUEST, text: '確認', ts: 3 }),
    textEvent({ id: 'p-dup-details', user: GUEST2, text: details, ts: 4 }),
    textEvent({ id: 'p-dup-confirm', user: GUEST2, text: '確認', ts: 5 }),
    textEvent({ id: 'p-cancel-bad', user: GUEST, text: '取消', ts: 6 }),
    textEvent({ id: 'p-cancel-ok', user: GUEST, text: '取消 SMC900100 電話' + phone, ts: 7 }),
    textEvent({ id: 'p-chat', user: 'UFAKECHAT0000000000000000000001', text: '你好', ts: 8 }),
    textEvent({ id: 'p-unknown', user: 'UFAKEUNK00000000000000000000001', text: '今天天氣真好', ts: 9 }),
    textEvent({ id: 'p-cap', user: 'UFAKECAP000000000000000000000001', text: '我要訂位，我是測試四，電話0900000004，10月8日18:00，80位', ts: 10 }),
    textEvent({ id: 'p-owner', user: OWNER, text: '我要訂位，我是測試二，電話0900000001，明天12:00，4位', ts: 11 }),
    textEvent({ id: 'p-id', user: GUEST, text: 'ID', ts: 12 }),
    {
      type: 'message',
      webhookEventId: 'p-sticker',
      replyToken: 'fake-reply-token',
      timestamp: 13,
      source: { type: 'user', userId: 'UFAKESTICKER00000000000000000001' },
      message: { id: 'p-sticker', type: 'sticker', packageId: '0', stickerId: '0' }
    },
    textEvent({ id: 'p-bare-confirm', user: 'UFAKEBARE0000000000000000000001', text: '確認', ts: 14 }),
    null
  ];
}

function factory() {
  return createMockServices({ ownerUserId: OWNER, today: { y: 2026, m: 9, d: 29 }, orderSeq: 900100 });
}

test('contract: simulated text event yields category, confidence, reason, isolate log path', () => {
  const sample = cases.booking;
  const record = observeClassification(inputOf(sample.text), { ts: '2026-09-29T00:00:00.000Z', sink: [] });
  assert.ok(CATEGORIES.includes(record.category));
  assert.equal(record.category, sample.category);
  assert.equal(record.reason, sample.reason);
  assert.equal(typeof record.confidence, 'number');
  assert.ok(record.confidence > 0 && record.confidence <= 1);
  assert.equal(record.logPath, LOG_PATH);
  assert.equal(record.shadow, true);
  assert.equal(record.followed, false);
  assert.equal(record.action, 'none');
  assert.equal(record.status, 'ok');
  assert.equal(record.kind, 'line_classify');
});

test('rules: documented examples', () => {
  for (const example of RULE_EXAMPLES) {
    const got = classifyMessage(inputOf(example.text, example.context));
    assert.equal(got.category, example.category, example.name);
    assert.equal(got.reason, example.reason, example.name);
    assert.ok(got.confidence >= 0 && got.confidence <= 1);
  }
  assert.deepEqual(classifyMessage(inputOf(cases.cancel.text)), {
    category: cases.cancel.category,
    confidence: 0.92,
    reason: cases.cancel.reason
  });
  assert.equal(classifyMessage(inputOf(cases.chitchat.text)).category, 'chitchat');
  assert.equal(classifyMessage(inputOf(cases.unknown.text)).category, 'unknown');
  assert.equal(classifyMessage(inputOf('   ')).reason, 'no_text');
  assert.equal(classifyMessage({ event: { message: { type: 'sticker' } } }).reason, 'no_text');
});

test('parser stand-in extracts fake booking fields and ignores money', () => {
  const parsed = parseBookingFields('我是測試一，電話0900000000，明天12:00，4位，預算不寫', { y: 2026, m: 9, d: 29 });
  assert.deepEqual(parsed, {
    name: '測試一',
    phone: '0900000000',
    date: '2026-09-30',
    time: '12:00',
    people: 4
  });
  assert.equal(parseBookingFields('晚上6點', { y: 2026, m: 9, d: 29 }).time, '18:00');
});

test('normal booking opens one order only after 確認', () => {
  const services = factory();
  const details = runPipeline(textEvent({
    id: 'b1',
    user: GUEST,
    text: '我要訂位，我是測試一，電話0900000000，明天12:00，4位'
  }), services);
  assert.equal(details.action, 'confirm_draft');
  assert.equal(services.counts.sheetAppend, 0);
  assert.match(details.reply, /測試一/);
  assert.match(details.reply, /0900000000/);
  assert.doesNotMatch(details.reply, /金額|預估/);
  const opened = runPipeline(textEvent({ id: 'b2', user: GUEST, text: '確認' }), services);
  assert.equal(opened.action, 'opened');
  assert.equal(services.counts.sheetAppend, 1);
  assert.equal(services.rows[0].id, 'SMC900100');
  assert.equal(services.rows[0].tables, 1);
  assert.equal(services.rows[0].people, 4);
  assert.equal(services.rows[0].status, '有效');
  assert.equal('amount' in services.rows[0], false);
});

test('cancel validates order id and phone before any sheet update', () => {
  const services = factory();
  services.rows.push({ id: 'SMC900001', phone: '0900000000', status: '有效', name: '測試一' });
  const ask = runPipeline(textEvent({ id: 'c1', user: GUEST, text: '取消' }), services);
  assert.equal(ask.action, 'cancel_ask');
  assert.equal(services.counts.sheetUpdate, 0);
  const missing = runPipeline(textEvent({ id: 'c2', user: GUEST, text: '取消 SMC900009 電話0900000000' }), services);
  assert.equal(missing.action, 'cancel_missing');
  assert.equal(services.counts.sheetUpdate, 0);
  const ok = runPipeline(textEvent({ id: 'c3', user: GUEST, text: '取消 SMC900001 電話0900000000' }), services);
  assert.equal(ok.action, 'cancel_ok');
  assert.equal(services.rows[0].status, '取消');
  assert.equal(services.counts.sheetUpdate, 1);
});

test('chitchat and unknown do not open an order; pipeline still answers as before', () => {
  const services = factory();
  const chat = runPipeline(textEvent({ id: 'h1', user: GUEST, text: cases.chitchat.text }), services);
  const unknown = runPipeline(textEvent({ id: 'h2', user: GUEST2, text: cases.unknown.text }), services);
  assert.equal(chat.action, 'need_fields');
  assert.equal(unknown.action, 'need_fields');
  assert.equal(services.counts.sheetAppend, 0);
  assert.equal(classifyMessage(inputOf(cases.chitchat.text)).category, 'chitchat');
  assert.equal(classifyMessage(inputOf(cases.unknown.text)).category, 'unknown');
});

test('fail-open: timeout, exception, empty, and malformed stay out of the decision', () => {
  const baseText = cases.booking.text;
  const modes = [
    {
      name: 'timeout',
      classify(_input, ctx) {
        const err = new Error('timeout');
        err.code = 'CLASSIFY_TIMEOUT';
        throw err;
      }
    },
    {
      name: 'exception',
      classify() { throw new Error('classifier_bug'); }
    },
    {
      name: 'empty',
      classify() { return {}; }
    },
    {
      name: 'malformed',
      classify() { return { category: 'MERGE', confidence: 2, reason: '', tables: 99, amount: 5000, bypassValidation: true }; }
    }
  ];
  for (const mode of modes) {
    const sink = [];
    const record = observeClassification(inputOf(baseText), { classify: mode.classify, sink: sink, ts: '2026-09-29T00:00:00.000Z' });
    assert.equal(record.status, mode.name, mode.name);
    assert.equal(record.category, null, mode.name);
    assert.equal(record.action, 'none');
    assert.equal(record.followed, false);
    assert.equal(sink.length, 1);
    assert.equal(JSON.stringify(record).includes('5000'), false);
    assert.equal(JSON.stringify(record).includes('bypass'), false);
  }
  let ticks = 0;
  const burned = observeClassification(inputOf(baseText), {
    budgetMs: 50,
    clock() { ticks += 1; return ticks === 1 ? 1000 : 1100; },
    classify() { return { category: 'booking', confidence: 0.9, reason: 'booking_keyword', tables: 9 }; }
  });
  assert.equal(burned.status, 'timeout');
  assert.equal(burned.category, null);
});

test('resend: duplicate webhook id does not reply or append again', () => {
  const events = [
    textEvent({ id: 'same-id', user: GUEST, text: '我要訂位，我是測試一，電話0900000000，10月3日12:00，4位' }),
    textEvent({ id: 'same-id', user: GUEST, text: '我要訂位，我是測試一，電話0900000000，10月3日12:00，4位' })
  ];
  const cmp = compareToBaseline(events, factory, {});
  assert.equal(cmp.behaviorMatch, true);
  assert.equal(cmp.delta.total, 0);
  assert.deepEqual(cmp.baseline.actions.map((item) => item.action), ['confirm_draft', 'deduped']);
  assert.equal(cmp.baseline.counts.sheetAppend, 0);
  assert.equal(cmp.baseline.counts.urlFetch, 1);
  assert.equal(cmp.shadowed.logs.length, 2);
  assert.equal(cmp.baseline.logs.length, 0);
});

test('parity: classification success and each failure mode match the baseline', () => {
  const events = parityEvents();
  const success = compareToBaseline(events, factory, {});
  assert.equal(success.behaviorMatch, true, JSON.stringify(success.delta));
  assert.equal(success.delta.total, 0);
  assert.equal(success.baseline.counts.sheetAppend, 1);
  assert.equal(success.baseline.counts.sheetUpdate, 1);
  assert.equal(success.baseline.rows[0].tables, 1);
  assert.equal(success.baseline.rows[0].status, '取消');
  assert.ok(success.baseline.actions.some((item) => item.action === 'duplicate'));
  assert.ok(success.baseline.actions.some((item) => item.action === 'over_capacity'));
  assert.ok(success.baseline.actions.some((item) => item.action === 'owner_silent'));
  assert.ok(success.baseline.actions.some((item) => item.action === 'deduped'));

  const failures = [
    function () { const err = new Error('timeout'); err.code = 'CLASSIFY_TIMEOUT'; throw err; },
    function () { throw new Error('boom'); },
    function () { return null; },
    function () { return { category: 'booking', confidence: 'high', reason: 'nope', tables: 99 }; }
  ];
  for (const classify of failures) {
    const cmp = compareToBaseline(events, factory, { classify: classify });
    assert.equal(cmp.behaviorMatch, true);
    assert.equal(cmp.delta.total, 0);
    assert.equal(cmp.shadowed.logs.every((rec) => rec.followed === false && rec.action === 'none'), true);
    assert.equal(cmp.shadowed.logs.every((rec) => rec.category == null), true);
  }
});

test('fail-open does not skip validation or dedup when classification throws', () => {
  const events = [
    textEvent({ id: 'v1', user: GUEST, text: '我要訂位' }),
    textEvent({ id: 'v2', user: GUEST, text: '我是測試一，電話0900000000，明天12:00，4位' }),
    textEvent({ id: 'v3', user: GUEST, text: '確認' }),
    textEvent({ id: 'v3', user: GUEST, text: '確認' }),
    textEvent({ id: 'v4', user: GUEST, text: '取消' })
  ];
  const cmp = compareToBaseline(events, factory, {
    classify() { throw new Error('down'); }
  });
  assert.equal(cmp.behaviorMatch, true);
  assert.deepEqual(cmp.baseline.actions.map((item) => item.action), [
    'need_fields', 'confirm_draft', 'opened', 'deduped', 'cancel_ask'
  ]);
  assert.equal(cmp.baseline.counts.sheetAppend, 1);
  assert.equal(cmp.baseline.counts.sheetUpdate, 0);
  assert.equal(cmp.shadowed.logs.every((rec) => rec.status === 'exception'), true);
});

test('a booking label cannot change table count, amount, or force an open', () => {
  const events = [
    textEvent({ id: 'f1', user: GUEST, text: '你好' }),
    textEvent({ id: 'f2', user: GUEST2, text: '我要訂位，我是測試一，電話0900000003，10月4日12:00，4位' })
  ];
  const cmp = compareToBaseline(events, factory, {
    classify() {
      return { category: 'booking', confidence: 1, reason: 'booking_keyword', tables: 99, amount: 1, action: 'append' };
    }
  });
  assert.equal(cmp.behaviorMatch, true);
  assert.equal(cmp.delta.total, 0);
  assert.equal(cmp.baseline.counts.sheetAppend, 0);
  assert.equal(cmp.shadowed.logs[0].category, 'booking');
  assert.equal(cmp.shadowed.logs[0].action, 'none');
  assert.equal(JSON.stringify(cmp.shadowed.rows).includes('amount'), false);
});

test('hook mutations and hook exceptions do not change the reply', () => {
  const event = textEvent({ id: 'm1', user: GUEST, text: '我要訂位，我是測試一，電話0900000000，明天12:00，4位' });
  const plain = runPipeline(event, factory());
  const mutated = runPipeline(event, factory(), {
    onPreParse(pre) {
      pre.dedupSeen = true;
      pre.awaitingConfirmation = false;
    }
  });
  const thrown = runPipeline(event, factory(), {
    onPreParse() { throw new Error('hook_bug'); }
  });
  assert.equal(mutated.reply, plain.reply);
  assert.equal(thrown.reply, plain.reply);
  assert.equal(mutated.action, 'confirm_draft');
});

test('week metrics: distribution, failure rate, duration, side-effect delta 0', () => {
  const report = runWeek();
  const summed = summarizeLogs([{ status: 'ok', category: 'booking' }, { status: 'timeout', category: null }]);
  assert.equal(summed.failureRate, 0.5);
  assert.equal(report.wiredToProduction, false);
  assert.equal(report.deploy, 'NO_DEPLOY');
  assert.equal(report.window.days, 7);
  assert.equal(report.eventCount, 42);
  assert.equal(report.sideEffectDelta.total, 0);
  assert.equal(report.behaviorMatch, true);
  assert.equal(report.externalApiCalls, 0);
  assert.equal(report.baselineIsolateLogCount, 0);
  assert.equal(report.isolateLogCount, 42);
  assert.equal(report.failures.timeout, 2);
  assert.equal(report.failures.exception, 2);
  assert.equal(report.failures.empty, 2);
  assert.equal(report.failures.malformed, 2);
  assert.equal(report.failures.total, 8);
  assert.equal(report.failureRate, 8 / 42);
  const distSum = report.distribution.booking + report.distribution.cancel + report.distribution.chitchat + report.distribution.unknown;
  assert.equal(distSum + report.failures.total, report.eventCount);
  assert.ok(report.distribution.booking > 0);
  assert.ok(report.distribution.cancel > 0);
  assert.ok(report.distribution.chitchat > 0);
  assert.ok(report.distribution.unknown > 0);
  assert.equal(typeof report.replayDurationMs, 'number');
  assert.ok(report.replayDurationMs >= 0);
  assert.ok(report.replayDurationMs < 5000);
});

test('replay cli exits 0 and prints a zero side-effect delta', () => {
  const result = spawnSync(process.execPath, ['isolate/jev-line-classify/replay.mjs'], {
    cwd: '/workspace',
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.sideEffectDelta.total, 0);
  assert.equal(report.wiredToProduction, false);
  assert.equal(report.externalApiCalls, 0);
});

test('isolate sources do not call live services or import the classifier into the replay', () => {
  const bookingSrc = readFileSync(new URL('./bookingReplay.mjs', import.meta.url), 'utf8');
  const classifySrc = readFileSync(new URL('./classify.mjs', import.meta.url), 'utf8');
  assert.equal(/classifyMessage|observeClassification|from '\.\/classify/.test(bookingSrc), false);
  assert.equal(/SpreadsheetApp|UrlFetchApp|MailApp|UrlFetch/.test(classifySrc), false);
  assert.equal(/openrouter|api\.line\.me|clasp/i.test(classifySrc + bookingSrc), false);
});
