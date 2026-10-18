# 隔離驗證第一步（二審修正）

結果：私人驗收入口已改成編輯器八案例，加上「只有我」的 HtmlService 頁。收件人由後端固定為 `SMC_SHOP_EMAIL`。公式開頭的寫入讀回仍用嚴格比對，少了防護單引號或不一致就停下，核對原列，不要重送。

要貼進 Apps Script 的程式停在 commit `ad9a8bad34495c8103156b212ae10d029d463ed3`。這份報告是下一個 commit，連結指回那個 SHA，不引用自己。

沒有部署，沒有寫入 Google 試算表，沒有寄信，沒有合併。`SEND_ATTRIBUTION_TO_BACKEND` 仍是 `false`。正式訂位 POST 仍是 11 欄。正式部署編號仍是 `AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q`。

## 固定檔案

| 檔案 | 連結 | SHA-256 |
| --- | --- | --- |
| `.github/pages-unpublished/booking-attribution-isolated.gs` | https://github.com/ichiroyap-dev/SMC-booking-system/blob/ad9a8bad34495c8103156b212ae10d029d463ed3/.github/pages-unpublished/booking-attribution-isolated.gs | `208dea922865b1da80ec3946f336d8a2efa2b2cd5c2e1ead3b64dcd89162b469` |
| `.github/pages-unpublished/IsolatedCheck.html` | https://github.com/ichiroyap-dev/SMC-booking-system/blob/ad9a8bad34495c8103156b212ae10d029d463ed3/.github/pages-unpublished/IsolatedCheck.html | `c6ce8cda0968b5ef8af1de6bd04529c2d8d4c8dd839168a1582c04e2ef4f0cce` |

完整 commit SHA：`ad9a8bad34495c8103156b212ae10d029d463ed3`

## 紅燈

同一支 `node tools/test-isolated-e2e.mjs`，腳本還是補私人頁面之前的 `.gs`。結束碼 1，13 項失敗。客人信仍寄到表單信箱；沒有 `IsolatedCheck.html`、`submitIsolatedFromPage`、`google.script.run`。

原始輸出：`.github/pages-unpublished/isolated-e2e-red-entry.log`

重建方式：只把 `.gs` 還原成 `5a87907`，其餘保持這支 PR，不必另開紅燈 commit。

```bash
git show 5a87907:.github/pages-unpublished/booking-attribution-isolated.gs > .github/pages-unpublished/booking-attribution-isolated.gs
node tools/test-isolated-e2e.mjs
```

這次重建結束碼 1，16 項失敗，含「flush 之後沒有讀回」、收件人未固定、沒有 HtmlService。輸出：`.github/pages-unpublished/isolated-e2e-red-rebuild.log`。跑完要把 `.gs` 放回 `ad9a8bad34495c8103156b212ae10d029d463ed3` 那一版。

## 綠燈

補上私人頁面與固定收件人之後，結束碼 0。輸出：`.github/pages-unpublished/isolated-e2e-green-entry.log`

```text
test 正式環境未改: pass
test 正式網址停住: pass
test 成功: pass
test 結果未知: pass
test 重複編號: pass
test 逾時: pass
test 寄信部分失敗: pass
test 私人入口與公式往返: pass
isolated e2e: pass
```

`=1+1`、`+1+1`、`-1+1`、`@cmd` 寫入後讀回是 `'=1+1`、`'+1+1`、`'-1+1`、`'@cmd`，不是數字 2。讀回若少了單引號，`confirmOrderRow_` 回 false，不寄信。模擬讀回變成 `2` 時，回應是結果未知，並寫明核對原列、不要重送。

`attacker@example.com` 只留在表格信箱欄。兩封信的收件人都是 `shop-test@example.com`。

## 其他測試

環境：Node `v22.14.0`。`typeof WebSocket` 是 `function`，這個版本不用加 `--experimental-websocket`。`tools/test-isolated-dining-check.mjs` 使用全域 `WebSocket`；若是 Node 20，要改跑 `node --experimental-websocket tools/test-isolated-dining-check.mjs`。在 v22.14.0 加上該旗標也能跑，沒有改測試結果。

`isolated-dining-check` 連跑三次，沒有重現取鎖時序失敗，所以沒有改鎖的程式：

| 次數 | 結束碼 | 最後一行 |
| --- | --- | --- |
| 1 | 0 | isolated check: endpoint, response verdict, and page states agree |
| 2 | 0 | isolated check: endpoint, response verdict, and page states agree |
| 3 | 0 | isolated check: endpoint, response verdict, and page states agree |

| 指令 | 結果 |
| --- | --- |
| `node tools/test-isolated-e2e.mjs` | 通過 |
| `node tools/test-booking-reconciliation.mjs` | 通過 |
| `node tools/test-booking-backend-contract.mjs` | 通過 |
| `node tools/test-isolated-dining-check.mjs` | 三次都通過 |

## 這次沒有做的事

沒有部署 Apps Script，沒有寫入任何 Google 試算表，沒有寄信，沒有改官網訂位與外帶，沒有打開旗標，沒有改正式部署編號，沒有合併。

本機表格不會執行公式。Google 試算表會不會把格子算掉，仍要 Owner 打開那一格看。讀回若和寫入契約不一致，就停下，不要為了對上而拿掉單引號。

## 請 Owner 做的三步

下載後先算 SHA-256，對不上就不要貼。不要打開 `www.sweetmeichicken.com`。不要覆寫正式部署 `AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q`。信箱用 Owner 自己的測試信箱。

程式 commit：`ad9a8bad34495c8103156b212ae10d029d463ed3`

### 1. 建立測試試算表

1. 打開 [Google 雲端硬碟](https://drive.google.com)。左上「新增」→「Google 試算表」。名稱打「隔離測試」。不要按共用。
2. 下方「+」新增分頁。在分頁名稱上按右鍵 →「重新命名」，輸入 `隔離標記`。
3. 點該分頁 **A1**，輸入 `SMC-ISOLATED-TEST`，按 Enter。
4. 從網址 `/d/` 與 `/edit` 之間複製試算表 ID。

請回傳：試算表 ID、分頁名稱、A1 原文，以及確認這不是正式訂位表。

### 2. 貼上固定版本，先跑八案例，再部署私人網頁

1. 在這張試算表選「擴充功能」→「Apps Script」，用 Owner 自己的帳號。
2. 刪掉編輯器原內容。貼上這個檔的全文後按磁碟圖示存檔：
   - https://github.com/ichiroyap-dev/SMC-booking-system/blob/ad9a8bad34495c8103156b212ae10d029d463ed3/.github/pages-unpublished/booking-attribution-isolated.gs
   - SHA-256 `208dea922865b1da80ec3946f336d8a2efa2b2cd5c2e1ead3b64dcd89162b469`
3. 左側「+」→「HTML」。檔名打 `IsolatedCheck`。貼上這個檔的全文後存檔：
   - https://github.com/ichiroyap-dev/SMC-booking-system/blob/ad9a8bad34495c8103156b212ae10d029d463ed3/.github/pages-unpublished/IsolatedCheck.html
   - SHA-256 `c6ce8cda0968b5ef8af1de6bd04529c2d8d4c8dd839168a1582c04e2ef4f0cce`
4. 齒輪「專案設定」→「指令碼內容」→「新增指令碼內容」，加三列：
   - `SMC_ATTRIBUTION_ISOLATED` = `yes`
   - `SMC_SHOP_EMAIL` = 下一步那個測試信箱
   - `SMC_TEST_SHEET_ID` = 第 1 步的 ID
5. **實測第一步：** 先不要部署。上方函數選單選 `runIsolatedEightCases`，按「執行」。沒有這個函式就停下來回報，不要自己新寫。
6. 看試算表「訂單」「郵件預覽」「驗收結果」，以及測試信箱。兩封信都應寄到 `SMC_SHOP_EMAIL`。案例 8 的寫入與寄信都是「否」。
7. 八案例核對完才部署。右上「部署」→「新增部署」→ 齒輪 →「網路應用程式」。執行身分選「我」。誰可以存取選「只有我」。**不可**選「任何人」。按「部署」並授權。
8. 用同一個 Google 帳號打開新的部署網址。頁面是私人 HtmlService，按鈕經 `google.script.run` 呼叫後端。不要用 `http://127.0.0.1:8765/.github/pages-unpublished/isolated-dining-check.html` 去送這個部署；那個跨來源呼叫會被導到登入頁並 CORS 失敗。

請回傳：試算表 ID、八案例是否跑完、新的 exec 網址、部署編號、執行身分與存取是不是「只有我」，以及確認沒有改到正式部署。部署編號先不要寫進 guard 白名單，等我們收齊再加。

### 3. 提供測試收件信箱

1. 用 Owner 自己收得到的測試信箱。客人信和店內信都只會寄到這裡。
2. 把它設成 `SMC_SHOP_EMAIL`。頁面上的信箱欄只寫進表格，後端不會拿來寄信。
3. 不要填客人的信箱。

請回傳：測試信箱地址，以及確認 `SMC_SHOP_EMAIL` 已設成同一個地址。

若某一格以 `=`、`+`、`-`、`@` 開頭，讀回來和寫入不一致，或回應要你核對原列，就停下，不要重送。把那一格的顯示文字回傳給我們。
