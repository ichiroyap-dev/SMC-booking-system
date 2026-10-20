# 預約讀取 API

這份說明給店內上傳程式。沒有權杖、沒有網址、沒有試算表編號。這次沒有部署，也沒有執行 clasp。

正式 `doGet` 目前不驗證就把整張分頁回給任何人。改完之後，GET 不再讀表，一律 `{ "ok": false, "error": "unauthorized" }`，也不回分頁名稱。

## 上線順序

必須照這個順序。中間不要恢復上傳。

1. 暫停上傳。內用、外帶，以及下面列出的每支讀表程式都先停。
2. 在 Apps Script 指令碼屬性設定 `READ_API_TOKEN`，用 `apps-script/read-api.js` 換掉 `doGet`、在 `doPost` 最上面加上查詢攔截，然後才部署。
3. 更換上傳腳本，含 lineok 變體與下方各支 Python。
4. 每支程式先送 `op` 為 `ping`。回應必須剛好是 `{ "ok": true, "api": "read-v1" }`。任何其他回應都停止，不要上傳。
5. 確認 ping 通過後才恢復上傳。

退回 v152 之前，要先把上傳腳本改回舊版。舊版 `doPost` 沒有查詢攔截；先退後端、腳本仍送查詢或訂位，就可能寫錯或取消錯。

## 貼上方式

1. 屬性 `READ_API_TOKEN` 的值只放在 Apps Script，以及店內電腦的環境變數或本機設定。不要寫進程式、不要放進這個 repo。沒設、空白、或讀取失敗，讀取一律拒絕。
2. 用 `apps-script/read-api.js` 換掉 `ReservationWebhook` 的 `doGet`。同專案不能留兩個 `doGet`。
3. 在「程式碼」的 `doPost` 最上面、拿鎖之前加：

```javascript
var readLookup = handleReadLookup_(e);
if (readLookup) return readLookup;
```

其餘訂位、外帶、取消、春節桌數上限都不要改。

## 誰在用 GET ?page

部署前要先打開 Apps Script，查最近 30 天的 `doGet` 執行紀錄。有出現的呼叫端都要先停或改掉，不能留著舊的 GET。

這個 repo 裡沒有這些店內腳本的原始碼。下表是已知會讀 `?page` 的呼叫端，以及這次要怎麼改。

| 呼叫端 | 現在怎麼讀 | 這次怎麼處理 |
|---|---|---|
| 內用上傳程式，含 lineok 變體 | `GET ?page=工作表1`，用來查重複、確認訂單編號 | 停用 GET。開頭先 `ping`。送出前改 `duplicate_check`。寫入成功後改 `exists` |
| 外帶上傳程式，含 lineok 變體 | `GET ?page=外帶訂單`，用來查重複、確認訂單編號 | 拿掉上傳程式自己的 GET 重複檢查，改靠後端外帶去重。後端錯誤訊息含「重複」就停止，不要再送。寫入成功後改 `takeout_exists`。開頭先 `ping` |
| `live-upload_py.py` | 店內電腦腳本，不在這個 repo。用 GET `?page` 讀表確認 | 與內用上傳程式相同：`ping`、`duplicate_check`、`exists`。不要再 GET |
| `finish_takeout_verify.py` | 店內電腦腳本，不在這個 repo。用 GET `?page` 核對外帶 | 改 `ping` 與 `takeout_exists`。不要再 GET |
| `live_takeout_once.py` | 店內電腦腳本，不在這個 repo。用 GET `?page` 讀外帶 | 改 `ping` 與 `takeout_exists`。不要再 GET |
| 晨間摘要、preview 讀取端 | 這個 repo 與檔名搜尋沒有找到會 GET `?page` 的晨間摘要或 preview 程式 | 仍要查近 30 天 `doGet`。若有，先停掉或改走 `lookup`，不能在部署後繼續 GET |

## 請求

`POST` JSON。權杖放 body，不要放網址。權杖必須是字串。

上傳程式每次開始先：

```json
{ "action": "lookup", "token": "<本機 READ_API_TOKEN>", "op": "ping" }
```

只有 `{ "ok": true, "api": "read-v1" }` 可以繼續。其他回應都停止。

查詢欄位只用 `lookup_order_id`、`lookup_date`、`lookup_session`、`lookup_phone`、`lookup_name`。不要同時帶 `date`、`phone`、`tel`、`mobile`、`orderId`、`orderID`、`order_id`、`bookingId`、`type`、`orderItems`。舊版沒有攔截的 `doPost` 看到 `date` 或不完整的訂單編號，有機會寫入或取消。這些名字就是要避開那條路。

`op` 只有四種：

| op | 用途 | 另外要帶 | 成功時 |
|---|---|---|---|
| `ping` | 確認讀到的是這版 API | 無 | `{ "ok": true, "api": "read-v1" }` |
| `exists` | 內用，確認訂單編號已經在「工作表1」 | `lookup_order_id` | `{ "ok": true, "found": true, "status": "預約中" }` 或 `{ "ok": true, "found": false }` |
| `duplicate_check` | 內用送出前 | `lookup_date`、`lookup_session`，以及電話或姓名 | 沒有重複是 `{ "ok": true, "duplicate": false }`。命中是 `duplicate: true`，有訂單編號才加 `matchedOrderId`。只有姓名是 `duplicate` 為 `possible` |
| `takeout_exists` | 外帶，確認訂單編號已經在「外帶訂單」 | `lookup_order_id` | 與 `exists` 相同 |

不會回姓名、電話、整列或其他分頁。

## 錯誤

| 回應 | 意義 | 上傳程式 |
|---|---|---|
| `{ "ok": false, "error": "unauthorized" }` | 沒權杖、權杖錯、權杖不是字串、或屬性沒設 | 停止。不是「找不到」，也不是「沒有重複」 |
| `{ "ok": false, "error": "bad_request" }` | 參數不夠、`op` 不認識、電話有字但沒有數字、或 body 帶了 `op`／`token` 但 `action` 不是 `lookup` | 停止，不要改走寫入 |
| `{ "ok": false, "error": "unavailable" }` | 這次沒讀到表、表頭不是訂單編號／狀態、或日期函式不可用 | 停止。不要改送出，也不要當成沒有訂單 |

`found: false` 和 `duplicate: false` 才是「表有讀到，但沒有這筆」。

## 內用上傳程式

送出前先 `duplicate_check`。

- 電話有數字時，只比電話、日期、時段，不比姓名。`午`／`中午` 都當中午，`晚`／`晚上` 都當晚上。電話只留數字並去掉一個開頭的 0。
- 電話欄有內容、又不是 `line訂`、正規化後卻是空的：`bad_request`。不要送出。
- 沒有電話，或電話正好是 `line訂`：改比姓名、日期、時段。回應是 `{ "ok": true, "duplicate": "possible" }`，有非空訂單編號才帶 `matchedOrderId`。上傳程式要停下來等人確認，不要自己送出。
- 狀態是 `已取消` 或 `取消訂位` 的列不算。
- 多筆時採用最後一筆非空的訂單編號。命中是 `duplicate: true`。若是 `duplicate: true` 但沒有 matchedOrderId，停止並人工確認，不要當成可以新開一筆。

其他規則：

- `unauthorized`、`bad_request`、`unavailable`：不要送出。
- `duplicate: true`：不要再送。有 `matchedOrderId` 就沿用；沒有就人工確認。
- `duplicate: false`：才送出原本的訂位 POST。
- `possible`：停下來等人確認。

送出成功後改呼叫 `exists`，不要再 GET 整張「工作表1」。`found: true` 才算編號已經落地。`unauthorized` 要停，不要重試成成功。

## 外帶上傳程式

上傳程式自己的 GET 重複檢查拿掉，改靠後端既有的外帶去重。後端錯誤訊息裡有「重複」就停止，不要再送、也不要當成成功。

寫入成功後改呼叫 `takeout_exists`，不要再 GET「外帶訂單」。判斷方式與上面的 `exists` 相同。開頭一樣先 `ping`，不是 `read-v1` 就停止。
