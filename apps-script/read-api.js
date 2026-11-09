// 貼進正式 Apps Script，不要整檔覆蓋。
// 1. 刪掉 ReservationWebhook 裡現在的 doGet。同專案只能留這一個 doGet。
// 2. 在「程式碼」的 doPost 最上面、拿鎖之前加兩行，其餘寫入不要改：
//      var readLookup = handleReadLookup_(e);
//      if (readLookup) return readLookup;
// 3. 指令碼屬性新增 READ_API_TOKEN。值由 Owner 自己填，不要寫進程式、不要提交。
//    沒設、空白、或讀取失敗，讀取一律拒絕。
// GET 不再讀表。窄查詢只收 POST JSON：action=lookup，權杖放 body.token。
// 查詢欄位只用 lookup_order_id、lookup_date、lookup_session、lookup_phone、lookup_name。
// 不要帶 date、phone、tel、mobile、orderId、orderID、order_id、bookingId、type、orderItems。
// action 不是 lookup 時，單獨的 token 或其他 op 要放行。只有 lookup_* 或查詢 op 才拒絕。

var READ_API_TOKEN_PROPERTY = "READ_API_TOKEN";
var READ_API_BLOCKED_KEYS = ["date", "phone", "tel", "mobile", "orderId", "orderID", "order_id", "bookingId", "type", "orderItems"];
var READ_API_LOOKUP_FIELDS = ["lookup_order_id", "lookup_date", "lookup_session", "lookup_phone", "lookup_name"];
var READ_API_LOOKUP_OPS = ["ping", "exists", "takeout_exists", "duplicate_check"];
var READ_API_DINING_HEADERS = [
  [1, "姓名"],
  [2, "電話"],
  [4, "日期"],
  [5, "時段"],
  [9, "訂單編號"],
  [10, "狀態"]
];

function readApiJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function readApiExpectedToken_() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props) return "";
    var value = props.getProperty(READ_API_TOKEN_PROPERTY);
    if (value == null) return "";
    return String(value).trim();
  } catch (err) {
    return "";
  }
}

function readApiTokenMatches_(presented) {
  var expected = readApiExpectedToken_();
  if (!expected) return false;
  if (typeof presented !== "string") return false;
  var given = presented.trim();
  var diff = expected.length === given.length ? 0 : 1;
  for (var i = 0; i < expected.length; i++) {
    var b = i < given.length ? given.charCodeAt(i) : 0;
    diff |= (expected.charCodeAt(i) ^ b);
  }
  return diff === 0;
}

function readApiBody_(e) {
  try {
    if (!e || !e.postData || e.postData.contents == null || e.postData.contents === "") return null;
    var parsed = e.postData.contents;
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!parsed || Object.prototype.toString.call(parsed) !== "[object Object]") return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function readApiHasBlockedKey_(body) {
  for (var i = 0; i < READ_API_BLOCKED_KEYS.length; i++) {
    if (Object.prototype.hasOwnProperty.call(body, READ_API_BLOCKED_KEYS[i])) return true;
  }
  return false;
}

function readApiHasLookupField_(body) {
  for (var i = 0; i < READ_API_LOOKUP_FIELDS.length; i++) {
    if (Object.prototype.hasOwnProperty.call(body, READ_API_LOOKUP_FIELDS[i])) return true;
  }
  return false;
}

function readApiIsLookupOp_(value) {
  if (typeof value !== "string") return false;
  for (var i = 0; i < READ_API_LOOKUP_OPS.length; i++) {
    if (value === READ_API_LOOKUP_OPS[i]) return true;
  }
  return false;
}

function readApiRequestText_(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

function doGet(e) {
  // 不讀參數。網址上的分頁名稱與權杖都不能換成資料。
  return readApiJson_({ ok: false, error: "unauthorized" });
}

function handleReadLookup_(e) {
  var body = readApiBody_(e);
  if (!body) return null;
  if (body.action !== "lookup") {
    if (readApiHasLookupField_(body) || readApiIsLookupOp_(body.op)) {
      return readApiJson_({ ok: false, error: "bad_request" });
    }
    return null;
  }
  if (!readApiTokenMatches_(body.token)) return readApiJson_({ ok: false, error: "unauthorized" });
  if (readApiHasBlockedKey_(body)) return readApiJson_({ ok: false, error: "bad_request" });
  if (body.op === "ping") return readApiJson_({ ok: true, api: "read-v1" });
  if (body.op === "exists") return readApiExists_(body, "工作表1", 9, 10);
  if (body.op === "takeout_exists") return readApiExists_(body, "外帶訂單", 7, 8);
  if (body.op === "duplicate_check") return readApiDuplicate_(body);
  return readApiJson_({ ok: false, error: "bad_request" });
}

function readApiRows_(sheetName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return null;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return null;
    return sheet.getDataRange().getValues();
  } catch (err) {
    return null;
  }
}

function readApiOrderKey_(value) {
  return String(value == null ? "" : value).trim().toUpperCase();
}

function readApiStatus_(value) {
  if (value == null) return "";
  return String(value).trim();
}

function readApiHeaderLabel_(col) {
  for (var i = 0; i < READ_API_DINING_HEADERS.length; i++) {
    if (READ_API_DINING_HEADERS[i][0] === col) return READ_API_DINING_HEADERS[i][1];
  }
  return "";
}

function readApiHeadersMatch_(headerRow, pairs) {
  if (!headerRow) return false;
  for (var i = 0; i < pairs.length; i++) {
    if (readApiStatus_(headerRow[pairs[i][0]]) !== pairs[i][1]) return false;
  }
  return true;
}

function readApiHeaderOk_(rows, idCol, statusCol) {
  if (!rows || !rows.length || !rows[0]) return false;
  return readApiStatus_(rows[0][idCol]) === readApiHeaderLabel_(9) && readApiStatus_(rows[0][statusCol]) === readApiHeaderLabel_(10);
}

function readApiDiningHeaderOk_(rows) {
  return !!(rows && rows.length && readApiHeadersMatch_(rows[0], READ_API_DINING_HEADERS));
}

function readApiExists_(body, sheetName, idCol, statusCol) {
  var rawId = readApiRequestText_(body.lookup_order_id);
  if (rawId === null) return readApiJson_({ ok: false, error: "bad_request" });
  var want = readApiOrderKey_(rawId);
  if (!want) return readApiJson_({ ok: false, error: "bad_request" });
  var rows = readApiRows_(sheetName);
  if (!rows || !readApiHeaderOk_(rows, idCol, statusCol)) return readApiJson_({ ok: false, error: "unavailable" });
  var found = false;
  var status = "";
  for (var i = 1; i < rows.length; i++) {
    if (readApiOrderKey_(rows[i][idCol]) !== want) continue;
    found = true;
    status = readApiStatus_(rows[i][statusCol]);
  }
  if (!found) return readApiJson_({ ok: true, found: false });
  return readApiJson_({ ok: true, found: true, status: status });
}

function readApiCellBlank_(value) {
  if (value == null) return true;
  if (typeof value === "string" && value.replace(/\u3000/g, "").trim() === "") return true;
  return false;
}

function readApiSession_(value) {
  if (readApiCellBlank_(value)) return "";
  if (typeof value !== "string" && typeof value !== "number") return null;
  var text = String(value).replace(/\u3000/g, "").trim();
  if (text === "午" || text === "中午") return "中午";
  if (text === "晚" || text === "晚上") return "晚上";
  if (!text) return "";
  return null;
}

function readApiFold_(value) {
  var text = String(value == null ? "" : value);
  try {
    text = text.normalize("NFKC");
  } catch (err) {}
  return text.replace(/[\s\u3000]+/g, "").toLowerCase();
}

function readApiIsLineBookingPhone_(value) {
  return readApiFold_(value) === "line訂";
}

function readApiPhoneKey_(value) {
  var folded = readApiFold_(value);
  if (folded === "line訂") return "";
  var digits = folded.replace(/\D/g, "");
  if (digits.indexOf("886") === 0 && digits.length > 9) digits = digits.substring(3);
  return digits.replace(/^0/, "");
}

function readApiNameKey_(value) {
  return String(value == null ? "" : value).replace(/\u3000/g, "").replace(/ /g, "").trim();
}

function readApiRowDay_(value) {
  if (readApiCellBlank_(value)) return "";
  var input = value;
  if (typeof value === "string") input = value.replace(/\u3000/g, "").trim();
  try {
    var day = sheetDayStr_(input);
    if (day) return day;
  } catch (err) {
    return null;
  }
  return null;
}

function readApiCancelled_(status) {
  return status === "已取消" || status === "取消" || status === "取消訂位";
}

function readApiDuplicate_(body) {
  var dateRaw = readApiRequestText_(body.lookup_date);
  var sessionRaw = readApiRequestText_(body.lookup_session);
  var phoneRaw = readApiRequestText_(body.lookup_phone);
  var nameRaw = readApiRequestText_(body.lookup_name);
  if (dateRaw === null || sessionRaw === null || phoneRaw === null || nameRaw === null) {
    return readApiJson_({ ok: false, error: "bad_request" });
  }
  if (readApiCellBlank_(dateRaw) || readApiCellBlank_(sessionRaw)) {
    return readApiJson_({ ok: false, error: "unavailable" });
  }
  if (typeof sheetDayStr_ !== "function") return readApiJson_({ ok: false, error: "unavailable" });
  var day = "";
  try {
    day = sheetDayStr_(dateRaw);
  } catch (err) {
    return readApiJson_({ ok: false, error: "unavailable" });
  }
  if (!day) return readApiJson_({ ok: false, error: "bad_request" });
  var session = readApiSession_(sessionRaw);
  if (session === null || !session) return readApiJson_({ ok: false, error: "bad_request" });

  var name = readApiNameKey_(nameRaw);
  var phone = "";
  var byPhone = false;
  if (readApiIsLineBookingPhone_(phoneRaw)) {
    byPhone = false;
  } else if (String(phoneRaw).trim() !== "") {
    phone = readApiPhoneKey_(phoneRaw);
    if (!phone) return readApiJson_({ ok: false, error: "bad_request" });
    byPhone = true;
  }
  if (!byPhone && !name) return readApiJson_({ ok: false, error: "bad_request" });

  var rows = readApiRows_("工作表1");
  if (!readApiDiningHeaderOk_(rows)) return readApiJson_({ ok: false, error: "unavailable" });
  var hit = false;
  var matched = "";
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var status = readApiStatus_(row[10]);
    if (readApiCancelled_(status)) continue;
    var samePerson = byPhone
      ? readApiPhoneKey_(row[2]) === phone
      : readApiNameKey_(row[1]) === name;
    if (!samePerson) continue;
    if (readApiCellBlank_(row[4]) || readApiCellBlank_(row[5])) {
      return readApiJson_({ ok: false, error: "unavailable" });
    }
    var rowDay = readApiRowDay_(row[4]);
    if (rowDay === null) return readApiJson_({ ok: false, error: "unavailable" });
    if (rowDay !== day) continue;
    var rowSession = readApiSession_(row[5]);
    if (rowSession === null) return readApiJson_({ ok: false, error: "unavailable" });
    if (rowSession !== session) continue;
    hit = true;
    var orderId = String(row[9] == null ? "" : row[9]).trim();
    if (orderId) matched = orderId;
  }
  if (!hit) return readApiJson_({ ok: true, duplicate: false });
  if (byPhone) {
    var phoneOut = { ok: true, duplicate: true };
    if (matched) phoneOut.matchedOrderId = matched;
    return readApiJson_(phoneOut);
  }
  var nameOut = { ok: true, duplicate: "possible" };
  if (matched) nameOut.matchedOrderId = matched;
  return readApiJson_(nameOut);
}
