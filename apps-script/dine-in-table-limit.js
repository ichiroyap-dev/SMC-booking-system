// 貼進正式 Apps Script「程式碼」（程式碼.js / 程式碼.gs），與既有 sheetDayStr_ 同一專案。
// 不要整檔覆蓋店內版本。正式檔匯出時（專案最後修改 2026-09-28）只改這兩處：
//   1. processBooking 內用分支，約第 469 行
//      var currentLimit = dineInTableLimit_(normalizedBookingDay, session, limitLunch, limitDinner);
//   2. 約第 483 行的超額訊息改為
//      dineInOverCapMessage_(normalizedBookingDay, session, currentLimit, usedTables)
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
  return "抱歉，" + session + "剩餘桌位不足（僅剩 " + (currentLimit - usedTables) + " 桌）。";
}
