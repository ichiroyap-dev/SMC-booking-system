/*
 * 預約來源（官網）。只存在這次分頁造訪，不寫進客人看得到的備註或收件畫面。
 *
 * 沒有 utm_*：source = direct/unknown，即使帶著 gclid 也不當成廣告。
 * 電話／LINE 人工建檔、來源不明：用 manualSource()，記「未知」（官網表單不會送這個值）。
 * 品牌／非品牌靠網址上的 utm_adgroup（brand / nonbrand）區分，報表再對照，不顯示在頁面上。
 *
 * 人工狀態欄不由網站送出，避免蓋掉店家已填的值：
 *   人工確認 confirmed、取消 cancelled、未到 noshow、到店 arrived、實收金額 revenue、更新時間 updatedAt
 * 預約送出、有效預約、到店實收分開計，bookingOutcomeCounts() 不加總這三個筆數。
 *
 * 正式寫入試算表的 Apps Script 不在本 repo，此檔沒有部署它。見 docs/booking-attribution.md。
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SmcAttribution = api;
    if (root && root.document) api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var STORAGE_KEY = 'smc_visit_attribution_v1';
    var SUBMISSION_KEY = 'smc_submitted_order_ids_v1';
    var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'utm_adgroup'];
    var MANUAL_STATUS_FIELDS = [
        { key: 'confirmed', label: '人工確認' },
        { key: 'cancelled', label: '取消' },
        { key: 'noshow', label: '未到' },
        { key: 'arrived', label: '到店' },
        { key: 'revenue', label: '實收金額' },
        { key: 'updatedAt', label: '更新時間' }
    ];

    function cleanToken(value, max) {
        if (value == null) return '';
        var text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
        if (!text) return '';
        if (text.length > max) text = text.slice(0, max);
        return text;
    }

    function emptyVisit() {
        return { utm: {}, gclid: '' };
    }

    function hasUtm(utm) {
        return !!utm && Object.keys(utm).length > 0;
    }

    function safeStorage(storage) {
        if (!storage) return memoryStorage();
        try {
            var probe = '__smc_attr_probe';
            storage.setItem(probe, '1');
            storage.removeItem(probe);
            return storage;
        } catch (err) {
            return memoryStorage();
        }
    }

    function memoryStorage() {
        var data = {};
        return {
            getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
            setItem: function (key, value) { data[key] = String(value); },
            removeItem: function (key) { delete data[key]; }
        };
    }

    function readVisit(storage) {
        if (!storage) return emptyVisit();
        try {
            var raw = storage.getItem(STORAGE_KEY);
            if (!raw) return emptyVisit();
            var parsed = JSON.parse(raw);
            var utm = {};
            var incoming = parsed && parsed.utm;
            if (incoming && typeof incoming === 'object') {
                UTM_KEYS.forEach(function (key) {
                    var value = cleanToken(incoming[key], 120);
                    if (value) utm[key] = value;
                });
            }
            return { utm: utm, gclid: cleanToken(parsed && parsed.gclid, 200) };
        } catch (err) {
            return emptyVisit();
        }
    }

    function parseLanding(search) {
        var query = search || '';
        if (query.charAt(0) === '?') query = query.slice(1);
        var params = new URLSearchParams(query);
        var utm = {};
        UTM_KEYS.forEach(function (key) {
            var value = cleanToken(params.get(key), 120);
            if (value) utm[key] = value;
        });
        return { utm: utm, gclid: cleanToken(params.get('gclid'), 200) };
    }

    function capture(search, storage) {
        var store = storage;
        var incoming = parseLanding(search);
        var prev = readVisit(store);
        if (!hasUtm(incoming.utm) && !incoming.gclid) return prev;
        var next = {
            utm: hasUtm(incoming.utm) ? incoming.utm : prev.utm,
            gclid: incoming.gclid || prev.gclid || ''
        };
        if (store) store.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
    }

    function normalizeAdgroup(raw) {
        var trimmed = cleanToken(raw, 80);
        if (!trimmed) return '';
        if (trimmed === '品牌') return 'brand';
        if (trimmed === '非品牌') return 'nonbrand';
        var value = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
        if (value === 'non_brand') return 'nonbrand';
        value = value.replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
        return value.slice(0, 40);
    }

    function adgroupBucket(code) {
        if (code === 'brand') return '品牌';
        if (code === 'nonbrand') return '非品牌';
        return '';
    }

    function bookingFields(storage) {
        var visit = readVisit(storage);
        var utm = visit.utm;
        var tagged = hasUtm(utm);
        var adgroup = normalizeAdgroup(utm.utm_adgroup || '');
        return {
            source: tagged ? (utm.utm_source || 'utm_missing_source') : 'direct/unknown',
            utmSource: utm.utm_source || '',
            utmMedium: utm.utm_medium || '',
            utmCampaign: utm.utm_campaign || '',
            utmContent: utm.utm_content || '',
            utmTerm: utm.utm_term || '',
            utmAdgroup: adgroup,
            adgroupBucket: adgroupBucket(adgroup),
            gclid: visit.gclid || ''
        };
    }

    function manualSource(channel, source) {
        var given = cleanToken(source, 80);
        if (given) return given;
        if (channel === 'phone' || channel === 'line') return '未知';
        return 'direct/unknown';
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
        if (!storage) return [];
        try {
            var parsed = JSON.parse(storage.getItem(SUBMISSION_KEY) || '[]');
            return Array.isArray(parsed) ? parsed.filter(function (id) { return typeof id === 'string' && id; }) : [];
        } catch (err) {
            return [];
        }
    }

    function recordSubmission(storage, orderId) {
        var id = cleanToken(orderId, 40);
        if (!id) return { counted: false, reason: 'missing' };
        var ids = readIdList(storage);
        if (ids.indexOf(id) !== -1) return { counted: false, reason: 'duplicate' };
        ids.push(id);
        if (ids.length > 100) ids = ids.slice(-100);
        if (storage) storage.setItem(SUBMISSION_KEY, JSON.stringify(ids));
        return { counted: true, reason: 'first' };
    }

    function install(win) {
        if (!win || !win.document || win.__smcAttributionInstalled) return;
        win.__smcAttributionInstalled = true;
        var storage = safeStorage(win.sessionStorage);
        win.__smcAttrStorage = storage;
        capture(win.location && win.location.search, storage);
        win.addEventListener('pageshow', function () {
            capture(win.location && win.location.search, storage);
        });
        win.document.addEventListener('click', function (event) {
            var target = event.target;
            var link = target && target.closest ? target.closest('a[href]') : null;
            if (!link) return;
            var href = link.getAttribute('href') || '';
            var kind = '';
            if (href.indexOf('tel:') === 0) kind = 'tel';
            else if (/^https?:\/\/line\.me\//.test(href)) kind = 'line';
            if (!kind) return;
            win.document.dispatchEvent(new CustomEvent('smc:contact-click', { detail: { kind: kind } }));
        }, true);
    }

    return {
        STORAGE_KEY: STORAGE_KEY,
        MANUAL_STATUS_FIELDS: MANUAL_STATUS_FIELDS,
        capture: capture,
        parseLanding: parseLanding,
        bookingFields: bookingFields,
        normalizeAdgroup: normalizeAdgroup,
        adgroupBucket: adgroupBucket,
        manualSource: manualSource,
        bookingOutcomeCounts: bookingOutcomeCounts,
        recordSubmission: recordSubmission,
        install: install,
        memoryStorage: memoryStorage
    };
});
