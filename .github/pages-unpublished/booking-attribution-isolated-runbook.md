# 隔離 Apps Script 驗收（內用）

必須是新建的獨立試算表專案，不要貼進任何既有專案。這支腳本沒有 `doPost`，只有 `doGet`。貼進既有專案會蓋掉同名的訂位入口。

這份給 Owner 或 hub 在**自己的 Google 帳號**做。不必自己組 JSON，也不必會寫程式。本機測試沒有連 Google，也沒有寄出真信。本機模擬會把以 `=` 開頭的儲存格字串算掉，用來重現試算表；`+`、`-`、`@` 與其他函式不會執行公式。這仍不能代替你打開 Google 試算表看那一格。結果未知時，不可以重新整理後重送。

不要把 `.github/pages-unpublished/booking-attribution-isolated.gs` 貼上正式預約專案，不要改正式 web app 網址，不要寫正式試算表，也不要打開正式官網 `www.sweetmeichicken.com` 來送這次測試。官網 `SEND_ATTRIBUTION_TO_BACKEND` 維持 `false`。正式腳本原始碼不在這個 repo，這支隔離腳本**不是**正式腳本的補丁；這裡通過之後，還要把同樣的「缺來源仍收單」移植到正式腳本，才能另案開旗標。

客人信不可以出現 `launch_202610`、`ag_brand`、`ag_geo_dining`。那些只出現在「訂單」分頁與「店內對帳」信。

回應有 `status`、`orderId`、`message`。成功或重複時還有 `mailed`、`duplicate`、`wrote`。`mailed` 為 true 才是兩封都交給寄信；false 是未確認全部寄出。`duplicate` 為 true 是這個編號已經收過。`wrote` 為 false 是這次沒有新增一列。**回應沒有備註**。備註要對這三處：你送出的內容、試算表「備註」欄、客人信與店內信。不要在回應裡找備註。讀回與寫入不一致就停下，請核對原列，不要重送。

## Owner 三步

需 Owner GO。沒有這句授權，不要貼上、不要執行、不要寫表、不要寄信。

必須是新建的獨立試算表專案，不要貼進任何既有專案。程式停在 commit `cd1aebaaa67a30fb92be331f71facf23d83155af`。這個路徑在 `.github` 裡，目前的建置方式會排除，正式官網打不開。以後如果換建置流程，或 `upload-pages-artifact` 換版本，要重新檢查這個目錄是否又被公開。

2026-10-18 16:02（台北）用 `355da77` 重跑，8 個案例全部通過。16:07 已部署成私人網頁應用程式：版本 1，存取只有自己。私人網頁維持 `355da77` 版本 1。這輪不要重新部署，也不要把這輪的腳本貼上後在真表執行。這輪改了寫入方式、欄位型別，以及客人信失敗後仍寄店內信，不是只改錯誤訊息。下面的 raw 連結和 SHA-256 只供核對檔案。固定 commit 是 `cd1aebaaa67a30fb92be331f71facf23d83155af`。

2026-10-18 Owner 已用編輯器跑過 `fa16c43` 的八案例。資料核對通過：確認寄出 14 封、未確認 0 封，訂單／郵件預覽／驗收結果／公式核對列數 8／8／9／5，案例 8 是 `duplicate=true`、`wrote=false`、`mailed=false`，公式核對通過。最後因編輯器沒有 `getUi`，舊程式把成功摘要改成結果未知。那張測試表當證據保留，不要清掉當下一輪。核准後要換新固定版，清空後從頭重跑。

1. **先準備測試表和信箱。** 用自己的帳號新增「隔離測試」試算表，不共用。新增「隔離標記」分頁，A1 填 `SMC-ISOLATED-TEST`。記下試算表 ID。選定自己收得到信的測試信箱，不用客人信箱。這個信箱就是下一步的 `SMC_SHOP_EMAIL`。重跑前清空四張分頁（訂單、郵件預覽、驗收結果、公式核對，表頭以下）。「隔離標記」不要清。訂單分頁至少1000列、欄擴至 AAA。
2. **核對程式。這輪不要貼上、不要執行八案例。** 未核對雜湊前不要貼。在 PowerShell 下載後執行 `Get-FileHash .\檔名 -Algorithm SHA256`，要和下面的預期值相同。
   - 腳本 raw：https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/cd1aebaaa67a30fb92be331f71facf23d83155af/.github/pages-unpublished/booking-attribution-isolated.gs
     預期 SHA-256 `22959850fe66221c7f0150ee1523d677ccad97ae50c7f5150c12ba8815ab45f2`
   - 頁面 raw：https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/cd1aebaaa67a30fb92be331f71facf23d83155af/.github/pages-unpublished/IsolatedCheck.html
     預期 SHA-256 `c6ce8cda0968b5ef8af1de6bd04529c2d8d4c8dd839168a1582c04e2ef4f0cce`
   - 從這張新試算表開 Apps Script。貼上腳本，再「+」→ HTML，檔名 `IsolatedCheck`。不必手改 `appsscript.json`。編輯器左側「服務」旁按「+」，選 Google Sheets API，按新增。預設的 Apps Script Cloud 專案會自己打開這個 API，不必再去 Cloud Console。存檔後 `appsscript.json` 會出現 `enabledAdvancedServices`：`userSymbol` 是 `Sheets`、`version` 是 `v4`、`serviceId` 是 `sheets`。
   - 設定 `SMC_ATTRIBUTION_ISOLATED=yes`、`SMC_SHOP_EMAIL=測試信箱`、`SMC_TEST_SHEET_ID=測試表 ID`。
   - **實測第一步：** 先不要部署。私人網頁維持既有版本，這輪不要重新部署。先讓試算表分頁保持開著。函數選單選 `runIsolatedEightCases`，按執行。結果會寫進編輯器執行記錄。從編輯器執行時沒有試算表彈窗，執行紀錄會多一句「編輯器執行，無彈窗，以執行紀錄為準」；這不是結果未知，成功摘要不可因此降級。從試算表分頁選單執行才會彈 alert；alert 出現後先讀完，按確定，再等執行完全結束。等待對話框不是故障。以執行記錄的最後一行為準；分頁寫 success，不等於整輪通過。不要把「編輯器執行，無彈窗，以執行紀錄為準」當成失敗。沒有看到這段結果、還在執行，或出現錯誤，就停止回報，不要重跑。客人的信寄失敗後，仍然會寄店內的信。`sendEmail` 丟錯記成未確認寄出，不要補寄。任一案例結果未知、錯誤、寄信未確認，或案例 8 不是重複，八案例就停在那個案例，後面的案例不跑、不再寄信。摘要會寫「停在」哪個案例和原因，不會寫四種前綴都通過。首次執行可能再授權。同意畫面只會列出還沒給過的項目，也可能不再詢問。進階服務用的範圍是 `https://www.googleapis.com/auth/spreadsheets`（查看、編輯、建立及刪除您所有的 Google 試算表）。它不能改成「只限目前這張試算表」。寄信權限是原本的「以您的名義傳送電子郵件」。存取仍是「只有我」，不要改成「任何人」。若出現雲端硬碟、Gmail 或日曆的新範圍，就停下來，不要繼續。
   - 全成功的執行記錄要寫「確認寄出 14 封。未確認寄出 0 封」（7 筆新單各 2 封，重複那筆不寄）。網頁驗收每一筆新單再 2 封。封數不同時，以「驗收結果」的寄信欄和執行記錄的最後一行為準，不要只靠信箱封數。
   - 核對「訂單」「郵件預覽」「驗收結果」「公式核對」。訂單分頁案例 6 的四格，讀回值必須完全等於原值 `=1+1`、`+1+1`、`-1+1`、`@cmd`，而且 `getFormula` 為空。`+1+1` 不能變成 `=+1+1`。「公式核對」分頁的原值與讀回值是 JSON 字串，例如 `"+1+1"`。任何 unknown、讀回不符或公式異常，就停止，不部署、不要開網頁驗收，先回報原列。結果未知時，不可以重新整理後重送。
3. **這輪不要開私人頁。** 私人網頁維持 `355da77` 版本 1。之後若 Owner 另決要開，才新增網路應用程式部署，執行身分「我」、存取「只有我」，**不可**改成「任何人」。不要覆寫正式部署。用同帳號開新網址，按鈕經 `google.script.run` 送一次品牌欄位。核對新編號、原列及兩封信。未知或沒有回應就停，不可以重新整理後重送。不要用 `http://127.0.0.1:8765/.github/pages-unpublished/isolated-dining-check.html` 送這個部署；那頁只留給模擬測試。

4. **表尾三筆用編輯器單筆入口。需 Owner GO。** 沒有這句授權，不要跑。人工確認測試表 ID 和收件信箱是測試用。訂單分頁至少1000列、欄擴至 AAA。不要開網頁，不要新增 doGet／doPost，也不要重新部署。函數選單只選 `runIsolatedOneBooking201`、`runIsolatedOneBooking202` 或 `runIsolatedOneBooking203`，每次只送一筆。不要從選單跑帶編號的函式。編號只能是 `SMC900201`、`SMC900202`、`SMC900203`。從編輯器執行沒有彈窗，執行紀錄會寫「編輯器執行，無彈窗，以執行紀錄為準」，回傳摘要與紀錄同一句，不因此改成結果未知。

   八案例通過後，訂單已有表頭加 7 列新單（A2:V8）。三筆各自在執行前佈置，不要一次全部放好。若先把 A10 的公式放好，201 會寫到第 11 列，而不是 A9:V9。確認上一筆後，才佈置並跑下一筆。

   | 入口 | 當筆執行前佈置 | 預期寫入 |
   | --- | --- | --- |
   | `runIsolatedOneBooking201` | 第 1000 列只有格式 | 寫入 A9:V9 |
   | `runIsolatedOneBooking202` | A10 放真正公式 `=""` | 寫入 A11:V11，A10 的 `=""` 公式仍在 |
   | `runIsolatedOneBooking203` | 12–13 列空、AAA14 放文字 | 寫入 A15:V15，AAA14 不可被蓋 |

   防護與八案例相同：重複、寫入位置、讀回、寄信封數；結果未知就停，不補寄。郵件預覽依序 A9:G9、A10:G10、A11:G11，每筆確認兩封。最後再跑 201 一次，必須判成重複：`duplicate=true`、`wrote=false`、`mailed=false`，不再寫入、不再寄信。

做完後一次回傳：測試表 ID、測試信箱、八案例的驗收結果、公式核對四格、exec 網址、存取是不是「只有我」，以及確認沒有改正式環境。

## 2026-10-18 14:59 之後怎麼重跑

14:31 那次用 commit `3e6c185`。同一張表先清除內容，時間 14:31:13–14:31:28（台北）。案例 1–5 成功。案例 6（`SMC900105`）已寫入、沒寄信、結果未知。`=1+1`、`-1+1`、`@cmd` 讀回等於原值。utm內容 `+1+1` 被存成文字 `=+1+1`，`getFormula` 是空的。「公式核對」的原值欄也被改成 `=+1+1`。案例 7、8 沒有跑。還沒部署。`setRichTextValue` 會把 `+` 開頭改成 `=+`，再以純文字留下。

14:59 那次用 commit `5f89c71`，`.gs` 的 SHA-256 是 `6e2375b719be7f1d2c165e05c6b800eeffabe8aad9b7f3450b909180d631c054`，Sheets API 已經加過。真表上觀察到：訂單分頁 7 個編號各一列，郵件預覽 7 列，信 14 封。案例 6 的 `=1+1`、`+1+1`、`-1+1`、`@cmd` 都存成文字。案例 8 是重複編號，沒寫、沒寄。執行約 18.5 秒，沒有錯誤。但是「驗收結果」和「公式核對」整張是空的，匯出的 CSV 是 0 bytes。那次沒有留下 flush 先後順序的執行追蹤。模擬重現的是：這兩張分頁先呼叫 `sheet.clear()`，清除延後到 flush；中間用 API 寫入報告；案例 7 寫入訂單時的 flush，以及腳本結束時的 flush，才把報告洗掉。案例 8 是重複編號，不會 flush。這能對上空白報告，但不是那次真表的內部追蹤。

重跑前先把 14:59 的四張 CSV（含兩個 0 bytes 檔）和郵件紀錄留好，跟新的一輪分開。重跑前四張分頁都要清除內容：訂單、郵件預覽、驗收結果、公式核對。只留同一張表，保留表頭，清除表頭以下的內容，不要刪掉整列。「隔離標記」A1 維持 `SMC-ISOLATED-TEST`。不要新建試算表，也不要改 `SMC_TEST_SHEET_ID`。如果訂單和郵件預覽沒清，所有案例都會被判成重複，不會改寫舊列，也不會寄信。

然後貼第 2 步的 raw 連結（不要再貼 `5f89c71`），確認已經加入 Google Sheets API，先不要部署，再執行一次 `runIsolatedEightCases`。先讓試算表分頁保持開著。alert 出現後先讀完，按確定，再等執行完全結束。等待對話框不是故障。同時看編輯器執行記錄裡的同一段文字。沒有這段結果、還在執行，或出現錯誤，就停止。跑完再重新整理。訂單 8 列（含表頭）：`SMC900001`、`SMC900101` 到 `SMC900106` 各一列。郵件預覽 8 列。驗收結果 9 列：案例 1–7 是 success、寫入是、寄信是；案例 8 是 success、寫入否、寄信否。公式核對 5 列，原值與讀回值是 `"=1+1"`、`"+1+1"`、`"-1+1"`、`"@cmd"`，getFormula 是（空），判定是通過。訂單格子本身是沒有外加引號的原值。14 封信。若出現錯誤、結果未知、報告空白、少列或讀回不符，就停止，不要重跑，不要部署。

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
| utm活動 | `=1+1` | `=1+1` | `getFormula` 為空 |
| utm內容 | `+1+1` | `+1+1` | `getFormula` 為空 |
| utm關鍵字 | `-1+1` | `-1+1` | `getFormula` 為空 |
| utm廣告群組 | `@cmd` | `@cmd` | `getFormula` 為空 |

```json
{"action":"book","type":"dining","name":"測試同學","phone":"0900000000","email":"你的測試信箱@example.com","people":"2","tables":"1","date":"2026-10-22","time":"12:00","note":"散客 大人2位；靠窗","orderItems":"","_testOrderId":"SMC900105","source":"google","utmSource":"google","utmMedium":"cpc","utmCampaign":"=1+1","utmContent":"+1+1","utmTerm":"-1+1","utmAdgroup":"@cmd","adgroupBucket":"品牌","gclid":""}
```

- 訂單編號四處相同。備註四處相同（不含回應），仍是 `散客 大人2位；靠窗`。
- 訂單分頁這四格的讀回值必須完全等於原值，而且 `getFormula` 為空。`+1+1` 不能變成 `=+1+1`。寫入用 Sheets API 的 `valueInputOption=RAW`，不解析公式。
- 打開「公式核對」分頁。四列的判定都要是「通過」。原值與讀回值用 JSON 字串呈現，例如 `"+1+1"`、`"=1+1"`，避免報告分頁自己再被改寫。`getFormula` 欄是「（空）」。任一格不符，腳本會停住，並在訊息裡寫明欄位、原值、讀回值、getFormula。後面的案例不會再送。不要部署，不要開網頁驗收。
- 這四格都不是數字 2。店內信要有這四個原值字串。客人信不得出現 `=1+1`。
- 開頭若先有空格、Tab 或換行，也一樣先去掉再當文字，不可算出來。本機模擬只會把 `=` 開頭算掉；這一步一定要在 Google 試算表用眼睛看。

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
4. 若 `status` 是 `unknown`，或訊息要你核對原列，就停下。結果未知時，不可以重新整理後重送。訊息會寫明欄位、原值、讀回值。先看試算表那一列。以 `=`、`+`、`-`、`@` 開頭的格子，讀回值要等於原值字串，而且 `getFormula` 為空，不可變成數字。網頁每一筆新單是 2 封信。

## 本機頁面不能拿來送私人部署

`http://127.0.0.1:8765/.github/pages-unpublished/isolated-dining-check.html` 只測瀏覽器鎖。私人部署是「只有我」時，這頁用跨來源方式呼叫部署網址會被導到登入頁，然後 CORS 失敗。不能拿來送私人部署。

1. 在專案資料夾執行 `python3 -m http.server 8765`，用瀏覽器開 `http://127.0.0.1:8765/.github/pages-unpublished/isolated-dining-check.html`。這個檔放在 `.github/pages-unpublished/`，目前的建置方式會排除 `.github`，所以正式官網打不開；本機這個位址仍可開。以後如果換建置流程，或 `upload-pages-artifact` 換版本，要重新檢查這個目錄裡的驗收頁、隔離腳本、手冊和 guard 是否又被公開。鎖只在同一個來源之間共用。請固定用這個 `127.0.0.1`，不要改開 `file://`，也不要改用別的連接埠或主機。不同來源看不到彼此的鎖。這一段不能拿來送私人部署。
這頁的「已寄出」或「未全部寄出，請核對信箱」只存在模擬測試裡。模擬用的 guard 在 `.github/pages-unpublished/isolated-check-guard.js`。Owner 不要改它，也不要用這頁送單。結果未知時，不可以重新整理後重送。

## 固定版本

要核對的兩個檔案停在 commit `cd1aebaaa67a30fb92be331f71facf23d83155af`。這段連結是下一個 commit 寫上的，不會引用自己。這輪不要貼上、不要重新部署。

- https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/cd1aebaaa67a30fb92be331f71facf23d83155af/.github/pages-unpublished/booking-attribution-isolated.gs
  - `Get-FileHash .\booking-attribution-isolated.gs -Algorithm SHA256`
  - 預期 `22959850fe66221c7f0150ee1523d677ccad97ae50c7f5150c12ba8815ab45f2`
- https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/cd1aebaaa67a30fb92be331f71facf23d83155af/.github/pages-unpublished/IsolatedCheck.html
  - `Get-FileHash .\IsolatedCheck.html -Algorithm SHA256`
  - 預期 `c6ce8cda0968b5ef8af1de6bd04529c2d8d4c8dd839168a1582c04e2ef4f0cce`

## 對過才算過

本機可先跑 `node tools/test-booking-reconciliation.mjs`（不連 Google）。它通過只代表隔離腳本的邏輯。本機模擬會把 `=` 開頭算掉；`+`、`-`、`@` 與其他函式不會執行公式，不能證明 Google 試算表沒有把儲存格算掉。試算表、真信，以及私人頁面那一筆，仍要你做。以 `=`、`+`、`-`、`@` 開頭的格子若讀回值不等於原值字串，或 `getFormula` 不是空的，就停下，核對原列，不要重送。

通過之後也不要把 `js/booking-attribution.js` 的 `SEND_ATTRIBUTION_TO_BACKEND` 改成 `true`。正式腳本還沒接上之前，開了旗標會把來源送進一支尚未驗證的正式 web app。
