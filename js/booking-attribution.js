/*
 * 預約來源（官網）。記在這次分頁，不寫進備註或收件畫面。
 * 網址列在帶參數時仍看得到 utm／gclid；隱私權告知只提到參數名稱。
 *
 * 沒有 utm_*、也沒有 gclid：source = direct/unknown。
 * 只有 gclid：source = 有點擊識別碼、來源待核對（不當成廣告，也不算 direct/unknown）。
 * 電話／LINE 人工建檔、來源不明：manualSource() 記「未知」。
 * 品牌／非品牌只認白名單與核准別名；原值另外保留。br!and 不會洗成 brand。
 *
 * 儲存讀寫失敗時改用同一個記憶體備援，且不可拋出。追蹤失敗不能擋住送單。
 * 帶標記的新進站整組替換（缺的 utm 或 gclid 清空）。完全無標記的站內導覽才保留前一組。
 * 閒置超過 30 分鐘，讀取時清除。
 *
 * 送出的來源字串會做試算表公式防護（= + - @ 開頭加單引號）。cleanToken 只去掉控制字元。
 * 正式寫入的 Apps Script 不在本 repo，是否忽略新欄位是「待驗證」。見 docs/booking-attribution.md。
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SmcAttribution = api;
    if (root && root.document) api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var STORAGE_KEY = 'smc_visit_attribution_v1';
    var SUBMISSION_KEY = 'smc_submitted_order_ids_v1';
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
    var ADGROUP_BUCKETS = {
        brand: '品牌',
        '品牌': '品牌',
        nonbrand: '非品牌',
        non_brand: '非品牌',
        'non-brand': '非品牌',
        '非品牌': '非品牌'
    };

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
        return { utm: {}, gclid: '', seenAt: 0 };
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

    function resolveStorage(win) {
        try {
            if (win && win.__smcAttrStorage) return win.__smcAttrStorage;
        } catch (err) {}
        var nativeStore = null;
        try {
            nativeStore = win ? win.sessionStorage : null;
        } catch (err) {
            nativeStore = null;
        }
        var storage = memoryStorage();
        if (nativeStore) {
            try {
                nativeStore.setItem('__smc_attr_probe', '1');
                try { nativeStore.removeItem('__smc_attr_probe'); } catch (err) {}
                storage = nativeStore;
            } catch (err) {
                storage = memoryStorage();
            }
        }
        try {
            if (win) win.__smcAttrStorage = storage;
        } catch (err) {}
        return storage;
    }

    function clockOf(now) {
        return typeof now === 'number' && isFinite(now) ? now : Date.now();
    }

    function readVisit(storage, now) {
        var clock = clockOf(now);
        try {
            var raw = readItem(storage, STORAGE_KEY);
            if (!raw) return emptyVisit();
            var parsed = JSON.parse(raw);
            var seenAt = parsed && typeof parsed.seenAt === 'number' ? parsed.seenAt : NaN;
            if (!isFinite(seenAt) || clock < seenAt || clock - seenAt >= VISIT_TTL_MS) {
                removeItem(storage, STORAGE_KEY);
                return emptyVisit();
            }
            var utm = {};
            var incoming = parsed && parsed.utm;
            if (incoming && typeof incoming === 'object') {
                UTM_KEYS.forEach(function (key) {
                    var value = cleanToken(incoming[key], 120);
                    if (value) utm[key] = value;
                });
            }
            return { utm: utm, gclid: cleanToken(parsed && parsed.gclid, 200), seenAt: seenAt };
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

    function persistVisit(storage, visit) {
        writeItem(storage, STORAGE_KEY, JSON.stringify({
            utm: visit.utm || {},
            gclid: visit.gclid || '',
            seenAt: visit.seenAt || 0
        }));
    }

    function capture(search, storage, now) {
        try {
            var clock = clockOf(now);
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
            var next = {
                utm: incoming.utm,
                gclid: incoming.gclid || '',
                seenAt: clock
            };
            persistVisit(storage, next);
            return next;
        } catch (err) {
            return emptyVisit();
        }
    }

    function classifyAdgroup(raw) {
        var trimmed = cleanToken(raw, 80);
        if (!trimmed) return { raw: '', bucket: '' };
        var bucket = ADGROUP_BUCKETS[trimmed] || ADGROUP_BUCKETS[trimmed.toLowerCase()] || '';
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

    function bookingFields(storage, now) {
        try {
            var visit = readVisit(storage, now);
            var utm = visit.utm || {};
            var tagged = hasUtm(utm);
            var group = classifyAdgroup(utm.utm_adgroup || '');
            var source = 'direct/unknown';
            if (tagged) source = utm.utm_source || 'utm_missing_source';
            else if (visit.gclid) source = GCLID_ONLY_SOURCE;
            return {
                source: plainSheetText(source),
                utmSource: plainSheetText(utm.utm_source || ''),
                utmMedium: plainSheetText(utm.utm_medium || ''),
                utmCampaign: plainSheetText(utm.utm_campaign || ''),
                utmContent: plainSheetText(utm.utm_content || ''),
                utmTerm: plainSheetText(utm.utm_term || ''),
                utmAdgroup: plainSheetText(group.raw),
                adgroupBucket: group.bucket,
                gclid: plainSheetText(visit.gclid || '')
            };
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

    function install(win) {
        try {
            if (!win || !win.document || win.__smcAttributionInstalled) return;
            win.__smcAttributionInstalled = true;
            var storage = resolveStorage(win);
            capture(win.location && win.location.search, storage);
            win.addEventListener('pageshow', function () {
                try { capture(win.location && win.location.search, resolveStorage(win)); } catch (err) {}
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
        VISIT_TTL_MS: VISIT_TTL_MS,
        ATTRIBUTION_KEYS: ATTRIBUTION_KEYS,
        GCLID_ONLY_SOURCE: GCLID_ONLY_SOURCE,
        MANUAL_STATUS_FIELDS: MANUAL_STATUS_FIELDS,
        capture: capture,
        parseLanding: parseLanding,
        bookingFields: bookingFields,
        emptyBookingFields: emptyBookingFields,
        classifyAdgroup: classifyAdgroup,
        normalizeAdgroup: normalizeAdgroup,
        adgroupBucket: adgroupBucket,
        plainSheetText: plainSheetText,
        manualSource: manualSource,
        bookingOutcomeCounts: bookingOutcomeCounts,
        recordSubmission: recordSubmission,
        resolveStorage: resolveStorage,
        install: install,
        memoryStorage: memoryStorage
    };
});
