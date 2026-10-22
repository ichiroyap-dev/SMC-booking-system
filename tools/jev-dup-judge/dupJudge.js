/**
 * Jev duplicate-booking judge (SMC 水美土雞城) — ISOLATED DRAFT, LOG-ONLY, NO_DEPLOY.
 *
 * Pattern (entity alignment): deterministic code proposes candidate duplicate
 * pairs; Jev (OpenRouter Decisions API, shadow mode) only returns a typed
 * verdict MERGE / REVIEW / SEPARATE plus a probability. This module NEVER
 * writes to any sheet, never merges, never cancels. Fail-open: any error ->
 * log and continue.
 *
 * Runtime: plain ES2015 so it can be pasted into Apps Script (V8) later or
 * required from Node (module.exports at the bottom). No network I/O happens
 * here unless the caller injects a `transport` function.
 *
 * Sheet facts (工作表1, 0-based index): A0 timestamp, B1 name, C2 phone,
 * E4 date, F5 餐別, G6 time, H7 備註 (plan code e.g. 4.5k2a), I8 桌數,
 * J9 訂單編號, K10 status. Column M (預估金額) is intentionally ignored.
 * Takeout lives in tab 外帶訂單 (column map is configurable; see README).
 */
'use strict';

var DINE_IN_COLUMNS = { timestamp: 0, name: 1, phone: 2, date: 4, meal: 5, time: 6, note: 7, tables: 8, id: 9, status: 10 };
// ASSUMPTION (open question): 外帶訂單 uses the same layout. Override via opts.takeoutColumns.
var TAKEOUT_COLUMNS = DINE_IN_COLUMNS;

var VERDICTS = ['MERGE', 'REVIEW', 'SEPARATE'];
var DEFAULT_MODEL = '~typesafe/jev-latest';
var DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
var NAME_SIM_THRESHOLD = 0.8;
var HONORIFICS = ['先生', '小姐', '同學', '太太', '女士', '老師', '媽媽', '爸爸', '阿姨', '哥', '姐'];
var CANCELLED_RE = /取消|cancel/i;

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** Normalise a sheet date cell (Date, '9/27', '2026/9/27', '2026-09-27') to 'MM-DD' (year-less on purpose; the sheet mixes both). */
function normalizeDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
  }
  var s = String(v).trim();
  var m = s.match(/(?:(\d{4})[\/\-.])?(\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return s;
  return pad2(parseInt(m[2], 10)) + '-' + pad2(parseInt(m[3], 10));
}

/** Parse 'HH:MM' (or Date) into minutes since midnight; NaN if unknown. */
function timeToMinutes(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) return v.getHours() * 60 + v.getMinutes();
  var m = String(v).match(/(\d{1,2})[:：](\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN;
}

/** 餐別 -> 'lunch' | 'dinner' | ''. Falls back to time (< 16:00 = lunch) when 餐別 is blank (e.g. takeout). */
function normalizeMeal(meal, time) {
  var s = String(meal || '');
  if (/午|中午|lunch/i.test(s)) return 'lunch';
  if (/晚|dinner/i.test(s)) return 'dinner';
  var t = timeToMinutes(time);
  if (!isNaN(t)) return t < 16 * 60 ? 'lunch' : 'dinner';
  return '';
}

/** Digits only; returns '' for placeholders like 'line訂' or anything shorter than 8 digits. */
function normalizePhone(v) {
  var digits = String(v || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : '';
}
function isPhonePlaceholder(v) {
  var s = String(v || '').trim();
  return s !== '' && normalizePhone(s) === '';
}

function normalizeName(v) { return String(v || '').replace(/[\s\u3000()（）.,，、]/g, '').toLowerCase(); }
function stripHonorific(n) {
  for (var i = 0; i < HONORIFICS.length; i++) {
    var h = HONORIFICS[i];
    if (n.length > h.length && n.slice(-h.length) === h) return n.slice(0, -h.length);
  }
  return n;
}

/**
 * Name similarity in [0,1]. Surname-only names (e.g. 陳先生 -> 陳) compare the
 * full raw string, so 陳先生 vs 陳小姐 = 0 but 陳先生 vs 陳先生 = 1.
 */
function nameSimilarity(a, b) {
  var na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  var sa = stripHonorific(na), sb = stripHonorific(nb);
  if (sa.length <= 1 || sb.length <= 1) return 0;
  if (sa === sb) return 0.95;
  if (sa.indexOf(sb) !== -1 || sb.indexOf(sa) !== -1) return 0.85;
  // character bigram Dice coefficient
  var bg = function (s) { var o = {}; for (var i = 0; i < s.length - 1; i++) { var k = s.substr(i, 2); o[k] = (o[k] || 0) + 1; } return o; };
  var A = bg(sa), B = bg(sb), inter = 0, ca = 0, cb = 0, k;
  for (k in A) { ca += A[k]; if (B[k]) inter += Math.min(A[k], B[k]); }
  for (k in B) cb += B[k];
  return ca + cb === 0 ? 0 : (2 * inter) / (ca + cb);
}

/** Plan code from 備註, e.g. '4.5k2a 大人4' -> '4.5k2a'. '' if none. */
function parsePlanCode(note) {
  var m = String(note || '').match(/(\d+(?:\.\d+)?k\d+a?)/i);
  return m ? m[1].toLowerCase() : '';
}

/** Convert raw sheet rows (2D array incl. or excl. header) to booking records. */
function rowsToBookings(values, channel, columns) {
  var c = columns || (channel === 'takeout' ? TAKEOUT_COLUMNS : DINE_IN_COLUMNS);
  var out = [];
  (values || []).forEach(function (r, i) {
    if (!r) return;
    var id = String(r[c.id] || '').trim();
    var name = String(r[c.name] || '').trim();
    if (!id && !name) return;
    if (/訂單編號|姓名/.test(id + name)) return; // header row
    out.push({
      rowIndex: i,
      channel: channel,
      id: id,
      name: name,
      phoneRaw: String(r[c.phone] || '').trim(),
      phone: normalizePhone(r[c.phone]),
      date: normalizeDate(r[c.date]),
      meal: normalizeMeal(r[c.meal], r[c.time]),
      time: String(r[c.time] || '').trim(),
      note: String(r[c.note] || '').trim(),
      planCode: parsePlanCode(r[c.note]),
      tables: String(r[c.tables] || '').trim(),
      status: String(r[c.status] || '').trim(),
      cancelled: CANCELLED_RE.test(String(r[c.status] || ''))
    });
  });
  return out;
}

/** Deterministic signals for a pair. */
function pairSignals(a, b) {
  var ta = timeToMinutes(a.time), tb = timeToMinutes(b.time);
  return {
    sameDate: !!a.date && a.date === b.date,
    sameMeal: !!a.meal && a.meal === b.meal,
    nameSimilarity: Math.round(nameSimilarity(a.name, b.name) * 100) / 100,
    samePhone: !!a.phone && a.phone === b.phone,
    phonePlaceholder: isPhonePlaceholder(a.phoneRaw) || isPhonePlaceholder(b.phoneRaw),
    samePlanCode: !!a.planCode && a.planCode === b.planCode,
    sameTables: !!a.tables && a.tables === b.tables,
    timeDiffMin: isNaN(ta) || isNaN(tb) ? null : Math.abs(ta - tb),
    crossChannel: a.channel !== b.channel,
    anyCancelled: !!(a.cancelled || b.cancelled),
    bothCancelled: !!(a.cancelled && b.cancelled)
  };
}

/**
 * Generate candidate duplicate pairs. A pair is a candidate only if it has the
 * same date AND same meal slot AND (a real phone match OR name similarity >=
 * threshold). Placeholder phones such as 'line訂' never count as a match.
 * opts: { activeOnly (default false), nameThreshold }
 */
function generateCandidates(dineIn, takeout, opts) {
  opts = opts || {};
  var th = opts.nameThreshold || NAME_SIM_THRESHOLD;
  var all = (dineIn || []).concat(takeout || []);
  var buckets = {};
  all.forEach(function (b) {
    if (!b.date || !b.meal) return;
    var k = b.date + '|' + b.meal;
    (buckets[k] = buckets[k] || []).push(b);
  });
  var out = [];
  Object.keys(buckets).sort().forEach(function (k) {
    var list = buckets[k];
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        var a = list[i], b = list[j];
        if (a.id && a.id === b.id && a.channel === b.channel) continue;
        var s = pairSignals(a, b);
        if (s.bothCancelled) continue;
        if (opts.activeOnly && s.anyCancelled) continue;
        var reasons = [];
        if (s.samePhone) reasons.push('same_phone');
        if (s.nameSimilarity >= th) reasons.push('similar_name');
        if (!reasons.length) continue;
        if (s.samePlanCode) reasons.push('same_plan_code');
        if (s.crossChannel) reasons.push('dine_in_vs_takeout');
        out.push({ key: k, a: a, b: b, signals: s, reasons: reasons });
      }
    }
  });
  return out;
}

function publicView(x) {
  return { id: x.id, channel: x.channel === 'takeout' ? '外帶' : '內用', name: x.name, phone: x.phoneRaw, date: x.date,
    meal: x.meal, time: x.time, note: x.note, plan_code: x.planCode, tables: x.tables, status: x.status };
}

/** Build the Decisions API payload for one candidate pair. */
function buildJevRequest(cand, model) {
  return {
    model: model || DEFAULT_MODEL,
    state: {
      context: '水美土雞城訂位表（內用 工作表1、外帶 外帶訂單）。判斷兩筆是否為同一組客人重複登記。' +
        '備註是方案代碼（如 4.5k2a，a=桌）。電話欄若為 line訂 表示從 LINE 下單、沒有真電話，不能當作同一人的證據。' +
        '內用與外帶同日同人可能是兩筆不同需求。',
      booking_a: publicView(cand.a),
      booking_b: publicView(cand.b),
      deterministic_signals: cand.signals,
      candidate_reasons: cand.reasons
    },
    questions: {
      verdict: {
        type: 'choice',
        instructions: '這兩筆訂單應如何處理？只做建議，系統不會自動合併或取消。',
        criteria: {
          MERGE: '幾乎確定是同一組客人同一次用餐被重複寫入（應保留一筆、另一筆取消）。',
          REVIEW: '證據不足或互相矛盾，需要店員人工確認。',
          SEPARATE: '是兩筆不同的訂單（不同客人、不同需求，或內用與外帶各一筆）。'
        }
      },
      same_booking: {
        type: 'noul',
        instructions: '這兩筆是否為同一次用餐的重複登記？',
        criteria: { 'true': '同一組客人、同一餐、同一需求被寫了兩次。', 'false': '兩筆代表不同的訂單。' }
      }
    }
  };
}

/** Parse a Decisions API response into { verdict, probability, confidence, probabilities }. Throws on bad shape. */
function parseJevResponse(body) {
  var ans = body && body.answers;
  if (!ans || !ans.verdict || ans.verdict.type !== 'choice' || !ans.same_booking || ans.same_booking.type !== 'noul') {
    throw new Error('unexpected Jev response shape');
  }
  var v = String(ans.verdict.choice || '').toUpperCase();
  if (VERDICTS.indexOf(v) === -1) throw new Error('unknown verdict ' + v);
  var p = Number(ans.same_booking.noul);
  if (!(p >= 0 && p <= 1)) throw new Error('bad probability');
  // Consistency guard: never report MERGE when Jev itself says it is unlikely the same booking.
  if (v === 'MERGE' && p < 0.5) v = 'REVIEW';
  return { verdict: v, probability: p, confidence: ans.verdict.confidence, probabilities: ans.verdict.probabilities || null };
}

/**
 * Config. `props` may be Apps Script PropertiesService.getScriptProperties().getProperties()
 * or Node's process.env. Keys are NEVER hardcoded here.
 */
function readConfig(props) {
  props = props || {};
  var off = function (x) { return String(x) === '0' || String(x).toLowerCase() === 'false'; };
  return {
    apiKey: props.OPENROUTER_API_KEY || '',
    model: props.JEV_MODEL || DEFAULT_MODEL,
    enabled: !off(props.JEV_DUP_JUDGE_ENABLED) && !off(props.JEV_ROUTER_ENABLED)
  };
}

/**
 * Judge candidates. Log-only, fail-open, synchronous (Apps Script friendly).
 * deps: { config, transport(url, {method, headers, body}) -> {status, body(string|object)}, log(entry), now() }
 * Returns the array of log entries. Never throws.
 */
function judgeCandidates(cands, deps) {
  deps = deps || {};
  var cfg = deps.config || readConfig({});
  var log = deps.log || function () {};
  var now = deps.now || function () { return new Date().toISOString(); };
  var entries = [];
  (cands || []).forEach(function (c) {
    var e = { ts: now(), kind: 'dup_judge', shadow: true, followed: false, action: 'none',
      key: c.key, a_id: c.a.id, b_id: c.b.id, reasons: c.reasons, signals: c.signals,
      verdict: null, probability: null };
    try {
      if (!cfg.enabled) { e.skipped = 'disabled'; }
      else if (!cfg.apiKey) { e.error = 'missing OPENROUTER_API_KEY'; }
      else if (typeof deps.transport !== 'function') { e.skipped = 'no_transport'; }
      else {
        var res = deps.transport(DECISIONS_URL, {
          method: 'post',
          headers: { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildJevRequest(c, cfg.model))
        });
        if (!res || res.status < 200 || res.status >= 300) throw new Error('HTTP ' + (res && res.status));
        var body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
        var r = parseJevResponse(body);
        e.verdict = r.verdict; e.probability = r.probability; e.confidence = r.confidence; e.probabilities = r.probabilities;
      }
    } catch (err) {
      e.error = String(err && err.message || err).replace(/sk-or-[A-Za-z0-9_\-]+/g, '[redacted]');
    }
    try { log(e); } catch (ignore) { /* fail-open */ }
    entries.push(e);
  });
  return entries;
}

var DupJudge = {
  DINE_IN_COLUMNS: DINE_IN_COLUMNS, TAKEOUT_COLUMNS: TAKEOUT_COLUMNS, VERDICTS: VERDICTS, DECISIONS_URL: DECISIONS_URL,
  normalizeDate: normalizeDate, normalizeMeal: normalizeMeal, normalizePhone: normalizePhone, isPhonePlaceholder: isPhonePlaceholder,
  nameSimilarity: nameSimilarity, parsePlanCode: parsePlanCode, rowsToBookings: rowsToBookings, pairSignals: pairSignals,
  generateCandidates: generateCandidates, buildJevRequest: buildJevRequest, parseJevResponse: parseJevResponse,
  readConfig: readConfig, judgeCandidates: judgeCandidates
};
if (typeof module !== 'undefined' && module.exports) module.exports = DupJudge;
