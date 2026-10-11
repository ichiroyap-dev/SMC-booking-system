# 線上版本（repo 能核對的範圍）與回滾草稿

NO_DEPLOY。這份只記錄現況與草稿，沒有 clasp pull、沒有 clasp push、沒有改觸發、沒有送 LINE、沒有寫試算表。

## 現在線上是哪一版

這個 git repo **沒有** Apps Script 專案、沒有 `.clasp.json`，也沒有 2026-09-27 之後的線上 pull。無法從這裡證明「此刻」線上檔案仍是下面這一版。

repo 裡最後一筆部署紀錄是 `original/DEPLOY_NOTE.md`（內用／外帶分區，2026-09-27 08:05 台北）：

- 推上去之前的線上 pull（`pre-push-pull-split-20260927/`）與候選相同：DailyBookingSync `3ce3440b`、LineDailyRemind `c7eff326`。那兩個目錄不在這個 git repo。
- 08:05:15 clasp push 了 5 個檔。push **之後**的內容雜湊（DEPLOY_NOTE 只寫前綴；本機對 `original/` 算出完整 SHA-256，前綴一致）：
  - DailyBookingSync `2299cebd94be5498862afc87747ee9990b757d1722f3c6936eb31c0690ffbf77`
  - LineDailyRemind `57109f2e4f3180c9e49762d172817d54feac6e0ab7fbdf4bc59fdf485190c55c`
- LineGroupLog、openclaww、appsscript.json 那次沒改。
- 推完再 pull（`verify-post-dinein-takeout-split-20260927/`）紀錄是 SHA 相符。該目錄也不在這個 git repo。
- 同一則紀錄寫明：**沒有**改 Apps Script 部署版本、沒有跑觸發、沒有送 LINE、沒有寫試算表。所以「線上」指的是腳本內容被 clasp push 蓋過，不是新的 web app deployment version。

`original/` 就是這次附上的 2026-09-27 快照，雜湊與上面兩支檔案的 push 後雜湊相同。它只能證明「當時 push 的內容」，不能證明之後沒有人再改線上。

## 暫停時間怎麼算

一般 LanguageApp 錯誤會 `Utilities.sleep(250)` **再試一次**。250ms 是這一小次失敗的暫停，不是整則備註固定多等約 3 秒。一段備註有多段、又各自失敗時，暫停次數才會疊加。

每日翻譯配額用盡（錯誤訊息含 `for one day`、`quota`、`每日`、`配額`）**不暫停、不重試**，該段直接留原文；同一輪後面的片段也不再呼叫。`in a short time`（短時間太頻繁）仍算一般錯誤，會暫停一次再試。

## 回滾草稿（不要執行）

下面是給負責人事後用的草稿。這次 PR **不要**照做。

1. 先在 Apps Script 編輯器或 clasp pull，把**現在**線上的 DailyBookingSync、LineDailyRemind 存下來，和 `original/` 的 SHA-256 對。不一致就停，不可用 09-27 快照直接覆蓋。
2. 若確認線上仍是 2026-09-27 08:05 那次 push（雜湊如上），而要退回「分區之前」：DEPLOY_NOTE 寫的回滾目錄是 `rollback-pre-dinein-takeout-split-20260927/`（內有 `.clasp.json`，作法是在那個目錄 `clasp push --force`）。**這個目錄不在本 git repo**，本機無法核對它還在不在、內容對不對。找不到目錄就不要推。
3. 若線上已經比 09-27 新，回滾目標不是本 PR，也不是 `original/`。要用步驟 1 拉下來的那份，或負責人指定的更新備份。
4. 本隔離稿 `LineDailyRemind.gs` 不是線上檔，不能拿去 clasp push。
5. 任何 push 之前：不改觸發、不送 LINE、不寫試算表。push 後再 pull，核對雜湊。DEPLOY_NOTE 寫的那次回滾指令是 `clasp push --force`，force 會蓋掉線上未 pull 的修改，所以步驟 1 不能省。
