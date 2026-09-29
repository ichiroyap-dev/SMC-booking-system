/**
 * Offline stand-in of the documented official LINE guest path (NO_DEPLOY).
 *
 * 程式碼.js is not in this public repo. This file mirrors the order described
 * in the 2026-09-21 OA diagnosis: ignore non-text, 60s dedup, ID reply,
 * owner silence, then cancel-or-parse. It is NOT a line-by-line port and it
 * does not read classification output.
 *
 * Cancel / confirm checks are duplicated here on purpose so they cannot share
 * a module with the classifier. SpreadsheetApp and UrlFetchApp are the mock
 * services passed in; this file never touches the network.
 */
'use strict';

export const LINE_REPLY_URL = 'offline://line-reply';
export const SEAT_PER_TABLE = 10;
export const MAX_PEOPLE = 40;
export const DEDUP_TTL_SEC = 60;

export function createMockServices(options) {
  const opts = options || {};
  const counts = { urlFetch: 0, sheetAppend: 0, sheetUpdate: 0, cacheWrite: 0, cacheRead: 0 };
  const rows = (opts.rows || []).map((row) => Object.assign({}, row));
  const cache = new Map();
  const replies = [];
  const fetches = [];
  let orderSeq = opts.orderSeq == null ? 900100 : opts.orderSeq;
  const nowMs = opts.nowMs == null ? Date.parse('2026-09-29T04:00:00Z') : opts.nowMs;

  function cacheGet(key) {
    counts.cacheRead += 1;
    const hit = cache.get(key);
    if (!hit) return null;
    if (hit.expiresAt != null && nowMs > hit.expiresAt) return null;
    return hit.value;
  }
  function cachePut(key, value, ttlSec) {
    counts.cacheWrite += 1;
    const expiresAt = ttlSec == null ? null : nowMs + ttlSec * 1000;
    cache.set(key, { value: value, expiresAt: expiresAt });
  }
  function cacheRemove(key) {
    counts.cacheWrite += 1;
    cache.delete(key);
  }

  return {
    counts: counts,
    replies: replies,
    fetches: fetches,
    rows: rows,
    today: opts.today || { y: 2026, m: 9, d: 29 },
    ownerUserId: opts.ownerUserId || 'U0000000000000000000000000000aaaa',
    muted: Object.assign({}, opts.muted || {}),
    nextOrderId: function () {
      const id = 'SMC' + String(orderSeq);
      orderSeq += 1;
      return id;
    },
    CacheService: { get: cacheGet, put: cachePut, remove: cacheRemove },
    SpreadsheetApp: {
      findIndex: function (pred) {
        for (let i = 0; i < rows.length; i++) if (pred(rows[i])) return i;
        return -1;
      },
      appendRow: function (row) {
        counts.sheetAppend += 1;
        rows.push(row);
        return rows.length - 1;
      },
      updateRow: function (index, patch) {
        counts.sheetUpdate += 1;
        if (!rows[index]) throw new Error('row_missing');
        Object.assign(rows[index], patch);
      }
    },
    UrlFetchApp: {
      fetch: function (url, params) {
        if (typeof url !== 'string' || url.indexOf('offline://') !== 0) {
          throw new Error('external_api_blocked');
        }
        counts.urlFetch += 1;
        fetches.push({ url: url, params: params || {} });
        replies.push(params && params.replyText ? params.replyText : '');
        return {
          getResponseCode: function () { return 200; },
          getContentText: function () { return ''; }
        };
      }
    }
  };
}

export function textEvent(spec) {
  const id = spec.id;
  return {
    type: 'message',
    webhookEventId: id,
    replyToken: spec.replyToken || 'fake-reply-token',
    timestamp: spec.ts == null ? 1750000000000 : spec.ts,
    source: { type: 'user', userId: spec.user },
    message: { id: id, type: 'text', text: spec.text }
  };
}

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function ymd(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  return y + '-' + pad(m) + '-' + pad(d);
}

function addDays(today, n) {
  const dt = new Date(Date.UTC(today.y, today.m - 1, today.d + n));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function parseName(text) {
  const m = String(text).match(/(?:我是|姓名|貴姓)[:：\s]*([\u4e00-\u9fff]{2,8})/);
  return m ? m[1] : '';
}

export function parsePhone(text) {
  const m = String(text).match(/09\d{8}/);
  return m ? m[0] : '';
}

export function parseDate(text, today) {
  const s = String(text);
  const day = today || { y: 2026, m: 9, d: 29 };
  if (/大後天/.test(s)) return addDays(day, 3);
  if (/後天/.test(s)) return addDays(day, 2);
  if (/明天/.test(s)) return addDays(day, 1);
  if (/今天/.test(s)) return addDays(day, 0);
  const m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (m) return ymd(day.y, parseInt(m[1], 10), parseInt(m[2], 10));
  const m2 = s.match(/(\d{1,2})\s*[\/／]\s*(\d{1,2})/);
  if (m2) return ymd(day.y, parseInt(m2[1], 10), parseInt(m2[2], 10));
  return '';
}

export function parseTime(text) {
  const s = String(text);
  let h = null;
  let min = null;
  const colon = s.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  const dian = s.match(/(\d{1,2})\s*點\s*(\d{1,2})?/);
  if (colon) {
    h = parseInt(colon[1], 10);
    min = parseInt(colon[2], 10);
  } else if (dian) {
    h = parseInt(dian[1], 10);
    min = dian[2] == null ? 0 : parseInt(dian[2], 10);
  } else {
    return '';
  }
  if (h > 23 || min > 59) return '';
  if (/下午|晚上/.test(s) && h < 12) h += 12;
  return pad(h) + ':' + pad(min);
}

export function parsePeople(text) {
  const s = String(text);
  const labeled = s.match(/人數\s*[:：]?\s*(\d+)/);
  const wei = s.match(/(\d+)\s*位/);
  const raw = labeled ? labeled[1] : (wei ? wei[1] : '');
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return n > 0 ? n : 0;
}

export function parseBookingFields(text, today) {
  return {
    name: parseName(text),
    phone: parsePhone(text),
    date: parseDate(text, today),
    time: parseTime(text),
    people: parsePeople(text)
  };
}

export function normalizeInbound(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { ok: false };
  if (event.type !== 'message' || !event.message || typeof event.message !== 'object') return { ok: false };
  if (!event.source || typeof event.source !== 'object') return { ok: false };
  return { ok: true, event: event };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildPreContext(event, services) {
  if (!event) {
    return { hasDraft: false, awaitingConfirmation: false, dedupSeen: false, priorTurnCount: 0 };
  }
  const userId = event.source && event.source.userId ? event.source.userId : '';
  const dedupId = event.webhookEventId || (event.message && event.message.id) || '';
  const dedupSeen = dedupId ? services.CacheService.get('dedup:' + dedupId) != null : false;
  const draft = userId ? services.CacheService.get('draft:' + userId) : null;
  return {
    hasDraft: !!draft,
    awaitingConfirmation: !!(draft && draft.awaitingConfirmation),
    dedupSeen: !!dedupSeen,
    priorTurnCount: draft && draft.turns ? draft.turns : 0
  };
}

function sendReply(services, event, text, action) {
  services.UrlFetchApp.fetch(LINE_REPLY_URL, {
    method: 'post',
    contentType: 'application/json',
    replyToken: event.replyToken || '',
    replyText: text
  });
  return { action: action, reply: text };
}

function isPipelineCancel(text) {
  if (/不要取消|先別取消|先不要取消/.test(text)) return false;
  return /取消|撤銷|不訂了|不要訂了|cancel/i.test(text);
}

function isPipelineConfirm(text) {
  return /^(確認|正確|沒問題|ok)$/i.test(text);
}

function missingReply(draft) {
  const parts = [];
  if (!draft.name) parts.push('貴姓');
  if (!draft.phone) parts.push('手機');
  if (!draft.date) parts.push('日期');
  if (!draft.time) parts.push('時間');
  if (!draft.people) parts.push('人數');
  return '還差' + parts.join('、') + '。';
}

function confirmReply(draft) {
  return [
    '請確認訂位：',
    '姓名：' + draft.name,
    '手機：' + draft.phone,
    '日期：' + draft.date,
    '時間：' + draft.time,
    '人數：' + draft.people,
    '回覆「確認」完成；要改直接傳新資料。'
  ].join('\n');
}

function loadDraft(services, userId) {
  return services.CacheService.get('draft:' + userId) || {
    name: '',
    phone: '',
    date: '',
    time: '',
    people: 0,
    awaitingConfirmation: false,
    turns: 0
  };
}

function handleCancel(text, services, event) {
  const idMatch = text.match(/SMC\d{6,}/i);
  const phone = parsePhone(text);
  const orderId = idMatch ? idMatch[0].toUpperCase() : '';
  if (!orderId || !phone) {
    return sendReply(services, event, '請提供訂單編號與預訂手機，才能取消。', 'cancel_ask');
  }
  const idx = services.SpreadsheetApp.findIndex((row) => row.id === orderId && row.phone === phone);
  if (idx < 0) {
    return sendReply(services, event, '查無此訂單，請再確認編號與手機。', 'cancel_missing');
  }
  if (services.rows[idx].status === '取消') {
    return sendReply(services, event, '此訂單已經是取消狀態。', 'cancel_already');
  }
  services.SpreadsheetApp.updateRow(idx, { status: '取消' });
  return sendReply(services, event, '已為您取消訂單 ' + orderId + '。', 'cancel_ok');
}

function finalize(draft, services, event, userId) {
  const complete = draft.name && draft.phone && draft.date && draft.time && draft.people;
  if (!complete) {
    draft.awaitingConfirmation = false;
    services.CacheService.put('draft:' + userId, draft);
    return sendReply(services, event, missingReply(draft), 'need_fields');
  }
  if (draft.people > MAX_PEOPLE) {
    draft.awaitingConfirmation = false;
    services.CacheService.put('draft:' + userId, draft);
    return sendReply(services, event, '人數超過單次可預約上限，請電話洽詢。', 'over_capacity');
  }
  const dup = services.SpreadsheetApp.findIndex((row) =>
    row.phone === draft.phone && row.date === draft.date && row.time === draft.time && row.status !== '取消');
  if (dup >= 0) {
    services.CacheService.remove('draft:' + userId);
    return sendReply(services, event, '此手機在同時段已有訂位，未再開一筆。', 'duplicate');
  }
  const tables = Math.max(1, Math.ceil(draft.people / SEAT_PER_TABLE));
  const id = services.nextOrderId();
  services.SpreadsheetApp.appendRow({
    name: draft.name,
    phone: draft.phone,
    date: draft.date,
    time: draft.time,
    people: draft.people,
    tables: tables,
    id: id,
    status: '有效'
  });
  services.CacheService.remove('draft:' + userId);
  return sendReply(
    services,
    event,
    '已收到訂位。訂單編號 ' + id + '。姓名' + draft.name + '，' + draft.date + ' ' + draft.time + '，' + draft.people + ' 位，' + tables + ' 桌。',
    'opened'
  );
}

function handleBooking(text, services, event, userId) {
  const draft = loadDraft(services, userId);
  if (draft.awaitingConfirmation && isPipelineConfirm(text)) {
    return finalize(draft, services, event, userId);
  }
  const parsed = parseBookingFields(text, services.today);
  if (parsed.name) draft.name = parsed.name;
  if (parsed.phone) draft.phone = parsed.phone;
  if (parsed.date) draft.date = parsed.date;
  if (parsed.time) draft.time = parsed.time;
  if (parsed.people) draft.people = parsed.people;
  draft.turns = (draft.turns || 0) + 1;
  if (draft.people > MAX_PEOPLE) {
    draft.awaitingConfirmation = false;
    services.CacheService.put('draft:' + userId, draft);
    return sendReply(services, event, '人數超過單次可預約上限，請電話洽詢。', 'over_capacity');
  }
  const complete = !!(draft.name && draft.phone && draft.date && draft.time && draft.people);
  draft.awaitingConfirmation = complete;
  services.CacheService.put('draft:' + userId, draft);
  if (!complete) return sendReply(services, event, missingReply(draft), 'need_fields');
  return sendReply(services, event, confirmReply(draft), 'confirm_draft');
}

function dispatch(event, services, pre, text) {
  const userId = event.source && event.source.userId ? event.source.userId : '';
  const dedupId = event.webhookEventId || (event.message && event.message.id) || '';
  if (pre.dedupSeen) return { action: 'deduped', reply: null };
  if (dedupId) services.CacheService.put('dedup:' + dedupId, '1', DEDUP_TTL_SEC);
  if (/^(id|我的id)$/i.test(text)) {
    return sendReply(services, event, '您的 ID：' + userId, 'id');
  }
  if (userId && userId === services.ownerUserId) {
    if (/^(暫停|恢復|指令|說明|help)$/i.test(text)) {
      return sendReply(services, event, '管理指令：暫停、恢復。離線替身不執行暫停。', 'owner');
    }
    return { action: 'owner_silent', reply: null };
  }
  if (services.muted[userId]) return { action: 'human_mute', reply: null };
  if (isPipelineCancel(text)) return handleCancel(text, services, event);
  return handleBooking(text, services, event, userId);
}

/**
 * Replay one webhook event. `hooks.onPreParse` may record a classification;
 * its return value is ignored, exceptions are contained, and it is given a
 * clone of the pre-parse context so it cannot change dedup or the draft.
 */
export function runPipeline(event, services, hooks) {
  const inbound = normalizeInbound(event);
  const pre = buildPreContext(inbound.ok ? inbound.event : null, services);
  if (hooks && typeof hooks.onPreParse === 'function') {
    try {
      hooks.onPreParse(cloneJson(pre), inbound.ok ? inbound.event : null);
    } catch (err) {
      if (hooks.onHookError) {
        try { hooks.onHookError(err); } catch (_ignore) { /* fail-open: keep going */ }
      }
    }
  }
  if (!inbound.ok) return { action: 'ignore', reply: null };
  if (inbound.event.message.type !== 'text') return { action: 'ignore', reply: null };
  const text = String(inbound.event.message.text || '').replace(/^\s+|\s+$/g, '');
  if (!text) return { action: 'ignore', reply: null };
  return dispatch(inbound.event, services, pre, text);
}
