/*
 * 隔離驗收頁用。只判斷「能不能送到這個網址」以及「回應算不算成功」。
 * 不改官網，也不打開 SEND_ATTRIBUTION_TO_BACKEND。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SmcIsolatedCheck = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var LIVE_ID = 'AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q';
  var ALLOWED_DEPLOYMENT_IDS = ['ISOLATEDTEST'];
  var UNKNOWN_MESSAGE = '結果未知，先核對試算表、勿重送';
  var LOCK_KEY = 'smc_isolated_check_lock_v1';
  var PROBE_KEY = 'smc_isolated_check_probe_v1';
  var SUBMIT_TIMEOUT_MS = 30000;
  var STORAGE_BLOCKED = '瀏覽器存不了這次的鎖，已停住，沒有送出。';

  function unknownVerdict(orderId) {
    var id = typeof orderId === 'string' ? orderId.trim() : '';
    var message = UNKNOWN_MESSAGE;
    if (id) message += '。訂單編號：' + id;
    return { ok: false, kind: 'unknown', orderId: id, message: message, mailed: false };
  }

  function decodeDeploymentId(segment) {
    var current = segment;
    for (var i = 0; i < 3; i += 1) {
      var next;
      try {
        next = decodeURIComponent(current);
      } catch (err) {
        return null;
      }
      if (next === current) break;
      current = next;
    }
    return current;
  }

  function endpointProblem(url) {
    var value = url == null ? '' : String(url).trim();
    if (!value) return '請貼上隔離 web app 網址。';
    var parsed;
    try {
      parsed = new URL(value);
    } catch (err) {
      return '網址無法辨識。請貼 https://script.google.com/macros/s/部署編號/exec。';
    }
    if (parsed.protocol !== 'https:') return '網址必須是 https。';
    if (parsed.username || parsed.password) return '網址不可含帳號或密碼。';
    if (parsed.port) return '網址不可指定連接埠。';
    if (parsed.hostname === 'sweetmeichicken.com' || parsed.hostname.endsWith('.sweetmeichicken.com')) {
      return '這是正式官網，已停住，沒有送出。';
    }
    if (parsed.hostname !== 'script.google.com') return '網址必須是 script.google.com 的網路應用程式。';
    if (parsed.search || parsed.hash) return '網址不可帶查詢或錨點。';
    var parts = parsed.pathname.split('/');
    if (parts.length !== 5 || parts[0] !== '' || parts[1] !== 'macros' || parts[2] !== 's' || parts[4] !== 'exec' || !parts[3]) {
      return '網址必須是 /macros/s/部署編號/exec，後面不能再加路徑。';
    }
    var decoded = decodeDeploymentId(parts[3]);
    if (decoded == null) return '部署編號無法解讀。';
    if (decoded === LIVE_ID || parts[3] === LIVE_ID) return '這是正式 web app，已停住，沒有送出。請貼隔離部署的網址。';
    if (!/^[A-Za-z0-9_-]+$/.test(decoded)) return '部署編號格式不對。';
    var allowed = false;
    for (var i = 0; i < ALLOWED_DEPLOYMENT_IDS.length; i += 1) {
      if (ALLOWED_DEPLOYMENT_IDS[i] === decoded) allowed = true;
    }
    if (!allowed) return '這個部署編號不在隔離白名單，已停住，沒有送出。';
    return '';
  }

  function classifyResponse(body) {
    var parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      return unknownVerdict();
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return unknownVerdict();
    var orderId = '';
    if (typeof parsed.orderId === 'string') orderId = parsed.orderId.trim();
    else if (typeof parsed.orderId === 'number' && isFinite(parsed.orderId)) orderId = String(parsed.orderId);
    var mailed = parsed.mailed === true ? true : (parsed.mailed === false ? false : null);
    if (parsed.status === 'success' && orderId) {
      if (parsed.duplicate === true || parsed.wrote === false) {
        var dupMessage = typeof parsed.message === 'string' && parsed.message.trim()
          ? parsed.message.trim()
          : '這個編號已經收過，這次沒有新增。';
        return { ok: false, kind: 'error', orderId: orderId, message: dupMessage, mailed: false };
      }
      return { ok: true, kind: 'success', orderId: orderId, message: '', mailed: mailed };
    }
    if (parsed.status === 'error') {
      var detail = typeof parsed.message === 'string' && parsed.message.trim()
        ? parsed.message.trim()
        : '隔離後端沒有收下這筆。';
      return { ok: false, kind: 'error', message: detail, mailed: false };
    }
    if (parsed.status === 'unknown') {
      var unknown = unknownVerdict(orderId);
      if (typeof parsed.message === 'string' && parsed.message.indexOf('結果未知') !== -1) {
        unknown.message = parsed.message.trim();
        if (orderId && unknown.message.indexOf(orderId) === -1) unknown.message += '。訂單編號：' + orderId;
      }
      return unknown;
    }
    return unknownVerdict(orderId);
  }

  function memoryStore() {
    var data = {};
    return {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
      setItem: function (key, value) { data[key] = String(value); },
      removeItem: function (key) { delete data[key]; }
    };
  }

  function parseLock(raw) {
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      if (parsed.state !== 'submitting' && parsed.state !== 'unknown' && parsed.state !== 'done') return null;
      return { state: parsed.state, orderId: typeof parsed.orderId === 'string' ? parsed.orderId : '' };
    } catch (err) {
      return null;
    }
  }

  function storesFrom(getSession, getLocal) {
    var sessionStore = null;
    var localStore = null;
    try {
      sessionStore = typeof getSession === 'function' ? getSession() : null;
    } catch (err) {
      sessionStore = null;
    }
    try {
      localStore = typeof getLocal === 'function' ? getLocal() : null;
    } catch (err) {
      localStore = null;
    }
    return { sessionStore: sessionStore, localStore: localStore };
  }

  function roundTripStore(store) {
    if (!store) return false;
    var token = 'ok';
    try {
      store.setItem(PROBE_KEY, token);
      var seen = store.getItem(PROBE_KEY);
      try { store.removeItem(PROBE_KEY); } catch (err) {}
      return seen === token;
    } catch (err) {
      return false;
    }
  }

  function canPersist(sessionStore, localStore) {
    return roundTripStore(sessionStore) && roundTripStore(localStore);
  }

  function commitLock(sessionStore, localStore, state, orderId) {
    var body = JSON.stringify({ state: state, orderId: orderId || '' });
    var sessionOk = false;
    var localOk = false;
    try {
      if (sessionStore) {
        sessionStore.setItem(LOCK_KEY, body);
        sessionOk = sessionStore.getItem(LOCK_KEY) === body;
      }
    } catch (err) {
      sessionOk = false;
    }
    try {
      if (localStore) {
        localStore.setItem(LOCK_KEY, body);
        localOk = localStore.getItem(LOCK_KEY) === body;
      }
    } catch (err) {
      localOk = false;
    }
    if (sessionOk && localOk) return { ok: true, body: body };
    return { ok: false, reason: STORAGE_BLOCKED };
  }

  function writeLock(sessionStore, localStore, state, orderId) {
    return commitLock(sessionStore, localStore, state, orderId).body || JSON.stringify({ state: state, orderId: orderId || '' });
  }

  function readLock(sessionStore, localStore) {
    var localRaw = '';
    var sessionRaw = '';
    try { localRaw = localStore && localStore.getItem(LOCK_KEY) || ''; } catch (err) { localRaw = ''; }
    try { sessionRaw = sessionStore && sessionStore.getItem(LOCK_KEY) || ''; } catch (err) { sessionRaw = ''; }
    return parseLock(localRaw) || parseLock(sessionRaw);
  }

  function clearLock(sessionStore, localStore) {
    try { if (sessionStore) sessionStore.removeItem(LOCK_KEY); } catch (err) {}
    try { if (localStore) localStore.removeItem(LOCK_KEY); } catch (err) {}
  }

  function classifyFetch(response, body) {
    if (!response || response.type === 'opaque' || response.status === 0) return unknownVerdict();
    var status = Number(response.status);
    if (!(status >= 200 && status < 300)) return unknownVerdict();
    return classifyResponse(body);
  }

  return {
    LIVE_ID: LIVE_ID,
    ALLOWED_DEPLOYMENT_IDS: ALLOWED_DEPLOYMENT_IDS,
    UNKNOWN_MESSAGE: UNKNOWN_MESSAGE,
    LOCK_KEY: LOCK_KEY,
    SUBMIT_TIMEOUT_MS: SUBMIT_TIMEOUT_MS,
    STORAGE_BLOCKED: STORAGE_BLOCKED,
    writeLock: writeLock,
    commitLock: commitLock,
    canPersist: canPersist,
    storesFrom: storesFrom,
    readLock: readLock,
    clearLock: clearLock,
    memoryStore: memoryStore,
    endpointProblem: endpointProblem,
    classifyResponse: classifyResponse,
    classifyFetch: classifyFetch,
    unknownVerdict: unknownVerdict
  };
});
