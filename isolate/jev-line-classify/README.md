# 官方 LINE 訊息 × Jev 分類 — 離線隔離草案

**NO_DEPLOY。目前沒有任何正式接線。**

這個資料夾沒有被官網、Apps Script、webhook、觸發器或 clasp 引用。它不接 live webhook、不加觸發器、不寫正式訂位表、不發 LINE、不呼叫外部 API。分類只寫進離線回放的記憶體紀錄。

`tools/jev-dup-judge`（另一條分支上的重複訂位判官）不是這個模組。Hub 的 `jev-shadow-router` 也不是。

## 做什麼

1. `classify.mjs`：用文件化規則把模擬的 LINE 文字事件分成 `booking` / `cancel` / `chitchat` / `unknown`，並附上 confidence 與短原因。見 `CONTRACT.md`、`RULES.md`。
2. `bookingReplay.mjs`：官方訂位 `程式碼.js` 不在這個公開 repo，所以這裡是依 2026-09-21 官方 OA 診斷記載的客人路徑做成的**離線替身**（非文字略過、60 秒去重、`ID`、老闆靜音、取消須對到訂單編號與電話、缺欄追問、回覆「確認」才開單、人數上限、同手機同時段不重複開單）。`SpreadsheetApp`、`UrlFetchApp`、`CacheService` 都是注入的 mock；回覆 URL 固定是 `offline://line-reply`，送出非 `offline://` 會直接丟錯。
3. 替身**不讀**分類結果。取消與確認的判斷故意跟分類規則分開寫，避免改規則就改到開單。
4. `harness.mjs`：同一批事件各跑一次「沒加分類」與「加分類」。回覆、開單列、副作用次數必須一致，副作用差的絕對值合計為 0。分類失敗（逾時、例外、空結果、格式錯誤）也一樣。Fail-open 只表示分類失敗時這段替身照舊跑，**不會**跳過缺欄、容量或去重。分類函式只拿到事件的 `structuredClone`；改了複本再丟例外，開單仍用原本那份事件。
5. `metrics.mjs` / `replay.mjs`：用七天假事件算分類分布、失敗率、回放耗時、副作用差。

隔離 log 與試算表寫入、LINE 回覆是分開計的。沒加分類時隔離 log 為 0；加了分類會有 log。那不算訂位副作用。

## 怎麼跑

在 repo 根目錄：

```bash
node --test isolate/jev-line-classify/test.mjs
node isolate/jev-line-classify/replay.mjs
```

不需要 Google 帳號、clasp 或網路。測試與回放腳本用檔案自己的路徑，工作目錄不必是 repo 根目錄。測例與一週腳本只用假姓名（測試一）、假電話（`0900000000` 起）、假訂單 `SMC900100` 起。不要把真實 webhook、客人資料、權杖或金鑰放進來。

`replay.mjs` 結束碼：副作用差為 0、行為一致、外部 API 次數為 0 時是 0，否則是 1。

## 回滾

正式環境沒有接這份程式，也沒有開關可關。回滾就是**不要合併**這個分支。合併之後若要撤掉，刪除 `isolate/jev-line-classify/` 即可，不會碰到現有官網或 Apps Script 檔。

## 已知限制

- 替身不是 live `程式碼.js` 的逐行移植。查詢單、真人靜音以外的分支、方案代碼與備註，都不在這份草案裡。
- 沒有呼叫 Jev 或 OpenRouter。本地規則不會產生外部配額；這也是為什麼不能只靠 try/catch 聲稱「沒有多耗配額」——對照的是 mock 呼叫次數與回放耗時。耗時是這台機器上的 CPU 時間，不能換成 Apps Script 配額。
- 一週指標用合成假事件，不是線上流量。用真實流量做 shadow 算正式接線，要另提 diff、資料範圍、時間與呼叫預算、停用方法，並等 Owner GO。
