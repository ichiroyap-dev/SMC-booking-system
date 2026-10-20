# 預約讀取 API

這份說明給店內兩支上傳程式。沒有權杖、沒有網址、沒有試算表編號。這次沒有部署，也沒有執行 clasp。

正式 `doGet` 目前不驗證就把整張分頁回給任何人。改完之後，GET 不再讀表，一律 `{ "ok": false, "error": "unauthorized" }`，也不回分頁名稱。

## 上線前 Owner 要做的事

1. 在 Apps Script 指令碼屬性新增 `READ_API_TOKEN`。值只放在那裡，以及兩台店內電腦的環境變數或本機設定。不要寫進程式、不要放進這個 repo。
2. 用 `apps-script/read-api.js` 換掉 `ReservationWebhook` 的 `doGet`。同專案不能留兩個 `doGet`。
3. 在「程式碼」的 `doPost` 最上面、拿鎖之前加：

```javascript
var readLookup = handleReadLookup_(e);
if (readLookup) return readLookup;
```

其餘訂位、外帶、取消、春節桌數上限都不要改。屬性沒設或讀不到時，讀取會拒絕；寫入維持原樣。

兩支上傳程式改完、而且屬性已設好之前，不要部署。舊的 GET 確認會變成 `unauthorized`，程式必須停，不能當成「沒有這筆」。

## 請求

`POST` JSON。權杖放 body，不要放網址。

```json
{ "action": "lookup", "token": "<本機 READ_API_TOKEN>", "op": "exists", "orderId": "SMC100001" }
```

`op` 只有三種：

| op | 用途 | 另外要帶 | 成功時只有這些欄位 |
|---|---|---|---|
| `exists` | 內用，確認訂單編號已經在「工作表1」 | `orderId` | `{ "ok": true, "found": true, "status": "預約中" }` 或 `{ "ok": true, "found": false }` |
| `duplicate_check` | 內用送出前 | `date`、`session` 或 `meal_period`，以及 `phone`、`name` 至少一個 | `{ "ok": true, "duplicate": false }` 或再加上 `matchedOrderId` |
| `takeout_exists` | 外帶，確認訂單編號已經在「外帶訂單」 | `orderId` | 與 `exists` 相同 |

不會回姓名、電話、整列或其他分頁。

## 錯誤

| 回應 | 意義 | 上傳程式 |
|---|---|---|
| `{ "ok": false, "error": "unauthorized" }` | 沒權杖、權杖錯、或屬性沒設 | 停止。不是「找不到」，也不是「沒有重複」 |
| `{ "ok": false, "error": "bad_request" }` | 參數不夠或 `op` 不認識 | 停止 |
| `{ "ok": false, "error": "unavailable" }` | 這次沒讀到表 | 停止。不要改送出，也不要當成沒有訂單 |

`found: false` 和 `duplicate: false` 才是「表有讀到，但沒有這筆」。

## 內用上傳程式

送出前先 `duplicate_check`。日期同一天、時段同為午或晚才比。`午`／`中午` 都當中午，`晚`／`晚上` 都當晚上。電話只留數字並去掉一個開頭的 0；儲存格裡的前導 `'` 不影響。`line訂` 不當成電話。姓名去掉前後空白後整段相同。兩個都有帶時，電話和姓名都要中。狀態是 `已取消` 或 `取消` 的列不算。多筆時用最後一列的 `matchedOrderId`。

- `unauthorized`、`bad_request`、`unavailable`：不要送出。
- `duplicate: true`：不要再送，沿用 `matchedOrderId`。
- `duplicate: false`：才送出原本的訂位 POST。

送出成功後改呼叫 `exists`，不要再 GET 整張「工作表1」。`found: true` 才算編號已經落地。`unauthorized` 要停，不要重試成成功。

## 外帶上傳程式

寫入成功後改呼叫 `takeout_exists`，不要再 GET「外帶訂單」。判斷方式與上面的 `exists` 相同。
