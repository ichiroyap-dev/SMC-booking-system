# 隔離 Apps Script 驗收（內用）

這份給 Owner 或 hub 在**自己的 Google 帳號**做。不必自己組 JSON，也不必會寫程式。本機測試沒有連 Google，也沒有寄出真信。假試算表**不會執行公式**，所以不能代替你打開 Google 試算表看那一格是不是數字。

不要把 `apps-script/booking-attribution-isolated.gs` 貼上正式預約專案，不要改正式 web app 網址，不要寫正式試算表，也不要打開正式官網 `www.sweetmeichicken.com` 來送這次測試。官網 `SEND_ATTRIBUTION_TO_BACKEND` 維持 `false`。正式腳本原始碼不在這個 repo，這支隔離腳本**不是**正式腳本的補丁；這裡通過之後，還要把同樣的「缺來源仍收單」移植到正式腳本，才能另案開旗標。

客人信不可以出現 `launch_202610`、`ag_brand`、`ag_geo_dining`。那些只出現在「訂單」分頁與「店內對帳」信。

回應只有 `status`、`orderId`、`message`。**回應沒有備註**。備註要對這三處：你送出的內容、試算表「備註」欄、客人信與店內信。不要在回應裡找備註。

## 準備（照著點）

1. 打開 [Google 雲端硬碟](https://drive.google.com)，新增 → Google 試算表。名稱打「隔離測試」。不要共用給客人。
2. 試算表下方的「+」新增分頁。在分頁名稱上按右鍵 → 重新命名，打 `隔離標記`。
3. 點那一頁的 **A1**，打上 `SMC-ISOLATED-TEST`，按 Enter。不要改字、不要加空白。腳本不會幫你建立這個分頁。
4. 看瀏覽器網址，`/d/` 和 `/edit` 中間那一串就是試算表 ID。先複製下來。
5. 選單「擴充功能」→「Apps Script」。若問要登入，用你自己的 Google 帳號。
6. 把編輯器裡原有的內容全部刪掉，貼上 repo 的 `apps-script/booking-attribution-isolated.gs`，按磁碟圖示存檔。
7. 左側齒輪「專案設定」→ 往下到「指令碼內容」→「新增指令碼內容」，加三列（ID **不可留白**，腳本不會改去你正在看的另一張表）：
   - `SMC_ATTRIBUTION_ISOLATED` = `yes`
   - `SMC_SHOP_EMAIL` = 你自己的測試信箱
   - `SMC_TEST_SHEET_ID` = 第 4 步複製的 ID
8. 右上「部署」→「新增部署」→ 齒輪 →「網路應用程式」。執行身分選「我」，誰可以存取選「只有我」。按「部署」，同意授權。複製新的網址。不要覆蓋正式那支 `AKfycby…`。
9. 回到試算表按重新整理。若看到選單「隔離測試」，點「送出 8 筆驗收案例」。若沒有這個選單，回到 Apps Script 編輯器，上方函數選單選 `runIsolatedEightCases`，按「執行」。
10. 執行完會跳出說明。到試算表看三個分頁：「訂單」、「郵件預覽」、「驗收結果」。也看你的信箱（客人信與店內信都會寄到 `SMC_SHOP_EMAIL`）。

收到時間欄是按下當下的時間。本機測試把它固定成 `2026-10-08T00:00:00.000Z`。試算表上不必相同，但不可空白。

表頭（訂單分頁第 1 列）：

`訂單編號` `收到時間` `動作` `類型` `姓名` `電話` `信箱` `人數` `桌數` `日期` `時間` `備註` `品項` `來源` `utm來源` `utm媒介` `utm活動` `utm內容` `utm關鍵字` `utm廣告群組` `群組分類` `點擊識別碼`

「驗收結果」最後一列是案例 8：結果 `success`、寫入 `否`、寄信 `否`。

下面 8 筆就是按鈕送出的內容。信箱在按鈕裡會改成你的 `SMC_SHOP_EMAIL`。若要自己貼上，把 `email` 改成你的測試信箱；訂位正文不因信箱改變。`_testOrderId` 只在這支隔離腳本有效。

## 每一筆都這樣對

- 訂單編號：回應的 `orderId`、訂單分頁、客人信、店內信，這四處要同一個編號。
- 備註：送出內容裡的 `note`、訂單分頁「備註」、客人信、店內信，這四處要同一句。回應沒有備註，跳過回應。
- 一般案例這句是 `散客 大人2位；靠窗`。
- 還要看日期 `2026-10-22`、時間 `12:00`、人數 `2`、桌數 `1`、姓名 `測試同學`、電話 `0900000000`。客人信與店內信都要有同一組日期、時間、人數、桌數。

## 案例 1｜只有原來的 11 欄（旗標關閉時官網就是這樣）

編號 `SMC900001`。

```json
{"action":"book","type":"dining","name":"測試同學","phone":"0900000000","email":"你的測試信箱@example.com","people":"2","tables":"1","date":"2026-10-22","time":"12:00","note":"散客 大人2位；靠窗","orderItems":"","_testOrderId":"SMC900001"}
```

- 回應：`status` 為 `success`，`orderId` 為 `SMC900001`。回應沒有備註。
- 訂單列：備註是 `散客 大人2位；靠窗`。來源到點擊識別碼 9 欄都空白。動作 `book`、類型 `dining`、姓名 `測試同學`、電話 `0900000000`、人數 `2`、桌數 `1`、日期 `2026-10-22`、時間 `12:00`、品項空白。
- 客人信正文：

```text
水美土雞城｜預約申請已收到
訂單編號：SMC900001
申請類型：內用
預約日期與時間：2026-10-22 12:00
人數：2
桌數：1
備註：散客 大人2位；靠窗
郵件上的「已收到」是收件通知，細節以電話確認為準。
```

- 店內信在同一套訂位內容下面，來源 9 行都是空的（`來源：` 後面沒有字）。沒有 `google`。

## 案例 2｜廣告・品牌 `ag_brand`

編號 `SMC900101`。

```json
{"action":"book","type":"dining","name":"測試同學","phone":"0900000000","email":"你的測試信箱@example.com","people":"2","tables":"1","date":"2026-10-22","time":"12:00","note":"散客 大人2位；靠窗","orderItems":"","_testOrderId":"SMC900101","source":"google","utmSource":"google","utmMedium":"cpc","utmCampaign":"launch_202610","utmContent":"ag_brand","utmTerm":"","utmAdgroup":"","adgroupBucket":"品牌","gclid":""}
```

- 訂單編號四處相同：`SMC900101`。
- 備註四處相同（不含回應）：`散客 大人2位；靠窗`。
- 訂單列：來源 `google`、utm來源 `google`、utm媒介 `cpc`、utm活動 `launch_202610`、utm內容 `ag_brand`、utm關鍵字空白、utm廣告群組空白、群組分類 `品牌`、點擊識別碼空白。
- 客人信與案例 1 相同格式，編號改 `SMC900101`。正文不得出現 `launch_202610`、`ag_brand`、`品牌`、`utm`。
- 店內信要有：`來源：google`、`utm內容：ag_brand`、`群組分類：品牌`、`utm活動：launch_202610`，以及同一句備註、同一個編號。主旨 `【店內對帳】預約 SMC900101`。

## 案例 3｜廣告・非品牌 `ag_geo_dining`

編號 `SMC900102`。

```json
{"action":"book","type":"dining","name":"測試同學","phone":"0900000000","email":"你的測試信箱@example.com","people":"2","tables":"1","date":"2026-10-22","time":"12:00","note":"散客 大人2位；靠窗","orderItems":"","_testOrderId":"SMC900102","source":"google","utmSource":"google","utmMedium":"cpc","utmCampaign":"launch_202610","utmContent":"ag_geo_dining","utmTerm":"","utmAdgroup":"","adgroupBucket":"非品牌","gclid":""}
```

- 訂單編號四處相同：`SMC900102`。備註四處相同（不含回應）。
- 訂單列群組分類是 `非品牌`，utm內容是 `ag_geo_dining`。案例 2 那一列仍是 `ag_brand`／`品牌`，不可被這筆改掉。
- 客人信不得出現 `ag_geo_dining` 或 `launch_202610`。

## 案例 4｜非廣告 `direct/unknown`

編號 `SMC900103`。

```json
{"action":"book","type":"dining","name":"測試同學","phone":"0900000000","email":"你的測試信箱@example.com","people":"2","tables":"1","date":"2026-10-22","time":"12:00","note":"散客 大人2位；靠窗","orderItems":"","_testOrderId":"SMC900103","source":"direct/unknown","utmSource":"","utmMedium":"","utmCampaign":"","utmContent":"","utmTerm":"","utmAdgroup":"","adgroupBucket":"","gclid":""}
```

- 訂單編號四處相同。備註四處相同（不含回應）。
- 訂單列來源是 `direct/unknown`，不是 `google`。群組分類空白。
- 客人信不得出現 `direct/unknown`。店內信要有 `來源：direct/unknown`。

## 案例 5｜來源不明（只有點擊識別碼）

編號 `SMC900104`。

```json
{"action":"book","type":"dining","name":"測試同學","phone":"0900000000","email":"你的測試信箱@example.com","people":"2","tables":"1","date":"2026-10-22","time":"12:00","note":"散客 大人2位；靠窗","orderItems":"","_testOrderId":"SMC900104","source":"有點擊識別碼、來源待核對","utmSource":"","utmMedium":"","utmCampaign":"","utmContent":"","utmTerm":"","utmAdgroup":"","adgroupBucket":"","gclid":"TESTGCLID9000"}
```

- 訂單編號四處相同。備註四處相同（不含回應）。
- 訂單列與店內信都要有這句來源和 `TESTGCLID9000`。不可寫成 `google`，也不可寫成 `direct/unknown`。
- 客人信不得出現 `TESTGCLID9000` 或「有點擊識別碼」。

## 案例 6｜公式開頭

編號 `SMC900105`。`utmCampaign` 是 `=1+1`，不要自己先加引號。備註仍是原來那句。

```json
{"action":"book","type":"dining","name":"測試同學","phone":"0900000000","email":"你的測試信箱@example.com","people":"2","tables":"1","date":"2026-10-22","time":"12:00","note":"散客 大人2位；靠窗","orderItems":"","_testOrderId":"SMC900105","source":"google","utmSource":"google","utmMedium":"cpc","utmCampaign":"=1+1","utmContent":"ag_brand","utmTerm":"","utmAdgroup":"","adgroupBucket":"品牌","gclid":""}
```

- 訂單編號四處相同。備註四處相同（不含回應），仍是 `散客 大人2位；靠窗`。
- 點開 utm活動那一格。它**不是數字 2**。應是純文字 `=1+1`（儲存格裡可能看得到前面的單引號）。店內信正文含 `'=1+1`。客人信不得出現 `=1+1`。
- 開頭若先有空格、Tab 或換行，也一樣先去掉再當文字，不可算出來。本機測試不會執行公式，這一步一定要在 Google 試算表用眼睛看。

## 案例 7｜格式壞掉仍收單

編號 `SMC900106`。

```json
{"action":"book","type":"dining","name":"測試同學","phone":"0900000000","email":"你的測試信箱@example.com","people":"2","tables":"1","date":"2026-10-22","time":"12:00","note":"散客 大人2位；靠窗","orderItems":"","_testOrderId":"SMC900106","source":{"bad":true},"utmContent":["ag_brand"],"adgroupBucket":"品牌<script>","gclid":12345}
```

- 回應 `success`，`orderId` 為 `SMC900106`。回應沒有備註。
- 備註仍是 `散客 大人2位；靠窗`（送出內容、試算表、兩封信）。
- 來源 9 欄都空白，沒有把 `ag_brand` 寫進去。客人信與案例 1 相同格式。

## 案例 8｜同一編號再送一次

與案例 2 同一份內容，編號仍是 `SMC900101`。

```json
{"action":"book","type":"dining","name":"測試同學","phone":"0900000000","email":"你的測試信箱@example.com","people":"2","tables":"1","date":"2026-10-22","time":"12:00","note":"散客 大人2位；靠窗","orderItems":"","_testOrderId":"SMC900101","source":"google","utmSource":"google","utmMedium":"cpc","utmCampaign":"launch_202610","utmContent":"ag_brand","utmTerm":"","utmAdgroup":"","adgroupBucket":"品牌","gclid":""}
```

- 回應仍是 `success` 與 `SMC900101`。
- 訂單分頁裡 `SMC900101` **只有一列**。郵件預覽只有原本那一封，信箱不會再收到第二封。該列仍是 `ag_brand`／`品牌`。
- 「驗收結果」這一列寫入是 `否`、寄信是 `否`。

## 用最終廣告網址送一筆真的測試單

這一步確認官網那套來源判斷有接到隔離後端。**不要**打開正式官網，也不要把正式 web app 網址貼進來。

1. 用檔案總管打開 repo 的 `tools/isolated-dining-check.html`。若瀏覽器不讓本機檔案送出，在專案資料夾執行 `python3 -m http.server 8765`，再開 `http://127.0.0.1:8765/tools/isolated-dining-check.html`。
2. 點「帶入品牌最終網址」。網址列應出現 `mode=dining`、`utm_content=ag_brand` 和 `#booking-section`，頁面停在「內用訂位」。
3. 畫面上要看到：來源 `google`、utm內容 `ag_brand`、群組分類 `品牌`、內用。
4. 把第 8 步複製的**隔離**網址貼進「隔離 web app 網址」。網址要剛好是 `https://script.google.com/macros/s/部署編號/exec`。不要加問號、井號、帳號、連接埠，也不要貼別的網站。若貼到正式那支 `AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q`，按鈕會停住，不會送出。
5. 姓名維持 `測試同學`、電話 `0900000000`、備註維持 `散客 大人2位；靠窗`。信箱改成你自己的測試信箱（頁上先放 `test@example.com`，只是讓按鈕可以按）。點「送到隔離後端」。
6. 畫面只有在回應是成功、而且有訂單編號時，才會顯示綠色的編號。用那個編號到隔離試算表「訂單」、客人信、店內信對同一個編號。備註對送出內容、試算表、兩封信。店內信要有 `ag_brand` 與 `品牌`。客人信不要有這些代碼。
7. 這頁不會指定 `SMC900001`。8 筆案例做完後再送，應出現**新的**訂單編號、新的一列，以及新的客人信和店內信。案例 1 那一列的來源仍是空白。
8. 若畫面寫「結果未知，先核對試算表、勿重送」，先看試算表有沒有多一列。沒有多出來再查網址；不要立刻再按一次。

可再點「帶入非品牌最終網址」送第二筆。它也要是另一個新編號。店內信應是 `ag_geo_dining`／`非品牌`，上一筆品牌列不要被改掉。

## 對過才算過

本機可先跑 `node tools/test-booking-reconciliation.mjs`（不連 Google）。它通過只代表隔離腳本的邏輯，而且**不會執行公式**，不能證明 Google 試算表沒有把儲存格算掉。試算表、真信，以及上面這頁送到隔離網址，仍要你做。

通過之後也不要把 `js/booking-attribution.js` 的 `SEND_ATTRIBUTION_TO_BACKEND` 改成 `true`。正式腳本還沒接上之前，開了旗標會把來源送進一支尚未驗證的正式 web app。
