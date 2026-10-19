# 水美土雞城驗證地圖

這個目錄是官網客人看得到的行為的驗證來源。先讀索引，再照單篇功能操作。

## Baseline preconditions

- 在 repo 根目錄用 `SHUIMEI_RUN_ID` 執行 `node .cursor/skills/verify-shuimei/scripts/control-shuimei.mjs launch`。
- 每個 run id 只用一份實例。並行時換 id，不要共用 `/tmp/shuimei-verify/<id>`。
- 沒有種子訂單。乾淨狀態就是空的 Chrome 設定檔與本機靜態檔。
- `doctor` 必須印出這次的 url、git HEAD，且 `bookingAttempts` 是空的。
- 不要操作不是這次 launch 起來的 Chrome 或連接埠。

## Driving conventions

- 每條步驟都從乾淨首頁開始，除非該篇另寫前置條件。
- 用無障礙角色與名稱，或篇內寫明的 id。不要靠座標或 Tab 順序。
- 指令照抄，包含引號與中文。
- 瀏覽器動作都走 `control-shuimei.mjs browser`。
- 驗證不還原正式資料，因為它根本不寫正式資料。cleanup 只收這次的程序，不刪證據。

## Proof and skip reporting

- 要留下動作與動作之後的狀態，不只最後一張圖。
- UI 證明含一份 ARIA snapshot，以及一張看得到「水美土雞城」的截圖。
- 這份地圖沒有 CLI 產品面。不要把 node 單元測試算成客人操作。
- 副作用用 `network.jsonl` 證明：沒有預約主機、沒有被放行的寫入請求。
- 每份證據註明功能 id 與實際走的入口。
- 走不到的入口要寫出試過的指令與缺了什麼。不要用另一個入口代替並宣稱已驗證。

## Feature entry contract

每篇都是 H1、一段話，然後固定四個 H2：`Sub-features`、`How to get to it (user POV)`、`Driving it with control-shuimei`、`Gotchas`。

## Features

- [內用桌菜摘要](./dining-summary.md) 是選用餐類型、方案與人數後，畫面上出現桌菜費用與烤雞隻數。不送出。
- [外帶品項小計](./takeout-summary.md) 是用加減按鈕調整外帶數量，並看到預估小計。不送出。
- [常見問題](./faq.md) 是打開 FAQ，展開預約題，並從 FAQ 回到首頁預約區。
- [首頁菜單與團體聚餐](./homepage-sections.md) 是從導覽進到菜單價格與團體聚餐兩段。
- [取消表單畫面](./cancel-form.md) 是打開取消／變更表單並看到必填欄。不送出。
