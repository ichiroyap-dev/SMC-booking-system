// 貼進正式 Apps Script，不要整檔覆蓋。
// 1. 刪掉 ReservationWebhook 裡現在的 doGet。同專案只能留這一個 doGet。
// 2. 在「程式碼」的 doPost 最上面、拿鎖之前加兩行，其餘寫入不要改：
//      var readLookup = handleReadLookup_(e);
//      if (readLookup) return readLookup;
// 3. 指令碼屬性新增 READ_API_TOKEN。值由 Owner 自己填，不要寫進程式、不要提交。
//    沒設、空白、或讀取失敗，讀取一律拒絕。
// GET 不再讀表。窄查詢只收 POST JSON：action=lookup，權杖放 body.token。

var READ_API_TOKEN_PROPERTY = "READ_API_TOKEN";

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
  var given = presented == null ? "" : String(presented).trim();
  var diff = expected.length === given.length ? 0 : 1;
  var n = Math.max(expected.length, given.length);
  for (var i = 0; i < n; i++) {
    var a = i < expected.length ? expected.charCodeAt(i) : 0;
    var b = i < given.length ? given.charCodeAt(i) : 0;
    diff |= (a ^ b);
  }
  return diff === 0;
}

function readApiBody_(e) {
  try {
    if (!e || !e.postData || e.postData.contents == null || e.postData.contents === "") return null;
    var parsed = e.postData.contents;
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function doGet(e) {
  // 不讀參數。網址上的分頁名稱與權杖都不能換成資料。
  return readApiJson_({ ok: false, error: "unauthorized" });
}

function handleReadLookup_(e) {
  var body = readApiBody_(e);
  if (!body || body.action !== "lookup") return null;
  if (!readApiTokenMatches_(body.token)) return readApiJson_({ ok: false, error: "unauthorized" });
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

function readApiExists_(body, sheetName, idCol, statusCol) {
  var want = readApiOrderKey_(body.orderId);
  if (!want) return readApiJson_({ ok: false, error: "bad_request" });
  var rows = readApiRows_(sheetName);
  if (!rows) return readApiJson_({ ok: false, error: "unavailable" });
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

function readApiDay_(value) {
  if (typeof sheetDayStr_ === "function") {
    try {
      return sheetDayStr_(value);
    } catch (err) {
      return "";
    }
  }
  return "";
}

function readApiSession_(value) {
  var text = String(value == null ? "" : value).trim();
  if (text === "午" || text === "中午") return "中午";
  if (text === "晚" || text === "晚上") return "晚上";
  return "";
}

function readApiPhoneKey_(value) {
  var raw = String(value == null ? "" : value).trim();
  if (raw === "line訂") return "";
  return raw.replace(/\D/g, "").replace(/^0/, "");
}

function readApiDuplicate_(body) {
  var day = readApiDay_(body.date);
  var session = readApiSession_(body.session);
  if (!session) session = readApiSession_(body.meal_period);
  var phone = readApiPhoneKey_(body.phone);
  var name = String(body.name == null ? "" : body.name).trim();
  if (!day || !session || (!phone && !name)) return readApiJson_({ ok: false, error: "bad_request" });
  var rows = readApiRows_("工作表1");
  if (!rows) return readApiJson_({ ok: false, error: "unavailable" });
  var hit = false;
  var matched = "";
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var status = readApiStatus_(row[10]);
    if (status === "已取消" || status === "取消") continue;
    if (readApiDay_(row[4]) !== day || readApiSession_(row[5]) !== session) continue;
    if (phone && readApiPhoneKey_(row[2]) !== phone) continue;
    if (name && String(row[1] == null ? "" : row[1]).trim() !== name) continue;
    hit = true;
    matched = String(row[9] == null ? "" : row[9]).trim();
  }
  if (!hit) return readApiJson_({ ok: true, duplicate: false });
  var out = { ok: true, duplicate: true };
  if (matched) out.matchedOrderId = matched;
  return readApiJson_(out);
}
