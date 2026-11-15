# 預約讀取 API

這份說明給店內上傳程式。沒有權杖、沒有網址、沒有試算表編號。這次沒有部署，也沒有執行 clasp。

正式 `doGet` 目前不驗證就把整張分頁回給任何人。改完之後，GET 不再讀表，一律 `{ "ok": false, "error": "unauthorized" }`，也不回分頁名稱。

## 上線順序

必須照這個順序。中間不要恢復上傳。

0. 先看 Apps Script 的 Executions 執行紀錄。紀錄保留時間有限，而且看不出呼叫端。能看到的 `doGet` 都要先找到對應程式並停掉。
1. 暫停上傳。內用、外帶，以及下面列出的每支讀表程式都先停。
2. 暫停之後、部署之前，再看 Executions，確認 doGet 為 0。然後才在指令碼屬性設定 `READ_API_TOKEN`，用 `apps-script/read-api.js` 換掉 `doGet`、在 `doPost` 最上面加上查詢攔截。部署要編輯原部署、發布新版本，維持原來的網址。不要新建部署。到 Manage deployments 確認只有一個啟用中的部署指向新版本，其他仍在使用的舊部署要封存舊部署。否則舊網址的 `doGet` 仍會公開整表。
3. 更換上傳腳本，含 lineok 變體與下方各支 Python。這一步由 Owner 在離峰時段做。部署前先做一次新鮮的 clasp pull，對過這份檔再貼。這份說明不代表已經執行 clasp，也不代表可以部署。貼上之後還要另一次 Owner GO 才算上線。
4. 每支程式先送 `op` 為 `ping`。回應必須剛好是 `{ "ok": true, "api": "read-v1" }`。任何其他回應都停止，不要上傳。
5. 恢復上傳前先做唯讀驗證，不能只看 ping。ping 不讀表。接著各送一次、都不要寫入：內用 `duplicate_check`、內用 `exists`、外帶 `takeout_exists`。三個都必須是 `ok: true`。出現 `unauthorized`、`bad_request`、`unavailable` 就不要恢復上傳。用店內已知道的測試條件即可，不要把客人資料寫進這份說明。

## 退回

1. 暫停所有呼叫端，並確認沒有進行中的工作。
2. 上傳腳本與後端一起改回。
3. 手動確認舊的 GET 有回應。
4. 確認之後才恢復。

退回 v152 會重新打開未驗證的整表讀取，只可短暫使用。退回也是編輯原部署，不要留下兩個啟用中的部署。退回後排定再上線的時間，並繼續看 Executions 的 `doGet`。

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

部署前要先打開 Apps Script 的 Executions，查還留著的 `doGet` 執行紀錄（最近 30 天；保留時間有限，而且看不出呼叫端）。有出現就要先停或改掉對應程式，不能留著舊的 GET。暫停呼叫端之後、部署之前，要看到 doGet 為 0。

這個 repo 裡沒有這些店內腳本的原始碼。下表是已知會讀 `?page` 的呼叫端，以及這次要怎麼改。

| 呼叫端 | 現在怎麼讀 | 這次怎麼處理 |
|---|---|---|
| 內用上傳程式，含 lineok 變體 | `GET ?page=工作表1`，用來查重複、確認訂單編號 | 停用 GET。開頭先 `ping`。送出前改 `duplicate_check`。寫入成功後改 `exists` |
| 外帶上傳程式，含 lineok 變體 | `GET ?page=外帶訂單`，用來查重複、確認訂單編號 | 拿掉上傳程式自己的 GET 重複檢查，改靠後端外帶去重。後端錯誤訊息含「重複」就停止，不要再送。寫入成功後改 `takeout_exists`。開頭先 `ping` |
| `live-upload_py.py` | 店內電腦腳本，不在這個 repo。用 GET `?page` 讀表確認 | 與內用上傳程式相同：`ping`、`duplicate_check`、`exists`。不要再 GET |
| `finish_takeout_verify.py` | 店內電腦腳本，不在這個 repo。用 GET `?page` 核對外帶 | 改 `ping` 與 `takeout_exists`。不要再 GET |
| `live_takeout_once.py` | 店內電腦腳本，不在這個 repo。用 GET `?page` 讀外帶 | 改 `ping` 與 `takeout_exists`。不要再 GET |
| 晨間摘要、preview 讀取端 | 這個 repo 與檔名搜尋沒有找到會 GET `?page` 的晨間摘要或 preview 程式 | 仍要查近 30 天 `doGet`。若有，先停掉或改走 `lookup`，不能在部署後繼續 GET |

## 舊 doGet 還有沒有別的用途

這個 repo 裡，官網 `index.html` 只對正式網址做兩次 POST（訂位、取消），沒有 GET。`faq.html` 不打這個網址。新的 `doGet` 不讀參數，固定 `unauthorized`。

先前看過的正式專案裡，`doGet` 只在 `ReservationWebhook`，用 `?page` 回整張分頁，預設分頁是測試分頁。沒有在那次匯出裡看到 `HtmlService`、健康檢查或 `?action=`。這次工作環境沒有那份匯出，所以部署前仍要在 Apps Script 編輯器搜尋 `function doGet` 和 `HtmlService`。有健康檢查、網頁或其他參數用途，先記下來，不要直接蓋掉。

## 寫入路徑

攔截加在正式 `doPost` 最前面。下面這些路徑都沒有在頂層帶查詢用的 `op` 或 `lookup_*`。單獨的 token 不會擋下寫入。

這個 repo 打到正式網址的寫入：

| 路徑 | 頂層欄位 | token / op |
|---|---|---|
| `index.html` 內用與外帶預約 | `action` `book`，加上 `type` `name` `phone` `email` `people` `tables` `date` `time` `note` `orderItems`。來源欄位預設不送 | 沒有 |
| `index.html` 取消 | `action` `cancel`，加上 `phone` `orderId` | 沒有 |

不在正式路徑，也沒有頂層 `token` 或 `op`：`.github/pages-unpublished/isolated-dining-check.html`、`booking-attribution-isolated.gs`。那是隔離測試，不是這次要貼的正式 `doPost`。

正式 `doPost` 不在這個 repo。攔截必須放行這些既有分流，不能改成 `bad_request`：

1. 搶不到鎖時的純文字 `OK`（這段在攔截之後，攔截回 `null` 才會走到）。
2. LINE：body 有 `events`。
3. `action` 或 `mode` 為 `pending_update`。
4. `action` 或 `mode` 為 `pending_ingest`。
5. 取消：`action`、`mode` 或 `type` 含 cancel 或「取消」，或沒有 `type`、沒有 `orderItems` 但有訂單編號。
6. `processBooking`：`type` 為 `dining` 寫「工作表1」，其他寫「外帶訂單」。春節桌數上限在這條路徑裡，這次不改。

店內上傳程式不在這個 repo。改完之後它們的查詢才會帶 `token` 和 `op`，而且 `action` 必須是 `lookup`。

`action` 不是 `lookup` 時，只有出現 `lookup_*` 欄位，或 `op` 正好是 `ping`、`exists`、`takeout_exists`、`duplicate_check`，才回 `bad_request`。表單若以後帶了別的 `token` 或其他 `op`，仍走原來的寫入。

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
| `duplicate_check` | 內用送出前 | `lookup_date`、`lookup_session`，以及電話或姓名 | 沒有重複是 `{ "ok": true, "duplicate": false }`。電話命中是 `duplicate: true`，有訂單編號才加 `matchedOrderId`。只有姓名沒有對到列也是 `duplicate: false`；對到列是 `duplicate` 為 `possible`，有非空訂單編號才加 `matchedOrderId` |
| `takeout_exists` | 外帶，確認訂單編號已經在「外帶訂單」 | `lookup_order_id` | 與 `exists` 相同 |

不會回姓名、電話、整列或其他分頁。

## 錯誤

| 回應 | 意義 | 上傳程式 |
|---|---|---|
| `{ "ok": false, "error": "unauthorized" }` | 沒權杖、權杖錯、權杖不是字串、或屬性沒設 | 停止。不是「找不到」，也不是「沒有重複」 |
| `{ "ok": false, "error": "bad_request" }` | 參數不夠、型別不對、`op` 不認識、電話有字但沒有數字，或訂位請求夾了 `lookup_*`／查詢用的 `op` | 停止，不要改走寫入 |
| `{ "ok": false, "error": "unavailable" }` | 這次沒讀到表、表頭對不上、日期函式不可用、查詢的日期或時段是空白，或有一列不是取消但日期或時段是空白或無法正規化（例如時段寫成午餐） | 停止。不要改送出，也不要當成沒有訂單 |

`found: false` 和 `duplicate: false` 才是「表有讀到，但沒有這筆」。

## 內用上傳程式

送出前先 `duplicate_check`。這是事前檢查，不等於後端規則。後端內用去重是另一套。送出後若後端回錯誤（含「重複」），要停止、轉人工、不要重試，也不算成功。

- 電話有數字時，只比電話、日期、時段，不比姓名。`午`／`中午` 都當中午，`晚`／`晚上` 都當晚上。全形空白會先拿掉，所以 `中午` 中間或前後有全形空白仍算中午。電話只留數字；開頭的 `+886` 會拿掉，再去掉一個 0，所以 `+886` 和 `09` 開頭對得到。
- 電話欄有內容、正規化後卻不是電話、也不是 `line訂`：`bad_request`。不要送出。`line訂`、`LINE訂`、`Line 訂`，以及中間的空白或全形空白，都當成沒有電話。
- 沒有電話，或電話是上面的 `line訂`：改比姓名、日期、時段。姓名裡的全形空白，以及中間的半形空白，都會拿掉再比。中文字本身不會被改掉，也不做全形轉半形。只有姓名沒有對到列是 `{ "ok": true, "duplicate": false }`，上傳程式照送。對到列是 `{ "ok": true, "duplicate": "possible" }`，有非空訂單編號才帶 `matchedOrderId`。`possible` 要停下來等人確認，不要自己送出。
- 查詢沒有日期、沒有時段，或這兩欄只有空白：回 `unavailable`，不要當成沒有重複。
- 狀態是已取消、取消、取消訂位的列不算。完全空白、而且不是這位客人的列略過。同一支電話或同一個姓名的列，日期或時段是空白，或有內容卻對不出來（例如午餐），整次回 `unavailable`，不要當成沒有重複。別人的怪時段不擋這次查詢。
- 多筆時採用最後一筆非空的訂單編號。命中是 `duplicate: true`。若是 `duplicate: true` 但沒有 matchedOrderId，停止並人工確認，不要當成可以新開一筆。

其他規則：

- `unauthorized`、`bad_request`、`unavailable`：不要送出。
- `duplicate: true`：不要再送。有 `matchedOrderId` 就沿用；沒有就人工確認。
- `duplicate: false`：才送出原本的訂位 POST。只有姓名沒有對到列也算這一條。
- `possible`：停下來等人確認。不要自己送出。

送出成功後改呼叫 `exists`，不要再 GET 整張「工作表1」。`found: true` 才算編號已經落地。`unauthorized` 要停，不要重試成成功。

上傳程式不可以把請求 body 或權杖印進 log、`print` 或例外訊息。讀取 API 自己不寫 log。不要把權杖放進網址。

## 外帶上傳程式

上傳程式自己的 GET 重複檢查拿掉，改靠後端既有的外帶去重。後端錯誤訊息裡有「重複」就停止，不要再送、也不要當成成功。

寫入成功後改呼叫 `takeout_exists`，不要再 GET「外帶訂單」。判斷方式與上面的 `exists` 相同。開頭一樣先 `ping`，不是 `read-v1` 就停止。
