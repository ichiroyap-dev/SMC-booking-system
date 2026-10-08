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
  var UNKNOWN_MESSAGE = '結果未知，先核對試算表、勿重送';

  function unknownVerdict() {
    return { ok: false, kind: 'unknown', message: UNKNOWN_MESSAGE };
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
    if (parsed.status === 'success' && orderId) {
      return { ok: true, kind: 'success', orderId: orderId, message: '' };
    }
    if (parsed.status === 'error') {
      var detail = typeof parsed.message === 'string' && parsed.message.trim()
        ? parsed.message.trim()
        : '隔離後端沒有收下這筆。';
      return { ok: false, kind: 'error', message: detail };
    }
    return unknownVerdict();
  }

  function classifyFetch(response, body) {
    if (!response || response.type === 'opaque' || response.status === 0) return unknownVerdict();
    return classifyResponse(body);
  }

  return {
    LIVE_ID: LIVE_ID,
    UNKNOWN_MESSAGE: UNKNOWN_MESSAGE,
    endpointProblem: endpointProblem,
    classifyResponse: classifyResponse,
    classifyFetch: classifyFetch,
    unknownVerdict: unknownVerdict
  };
});
