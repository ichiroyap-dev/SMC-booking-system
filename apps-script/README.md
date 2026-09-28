# apps-script/（NO_DEPLOY 草稿）

官方訂位 Apps Script（程式碼.js 等）含機密常數，**不放進這個公開 repo**。這裡只放：

- `official/LinePlanRemark.js` — 要新增到官方訂位專案的純函式檔（LINE 訂位方案代碼 → 備註 H 欄）。
- `official/line-plan-remark.patch` — 對 v149 `程式碼.js` 的最小接線 patch（parseBookingMessage／handleLineWebhook／finalizeBooking 三處）。

測試：`node tools/test-line-plan-remark.mjs`；有本機 v149 `程式碼.js` 時加 `SMC_GAS_MAIN=<path>` 另跑整合測試（套 patch 後模擬 LINE 對話，檢查寫入列只有 A:L、備註含代碼）。

本資料夾任何內容都**未** push／deploy 到 Apps Script；上線需 Owner 另行核准。
