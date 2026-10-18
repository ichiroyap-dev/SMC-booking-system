# 正式腳本移植清單

這輪只寫清單。不要部署，不要改正式專案，不要寫正式試算表，不要開 `SEND_ATTRIBUTION_TO_BACKEND`。正式腳本不在這個 repo。隔離通過不能當成正式環境已經接上。

正式部署 ID 維持 `AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q`。不要改這個網址，也不要拿隔離部署蓋掉它。

## 要搬的函式

從 `.github/pages-unpublished/booking-attribution-isolated.gs` 對照看，只搬寫入和來源這一段，不搬隔離入口。

- `formulaGuard_`：不在前面加單引號，也不刪姓名、備註開頭的 `'`。
- `textStore_`、`phoneStore_`、`numberStore_`、`dateStore_`、`timeStore_`、`datetimeStore_`：逐欄見 `docs/booking-sheet-columns.md`。
- `writeRow_`：在鎖內用 `values.get` 看整張表的值，再用 `values.update`、`valueInputOption=RAW` 寫到最後一筆有值的下一列。核對回應的 `updatedRange`。不要用 `A1` 的 `values.append`，那個只接在包含 A1 的表格後面。
- `applyColumnFormats_`：電話 `@`，人數與桌數 `0`，日期 `yyyy-mm-dd`，時間 `hh:mm`，收到時間 `yyyy-mm-dd hh:mm:ss`。
- `sameStored_`、`confirmOrderRow_`：文字原樣比對；數字和日期比序號；`getFormula` 必須是空的。對不上就停下，不寄信。
- `attributionFromPayload_`：9 欄可有可無。缺欄、多欄、型別不對仍收單，壞掉的來源改空白。
- 寫入前後的 `LockService.getScriptLock`。`values.get` 和 `values.update` 必須在鎖裡面。

不要搬進正式專案：`doGet`、`runIsolatedEightCases`、`submitIsolatedFromPage`、隔離標記、`_testOrderId`、把兩封信都改寄到測試信箱。正式腳本要留下自己的 `doPost`。

隔離腳本在客人信丟錯後仍會嘗試店內信。正式要不要一樣，需 Owner 決定。決策前維持正式現況，這輪不改正式寄信。

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

## 正式表的欄位不能照搬隔離的 22 欄

內用「工作表1」既有的 A–M 共 13 欄維持原欄名、原順序、原位置。不要插入、不要改名、不要換成隔離腳本的表頭。來源和歸因欄只能接在 M 之後。

外帶分頁的欄位和內用不同，要另外列自己的映射。不可沿用工作表1 的 A–M，也不可把隔離腳本的 22 欄表頭抄進去。欄名以正式表副本上看到的為準，這個 repo 沒有正式腳本，不要在這裡猜欄名。

## 不要每次重設整欄格式

隔離腳本的 `ensureSheet_` 現在每次寫入都會對整欄設格式，而且格式錯誤被吃掉。移植時不要重設整欄格式。只格式化新列，或另外做一次明確的初始化。歷史列的顯示格式要留著。

## 電話和桌數維持正式現況

保留正式的 `normalizedPhone`。它會去掉中間的空格，`0936 677 616` 仍要比對到同一支電話。不要改成只 trim、不去中間空格。

桌數維持寫入前的 `parseInt`。不要把隔離腳本「不是整數就留文字」直接套到正式桌數。

## 讀表路徑要在正式表副本上驗

不要用正式訂單表。用副本核對每一條讀取：

- DailyBookingSync／LINE 總覽
- 取消查詢
- 桌數上限
- 有效訂位／查詢列表

日期、時間、收到時間讀回來必須是 Date，不能是裸序號。`new Date(46317)` 會被當成 1970 年的毫秒，日期會錯。

另外核對正式背景通知。隔離的兩封信不能直接套上去。若背景工作已經會寄店內信，再依隔離行為加一封就會多寄。這件事和「客人信失敗後要不要寄店內信」一起等 Owner 決定。
