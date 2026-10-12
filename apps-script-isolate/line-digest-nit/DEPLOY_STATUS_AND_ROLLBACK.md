# PR #39 回滾點（草稿，不要執行）

NO_DEPLOY。這份沒有 clasp pull、沒有 clasp push、沒有改觸發、沒有送 LINE、沒有寫試算表。

## 回滾點是什麼

PR #39 的回滾點，是**部署前那一刻**、對**同一個** Apps Script 專案做的**完整**線上 pull。

不是 2026-09-27 的兩支檔，也不是分區前的歷史目錄。這個 git repo 目前**沒有**那份 pull，所以**現在不能部署**。沒有完整 pull 與雜湊清單之前，沒有可回復的 PR #39 回滾點。

## 部署前必須先做（本 PR 不執行）

1. 確認專案身分：`.clasp.json` 的 `scriptId`、專案名稱、擁有者。寫進備份目錄的說明。
2. 在新目錄對**這個** `scriptId` 做完整 `clasp pull`。
3. 列出**全部**檔案，至少包含：
   - `appsscript.json`（manifest）
   - `DailyBookingSync.gs`
   - `LineDailyRemind.gs`
   - `LineGroupLog`（檔名以線上為準）
   - `openclaww.gs`
   - 線上還有的其他檔，一個都不能漏
4. 每個檔案算 SHA-256，和檔名一起寫成清單。這份清單才是 PR #39 的回滾點。

## 部署當天必查（push 與回復之前當場記錄，不是事後補記）

- 台北時間戳。
- `clasp` 版本。
- 實際 deployment ID 與 version。
- 觸發器清單。
- `rootDir`、`.claspignore`，以及實際會推上去的檔案清單。備份要完整，不能把這份候選稿混進去。
- 推送前、回復前再對一次當時線上。有未預期的漂移就停。

## 如何回復

1. 只用步驟 2 那個備份目錄的**完整檔案**，放回同一個 `scriptId`。不要只用 `LineDailyRemind.gs`。
2. `clasp push` 會換成你送上去的專案內容（Apps Script `projects.updateContent` 會清掉專案裡既有檔案再寫入）。`--force` 只是強制覆寫遠端 manifest；不是「沒加 `--force` 就不會蓋掉專案」。
3. 回復後立刻再完整 pull 到另一個目錄。
4. 比對檔案清單與每個檔的 SHA-256。多檔、少檔、或雜湊不同就停，不要再推。
5. 不改觸發、不送 LINE、不寫試算表。本隔離稿不是線上檔，不能拿去 push。

## 歷史說明（不是 PR #39 的回滾點）

`original/DEPLOY_NOTE.md` 記的是 2026-09-27 內用／外帶分區。當時 push 後的兩支雜湊（本機對 `original/` 重算，與紀錄前綴一致）：

- DailyBookingSync `2299cebd94be5498862afc87747ee9990b757d1722f3c6936eb31c0690ffbf77`
- LineDailyRemind `57109f2e4f3180c9e49762d172817d54feac6e0ab7fbdf4bc59fdf485190c55c`

`rollback-pre-dinein-takeout-split-20260927/` 是**分區之前**的回滾目錄。它**不能**用來回復 PR #39。該目錄不在這個 git repo。repo 也沒有 `.clasp.json`，無法從這裡證明此刻線上仍是 09-27 那一版。

## 這一版的印尼文（行為說明，不是部署）

結構句用固定字串。備註與自由文字整段留中文，並加 `REMARK_CONFIRM_NOTICE_`。不呼叫 LanguageApp，所以沒有翻譯暫停、沒有配額重試。說明見 `REAL_LANGUAGEAPP_ACCEPTANCE.md`。

## 回滾時不要裝回會改金額的舊翻譯

2026-09-27 的 `LineDailyRemind.gs`（以及與此相同的線上快照）在備註裡把 `$1,000` 改成 `$1.000`（千分位逗號換成點）。那不是可接受的金額行為。

回復整個專案時，仍然只用部署前那份完整 pull，而且要比對檔案清單與 SHA-256。不要把 09-27 的 `original/LineDailyRemind.gs` 當成金額正確的版本裝回去。若回復後的線上檔仍會把 `$1,000` 改成 `$1.000`，先停，不要為了「回到舊翻譯」再推一次。這一版的做法是備註根本不改寫，`$1,000` 維持來源原文。
