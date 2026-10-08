/*
 * 預約來源（官網）。記在這次分頁，不寫進備註或收件畫面。
 * 網址列在帶參數時仍看得到 utm／gclid；隱私權告知只提到參數名稱。
 *
 * 沒有 utm_*、也沒有 gclid：source = direct/unknown。
 * 只有 gclid：source = 有點擊識別碼、來源待核對（不當成廣告，也不算 direct/unknown）。
 * 電話／LINE 人工建檔、來源不明：manualSource() 記「未知」。
 * 品牌／非品牌：有 utm_adgroup 時只認白名單與核准別名。沒有 utm_adgroup 時，
 * 第一輪最終網址的 utm_content 只認 ag_brand→品牌、ag_geo_dining→非品牌。
 * 其他 utm_content（含 rsa_family、尚未投放的 ag_*）不當群組。br!and 不會洗成 brand。
 *
 * 儲存讀寫失敗時改用同一個記憶體備援，且不可拋出。追蹤失敗不能擋住送單。
 * 探測成功之後若寫入失敗，改把最新來源固定寫進共用記憶體，不再讀舊的原生紀錄。
 * 帶標記的新進站整組替換（缺的 utm 或 gclid 清空）。完全無標記的站內導覽才保留前一組。
 * pageshow 且 persisted 為 true：只讀既有紀錄並檢查期限，不解析網址。bfcache 還原時 type 可能仍是 navigate。
 * persisted 不是 true 時才看 Navigation Timing（navigate／reload／back_forward）。
 * 30 分鐘內同一條帶標記網址不是新造訪，不更新 seenAt。
 * 過期後的 reload、back_forward 不用舊網址參數恢復來源，記 direct/unknown。
 * 只有明確的 navigate 才寫帶標記進站。這不是已證實的新廣告點擊；同一 gclid 不是新點擊。
 * 省略、空白、讀不到或不明的導覽類型都不從網址建立來源。過期後沒有參數則記 direct/unknown。
 * 閒置超過 30 分鐘，讀取時清除。
 *
 * 九個來源欄位一律是字串。群組分類只允許「品牌」「非品牌」或空白。
 * 送出的來源字串會做試算表公式防護（= + - @ 開頭加單引號）。cleanToken 只去掉控制字元。
 * SEND_ATTRIBUTION_TO_BACKEND 預設 false：來源只留在這次分頁，正式 POST 不加新欄位。
 * 送出當下的 9 欄快照綁到回傳的訂單編號；同一編號不覆寫、不重複計。快照不進正式 POST。
 * 正式 Apps Script 不在本 repo。本機契約測試不能證明後端相容。見 docs/booking-attribution.md。
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SmcAttribution = api;
    if (root && root.document) api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var STORAGE_KEY = 'smc_visit_attribution_v1';
    var SUBMISSION_KEY = 'smc_submitted_order_ids_v1';
    var ORDER_ATTR_KEY = 'smc_order_attribution_v1';
    var VISIT_TTL_MS = 30 * 60 * 1000;
    var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'utm_adgroup'];
    var ATTRIBUTION_KEYS = ['source', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', 'utmAdgroup', 'adgroupBucket', 'gclid'];
    var GCLID_ONLY_SOURCE = '有點擊識別碼、來源待核對';
    var MANUAL_STATUS_FIELDS = [
        { key: 'confirmed', label: '人工確認' },
        { key: 'cancelled', label: '取消' },
        { key: 'noshow', label: '未到' },
        { key: 'arrived', label: '到店' },
        { key: 'revenue', label: '實收金額' },
        { key: 'updatedAt', label: '更新時間' }
    ];
    // 無原型，避免 __proto__ / constructor / toString 被當成分類結果。
    var ADGROUP_BUCKETS = Object.create(null);
    ADGROUP_BUCKETS.brand = '品牌';
    ADGROUP_BUCKETS['品牌'] = '品牌';
    ADGROUP_BUCKETS.nonbrand = '非品牌';
    ADGROUP_BUCKETS.non_brand = '非品牌';
    ADGROUP_BUCKETS['non-brand'] = '非品牌';
    ADGROUP_BUCKETS['非品牌'] = '非品牌';
    // 第一輪最終到達網址把廣告群組放在 utm_content，沒有 utm_adgroup。只認這兩個原值。
    var CONTENT_GROUP_BUCKETS = Object.create(null);
    CONTENT_GROUP_BUCKETS.ag_brand = '品牌';
    CONTENT_GROUP_BUCKETS.ag_geo_dining = '非品牌';
    var storageFallbacks = typeof WeakMap === 'function' ? new WeakMap() : null;
    // 預設關閉。隔離環境確認寫表與寄信之後，才把這行改成 true，並另案部署靜態官網。
    // 本機契約測試不能證明後端相容，也不能當作打開這行的理由。
    var SEND_ATTRIBUTION_TO_BACKEND = false;
    var ORIGINAL_PAYLOAD_KEYS = ['action', 'type', 'name', 'phone', 'email', 'people', 'tables', 'date', 'time', 'note', 'orderItems'];

    function cleanToken(value, max) {
        if (value == null) return '';
        var text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
        if (!text) return '';
        if (text.length > max) text = text.slice(0, max);
        return text;
    }

    function plainSheetText(value) {
        var text = value == null ? '' : String(value);
        if (!text) return '';
        if (/^[=+\-@]/.test(text)) return "'" + text;
        return text;
    }

    function emptyVisit() {
        return { utm: {}, gclid: '', seenAt: 0, sig: '' };
    }

    function signatureOf(utm, gclid) {
        var canonical = {};
        var source = utm || {};
        UTM_KEYS.forEach(function (key) {
            var value = cleanToken(source[key], 120);
            if (value) canonical[key] = value;
        });
        return JSON.stringify({ utm: canonical, gclid: cleanToken(gclid, 200) });
    }

    function activeStorage(storage) {
        if (!storage || !storageFallbacks) return storage;
        var mapped = storageFallbacks.get(storage);
        return mapped || storage;
    }

    function ensureFallback(storage) {
        var existing = storage && storageFallbacks ? storageFallbacks.get(storage) : null;
        if (existing) return existing;
        var memory = memoryStorage();
        if (storage && storageFallbacks) {
            try { storageFallbacks.set(storage, memory); } catch (err) {}
        }
        return memory;
    }

    function emptyBookingFields() {
        return {
            source: 'direct/unknown',
            utmSource: '',
            utmMedium: '',
            utmCampaign: '',
            utmContent: '',
            utmTerm: '',
            utmAdgroup: '',
            adgroupBucket: '',
            gclid: ''
        };
    }

    function hasUtm(utm) {
        return !!utm && Object.keys(utm).length > 0;
    }

    function memoryStorage() {
        var data = {};
        return {
            getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
            setItem: function (key, value) { data[key] = String(value); },
            removeItem: function (key) { delete data[key]; }
        };
    }

    function readItem(storage, key) {
        if (!storage) return null;
        try {
            return storage.getItem(key);
        } catch (err) {
            return null;
        }
    }

    function writeItem(storage, key, value) {
        if (!storage) return false;
        try {
            storage.setItem(key, value);
            return true;
        } catch (err) {
            return false;
        }
    }

    function removeItem(storage, key) {
        if (!storage) return;
        try {
            storage.removeItem(key);
        } catch (err) {}
    }

    function pinStorage(win, storage, asMemory) {
        try { if (win) win.__smcAttrStorage = storage; } catch (err) {}
        if (!asMemory) return;
        try { if (win) win.__smcAttrMemory = storage; } catch (err) {}
    }

    function resolveStorage(win) {
        var cached = null;
        try { cached = win && win.__smcAttrStorage; } catch (err) { cached = null; }
        if (cached) {
            var mapped = activeStorage(cached);
            if (mapped && mapped !== cached) pinStorage(win, mapped, true);
            return mapped || cached;
        }
        var nativeStore = null;
        try {
            nativeStore = win ? win.sessionStorage : null;
        } catch (err) {
            nativeStore = null;
        }
        var storage = memoryStorage();
        if (nativeStore) {
            var nativeMapped = activeStorage(nativeStore);
            if (nativeMapped !== nativeStore) {
                storage = nativeMapped;
            } else {
                try {
                    nativeStore.setItem('__smc_attr_probe', '1');
                    try { nativeStore.removeItem('__smc_attr_probe'); } catch (err) {}
                    storage = nativeStore;
                } catch (err) {
                    storage = ensureFallback(nativeStore);
                }
            }
        }
        pinStorage(win, storage, storage !== nativeStore);
        return storage;
    }

    function clockOf(now) {
        return typeof now === 'number' && isFinite(now) ? now : Date.now();
    }

    function isExpired(seenAt, clock) {
        return !isFinite(seenAt) || clock < seenAt || clock - seenAt >= VISIT_TTL_MS;
    }

    function utmFrom(raw) {
        var utm = {};
        if (!raw || typeof raw !== 'object') return utm;
        UTM_KEYS.forEach(function (key) {
            var value = cleanToken(raw[key], 120);
            if (value) utm[key] = value;
        });
        return utm;
    }

    function peekVisit(storage) {
        try {
            var raw = readItem(activeStorage(storage), STORAGE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (err) {
            return null;
        }
    }

    function readVisit(storage, now) {
        var clock = clockOf(now);
        var target = activeStorage(storage);
        try {
            var raw = readItem(target, STORAGE_KEY);
            if (!raw) return emptyVisit();
            var parsed = JSON.parse(raw);
            if (parsed && parsed.expired) return emptyVisit();
            var seenAt = parsed && typeof parsed.seenAt === 'number' ? parsed.seenAt : NaN;
            if (isExpired(seenAt, clock)) {
                var expiredUtm = utmFrom(parsed && parsed.utm);
                var expiredGclid = cleanToken(parsed && parsed.gclid, 200);
                var expiredSig = parsed && typeof parsed.sig === 'string' && parsed.sig
                    ? parsed.sig
                    : signatureOf(expiredUtm, expiredGclid);
                rememberExpired(storage, expiredSig);
                return emptyVisit();
            }
            var utm = utmFrom(parsed && parsed.utm);
            var gclid = cleanToken(parsed && parsed.gclid, 200);
            var sig = parsed && typeof parsed.sig === 'string' && parsed.sig ? parsed.sig : signatureOf(utm, gclid);
            return { utm: utm, gclid: gclid, seenAt: seenAt, sig: sig };
        } catch (err) {
            return emptyVisit();
        }
    }

    function parseLanding(search) {
        var query = search || '';
        if (query.charAt(0) === '?') query = query.slice(1);
        var params;
        try {
            params = new URLSearchParams(query);
        } catch (err) {
            return { utm: {}, gclid: '' };
        }
        var utm = {};
        UTM_KEYS.forEach(function (key) {
            var value = cleanToken(params.get(key), 120);
            if (value) utm[key] = value;
        });
        return { utm: utm, gclid: cleanToken(params.get('gclid'), 200) };
    }

    function rememberExpired(storage, sig) {
        var target = activeStorage(storage) || storage;
        if (!sig) {
            removeItem(target, STORAGE_KEY);
            return;
        }
        var body = JSON.stringify({ utm: {}, gclid: '', seenAt: 0, sig: sig, expired: true });
        if (!writeItem(target, STORAGE_KEY, body)) removeItem(target, STORAGE_KEY);
    }

    function persistVisit(storage, visit) {
        var body = JSON.stringify({
            utm: visit.utm || {},
            gclid: visit.gclid || '',
            seenAt: visit.seenAt || 0,
            sig: visit.sig || signatureOf(visit.utm || {}, visit.gclid || '')
        });
        var target = activeStorage(storage) || storage;
        if (writeItem(target, STORAGE_KEY, body)) return true;
        removeItem(target, STORAGE_KEY);
        if (target !== storage) removeItem(storage, STORAGE_KEY);
        var memory = ensureFallback(storage || target);
        if (target && target !== memory && storageFallbacks) {
            try { storageFallbacks.set(target, memory); } catch (err) {}
        }
        if (memory === target) return false;
        return writeItem(memory, STORAGE_KEY, body);
    }

    function canonicalNavType(type) {
        return type === 'navigate' || type === 'reload' || type === 'back_forward' ? type : '';
    }

    function navigationType(win) {
        try {
            var performance = win && win.performance;
            if (!performance || typeof performance.getEntriesByType !== 'function') return '';
            var entries = performance.getEntriesByType('navigation');
            var entry = entries && entries.length ? entries[0] : null;
            return canonicalNavType(entry && entry.type);
        } catch (err) {
            return '';
        }
    }

    // 帶標記進站：寫入這次網址上的 utm／gclid。同一 gclid 不是新廣告點擊的證據。
    function writeTaggedVisit(storage, incoming, clock, sig) {
        var next = {
            utm: incoming.utm,
            gclid: incoming.gclid || '',
            seenAt: clock,
            sig: sig
        };
        persistVisit(storage, next);
        return next;
    }

    function capture(search, storage, now, navType) {
        try {
            var clock = clockOf(now);
            var type = canonicalNavType(navType);
            var incoming = parseLanding(search);
            var tagged = hasUtm(incoming.utm) || !!incoming.gclid;
            if (!tagged) {
                var prev = readVisit(storage, clock);
                if (hasUtm(prev.utm) || prev.gclid) {
                    prev.seenAt = clock;
                    persistVisit(storage, prev);
                }
                return prev;
            }
            var sig = signatureOf(incoming.utm, incoming.gclid || '');
            var peeked = peekVisit(storage);
            var peekedSeen = peeked && typeof peeked.seenAt === 'number' ? peeked.seenAt : NaN;
            var peekedUtm = utmFrom(peeked && peeked.utm);
            var peekedGclid = cleanToken(peeked && peeked.gclid, 200);
            var peekedSig = peeked && typeof peeked.sig === 'string' && peeked.sig
                ? peeked.sig
                : (peeked ? signatureOf(peekedUtm, peekedGclid) : '');
            var priorLive = peeked && !peeked.expired && !isExpired(peekedSeen, clock);
            // 期限內同一條帶標記網址：沿用原造訪，不更新 seenAt。
            if (priorLive && peekedSig === sig) return readVisit(storage, clock);
            // 只有明確的 navigate 才從網址寫入帶標記進站。省略、空白、reload、back_forward、不明類型都不建立來源。
            if (type !== 'navigate') {
                if (priorLive) return readVisit(storage, clock);
                if (peeked) rememberExpired(storage, peekedSig || sig);
                return emptyVisit();
            }
            // 帶標記進站。同一 gclid 不是已證實的新廣告點擊。
            return writeTaggedVisit(storage, incoming, clock, sig);
        } catch (err) {
            return emptyVisit();
        }
    }

    function handlePageShow(win, event, now) {
        try {
            var storage = resolveStorage(win);
            // bfcache 還原時 Navigation Timing 可能仍是 navigate，所以 persisted 優先，且不解析網址。
            if (event && event.persisted === true) return readVisit(storage, now);
            return capture(win && win.location && win.location.search, storage, now, navigationType(win));
        } catch (err) {
            return emptyVisit();
        }
    }

    function lookupBucket(token) {
        if (!token || !Object.prototype.hasOwnProperty.call(ADGROUP_BUCKETS, token)) return '';
        var value = ADGROUP_BUCKETS[token];
        return value === '品牌' || value === '非品牌' ? value : '';
    }

    function classifyAdgroup(raw) {
        var trimmed = cleanToken(raw, 80);
        if (!trimmed) return { raw: '', bucket: '' };
        var bucket = lookupBucket(trimmed) || lookupBucket(trimmed.toLowerCase());
        if (bucket !== '品牌' && bucket !== '非品牌') bucket = '';
        return { raw: trimmed, bucket: bucket };
    }

    function normalizeAdgroup(raw) {
        var found = classifyAdgroup(raw);
        if (found.bucket === '品牌') return 'brand';
        if (found.bucket === '非品牌') return 'nonbrand';
        return '';
    }

    function adgroupBucket(raw) {
        return classifyAdgroup(raw).bucket;
    }

    function contentGroupBucket(raw) {
        var token = cleanToken(raw, 120);
        if (!token || !Object.prototype.hasOwnProperty.call(CONTENT_GROUP_BUCKETS, token)) return '';
        var value = CONTENT_GROUP_BUCKETS[token];
        return value === '品牌' || value === '非品牌' ? value : '';
    }

    // 有 utm_adgroup 就只看它（認不得就留白，不用 utm_content 蓋過）。
    // 沒有 utm_adgroup 才看第一輪最終網址的 utm_content。
    function resolveGroup(utm) {
        var source = utm || {};
        var group = classifyAdgroup(source.utm_adgroup || '');
        if (group.raw) {
            var fromAdgroup = group.bucket === '品牌' || group.bucket === '非品牌' ? group.bucket : '';
            return { raw: group.raw, bucket: fromAdgroup };
        }
        return { raw: '', bucket: contentGroupBucket(source.utm_content || '') };
    }

    function bookingFields(storage, now) {
        try {
            var visit = readVisit(storage, now);
            var utm = visit.utm || {};
            var tagged = hasUtm(utm);
            var group = resolveGroup(utm);
            var source = 'direct/unknown';
            if (tagged) source = utm.utm_source || 'utm_missing_source';
            else if (visit.gclid) source = GCLID_ONLY_SOURCE;
            var bucket = group.bucket === '品牌' || group.bucket === '非品牌' ? group.bucket : '';
            var fields = {
                source: plainSheetText(source),
                utmSource: plainSheetText(utm.utm_source || ''),
                utmMedium: plainSheetText(utm.utm_medium || ''),
                utmCampaign: plainSheetText(utm.utm_campaign || ''),
                utmContent: plainSheetText(utm.utm_content || ''),
                utmTerm: plainSheetText(utm.utm_term || ''),
                utmAdgroup: plainSheetText(group.raw),
                adgroupBucket: bucket,
                gclid: plainSheetText(visit.gclid || '')
            };
            ATTRIBUTION_KEYS.forEach(function (key) {
                if (typeof fields[key] !== 'string') fields[key] = '';
            });
            return fields;
        } catch (err) {
            return emptyBookingFields();
        }
    }

    function manualSource(channel, source) {
        try {
            var given = cleanToken(source, 80);
            if (given) return plainSheetText(given);
            if (channel === 'phone' || channel === 'line') return '未知';
            return 'direct/unknown';
        } catch (err) {
            return 'direct/unknown';
        }
    }

    function markedYes(value) {
        if (value === true) return true;
        var text = String(value == null ? '' : value).trim().toLowerCase();
        return text === '是' || text === 'y' || text === 'yes' || text === 'true';
    }

    function money(value) {
        if (typeof value === 'number' && isFinite(value)) return value;
        var parsed = Number(String(value == null ? '' : value).replace(/[^\d.-]/g, ''));
        return isFinite(parsed) ? parsed : 0;
    }

    function bookingOutcomeCounts(rows) {
        var seen = {};
        var submitted = 0;
        var valid = 0;
        var arrived = 0;
        var arrivedAmount = 0;
        (rows || []).forEach(function (row) {
            var id = cleanToken(row && row.orderId, 40);
            if (!id || seen[id]) return;
            seen[id] = true;
            submitted += 1;
            var cancelled = markedYes(row.cancelled);
            if (markedYes(row.confirmed) && !cancelled) valid += 1;
            if (markedYes(row.arrived)) {
                arrived += 1;
                arrivedAmount += money(row.revenue);
            }
        });
        return {
            submitted: submitted,
            valid: valid,
            arrived: arrived,
            arrivedAmount: arrivedAmount
        };
    }

    function readIdList(storage) {
        try {
            var parsed = JSON.parse(readItem(storage, SUBMISSION_KEY) || '[]');
            return Array.isArray(parsed) ? parsed.filter(function (id) { return typeof id === 'string' && id; }) : [];
        } catch (err) {
            return [];
        }
    }

    function recordSubmission(storage, orderId) {
        try {
            storage = activeStorage(storage);
            var id = cleanToken(orderId, 40);
            if (!id) return { counted: false, reason: 'missing' };
            var ids = readIdList(storage);
            if (ids.indexOf(id) !== -1) return { counted: false, reason: 'duplicate' };
            ids.push(id);
            if (ids.length > 100) ids = ids.slice(-100);
            if (!writeItem(storage, SUBMISSION_KEY, JSON.stringify(ids))) {
                return { counted: false, reason: 'unstored' };
            }
            return { counted: true, reason: 'first' };
        } catch (err) {
            return { counted: false, reason: 'error' };
        }
    }

    function attributionSendingEnabled() {
        return SEND_ATTRIBUTION_TO_BACKEND === true;
    }

    function copyOriginalPayload(base) {
        var payload = {};
        var source = base && typeof base === 'object' ? base : {};
        ORIGINAL_PAYLOAD_KEYS.forEach(function (key) {
            if (Object.prototype.hasOwnProperty.call(source, key)) payload[key] = source[key];
        });
        return payload;
    }

    function snapshotAttribution(fields) {
        var snap = {};
        var extra = fields && typeof fields === 'object' ? fields : null;
        ATTRIBUTION_KEYS.forEach(function (key) {
            snap[key] = extra && typeof extra[key] === 'string' ? extra[key] : '';
        });
        return snap;
    }

    // 預覽「旗標打開之後」的 POST。官網送出不呼叫這支；旗標維持關閉。
    function payloadIfAttributionEnabled(base, fields) {
        var payload = copyOriginalPayload(base);
        var extra = snapshotAttribution(fields);
        ATTRIBUTION_KEYS.forEach(function (key) {
            payload[key] = extra[key];
        });
        return payload;
    }

    function payloadForBooking(base, fields) {
        if (!attributionSendingEnabled()) return copyOriginalPayload(base);
        return payloadIfAttributionEnabled(base, fields);
    }

    function readOrderMap(storage) {
        var safe = Object.create(null);
        try {
            var parsed = JSON.parse(readItem(activeStorage(storage), ORDER_ATTR_KEY) || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return safe;
            Object.keys(parsed).forEach(function (key) {
                if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
                var id = cleanToken(key, 40);
                if (!id || id !== key) return;
                safe[id] = snapshotAttribution(parsed[key]);
            });
        } catch (err) {}
        return safe;
    }

    // 送出當下的快照綁到這個訂單編號。同一編號再綁不覆寫，避免後一筆造訪蓋掉前一筆。
    function bindOrderAttribution(storage, orderId, fields) {
        try {
            storage = activeStorage(storage);
            var id = cleanToken(orderId, 40);
            if (!id) return { bound: false, reason: 'missing' };
            var map = readOrderMap(storage);
            if (map[id]) return { bound: false, reason: 'duplicate', fields: snapshotAttribution(map[id]) };
            map[id] = snapshotAttribution(fields);
            var ids = Object.keys(map);
            if (ids.length > 100) {
                ids.slice(0, ids.length - 100).forEach(function (oldId) { delete map[oldId]; });
            }
            if (!writeItem(storage, ORDER_ATTR_KEY, JSON.stringify(map))) {
                return { bound: false, reason: 'unstored' };
            }
            return { bound: true, reason: 'first', fields: snapshotAttribution(map[id]) };
        } catch (err) {
            return { bound: false, reason: 'error' };
        }
    }

    function readOrderAttribution(storage, orderId) {
        try {
            var id = cleanToken(orderId, 40);
            if (!id) return null;
            var map = readOrderMap(storage);
            return map[id] ? snapshotAttribution(map[id]) : null;
        } catch (err) {
            return null;
        }
    }

    function listOrderAttributions(storage) {
        try {
            var map = readOrderMap(storage);
            return Object.keys(map).map(function (id) {
                return { orderId: id, fields: snapshotAttribution(map[id]) };
            });
        } catch (err) {
            return [];
        }
    }

    function install(win) {
        try {
            if (!win || !win.document || win.__smcAttributionInstalled) return;
            win.__smcAttributionInstalled = true;
            var storage = resolveStorage(win);
            capture(win.location && win.location.search, storage, undefined, navigationType(win));
            win.addEventListener('pageshow', function (event) {
                try { handlePageShow(win, event); } catch (err) {}
            });
            win.document.addEventListener('click', function (event) {
                try {
                    var target = event.target;
                    var link = target && target.closest ? target.closest('a[href]') : null;
                    if (!link) return;
                    var href = link.getAttribute('href') || '';
                    var kind = '';
                    if (href.indexOf('tel:') === 0) kind = 'tel';
                    else if (/^https?:\/\/line\.me\//.test(href)) kind = 'line';
                    if (!kind) return;
                    win.document.dispatchEvent(new CustomEvent('smc:contact-click', { detail: { kind: kind } }));
                } catch (err) {}
            }, true);
        } catch (err) {}
    }

    return {
        STORAGE_KEY: STORAGE_KEY,
        ORDER_ATTR_KEY: ORDER_ATTR_KEY,
        VISIT_TTL_MS: VISIT_TTL_MS,
        ATTRIBUTION_KEYS: ATTRIBUTION_KEYS,
        GCLID_ONLY_SOURCE: GCLID_ONLY_SOURCE,
        MANUAL_STATUS_FIELDS: MANUAL_STATUS_FIELDS,
        capture: capture,
        navigationType: navigationType,
        parseLanding: parseLanding,
        handlePageShow: handlePageShow,
        attributionSendingEnabled: attributionSendingEnabled,
        payloadForBooking: payloadForBooking,
        payloadIfAttributionEnabled: payloadIfAttributionEnabled,
        bookingFields: bookingFields,
        emptyBookingFields: emptyBookingFields,
        classifyAdgroup: classifyAdgroup,
        contentGroupBucket: contentGroupBucket,
        resolveGroup: resolveGroup,
        normalizeAdgroup: normalizeAdgroup,
        adgroupBucket: adgroupBucket,
        plainSheetText: plainSheetText,
        manualSource: manualSource,
        bookingOutcomeCounts: bookingOutcomeCounts,
        recordSubmission: recordSubmission,
        bindOrderAttribution: bindOrderAttribution,
        readOrderAttribution: readOrderAttribution,
        listOrderAttributions: listOrderAttributions,
        resolveStorage: resolveStorage,
        install: install,
        memoryStorage: memoryStorage
    };
});
