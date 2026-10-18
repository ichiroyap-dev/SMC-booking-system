# 隔離 Apps Script 驗收（內用）

必須是新建的獨立試算表專案，不要貼進任何既有專案。這支腳本沒有 `doPost`，只有 `doGet`。貼進既有專案會蓋掉同名的訂位入口。

這份給 Owner 或 hub 在**自己的 Google 帳號**做。不必自己組 JSON，也不必會寫程式。本機測試沒有連 Google，也沒有寄出真信。假試算表**不會執行公式**，所以不能代替你打開 Google 試算表看那一格是不是數字。結果未知時，不可以重新整理後重送。

不要把 `.github/pages-unpublished/booking-attribution-isolated.gs` 貼上正式預約專案，不要改正式 web app 網址，不要寫正式試算表，也不要打開正式官網 `www.sweetmeichicken.com` 來送這次測試。官網 `SEND_ATTRIBUTION_TO_BACKEND` 維持 `false`。正式腳本原始碼不在這個 repo，這支隔離腳本**不是**正式腳本的補丁；這裡通過之後，還要把同樣的「缺來源仍收單」移植到正式腳本，才能另案開旗標。

客人信不可以出現 `launch_202610`、`ag_brand`、`ag_geo_dining`。那些只出現在「訂單」分頁與「店內對帳」信。

回應有 `status`、`orderId`、`message`。成功或重複時還有 `mailed`、`duplicate`、`wrote`。`mailed` 為 true 才是兩封都交給寄信；false 是沒有全部寄出。`duplicate` 為 true 是這個編號已經收過。`wrote` 為 false 是這次沒有新增一列。**回應沒有備註**。備註要對這三處：你送出的內容、試算表「備註」欄、客人信與店內信。不要在回應裡找備註。讀回與寫入不一致就停下，請核對原列，不要重送。

## 準備（照著點）

1. 打開 [Google 雲端硬碟](https://drive.google.com)，新增 → Google 試算表。名稱打「隔離測試」。不要共用給客人。
2. 試算表下方的「+」新增分頁。在分頁名稱上按右鍵 → 重新命名，打 `隔離標記`。
3. 點那一頁的 **A1**，打上 `SMC-ISOLATED-TEST`，按 Enter。不要改字、不要加空白。腳本不會幫你建立這個分頁。
4. 看瀏覽器網址，`/d/` 和 `/edit` 中間那一串就是試算表 ID。先複製下來。
5. 選單「擴充功能」→「Apps Script」。若問要登入，用你自己的 Google 帳號。
6. 把編輯器裡原有的內容全部刪掉，貼上固定版本的 `.github/pages-unpublished/booking-attribution-isolated.gs`，按磁碟圖示存檔。檔名維持 `Code.gs` 即可。這個路徑在 `.github` 裡，目前的建置方式會排除，正式官網打不開；請從下面的固定連結複製，不要從官網網址下載。以後如果換建置流程，或 `upload-pages-artifact` 換版本，要重新檢查這個目錄裡的驗收頁、隔離腳本、手冊和 guard 是否又被公開。
7. 左側「檔案」旁的「+」→「HTML」。檔名打 `IsolatedCheck`（不要加 `.html`，編輯器會自己加）。把固定版本的 `.github/pages-unpublished/IsolatedCheck.html` 全部貼上，存檔。
8. 左側齒輪「專案設定」→ 往下到「指令碼內容」→「新增指令碼內容」，加三列（ID **不可留白**，腳本不會改去你正在看的另一張表）：
   - `SMC_ATTRIBUTION_ISOLATED` = `yes`
   - `SMC_SHOP_EMAIL` = 你自己的測試信箱
   - `SMC_TEST_SHEET_ID` = 第 4 步複製的 ID
9. **實測第一步**是在編輯器執行 `runIsolatedEightCases`，先不要部署。上方函數選單選 `runIsolatedEightCases`，按「執行」。若選單裡沒有這個函式，代表貼錯檔，先停下來回報，不要自己另寫一支。
10. 執行完會跳出說明。到試算表看三個分頁：「訂單」、「郵件預覽」、「驗收結果」。也看你的信箱（客人信與店內信都會寄到 `SMC_SHOP_EMAIL`，不看表格「信箱」欄）。八案例通過後才做下一步。
11. 右上「部署」→「新增部署」→ 齒輪 →「網路應用程式」。執行身分選「我」，誰可以存取選「只有我」。**不可**改成「任何人」；改了這支就會變成別人也能觸發寄信的端點。按「部署」，同意授權。複製新的網址。不要覆蓋正式那支 `AKfycby…`。
12. 用同一個 Google 帳號打開第 11 步的部署網址。畫面上是私人 HtmlService 頁，按鈕用 `google.script.run` 呼叫 `submitIsolatedFromPage`。不要把網址貼進本機頁面。

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

編號 `SMC900105`。同一個案例用四個欄位各放一種開頭，不要自己先加引號。備註仍是原來那句。

| 欄位 | 原值 | 讀回值 | 不是公式 |
| --- | --- | --- | --- |
| utm活動 | `=1+1` | `'=1+1` | `getFormula` 為空 |
| utm內容 | `+1+1` | `'+1+1` | `getFormula` 為空 |
| utm關鍵字 | `-1+1` | `'-1+1` | `getFormula` 為空 |
| utm廣告群組 | `@cmd` | `'@cmd` | `getFormula` 為空 |

```json
{"action":"book","type":"dining","name":"測試同學","phone":"0900000000","email":"你的測試信箱@example.com","people":"2","tables":"1","date":"2026-10-22","time":"12:00","note":"散客 大人2位；靠窗","orderItems":"","_testOrderId":"SMC900105","source":"google","utmSource":"google","utmMedium":"cpc","utmCampaign":"=1+1","utmContent":"+1+1","utmTerm":"-1+1","utmAdgroup":"@cmd","adgroupBucket":"品牌","gclid":""}
```

- 訂單編號四處相同。備註四處相同（不含回應），仍是 `散客 大人2位；靠窗`。
- 打開「公式核對」分頁。四列的判定都要是「通過」。讀回值是帶前導單引號的文字，`getFormula` 欄是「（空）」。任一格不符，腳本會停住，後面的案例不會再送。不要部署，不要開網頁驗收，不要重跑。
- 這四格都不是數字 2。店內信要有這四個帶引號的讀回值。客人信不得出現 `=1+1`。
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

- 回應仍是 `success` 與 `SMC900101`，並明示 `duplicate` 為 true、`wrote` 為 false。訊息會寫這次沒有新增。這不是新的一列。
- 訂單分頁裡 `SMC900101` **只有一列**。郵件預覽只有原本那一封，信箱不會再收到第二封。該列仍是 `ag_brand`／`品牌`。
- 「驗收結果」這一列寫入是 `否`、寄信是 `否`。

## 用私人頁面再送一筆

八案例做完、部署仍是「只有我」之後，才打開部署網址。

1. 點「帶入品牌欄位」。預覽要有來源 `google`、utm內容 `ag_brand`、群組分類 `品牌`。
2. 姓名維持 `測試同學`、電話 `0900000000`、備註維持 `散客 大人2位；靠窗`。表格信箱可以留 `test@example.com`。它不會變成收件人。
3. 點「送到隔離後端」。成功時畫面列出 `status`、`orderId`、`message`、`mailed`、`duplicate`、`wrote`。用那個編號到「訂單」、客人信、店內信對同一個編號。兩封信都在 `SMC_SHOP_EMAIL`。店內信要有 `ag_brand` 與 `品牌`。客人信不要有這些代碼。
4. 若 `status` 是 `unknown`，或訊息要你核對原列，就停下。結果未知時，不可以重新整理後重送。先看試算表那一列。以 `=`、`+`、`-`、`@` 開頭的格子要仍是文字（前面可能有單引號），不可變成數字。讀回少了防護單引號也不算一致。網頁每一筆新單是 2 封信。

## 本機頁面不能拿來送私人部署

`http://127.0.0.1:8765/.github/pages-unpublished/isolated-dining-check.html` 只測瀏覽器鎖。私人部署是「只有我」時，這頁用跨來源方式呼叫部署網址會被導到登入頁，然後 CORS 失敗。不能拿來送私人部署。

1. 在專案資料夾執行 `python3 -m http.server 8765`，用瀏覽器開 `http://127.0.0.1:8765/.github/pages-unpublished/isolated-dining-check.html`。這個檔放在 `.github/pages-unpublished/`，目前的建置方式會排除 `.github`，所以正式官網打不開；本機這個位址仍可開。以後如果換建置流程，或 `upload-pages-artifact` 換版本，要重新檢查這個目錄裡的驗收頁、隔離腳本、手冊和 guard 是否又被公開。鎖只在同一個來源之間共用。請固定用這個 `127.0.0.1`，不要改開 `file://`，也不要改用別的連接埠或主機。不同來源看不到彼此的鎖。這一段不能拿來送私人部署。
這頁的「已寄出」或「未全部寄出，請核對信箱」只存在模擬測試裡。模擬用的 guard 在 `.github/pages-unpublished/isolated-check-guard.js`。Owner 不要改它，也不要用這頁送單。結果未知時，不可以重新整理後重送。

## 固定版本

Raw 連結、`Get-FileHash -Algorithm SHA256` 與預期雜湊寫在下一個 commit 的驗證報告。這兩個程式檔與那份報告分開，避免說明引用尚未產生的 SHA。下載後先核對，對不上就不要貼。部署存取維持「只有我」，不可改成「任何人」。

## 對過才算過

本機可先跑 `node tools/test-booking-reconciliation.mjs`（不連 Google）。它通過只代表隔離腳本的邏輯，而且**不會執行公式**，不能證明 Google 試算表沒有把儲存格算掉。試算表、真信，以及私人頁面那一筆，仍要你做。以 `=`、`+`、`-`、`@` 開頭的格子若讀回不一致，就停下，核對原列，不要重送。

通過之後也不要把 `js/booking-attribution.js` 的 `SEND_ATTRIBUTION_TO_BACKEND` 改成 `true`。正式腳本還沒接上之前，開了旗標會把來源送進一支尚未驗證的正式 web app。
