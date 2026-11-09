/**
 * One-week offline observation metrics (NO_DEPLOY).
 * Synthetic fake events only. No live traffic, no external API.
 */
'use strict';

import { classifyMessage } from './classify.mjs';
import { createMockServices, textEvent } from './bookingReplay.mjs';
import { compareToBaseline } from './harness.mjs';

const WINDOW_START = '2026-09-23';
const WINDOW_END = '2026-09-29';
const FAILURE_INDEXES = { 4: 'timeout', 9: 'exception', 14: 'empty', 19: 'malformed', 24: 'timeout', 29: 'exception', 34: 'empty', 39: 'malformed' };

export function buildWeekEvents() {
  const events = [];
  for (let d = 0; d < 7; d++) {
    const user = 'UFAKEWEEK' + String(d);
    const phone = '090000000' + String(d);
    const dayOfMonth = d + 1;
    const baseTs = Date.parse('2026-09-23T02:00:00Z') + d * 86400000;
    events.push(textEvent({
      id: 'week-' + d + '-details',
      user: user,
      ts: baseTs + 1000,
      text: '我要訂位，我是測試一，電話' + phone + '，10月' + dayOfMonth + '日12:00，4位'
    }));
    events.push(textEvent({
      id: 'week-' + d + '-confirm',
      user: user,
      ts: baseTs + 2000,
      text: '確認'
    }));
    events.push(textEvent({
      id: 'week-' + d + '-cancel',
      user: user,
      ts: baseTs + 3000,
      text: '取消 SMC' + String(900100 + d) + ' 電話' + phone
    }));
    events.push(textEvent({
      id: 'week-' + d + '-chat',
      user: user,
      ts: baseTs + 4000,
      text: '你好，請問營業到幾點？'
    }));
    events.push(textEvent({
      id: 'week-' + d + '-unknown',
      user: user,
      ts: baseTs + 5000,
      text: '今天天氣真好'
    }));
    events.push(textEvent({
      id: 'week-' + d + '-chat',
      user: user,
      ts: baseTs + 6000,
      text: '你好，請問營業到幾點？'
    }));
  }
  return events;
}

export function weekClassifyFactory() {
  let index = 0;
  return function weekClassify(input, ctx) {
    const mode = FAILURE_INDEXES[index] || 'ok';
    index += 1;
    if (mode === 'timeout') {
      const err = new Error('timeout');
      err.code = 'CLASSIFY_TIMEOUT';
      throw err;
    }
    if (mode === 'exception') throw new Error('injected_exception');
    if (mode === 'empty') return {};
    if (mode === 'malformed') return { category: 'MERGE', confidence: 'high', reason: '' };
    return classifyMessage(input, ctx);
  };
}

export function summarizeLogs(logs) {
  const distribution = { booking: 0, cancel: 0, chitchat: 0, unknown: 0 };
  const failures = { timeout: 0, exception: 0, empty: 0, malformed: 0, total: 0 };
  for (let i = 0; i < logs.length; i++) {
    const rec = logs[i];
    if (rec.status === 'ok' && Object.prototype.hasOwnProperty.call(distribution, rec.category)) {
      distribution[rec.category] += 1;
    } else if (Object.prototype.hasOwnProperty.call(failures, rec.status)) {
      failures[rec.status] += 1;
      failures.total += 1;
    }
  }
  const eventCount = logs.length;
  return {
    distribution: distribution,
    failures: failures,
    failureRate: eventCount === 0 ? 0 : failures.total / eventCount,
    eventCount: eventCount
  };
}

export function countExternalFetches(fetches) {
  let n = 0;
  for (let i = 0; i < fetches.length; i++) {
    const url = fetches[i] && fetches[i].url;
    if (typeof url !== 'string' || url.indexOf('offline://') !== 0) n += 1;
  }
  return n;
}

export function runWeek() {
  const events = buildWeekEvents();
  const createServices = function () {
    return createMockServices({ today: { y: 2026, m: 9, d: 29 }, orderSeq: 900100 });
  };
  const started = performance.now();
  const cmp = compareToBaseline(events, createServices, {
    classify: weekClassifyFactory(),
    budgetMs: 50
  });
  const replayDurationMs = performance.now() - started;
  const summary = summarizeLogs(cmp.shadowed.logs);
  const externalApiCalls = countExternalFetches(cmp.baseline.fetches) + countExternalFetches(cmp.shadowed.fetches);
  return {
    mode: 'offline-replay',
    deploy: 'NO_DEPLOY',
    wiredToProduction: false,
    window: { start: WINDOW_START, end: WINDOW_END, days: 7 },
    eventCount: events.length,
    replayDurationMs: replayDurationMs,
    distribution: summary.distribution,
    failures: summary.failures,
    failureRate: summary.failureRate,
    isolateLogCount: cmp.shadowed.logs.length,
    baselineIsolateLogCount: cmp.baseline.logs.length,
    sideEffectDelta: cmp.delta,
    behaviorMatch: cmp.behaviorMatch,
    externalApiCalls: externalApiCalls
  };
}
