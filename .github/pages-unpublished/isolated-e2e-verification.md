# 隔離驗證（開旗標前的必修）

私人網頁維持 `355da77` 版本 1，這輪不重新部署，不開旗標，不寫正式試算表，不寄信。這輪的 `.gs` 不要貼上已部署的專案。

第 8 輪寫過「只是錯誤訊息和文件的小修」。那句少了行為改變：客人的信寄失敗後，仍然會寄店內的信。`355da77` 沒有這個行為。這輪的摘要改寫實際封數：確認寄出、未確認寄出。寄信呼叫回傳錯誤時寫「未確認寄出」，不要寫成已經確定沒有寄出，也不要補寄。

## PR46 第 8 輪紅燈的兩種重現

這組數字用的是第 8 輪的測試和文件，commit `beb2cf191cf6d2f82c6d5a493bd4dbc2772ae88c`。差異在於文件有沒有一起換回 `355da77`。只換腳本、文件留在新版（第 8 輪），得到 9 項和 7 項。腳本和文件都換回舊版，得到 14 項和 11 項。Node `v22.14.0`。2026-10-18 在這支分支上照下面兩組指令重跑，數字相同。跑完要把檔案放回目前這支分支。

只換腳本（第 8 輪的新文件＋舊 `.gs`）。測試也要放回第 8 輪，否則會混進這輪新增的寄信斷言：

```bash
git show beb2cf191cf6d2f82c6d5a493bd4dbc2772ae88c:tools/test-booking-reconciliation.mjs > tools/test-booking-reconciliation.mjs
git show beb2cf191cf6d2f82c6d5a493bd4dbc2772ae88c:tools/test-isolated-e2e.mjs > tools/test-isolated-e2e.mjs
git show beb2cf191cf6d2f82c6d5a493bd4dbc2772ae88c:.github/pages-unpublished/isolated-e2e-verification.md > .github/pages-unpublished/isolated-e2e-verification.md
git show beb2cf191cf6d2f82c6d5a493bd4dbc2772ae88c:.github/pages-unpublished/booking-attribution-isolated-runbook.md > .github/pages-unpublished/booking-attribution-isolated-runbook.md
git show 355da77:.github/pages-unpublished/booking-attribution-isolated.gs > .github/pages-unpublished/booking-attribution-isolated.gs
node tools/test-booking-reconciliation.mjs
node tools/test-isolated-e2e.mjs
```

`test-booking-reconciliation.mjs` 結束碼 1，9 項。紀錄 `.github/pages-unpublished/isolated-red-r8-recon-gs-only.log`。
`test-isolated-e2e.mjs` 結束碼 1，7 項。紀錄 `.github/pages-unpublished/isolated-red-r8-e2e-gs-only.log`。

腳本和文件一起換回 `355da77`（測試仍是第 8 輪）：

```bash
git show beb2cf191cf6d2f82c6d5a493bd4dbc2772ae88c:tools/test-booking-reconciliation.mjs > tools/test-booking-reconciliation.mjs
git show beb2cf191cf6d2f82c6d5a493bd4dbc2772ae88c:tools/test-isolated-e2e.mjs > tools/test-isolated-e2e.mjs
git show 355da77:.github/pages-unpublished/booking-attribution-isolated.gs > .github/pages-unpublished/booking-attribution-isolated.gs
git show 355da77:.github/pages-unpublished/isolated-e2e-verification.md > .github/pages-unpublished/isolated-e2e-verification.md
git show 355da77:.github/pages-unpublished/booking-attribution-isolated-runbook.md > .github/pages-unpublished/booking-attribution-isolated-runbook.md
node tools/test-booking-reconciliation.mjs
node tools/test-isolated-e2e.mjs
```

`test-booking-reconciliation.mjs` 結束碼 1，14 項。紀錄 `.github/pages-unpublished/isolated-red-r8-recon-docs.log`。
`test-isolated-e2e.mjs` 結束碼 1，11 項。紀錄 `.github/pages-unpublished/isolated-red-r8-e2e-docs.log`。

若改用這輪的測試、只換 `355da77` 的腳本，文件留在這輪，對帳是 9 項，端到端是 9 項。這輪的測試留著，只把腳本和兩份文件換回 `355da77`，對帳是 14 項，端到端是 13 項。不是把測試也換回 `355da77`。多出來的是這輪新增的「確認寄出／未確認寄出」斷言，不是第 8 輪那組 9／7 和 14／11。紀錄 `isolated-red-preflag-recon-gs-only.log`、`isolated-red-preflag-e2e-gs-only.log`、`isolated-red-preflag-recon-docs.log`、`isolated-red-preflag-e2e-docs.log`。

## PR47 第 1 輪紅燈與綠燈

Node `v22.14.0`。紅燈是測試配上 `3ebf58a` 的腳本。F2 的紅燈要用 `TZ=UTC`，讓專案時區和試算表的 `Asia/Taipei` 不同。綠燈是同一指令、腳本放回這輪，結束碼 0。`TZ=Asia/Taipei` 再跑 F2 也是 0，讀回不再靠行程時區。

```bash
git show 3ebf58a:.github/pages-unpublished/booking-attribution-isolated.gs > .github/pages-unpublished/booking-attribution-isolated.gs
TZ=UTC node tools/test-pr47-r1.mjs --item f1
TZ=UTC node tools/test-pr47-r1.mjs --item f2
TZ=UTC node tools/test-pr47-r1.mjs --item f6
TZ=UTC node tools/test-pr47-r1.mjs --item checklist
TZ=UTC node tools/test-pr47-r1.mjs --item nit-doc
TZ=UTC node tools/test-pr47-r1.mjs --item nit-pages
```

| 項目 | 紅燈 | 綠燈 |
| --- | --- | --- |
| f1 收到時間序號 | 結束碼 1，3 項 | 0 |
| f2 Date 讀回 | 結束碼 1，5 項 | 0 |
| f6 表尾位置 | 結束碼 1，6 項 | 0 |
| 移植清單補欄 | 結束碼 1，12 項 | 0 |
| 文件用詞 | 結束碼 1，8 項 | 0 |
| Pages 環境不足 | 結束碼 1，3 項 | 0 |

紀錄在 `isolated-red-pr47-r1-f1.log` 到 `isolated-red-pr47-r1-nit-pages.log`，綠燈是 `isolated-green-pr47-r1-*.log`。跑完要把腳本放回這支分支。

## PR47 第 3 輪：Codex 第 2 輪退回

Node `v22.14.0`。紅燈是 `tools/test-pr47-r2.mjs` 配上固定腳本 `46a7254b15884868dff6f5593abfb65ed3fba288`。綠燈是同一指令、腳本放回這輪，結束碼 0。跑完要把腳本放回這支分支。沒有連 Google，沒有寫表，沒有寄信。

```bash
git show 46a7254b15884868dff6f5593abfb65ed3fba288:.github/pages-unpublished/booking-attribution-isolated.gs > .github/pages-unpublished/booking-attribution-isolated.gs
node tools/test-pr47-r2.mjs --item range
node tools/test-pr47-r2.mjs --item occupy
node tools/test-pr47-r2.mjs --item checklist
node tools/test-pr47-r2.mjs --item nit
```

| 項目 | 紅燈 | 綠燈 |
| --- | --- | --- |
| updatedRange 分頁、單列、欄位 | 結束碼 1，8 項 | 結束碼 0 |
| 公式空結果與 ZZ 之後 | 結束碼 1，8 項 | 結束碼 0 |
| 移植清單的擴列與跨寫入者 | 結束碼 1，6 項 | 結束碼 0 |
| tableRange 推算與缺時區用詞 | 結束碼 1，4 項 | 結束碼 0 |

紀錄是 `isolated-red-pr47-r2-range.log`、`isolated-red-pr47-r2-occupy.log`、`isolated-red-pr47-r2-checklist.log`、`isolated-red-pr47-r2-nit.log`。綠燈是 `isolated-green-pr47-r2-*.log`。

## 合併到 main 之後

合併到 main 後，公開網站的 JS 會立刻改送原文，不再加前導單引號。開旗標的順序是：先把正式腳本改成 RAW 寫入並在副本上驗證，最後才開旗標。Google 只保證 RAW 不解析輸入，不能把 `=`、`+`、`-`、`@` 說成一定會被當成公式執行。

## 開旗標前必修的紅燈與綠燈

Node `v22.14.0`。指令是 `node tools/test-preflag-fixes.mjs --item <項目>`。紅燈是改程式前；綠燈是改完後同一指令，結束碼都是 0。

| 項目 | 紅燈 | 綠燈紀錄 |
| --- | --- | --- |
| 1 前端送原文 | 結束碼 1，7 項。`isolated-red-preflag-item1.log` | `isolated-green-preflag-item1.log` |
| 2 append 與表尾 | 結束碼 1，8 項。`isolated-red-preflag-item2.log` | `isolated-green-preflag-item2.log` |
| 3 欄位契約 | 結束碼 1，16 項。`isolated-red-preflag-item3.log` | `isolated-green-preflag-item3.log` |
| 4 移植清單 | 結束碼 1，10 項。`isolated-red-preflag-item4.log` | `isolated-green-preflag-item4.log` |
| 5 Pages 排除 | 結束碼 1，1 項。`isolated-red-preflag-item5.log` | `isolated-green-preflag-item5.log` |
| 客人信失敗仍寄店內信 | 第 8 輪腳本只有手冊缺句：結束碼 1，1 項。`isolated-red-preflag-nit1.log`。只換 `355da77` 的腳本、手冊留這輪：結束碼 1，2 項。`isolated-red-preflag-nit1-gs-only.log`。手冊也還沒那句時是 3 項，`isolated-red-preflag-nit1-355da77.log` | `isolated-green-preflag-nit1.log` |
| 手冊最後一行為準 | 結束碼 1，1 項。`isolated-red-preflag-nit2.log` | `isolated-green-preflag-nit2.log` |
| 摘要封數 | 結束碼 1，5 項。`isolated-red-preflag-nit3.log` | `isolated-green-preflag-nit3.log` |
| 第 8 輪兩種紅燈寫進文件 | 結束碼 1，2 項。`isolated-red-preflag-nit4.log` | `isolated-green-preflag-nit4.log` |

全套綠燈：`node tools/test-booking-reconciliation.mjs` 結束碼 0，`isolated-green-recon-preflag.log`。`node tools/test-isolated-e2e.mjs` 結束碼 0，`isolated-green-e2e-preflag.log`。`node tools/test-booking-backend-contract.mjs` 結束碼 0。

決定：防護只放在 RAW 寫入。前端送原文，不加 `'`。後端不刪使用者欄位開頭的 `'`。資料列在鎖內先 `values.get` 整張分頁的公式（`FORMULA`，不設 `A:ZZ` 上限），再用 `values.update` RAW 寫到最後一筆有值的下一列。`updatedRange` 要對上分頁、正好那一列、欄從 A 到最後一欄。記錄裡的 `tableRange` 是推算。不看快取最後一列加一，也不用範圍 A1 的 `values.append`。電話永遠文字並保留開頭 0。人數、桌數是整數才存數字。日期、時間存試算表序號。收到時間用試算表時區的牆鐘序號。契約在 `docs/booking-sheet-columns.md`。正式腳本這輪不改，清單在 `.github/pages-unpublished/production-port-checklist.md`。Pages 檢查是 `node tools/check-pages-unpublished.mjs`，不部署。

固定檔案停在 commit `46a7254b15884868dff6f5593abfb65ed3fba288`。這份說明是下一個 commit，連結指回那個 SHA。這輪不要貼上、不要重新部署。私人網頁維持 `355da77` 版本 1。

| 檔案 | raw 連結 | SHA-256 |
| --- | --- | --- |
| `.github/pages-unpublished/booking-attribution-isolated.gs` | https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/46a7254b15884868dff6f5593abfb65ed3fba288/.github/pages-unpublished/booking-attribution-isolated.gs | `9f8a3072cb6ddd77d20238061414f59adf80706c46fb9c727f173e7c5c41221c` |
| `.github/pages-unpublished/IsolatedCheck.html` | https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/46a7254b15884868dff6f5593abfb65ed3fba288/.github/pages-unpublished/IsolatedCheck.html | `c6ce8cda0968b5ef8af1de6bd04529c2d8d4c8dd839168a1582c04e2ef4f0cce` |

## 第 8 輪原文

# 隔離驗證（第 8 輪，錯誤訊息）

要貼進 Apps Script 的程式停在 commit `6328d17f72d6bf4b9d8f41a82bc3dd96719a31eb`。這份報告是下一個 commit，連結指回那個 SHA。不要再貼 `d14798a`。2026-10-18 16:02（台北）Owner 用 `355da77` 重跑，8 個案例全部通過。16:07 已部署成私人網頁應用程式：版本 1，存取只有自己。已部署的是 355da77；新 commit 只是錯誤訊息和文件的小修，是否重新部署由 Owner 決定。

必須是新建的獨立試算表專案，不要貼進任何既有專案。隔離腳本沒有 `doPost`，只有 `doGet`。

這輪沒有重新部署，沒有寫入 Google 試算表，沒有寄信，沒有合併。`SEND_ATTRIBUTION_TO_BACKEND` 仍是 `false`。正式訂位 POST 仍是 11 欄。正式部署編號仍是 `AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q`。

## 固定檔案

| 檔案 | raw 連結 | SHA-256 |
| --- | --- | --- |
| `.github/pages-unpublished/booking-attribution-isolated.gs` | https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/6328d17f72d6bf4b9d8f41a82bc3dd96719a31eb/.github/pages-unpublished/booking-attribution-isolated.gs | `a0f1bcf7a4cb3f1a9f392e5c064eb577399c19cb065e8901eeae4e9fbe24094a` |
| `.github/pages-unpublished/IsolatedCheck.html` | https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/6328d17f72d6bf4b9d8f41a82bc3dd96719a31eb/.github/pages-unpublished/IsolatedCheck.html | `c6ce8cda0968b5ef8af1de6bd04529c2d8d4c8dd839168a1582c04e2ef4f0cce` |

PowerShell：

```powershell
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/6328d17f72d6bf4b9d8f41a82bc3dd96719a31eb/.github/pages-unpublished/booking-attribution-isolated.gs' -OutFile booking-attribution-isolated.gs
Get-FileHash .\booking-attribution-isolated.gs -Algorithm SHA256
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/6328d17f72d6bf4b9d8f41a82bc3dd96719a31eb/.github/pages-unpublished/IsolatedCheck.html' -OutFile IsolatedCheck.html
Get-FileHash .\IsolatedCheck.html -Algorithm SHA256
```

## 第 8 輪紅燈與綠燈

錯誤訊息要寫明是哪張分頁、什麼錯誤。最終 flush 失敗要寫出階段、「驗收結果」、「公式核對」和錯誤文字，不可只寫讀不回來。公式核對讀回失敗、驗收結果寫入失敗也要帶上錯誤文字。只寄出部分信時，每一封已確認成功的 `MailApp.sendEmail` 各算一封；沒寄出的另外標示，不要補寄。案例 6 的第二封失敗時，實際成功 11 封，舊訊息寫成 10。alert 本身失敗時，`runIsolatedEightCases` 回結果未知，不回「四種前綴都通過」。`notify_` 仍不把 alert 錯誤丟出去，錯誤留在執行記錄。getLastRow()+1 這輪不改。文件把快取改成不可依賴即時一致，根因分成真表上觀察到和模擬重現，手冊補上按確定與等待對話框。Node `v22.14.0`。

紅燈：目前的測試配上 `355da77` 的腳本。

```bash
git show 355da77:.github/pages-unpublished/booking-attribution-isolated.gs > .github/pages-unpublished/booking-attribution-isolated.gs
node tools/test-booking-reconciliation.mjs
node tools/test-isolated-e2e.mjs
```

`test-booking-reconciliation.mjs` 結束碼 1，14 項。紀錄 `.github/pages-unpublished/isolated-red-messages-r8.log`。
`test-isolated-e2e.mjs` 結束碼 1，11 項。紀錄 `.github/pages-unpublished/isolated-red-messages-e2e-r8.log`。

綠燈：腳本放回 `6328d17f72d6bf4b9d8f41a82bc3dd96719a31eb` 後，同樣兩個指令結束碼都是 0。紀錄 `isolated-green-recon-r8.log`、`isolated-green-e2e-r8.log`。`test-booking-backend-contract.mjs` 與 `test-isolated-dining-check.mjs` 結束碼也是 0。

## 第 7 輪紅燈與綠燈

最後讀回「驗收結果」和「公式核對」之前先呼叫 `SpreadsheetApp.flush()`。測試故意在報告寫完後再排一個會延後的 `sheet.clear()`。沒有這行 flush 時，回傳仍寫「四種前綴都通過」，腳本結束後驗收結果是 0 列。有這行就回結果未知，並寫出讀回 0 列、預期 9 列。`notify_` 先寫 `console.log`；alert 失敗時把錯誤也寫進執行記錄。內容不符會寫出實際值和預期值。公式核對寫入失敗會寫明停在「6 公式開頭」，以及已經寄出 12 封信。API 讀回若省略列尾空欄，比對前先補齊。Node `v22.14.0`。

紅燈：目前的測試配上 `d14798a` 的腳本。

```bash
git show d14798a:.github/pages-unpublished/booking-attribution-isolated.gs > .github/pages-unpublished/booking-attribution-isolated.gs
node tools/test-booking-reconciliation.mjs
node tools/test-isolated-e2e.mjs
```

`test-booking-reconciliation.mjs` 結束碼 1，15 項。紀錄 `.github/pages-unpublished/isolated-red-flush-r7.log`。
`test-isolated-e2e.mjs` 結束碼 1，7 項。紀錄 `.github/pages-unpublished/isolated-red-flush-e2e-r7.log`。

綠燈：腳本放回 `355da772b841c1caccfc6250fca686793da8a258` 後，同樣兩個指令結束碼都是 0。紀錄 `isolated-green-recon-r7.log`、`isolated-green-e2e-r7.log`。`test-booking-backend-contract.mjs` 與 `test-isolated-dining-check.mjs` 結束碼也是 0。

兩個會開瀏覽器的測試是 `tools/test-booking-attribution.mjs` 和 `tools/test-isolated-dining-check.mjs`。Node 20 要加 `--experimental-websocket`，Node 22 不用。

## 第 6 輪紅燈與綠燈

真表上觀察到的是：Owner 用 `5f89c71` 在 2026-10-18 14:59（台北）跑了 `runIsolatedEightCases`。`.gs` 的 SHA-256 是 `6e2375b719be7f1d2c165e05c6b800eeffabe8aad9b7f3450b909180d631c054`，Sheets API 已經加過。訂單分頁 7 個編號各一列，郵件預覽 7 列，信 14 封。案例 6 的 `=1+1`、`+1+1`、`-1+1`、`@cmd` 都是文字。案例 8 是重複編號，沒寫、沒寄。執行約 18.5 秒，沒有錯誤。但是「驗收結果」和「公式核對」整張是空的，匯出的 CSV 是 0 bytes。沒有部署。那次沒有留下能證明 flush 先後順序的執行追蹤。

模擬重現的是：當時的 `writeResultSheet_` 和 `writeProbeSheet_` 先呼叫 `sheet.clear()`。模擬裡 SpreadsheetApp 會把清除延後。接著 `values.update` 立刻把報告寫進伺服器。案例 7 的 `SpreadsheetApp.flush()`，以及腳本結束時的 flush，才把那個清除送出，報告被洗掉。案例 8 是重複編號，沒有寫入，不會 flush。這能對上真表上看到的空白報告，但不是 14:59 那次真表的內部追蹤。訂單和郵件預覽沒有呼叫 clear，所以真表上的 7 列和 14 封信還在。RAW 這段是有效的。

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

訂單分頁的 RAW 已在 14:59 真表通過。報告分頁那次是空白，要等這次重跑。讀回列數或內容不對會回結果未知。重跑前四張分頁都要清除內容：訂單、郵件預覽、驗收結果、公式核對。如果訂單和郵件預覽沒清，所有案例都會被判成重複。

## 開旗標前

這輪不打開 `SEND_ATTRIBUTION_TO_BACKEND`。開旗標前要先做完下面四項，這輪都不改程式：

1. PR37 前端的單引號。`js/booking-attribution.js` 的 `plainSheetText` 在值以 `=`、`+`、`-`、`@` 開頭時會先加 `'`。隔離後端的 RAW 會把這個引號原樣留下，所以可能核對成功，但格子和店內信多一個字。開旗標前要分開規定原文怎麼寫、已經加了引號的值怎麼寫。姓名和備註裡本來就有的單引號不能刪掉。還要補官網送到後端的整合測試，以及真表驗證。
2. getLastRow()+1。訂單和郵件預覽的新列仍用試算表快取的 `getLastRow()+1` 再交給 API 寫入。不可依賴試算表快取和 Sheets API 即時一致。官方說明有讀寫快取，但沒有保證 API 寫入之後 getLastRow 立刻對得上。14:59 的七筆各佔一列是那次真表看到的結果，不是快取內部的追蹤。開旗標前要改成不靠這份快取決定列號，並用測試證明連續寫入不會蓋到同一列。這輪不改這段寫入。
3. RAW 全文字。這支腳本送進 RAW 之前把每個值都轉成字串。RAW 本身可以存數字和布林，但現在非空資料都會以文字留下。開旗標前要定數字、日期、公式文字和下游讀表的契約。
4. 確認 Pages 建置仍把 .github/pages-unpublished 排除在公開網站之外。目前的建置會排除 `.github`。換建置流程或 `upload-pages-artifact` 換版本之後，要再確認驗收頁、隔離腳本、手冊和 guard 沒有進公開網站。這輪不改建置。

移植到正式腳本要另外驗證。正式腳本不在這個 repo，隔離通過不能當成正式環境已經接上。

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
2. **核對程式，先跑八案例。** 用上面的 raw 連結與 `Get-FileHash -Algorithm SHA256`。從試算表開 Apps Script，貼上腳本，新增 `IsolatedCheck` HTML。編輯器左側「服務」加 Google Sheets API，不必手改 `appsscript.json`。設定 `SMC_ATTRIBUTION_ISOLATED=yes`、`SMC_SHOP_EMAIL=測試信箱`、`SMC_TEST_SHEET_ID=測試表 ID`。先不要部署，執行 `runIsolatedEightCases`。結果會寫進編輯器執行記錄，也會嘗試在試算表分頁彈出 alert。沒有看到這段結果、還在執行，或出現錯誤，就停止回報。首次執行可能再授權，範圍是 `https://www.googleapis.com/auth/spreadsheets`。全成功預期 14 封測試信。訂單分頁四格的讀回值要等於原值，而且 `getFormula` 為空。`+1+1` 不能變成 `=+1+1`。「公式核對」的原值與讀回值是 JSON 字串。任何 unknown、報告空白或讀回不符就停，不部署。重跑前先留下 14:59 的 CSV 和郵件紀錄。同一張表要清除內容：訂單、郵件預覽、驗收結果、公式核對。表頭可以留著。如果訂單和郵件預覽沒清，所有案例都會被判成重複。
3. **全部核對通過才開私人頁。** 新增網路應用程式部署，執行身分「我」、存取「只有我」。不要覆寫正式部署。用同帳號開新網址，帶入品牌欄位送一次。網頁每一筆新單再 2 封。未知或沒有回應就停，不可以重新整理後重送。`127.0.0.1` 那頁只留給模擬測試，不要拿來送這個部署。

做完後一次回傳：測試表 ID、測試信箱、八案例的驗收結果、公式核對四格、exec 網址、存取是不是「只有我」，以及確認沒有改正式環境。
