/**
 * Compare booking replay with and without isolate classification (NO_DEPLOY).
 * Classification logs are not booking side effects.
 */
'use strict';

import { observeClassification } from './classify.mjs';
import { runPipeline } from './bookingReplay.mjs';

export const EFFECT_KEYS = ['urlFetch', 'sheetAppend', 'sheetUpdate', 'cacheWrite', 'cacheRead'];

export function effectDelta(baseCounts, otherCounts) {
  const delta = {};
  let total = 0;
  const base = baseCounts || {};
  const other = otherCounts || {};
  for (let i = 0; i < EFFECT_KEYS.length; i++) {
    const key = EFFECT_KEYS[i];
    const d = (other[key] || 0) - (base[key] || 0);
    delta[key] = d;
    total += Math.abs(d);
  }
  delta.total = total;
  return delta;
}

export function replayAll(events, services, shadow) {
  const logs = [];
  const actions = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const action = runPipeline(event, services, shadow ? {
      onPreParse: function (pre, ev) {
        const record = observeClassification({ event: ev, context: pre }, shadow);
        logs.push(record);
      }
    } : null);
    actions.push(action);
  }
  return {
    actions: actions,
    logs: logs,
    counts: Object.assign({}, services.counts),
    replies: services.replies.slice(),
    rows: services.rows.map((row) => Object.assign({}, row)),
    fetches: services.fetches.map((item) => ({ url: item.url, params: Object.assign({}, item.params) }))
  };
}

export function compareToBaseline(events, createServices, shadow) {
  const baseline = replayAll(events, createServices(), null);
  const shadowed = replayAll(events, createServices(), shadow || {});
  const delta = effectDelta(baseline.counts, shadowed.counts);
  const sameReplies = JSON.stringify(baseline.replies) === JSON.stringify(shadowed.replies);
  const sameRows = JSON.stringify(baseline.rows) === JSON.stringify(shadowed.rows);
  const sameActions = JSON.stringify(baseline.actions) === JSON.stringify(shadowed.actions);
  return {
    baseline: baseline,
    shadowed: shadowed,
    delta: delta,
    sameReplies: sameReplies,
    sameRows: sameRows,
    sameActions: sameActions,
    behaviorMatch: sameReplies && sameRows && sameActions && delta.total === 0
  };
}
