# 隔離驗證（第 6 輪，延後的 clear）

要貼進 Apps Script 的程式停在 commit `d14798a3ce577420c3b00aa530c6a7c4775820a5`。這份報告是下一個 commit，連結指回那個 SHA。不要再貼 `5f89c71`。

必須是新建的獨立試算表專案，不要貼進任何既有專案。隔離腳本沒有 `doPost`，只有 `doGet`。

沒有部署，沒有寫入 Google 試算表，沒有寄信，沒有合併。`SEND_ATTRIBUTION_TO_BACKEND` 仍是 `false`。正式訂位 POST 仍是 11 欄。正式部署編號仍是 `AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q`。

## 固定檔案

| 檔案 | raw 連結 | SHA-256 |
| --- | --- | --- |
| `.github/pages-unpublished/booking-attribution-isolated.gs` | https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/d14798a3ce577420c3b00aa530c6a7c4775820a5/.github/pages-unpublished/booking-attribution-isolated.gs | `58123a5a1598ba2c942ca295e871f8c46af78252c62edb8f1bf88e199f809802` |
| `.github/pages-unpublished/IsolatedCheck.html` | https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/d14798a3ce577420c3b00aa530c6a7c4775820a5/.github/pages-unpublished/IsolatedCheck.html | `c6ce8cda0968b5ef8af1de6bd04529c2d8d4c8dd839168a1582c04e2ef4f0cce` |

PowerShell：

```powershell
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/d14798a3ce577420c3b00aa530c6a7c4775820a5/.github/pages-unpublished/booking-attribution-isolated.gs' -OutFile booking-attribution-isolated.gs
Get-FileHash .\booking-attribution-isolated.gs -Algorithm SHA256
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/d14798a3ce577420c3b00aa530c6a7c4775820a5/.github/pages-unpublished/IsolatedCheck.html' -OutFile IsolatedCheck.html
Get-FileHash .\IsolatedCheck.html -Algorithm SHA256
```

## 第 6 輪紅燈與綠燈

Owner 用 `5f89c71` 在 2026-10-18 14:59（台北）跑了 `runIsolatedEightCases`。`.gs` 的 SHA-256 是 `6e2375b719be7f1d2c165e05c6b800eeffabe8aad9b7f3450b909180d631c054`，Sheets API 已經加過。訂單分頁 7 個編號各一列，郵件預覽 7 列，信 14 封。案例 6 的 `=1+1`、`+1+1`、`-1+1`、`@cmd` 都是文字。案例 8 是重複編號，沒寫、沒寄。執行約 18.5 秒，沒有錯誤。但是「驗收結果」和「公式核對」整張是空的，匯出的 CSV 是 0 bytes。沒有部署。

程式裡 `writeResultSheet_` 和 `writeProbeSheet_` 先呼叫 `sheet.clear()`。SpreadsheetApp 會把清除延後。接著 `values.update` 立刻把報告寫進伺服器。案例 7、8 的 `SpreadsheetApp.flush()`，以及腳本結束時的 flush，才把那個清除送出，報告被洗掉。訂單和郵件預覽沒有呼叫 clear，所以 7 列和 14 封信還在。RAW 這段是有效的。

模擬把 SpreadsheetApp 的 appendRow、setValues、setRichTextValue、clear 留到 flush 才寫進儲存的列。API 的 update、clear、get 立刻作用在儲存的列。Node `v22.14.0`。

紅燈：目前的測試配上 `5f89c71` 的腳本。

```bash
git show 5f89c71:.github/pages-unpublished/booking-attribution-isolated.gs > .github/pages-unpublished/booking-attribution-isolated.gs
node tools/test-booking-reconciliation.mjs
node tools/test-isolated-e2e.mjs
```

`test-booking-reconciliation.mjs` 結束碼 1，12 項。紀錄 `.github/pages-unpublished/isolated-red-clear-r6.log`。
`test-isolated-e2e.mjs` 結束碼 1，7 項。紀錄 `.github/pages-unpublished/isolated-red-clear-e2e-r6.log`。

綠燈：腳本放回 `d14798a3ce577420c3b00aa530c6a7c4775820a5` 後，同樣兩個指令結束碼都是 0。紀錄 `isolated-green-recon-r6.log`、`isolated-green-e2e-r6.log`。`test-booking-backend-contract.mjs` 與 `test-isolated-dining-check.mjs` 結束碼也是 0。

訂單分頁的 RAW 已在 14:59 真表通過。報告分頁那次是空白，要等這次重跑。讀回列數或內容不對會回結果未知，不再默默留下空白。重跑前四張分頁都要清除內容：訂單、郵件預覽、驗收結果、公式核對。如果訂單和郵件預覽沒清，所有案例都會被判成重複。

## 第 5 輪紅燈與綠燈

Owner 用 `3e6c185` 在 2026-10-18 14:31:13–14:31:28（台北）重跑 `runIsolatedEightCases`。同一張表，四個分頁先清乾淨。案例 1–5 成功。案例 6（`SMC900105`）已寫入、沒寄信、結果未知。`=1+1`、`-1+1`、`@cmd` 讀回等於原值，`getFormula` 為空。utm內容 `+1+1` 被存成文字 `=+1+1`，`getFormula` 也是空的。「公式核對」的原值欄同樣變成 `=+1+1`。沒有部署。

`setRichTextValue` 會把 `+` 開頭改成 `=+` 再當純文字留下。模擬已重現這件事。寫入改為 Sheets API `values.update`，`valueInputOption=RAW`。官方說明 RAW 不解析，字串原樣儲存。Node `v22.14.0`。

紅燈：目前的測試配上 `3e6c185` 的腳本。

```bash
git show 3e6c185:.github/pages-unpublished/booking-attribution-isolated.gs > .github/pages-unpublished/booking-attribution-isolated.gs
node tools/test-booking-reconciliation.mjs
node tools/test-isolated-e2e.mjs
```

`test-booking-reconciliation.mjs` 結束碼 1，37 項。紀錄 `.github/pages-unpublished/isolated-red-plus-r5.log`。
`test-isolated-e2e.mjs` 結束碼 1，5 項。紀錄 `.github/pages-unpublished/isolated-red-plus-e2e-r5.log`。

綠燈：腳本放回 `5f89c717b6763b767ac31bc98a88616ade8bbd76` 後，同樣兩個指令結束碼都是 0。紀錄 `isolated-green-recon-r5.log`、`isolated-green-e2e-r5.log`。

第 5 輪模擬通過後，14:59 真表的訂單四格通過，報告分頁卻是空白。讀回不符仍停下、不寄信。

## 第 4 輪紅燈與綠燈

Owner 用 `319ca18` 在 2026-10-18 13:40–13:43（台北）跑了 `runIsolatedEightCases`。案例 1–5 成功。案例 6（`SMC900105`）已寫入、沒寄信、結果未知。utm活動原值 `=1+1` 讀回 `2`，`getFormula` 為空。`+1+1`、`-1+1`、`@cmd` 讀回等於原值，`getFormula` 也是空的，但舊判定因為少了前導單引號而失敗。沒有部署。

模擬把 `setValues` 的 `=` 開頭算成結果，前導單引號與 `setNumberFormat('@')` 都擋不住。`setRichTextValue` 才留下文字。Node `v22.14.0`。

紅燈：目前的測試配上 `319ca18` 的腳本。

```bash
git show 319ca18:.github/pages-unpublished/booking-attribution-isolated.gs > .github/pages-unpublished/booking-attribution-isolated.gs
node tools/test-booking-reconciliation.mjs
node tools/test-isolated-e2e.mjs
```

`test-booking-reconciliation.mjs` 結束碼 1，97 項。紀錄 `.github/pages-unpublished/isolated-red-equals-r4.log`。
`test-isolated-e2e.mjs` 結束碼 1，12 項。紀錄 `.github/pages-unpublished/isolated-red-equals-e2e-r4.log`。

綠燈：腳本放回 `3e6c1854f7ee678407e7f71d74340087fc390a45` 後，同樣兩個指令結束碼都是 0。紀錄 `isolated-green-recon-r4.log`、`isolated-green-e2e-r4.log`。

第 4 輪當時的模擬通過，真表後來沒過。讀回不符仍停下、不寄信，訊息含欄位、原值、讀回值。`SMC900105` 若還在表上，重跑會走重複編號。

## 這一輪的紅燈與綠燈

每一項都先加測試再改程式。Node `v22.14.0`。

| 項目 | 紅燈 | 綠燈 |
| --- | --- | --- |
| 八案例四種前綴 | 結束碼 1，8 項。紀錄 `isolated-red-formula.log` | `test-booking-reconciliation.mjs` 結束碼 0 |
| 空白與格式錯誤信箱 | 結束碼 1，6 項。紀錄 `isolated-red-email.log` | 同上，結束碼 0。紀錄 `isolated-green-recon-r3.log` |
| 移除 doPost | 結束碼 1，4 項。紀錄 `isolated-red-dopost.log` | `test-isolated-e2e.mjs` 結束碼 0。紀錄 `isolated-green-e2e-r3.log` |

公式紅燈的 8 項：內容欄、關鍵字、廣告群組還沒有 `+ - @`；沒有「四種前綴都通過」；沒有公式核對表；不符時仍繼續後面的案例；手冊沒有列出四種原值與 `getFormula`。

信箱紅燈的 6 項：空白時仍收單並可被看成已寄出，八案例也不停；`not-an-email` 同樣會寫表。

doPost 紅燈的 4 項：仍定義 `doPost`；手冊還沒寫必須新建專案、未知時不可重新整理重送，也還在教改 guard 白名單。

八案例全成功是 14 封信。私人頁每一筆新單 2 封。

## 先前「13 項」怎麼重現（第 3 輪紀錄）

13 這個數字不能從單一 commit 重現。`isolated-e2e-red-entry.log` 是當時還沒 commit 的測試檔，配上腳本 `5d4b789` 跑出來的。只 checkout 一個 commit 會得到另一組失敗數，所以總管重現時對不上 13。

第 3 輪當時可重現的做法：其餘檔案保持 `319ca184f94d9639f49f635fac7901aae17a76fc` 的測試，只把 `.gs` 換成 `5a87907`：

```bash
git show 5a87907:.github/pages-unpublished/booking-attribution-isolated.gs > .github/pages-unpublished/booking-attribution-isolated.gs
node tools/test-isolated-e2e.mjs
```

結束碼 1，18 項。紀錄 `.github/pages-unpublished/isolated-e2e-red-rebuild-r3.log`。跑完要把 `.gs` 放回 `319ca184f94d9639f49f635fac7901aae17a76fc`。

## 請 Owner 做的三步

必須是新建的獨立試算表專案，不要貼進任何既有專案。未核對雜湊前不要貼。不要打開 `www.sweetmeichicken.com`。不要覆寫正式部署。信箱用 Owner 自己的測試信箱。結果未知時，不可以重新整理後重送。

1. **先準備測試表和信箱。** 用自己的帳號新增「隔離測試」試算表，不共用。新增「隔離標記」分頁，A1 填 `SMC-ISOLATED-TEST`。記下試算表 ID。選定自己收得到信的測試信箱，不用客人信箱。
2. **核對程式，先跑八案例。** 用上面的 raw 連結與 `Get-FileHash -Algorithm SHA256`。從試算表開 Apps Script，貼上腳本，新增 `IsolatedCheck` HTML。編輯器左側「服務」加 Google Sheets API，不必手改 `appsscript.json`。設定 `SMC_ATTRIBUTION_ISOLATED=yes`、`SMC_SHOP_EMAIL=測試信箱`、`SMC_TEST_SHEET_ID=測試表 ID`。先不要部署，執行 `runIsolatedEightCases`。首次執行可能再授權，範圍是 `https://www.googleapis.com/auth/spreadsheets`。全成功預期 14 封測試信。訂單分頁四格的讀回值要等於原值，而且 `getFormula` 為空。`+1+1` 不能變成 `=+1+1`。「公式核對」的原值與讀回值是 JSON 字串。任何 unknown、報告空白或讀回不符就停，不部署。重跑前同一張表要清除內容：訂單、郵件預覽、驗收結果、公式核對。表頭可以留著。如果訂單和郵件預覽沒清，所有案例都會被判成重複。
3. **全部核對通過才開私人頁。** 新增網路應用程式部署，執行身分「我」、存取「只有我」。不要覆寫正式部署。用同帳號開新網址，帶入品牌欄位送一次。網頁每一筆新單再 2 封。未知或沒有回應就停，不可以重新整理後重送。`127.0.0.1` 那頁只留給模擬測試，不要拿來送這個部署。

做完後一次回傳：測試表 ID、測試信箱、八案例的驗收結果、公式核對四格、exec 網址、存取是不是「只有我」，以及確認沒有改正式環境。
