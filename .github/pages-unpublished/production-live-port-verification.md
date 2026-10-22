# 正式上線移植驗證清單

這份給 Owner 在另案把寫入方式移植到正式腳本之後用。這張 PR 不部署、不開旗標、不寫正式試算表、不寄信。`SEND_ATTRIBUTION_TO_BACKEND` 維持關閉。正式腳本不在這個 repo。隔離通過不能當成正式環境已經接上。

不要把部署編號寫進新文件。上線前由 Owner 在 Apps Script 的部署畫面核對目前版本，不要把編號貼回 repo。

## 上線前

1. 旗標仍是關閉。官網 POST 仍是原來的 11 欄。
2. 只用正式表的副本，或已標成隔離的測試表。不要寫正式訂單。
3. 假資料只用「測試王小明」、電話 `0900-000-001` 與 `0900-000-002`。不要用真實客人的姓名、電話或訂單編號。
4. 先在部署畫面記下目前的版本號。不要刪除該版本。

## 步驟

1. 只搬寫入和來源那一段，不貼整支隔離腳本，也不要新增第二個 `doPost`。對照 `.github/pages-unpublished/production-port-checklist.md`。
2. 送一筆：姓名「測試王小明」、電話 `0900-000-001`。
3. 讀回同一列，對下面的讀回檢查。
4. 再送一筆電話 `0900-000-002`。兩筆各佔一列，中間不因表尾只有格式而空一列，也不互相蓋掉。
5. 用同一編號再送一次。必須沒有新增、沒有再寄信、沒有重跑整欄格式。
6. 執行 `node tools/check-pages-unpublished.mjs`。它只對下面網址做 curl，預期每一列都是 `404`，最後一行是 `pages unpublished check: pass`。這代表 `/tools/isolated-*` 與 `/.github/pages-unpublished/*` 沒有被 GitHub Pages 提供：
   - `/tools/isolated-dining-check.html`
   - `/tools/isolated-check-guard.js`
   - `/.github/pages-unpublished/isolated-dining-check.html`
   - `/.github/pages-unpublished/isolated-check-guard.js`
   - `/.github/pages-unpublished/booking-attribution-isolated.gs`
   - `/.github/pages-unpublished/IsolatedCheck.html`
   - `/.github/pages-unpublished/booking-attribution-isolated-runbook.md`

任一步對不上就停。不要重送，不要補寄，不要開旗標。

## 讀回檢查

- 電話是文字 `0900-000-001`。開頭的 0 還在。前面沒有多出來的單引號。
- 姓名、備註、品項、來源若以 `=`、`+`、`-`、`@` 開頭，讀回等於原文字，`getFormula` 是空的。不要先加單引號。
- 客人自己打在開頭的 `'` 要留著，例如姓名 `'測試王小明`。
- 人數、桌數的儲存格型別是數字。
- 日期、時間、收到時間的儲存格型別是日期或時間序號，不是文字。
- 若把這五欄先轉成文字再以 RAW 寫入，型別會變成文字：人數與桌數不能加總，日期、時間、收到時間不能當日期篩選。現行程式不要這樣寫。預期型別見 `docs/booking-sheet-columns.md`。

## 回滾

照這個順序，不要跳步。

1. 先把旗標維持或改回關閉。官網就不會再送新欄位。
2. 再把正式部署選回上一個版本。不要刪除舊版本。網址不變。不要改成「任何人」。
3. 若要撤回這次程式，開 revert PR。不要 force push。
4. 不要整批刪試算表的列。已經寫上的新欄停止再寫即可，空白不要蓋掉店務手改的值。

## 這輪不做

不部署、不開旗標、不寫真表、不寄信、不合併。上面的步驟要等 Owner GO。
