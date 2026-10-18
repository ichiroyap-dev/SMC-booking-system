# 正式腳本移植清單

這輪只寫清單。不要部署，不要改正式專案，不要寫正式試算表，不要開 `SEND_ATTRIBUTION_TO_BACKEND`。正式腳本不在這個 repo。隔離通過不能當成正式環境已經接上。

正式部署 ID 維持 `AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q`。不要改這個網址，也不要拿隔離部署蓋掉它。

## 要搬的函式

從 `.github/pages-unpublished/booking-attribution-isolated.gs` 對照看，只搬寫入和來源這一段，不搬隔離入口。

- `formulaGuard_`：不在前面加單引號，也不刪姓名、備註開頭的 `'`。
- `textStore_`、`phoneStore_`、`numberStore_`、`dateStore_`、`timeStore_`、`datetimeStore_`：逐欄見 `docs/booking-sheet-columns.md`。
- `writeRow_`：`values.append`（`Sheets.Spreadsheets.Values.append`），`valueInputOption=RAW`，`insertDataOption=INSERT_ROWS`。
- `applyColumnFormats_`：電話 `@`，人數與桌數 `0`，日期 `yyyy-mm-dd`，時間 `hh:mm`，收到時間 `yyyy-mm-dd hh:mm:ss`。
- `sameStored_`、`confirmOrderRow_`：文字原樣比對；數字和日期比序號；`getFormula` 必須是空的。對不上就停下，不寄信。
- `attributionFromPayload_`：9 欄可有可無。缺欄、多欄、型別不對仍收單，壞掉的來源改空白。
- 寫入前後的 `LockService.getScriptLock`。append 必須在鎖裡面。

不要搬進正式專案：`doGet`、`runIsolatedEightCases`、`submitIsolatedFromPage`、隔離標記、`_testOrderId`、把兩封信都改寄到測試信箱。正式腳本要留下自己的 `doPost`。

隔離腳本在客人信丟錯後仍會嘗試店內信。正式寄信現況不在 repo，不可假設相同。要不要做成一樣，另測再決定。這輪不改正式寄信。

## 正式專案要加的服務和範圍

1. 編輯器左側「服務」加 Google Sheets API。`appsscript.json` 會出現 `enabledAdvancedServices`：`userSymbol` 是 `Sheets`、`version` 是 `v4`、`serviceId` 是 `sheets`。
2. 授權範圍要有 `https://www.googleapis.com/auth/spreadsheets`。這是查看、編輯、建立及刪除你所有的 Google 試算表，不能改成只限目前這張表。
3. 不要刪掉正式腳本原本就有的範圍。首次執行可能再授權。若出現雲端硬碟、Gmail 或日曆的新範圍，停下來。
4. 寄信仍用原本的範圍。不要為了這次加 Gmail 範圍。

## 正式的 11 欄和 doPost

正式 POST 現在是這 11 欄，順序不變：`action`、`type`、`name`、`phone`、`email`、`people`、`tables`、`date`、`time`、`note`、`orderItems`。

旗標維持關閉時，官網不會多送 9 個來源欄。移植後的 `doPost` 在沒有這 9 欄時，回應、寫表、寄信都要和現在一樣。有這 9 欄時才寫來源，缺了或壞了仍收單。不要新增第二個 `doPost`。隔離腳本沒有 `doPost`，貼進去會蓋掉正式入口，所以不要貼整支。

## 回滾

1. 先記下正式部署目前的版本號，不要刪除該版本。
2. 旗標保持 `false`。官網就不會送新欄位。
3. 若已經部署了新版本：管理部署，選正式那個部署，編輯，選回舊版本。網址不變。不要改成「任何人」。
4. 不要整批刪試算表的列。新欄若已經加了，停止寫入即可，空白不要蓋掉店務手改的值。

## 真表驗收（這輪不做）

用測試表，不要用正式訂單。私人隔離網頁維持 355da77 版本 1，這份清單不要求重新部署。

1. 測試表先有隔離標記，或正式移植時用正式表的副本，不要直接改正式訂單。
2. 只送假資料：姓名「測試同學」、電話 `0900000000`。
3. 核對電話仍是 `0900000000`，人數、桌數能加總，日期能篩，`=1+1`、`+1+1`、`-1+1`、`@cmd` 是文字，姓名 `'測試同學` 仍帶著單引號。
4. 連續兩筆、以及表尾有空列或格式時，各佔一列，不互相覆蓋。
5. 客人信沒有活動代碼。11 欄缺來源時仍回訂單編號。
6. 任一步未知就停，不重送，不補寄，不開旗標。
