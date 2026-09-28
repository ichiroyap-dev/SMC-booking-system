# apps-script/（NO_DEPLOY 草稿）

官方訂位 Apps Script（程式碼.js 等）含機密常數，**不放進這個公開 repo**。這裡只放：

- `official/LinePlanRemark.js` — 要新增到官方訂位專案的純函式檔（LINE 訂位方案代碼 → 備註 H 欄）。
- `official/line-plan-remark.patch` — 對 v149 `程式碼.js` 的最小接線 patch（parseBookingMessage／handleLineWebhook／finalizeBooking，加上客人看得到的四處：LINE 核對、還差資料 summariseCollected、processBooking 預約成功、sendConfirmationEmail 確認信）。
  - 客人看不到方案代碼：方案改成友善文字另起一行（`4.5k1a` →「每桌 4500 元、1 桌」、`5k2a` →「每桌 5000 元、2 桌」；沒方案就不多一行），備註只顯示去掉代碼（5k1a／4.5k2a／5k／散客／大型Na）後的內容。工作表 H 欄仍存完整「代碼；原備註」，老闆通知／行事曆照舊看得到代碼。
  - 桌數：客人有講（「一桌就好」「兩桌」「5k1a」）就用客人的（容量檢查、I 欄、代碼一致）；沒講才 ceil(人數/10)。
  - 備註已有代碼（5k1a／5k／全形５ｋ２ａ／5k×2a）→ 不重複，a 一律改成最終桌數（I 欄），H 欄、成功訊息桌數、方案文字永遠一致。
  - 不自動寫人數分類字（大人N位…）到備註（Owner 2026-09-28 縮小範圍）。
  - 人數（D 欄）沿用原本 parsePeople，唯一修正：「大人8位小孩2位」「大人8位、小孩2位」「8大2小」加總成 10（lineCategoryPeople_；至少兩組、含大人、每個分類字後面緊接數字才算，其他情況回 null 沿用原本）。素食1位／2位不吃辣／需要1位素食／第1位置 不算人數。

測試：`node tools/test-line-plan-remark.mjs`；有本機 v149 `程式碼.js` 時加 `SMC_GAS_MAIN=<path>` 另跑整合測試（套 patch 後模擬 LINE 對話與網頁表單確認信，檢查寫入列只有 A:L、H 欄含代碼、客人看到的文字只有友善方案、沒有代碼）。

本資料夾任何內容都**未** push／deploy 到 Apps Script；上線需 Owner 另行核准。
