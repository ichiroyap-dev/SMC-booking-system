// 貼進正式 Apps Script「程式碼」（程式碼.js / 程式碼.gs），與既有 sheetDayStr_ 同一專案。
// 不要整檔覆蓋店內版本。正式內用分支在算上限時還沒有日期變數。
// 後面才宣告的 bookingDate 不要提前拿來用。
// 日期直接傳 params.date，函式內部會呼叫 sheetDayStr_。
//   1. 取代 currentLimit 那一行（約第 469 行，在 session 之後）：
//      var currentLimit = dineInTableLimit_(params.date, session, limitLunch, limitDinner);
//   2. 取代 parseInt(params.tables || 1)（約第 470 行）。null 就回訊息並 return，不要寫表：
//      var requestedTables = parseDineInRequestedTables_(params.tables);
//      if (requestedTables == null) {
//        var badTablesMsg = dineInTablesErrorMessage_();
//        if (isLineSource) { sendLineReply(replyToken, badTablesMsg); return ContentService.createTextOutput("OK"); }
//        return responseMsg("error", badTablesMsg);
//      }
//   3. 取代超額訊息（約第 483 行）：
//      var failMsg = dineInOverCapMessage_(params.date, session, currentLimit, usedTables);
// 外帶分支（params.type !== "dining"）不要呼叫。

var CNY_2027_DINE_IN_TABLE_CAPS = {
  "2027-02-05": 0,
  "2027-02-06": 15,
  "2027-02-07": 15,
  "2027-02-08": 15,
  "2027-02-09": 15,
  "2027-02-10": 15
};

function dineInTableLimit_(bookingDay, session, limitLunch, limitDinner) {
  var day = sheetDayStr_(bookingDay);
  if (Object.prototype.hasOwnProperty.call(CNY_2027_DINE_IN_TABLE_CAPS, day)) {
    return CNY_2027_DINE_IN_TABLE_CAPS[day];
  }
  return (session === "中午") ? limitLunch : limitDinner;
}

function dineInOverCapMessage_(bookingDay, session, currentLimit, usedTables) {
  if (sheetDayStr_(bookingDay) === "2027-02-05") {
    return "抱歉，除夕（2027-02-05）不開放內用，當日僅提供外帶。";
  }
  var remaining = Math.max(0, currentLimit - usedTables);
  return "抱歉，" + session + "剩餘桌位不足（僅剩 " + remaining + " 桌）。";
}

function dineInTablesErrorMessage_() {
  return "桌數必須是正整數。";
}

// 缺值沿用正式程式 params.tables || 1，當成 1 桌。
// 接受有前導零的整數字串（"03"、"  03  "）。0、"0"、負數、"1.5"、"3.0"、非數字回 null。
function parseDineInRequestedTables_(raw) {
  if (raw === undefined || raw === null) return 1;
  if (typeof raw === "string" && raw.trim() === "") return 1;
  if (typeof raw === "number") {
    if (isFinite(raw) && Math.floor(raw) === raw && raw >= 1) return raw;
    return null;
  }
  var text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  var parsed = parseInt(text, 10);
  if (!isFinite(parsed) || parsed < 1) return null;
  return parsed;
}
