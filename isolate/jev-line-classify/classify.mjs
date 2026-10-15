/**
 * Official LINE message × Jev classification — isolated, log-only, NO_DEPLOY.
 *
 * Categories follow this draft's contract (booking / cancel / chitchat / unknown).
 * The repo has no existing message-classification enum; jev-dup-judge's
 * MERGE / REVIEW / SEPARATE verdicts are a different task and are not reused.
 *
 * This module never calls the network, never writes a sheet, and never decides
 * a reply. Callers must discard the return value except for an isolate log.
 */
'use strict';

export const CATEGORIES = ['booking', 'cancel', 'chitchat', 'unknown'];
export const LOG_PATH = 'memory://isolate/jev-line-classify/logs/classify.jsonl';
export const DEFAULT_BUDGET_MS = 50;

const CANCEL_RE = /取消|撤銷|不訂了|不要訂了|cancel/i;
const CANCEL_NEG_RE = /不要取消|先別取消|先不要取消/;
const BOOKING_RE = /訂位|訂桌|預約|我要訂|想訂|想預約|幫我訂|定位/;
const CONFIRM_RE = /^(確認|正確|沒問題|ok)$/i;
const GREET_RE = /^(你好|您好|嗨|哈囉|在嗎|謝謝你?|感謝|早安|晚安|掰掰|拜拜|哈哈+|呵呵)[!！。.\s～~]*$/;
const INFO_RE = /營業|地址在|菜單|怎麼走|停車|包廂|幾點關|幾點開|好吃嗎|有位置嗎/;

/** Examples locked by tests. Keep RULES.md in sync. */
export const RULE_EXAMPLES = [
  {
    name: 'booking',
    text: '我要訂位，我是測試一，電話0900000000，明天12:00，4位',
    context: {},
    category: 'booking',
    reason: 'booking_keyword'
  },
  {
    name: 'booking_fields',
    text: '我是測試一，電話0900000000，明天12:00，4位',
    context: {},
    category: 'booking',
    reason: 'booking_fields'
  },
  {
    name: 'confirm_draft',
    text: '確認',
    context: { awaitingConfirmation: true },
    category: 'booking',
    reason: 'confirm_draft'
  },
  {
    name: 'cancel',
    text: '取消訂單 SMC900001，手機0900000000',
    context: {},
    category: 'cancel',
    reason: 'cancel_keyword'
  },
  {
    name: 'cancel_negated',
    text: '不要取消，我要訂位',
    context: {},
    category: 'booking',
    reason: 'booking_keyword'
  },
  {
    name: 'chitchat_greeting',
    text: '你好',
    context: {},
    category: 'chitchat',
    reason: 'chitchat_greeting'
  },
  {
    name: 'chitchat_info',
    text: '你好，請問營業到幾點？',
    context: {},
    category: 'chitchat',
    reason: 'chitchat_info'
  },
  {
    name: 'unknown',
    text: '今天天氣真好',
    context: {},
    category: 'unknown',
    reason: 'no_rule'
  }
];

function extractText(input) {
  if (!input || typeof input !== 'object') return null;
  const event = input.event && typeof input.event === 'object' ? input.event : input;
  if (!event.message || typeof event.message !== 'object') return null;
  if (event.message.type !== 'text' || typeof event.message.text !== 'string') return null;
  const text = event.message.text.replace(/^\s+|\s+$/g, '');
  return text ? text : null;
}

function hasFieldBundle(text) {
  const phone = /09\d{8}/.test(text);
  const when = /今天|明天|後天|大後天|\d{1,2}\s*月\s*\d{1,2}|\d{1,2}\s*[\/／]\s*\d{1,2}|\d{1,2}\s*[:：]\s*\d{2}|\d{1,2}\s*點/.test(text);
  const people = /人數|\d+\s*位/.test(text);
  return phone && when && people;
}

/**
 * Deep-copy a webhook/classify payload. Callers never hand the live event to
 * rule code or to an injected classify function.
 */
export function cloneClassifyInput(input) {
  return structuredClone(input);
}

/**
 * Deterministic local rules. No outbound classifier call.
 * Operates on a deep clone so rule code cannot mutate the caller's event.
 * @returns {{category: string, confidence: number, reason: string}}
 */
export function classifyMessage(input) {
  const source = cloneClassifyInput(input);
  const text = extractText(source);
  const ctx = source && source.context && typeof source.context === 'object' ? source.context : {};
  if (text == null) {
    return { category: 'unknown', confidence: 0.95, reason: 'no_text' };
  }
  if (CANCEL_RE.test(text) && !CANCEL_NEG_RE.test(text)) {
    return { category: 'cancel', confidence: 0.92, reason: 'cancel_keyword' };
  }
  if (BOOKING_RE.test(text)) {
    return { category: 'booking', confidence: 0.9, reason: 'booking_keyword' };
  }
  if (ctx.awaitingConfirmation === true && CONFIRM_RE.test(text)) {
    return { category: 'booking', confidence: 0.86, reason: 'confirm_draft' };
  }
  if (hasFieldBundle(text)) {
    return { category: 'booking', confidence: 0.78, reason: 'booking_fields' };
  }
  if (GREET_RE.test(text)) {
    return { category: 'chitchat', confidence: 0.84, reason: 'chitchat_greeting' };
  }
  if (INFO_RE.test(text)) {
    return { category: 'chitchat', confidence: 0.8, reason: 'chitchat_info' };
  }
  return { category: 'unknown', confidence: 0.4, reason: 'no_rule' };
}

function isEmptyResult(raw) {
  if (raw == null || raw === '') return true;
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0) return true;
  return false;
}

function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not_object' };
  if (CATEGORIES.indexOf(raw.category) === -1) return { ok: false, error: 'bad_category' };
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
    return { ok: false, error: 'bad_confidence' };
  }
  if (typeof raw.reason !== 'string' || raw.reason.length === 0 || raw.reason.length > 80) {
    return { ok: false, error: 'bad_reason' };
  }
  return {
    ok: true,
    value: { category: raw.category, confidence: raw.confidence, reason: raw.reason }
  };
}

function safeErr(err) {
  const msg = String(err && err.message ? err.message : err);
  return msg.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/sk-[A-Za-z0-9]+/g, '[redacted]').slice(0, 120);
}

function eventOf(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.event && typeof input.event === 'object') return input.event;
  return input;
}

function webhookEventIdOf(input) {
  const event = eventOf(input);
  return event && typeof event.webhookEventId === 'string' ? event.webhookEventId : '';
}

function messageIdOf(input) {
  const event = eventOf(input);
  const id = event && event.message && event.message.id;
  return typeof id === 'string' ? id : '';
}

/**
 * Run classification for the isolate log only.
 * Timeout, throw, empty, and malformed results become status failures.
 * The record's action is always `none` and followed is always false.
 * Extra fields on a classifier payload (tables, amount, bypass flags) are dropped.
 */
export function observeClassification(input, options) {
  const opts = options || {};
  const budgetMs = opts.budgetMs == null ? DEFAULT_BUDGET_MS : opts.budgetMs;
  const clock = typeof opts.clock === 'function' ? opts.clock : () => Date.now();
  const classify = typeof opts.classify === 'function' ? opts.classify : classifyMessage;
  const started = clock();
  const webhookEventId = webhookEventIdOf(input);
  const messageId = messageIdOf(input);
  let raw;
  let status = 'ok';
  let error = null;
  let value = null;
  let classifyInput = null;
  try {
    classifyInput = cloneClassifyInput(input);
  } catch (err) {
    status = 'exception';
    error = safeErr(err);
  }
  if (status === 'ok') {
    try {
      raw = classify(classifyInput, { budgetMs: budgetMs, clock: clock, startedAt: started });
    } catch (err) {
      const timedOut = !!(err && (err.code === 'CLASSIFY_TIMEOUT' || err.name === 'ClassifyTimeoutError'));
      status = timedOut ? 'timeout' : 'exception';
      error = timedOut ? 'timeout' : safeErr(err);
    }
  }
  if (status === 'ok') {
    let elapsed = 0;
    try {
      elapsed = clock() - started;
    } catch (err) {
      status = 'exception';
      error = safeErr(err);
    }
    if (status === 'ok' && !(elapsed <= budgetMs)) {
      status = 'timeout';
      error = 'budget_exceeded';
    }
  }
  if (status === 'ok') {
    if (isEmptyResult(raw)) {
      status = 'empty';
      error = 'empty_result';
    } else {
      const norm = normalizeResult(raw);
      if (!norm.ok) {
        status = 'malformed';
        error = norm.error;
      } else {
        value = norm.value;
      }
    }
  }
  const record = {
    ts: opts.ts || new Date().toISOString(),
    kind: 'line_classify',
    shadow: true,
    followed: false,
    action: 'none',
    webhookEventId: webhookEventId,
    messageId: messageId,
    category: value ? value.category : null,
    confidence: value ? value.confidence : null,
    reason: value ? value.reason : null,
    status: status,
    error: error,
    logPath: opts.logPath || LOG_PATH
  };
  if (opts.sink && typeof opts.sink.push === 'function') opts.sink.push(record);
  return record;
}
