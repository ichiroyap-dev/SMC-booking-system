# 隔離驗證第一步：本機端對端模擬

結果：本機模擬已通過。驗收頁送出後，隔離腳本會取號、寫入、flush、讀回同一列，確認後才模擬寄信。正式環境這次沒有改：`SEND_ATTRIBUTION_TO_BACKEND` 仍是 `false`，正式訂位 POST 仍是 11 欄，正式部署編號仍是 `AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q`。

這不是 Google 試算表實測，也沒有寄出信。試算表、寄信、鎖、網路請求都在同一個 Node 行程裡模擬。沒有部署 Apps Script，沒有呼叫 `script.google.com`。

發現一個隔離後端的缺口，只改了隔離檔：寫入並 flush 之後，原先沒有把同一列讀回來。讀回對不上時，腳本仍回成功並寄信。現在對不上、或讀的時候出錯，會回「結果未知」而且不寄信。確認成功並放開鎖之後才寄信。

使用的都是假資料：姓名「測試同學」、電話 `0900000000`、客人信箱 `test@example.com`、店內信箱 `shop-test@example.com`。訂單編號是腳本自己取的 `SMC900001`、`SMC900002`。

## 怎麼跑

```bash
node tools/test-isolated-e2e.mjs
```

腳本位置以 main 為準：隔離程式、驗收頁、手冊都在 `.github/pages-unpublished/`。這個目錄目前的 Pages 建置會排除。

流程是：驗收頁帶入品牌最終網址並送出 → 隔離腳本取號 → 寫入記憶體表格 → `SpreadsheetApp.flush` → 讀回同一列 → 模擬 `MailApp.sendEmail`。另外再送一筆含 `utm_term`、`utm_adgroup`、`gclid` 的進站，確認來源欄和訂單編號對得上，而且不會改到前一列。

## 紅燈

補讀回之前，`node tools/test-isolated-e2e.mjs` 結束碼是 1。成功、結果未知、重複編號的第一筆、寄信部分失敗，都卡在「flush 之後沒有讀回」。結果未知那個案例當時仍被當成成功，而且模擬寄了信。逾時與「正式環境沒改」在紅燈時已經通過。

原始輸出：`.github/pages-unpublished/isolated-e2e-red.log`

```text
test 正式環境未改: pass
prod SEND_ATTRIBUTION_TO_BACKEND=false liveKeys=11 deployment=AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q
test 正式網址停住: pass
flow 成功: lock -> flush-held -> release -> mail-free -> mail-free -> lock -> flush-held -> release -> mail-free -> mail-free
sheet 品牌 SMC900001 gclid= utm內容=ag_brand
sheet gclid SMC900002 gclid=TESTGCLID9000 utm關鍵字=family-table
ui 成功: ok | 已送到隔離後端。訂單編號：SMC900001 寄信：已寄出。 請到隔離試算表、客人信、店內信核對這個編號。回應沒有備註；備註對照上面送出的 note、試算表與兩封信。
test 成功: FAIL
mail 成功: mocked 4（沒有實際寄出）
flow 結果未知: lock -> flush-held -> release -> mail-free -> mail-free
ui 結果未知: ok | 已送到隔離後端。訂單編號：SMC900001 寄信：已寄出。 請到隔離試算表、客人信、店內信核對這個編號。回應沒有備註；備註對照上面送出的 note、試算表與兩封信。
test 結果未知: FAIL
flow 重複編號: lock -> release
ui 重複編號: bad | 這個編號已經收過，這次沒有新增。
test 重複編號: FAIL
flow 逾時: fetch hung -> page unknown（後端未被呼叫）
ui 逾時: warn | 結果未知，先核對試算表、勿重送
test 逾時: pass
flow 寄信部分失敗: lock -> flush-held -> release -> mail-free
ui 寄信部分失敗: ok | 已送到隔離後端。訂單編號：SMC900001 寄信：未全部寄出，請核對信箱。 請到隔離試算表、客人信、店內信核對這個編號。回應沒有備註；備註對照上面送出的 note、試算表與兩封信。
test 寄信部分失敗: FAIL
isolated e2e failed: 9
 - 品牌單：flush 之後、放鎖之前要讀回訂單列
 - gclid 單：flush 之後、放鎖之前要讀回訂單列
 - 讀回對不上要回 unknown，且不可宣稱已寄信
 - 結果未知要提醒勿重送
 - 結果未知之前要真的讀過訂單列
 - 讀回失敗不可寄信
 - 驗收頁要把未知結果和編號一起顯示
 - 重複編號的第一筆：flush 之後、放鎖之前要讀回訂單列
 - 部分寄信：flush 之後、放鎖之前要讀回訂單列
```

## 綠燈

讀回補上之後，同一支指令結束碼是 0。成功路徑的順序是 `lock -> flush-held -> readback-held -> release -> mail-free`。

原始輸出：`.github/pages-unpublished/isolated-e2e-green.log`

```text
test 正式環境未改: pass
prod SEND_ATTRIBUTION_TO_BACKEND=false liveKeys=11 deployment=AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q
test 正式網址停住: pass
flow 成功: lock -> flush-held -> readback-held -> release -> mail-free -> mail-free -> lock -> flush-held -> readback-held -> release -> mail-free -> mail-free
sheet 品牌 SMC900001 gclid= utm內容=ag_brand
sheet gclid SMC900002 gclid=TESTGCLID9000 utm關鍵字=family-table
ui 成功: ok | 已送到隔離後端。訂單編號：SMC900001 寄信：已寄出。 請到隔離試算表、客人信、店內信核對這個編號。回應沒有備註；備註對照上面送出的 note、試算表與兩封信。
test 成功: pass
mail 成功: mocked 4（沒有實際寄出）
flow 結果未知: lock -> flush-held -> readback-held -> release
ui 結果未知: warn | 結果未知，先核對試算表、勿重送。訂單編號：SMC900001
test 結果未知: pass
flow 重複編號: lock -> release
ui 重複編號: bad | 這個編號已經收過，這次沒有新增。
test 重複編號: pass
flow 逾時: fetch hung -> page unknown（後端未被呼叫）
ui 逾時: warn | 結果未知，先核對試算表、勿重送
test 逾時: pass
flow 寄信部分失敗: lock -> flush-held -> readback-held -> release -> mail-free
ui 寄信部分失敗: ok | 已送到隔離後端。訂單編號：SMC900001 寄信：未全部寄出，請核對信箱。 請到隔離試算表、客人信、店內信核對這個編號。回應沒有備註；備註對照上面送出的 note、試算表與兩封信。
test 寄信部分失敗: pass
isolated e2e: pass
network: in-process mock only; SpreadsheetApp, MailApp, LockService, fetch 都沒有離開這個行程
```

### 情境

| 情境 | 結果 |
| --- | --- |
| 成功（品牌最終網址） | 取號 `SMC900001`。表格來源 `google`、utm內容 `ag_brand`、群組分類 `品牌`、點擊識別碼空白。客人信與店內信同一個編號。客人信沒有活動代碼。 |
| 成功（含 utm 與 gclid） | 另一個編號 `SMC900002`。utm關鍵字 `family-table`、utm廣告群組 `brand`、點擊識別碼 `TESTGCLID9000`。前一列沒有被改掉。 |
| 結果未知 | 讀回看到的編號對不上。回應 `unknown`，頁面是「結果未知，先核對試算表、勿重送」並帶編號。沒有寄信。表格裡那一列仍在。 |
| 重複編號 | 第二筆回同一個編號，`duplicate: true`、`wrote: false`，頁面不是綠色成功。沒有第二列，也沒有再寄信。 |
| 逾時 | 請求一直不回應。頁面約 30 毫秒（測試把 30 秒縮短）後顯示結果未知。後端沒有被呼叫，沒有寫表、沒有寄信。 |
| 寄信部分失敗 | 客人信有模擬寄出，店內信丟出錯誤。回應仍是成功，`mailed: false`。頁面寫「未全部寄出」。表格列還在，gclid 與編號對得上。 |
| 正式網址 | 貼上正式 `AKfycby…` 時按鈕停住，沒有送出。 |

## 其他測試

| 指令 | 結果 |
| --- | --- |
| `node tools/test-isolated-e2e.mjs` | 通過（綠燈） |
| `node tools/test-booking-reconciliation.mjs` | 通過。正式 POST 沒有來源欄；隔離表、客人信、店內信一致。 |
| `node tools/test-booking-backend-contract.mjs` | 通過。旗標關閉，預設 payload 仍是改版前的形狀。 |
| `node tools/test-isolated-dining-check.mjs` | 通過。驗收頁的網址判斷、逾時、鎖都還在。 |

## 這次沒有做的事

沒有部署 Apps Script，沒有寫入任何 Google 試算表，沒有寄信，沒有改官網訂位與外帶，沒有打開旗標，沒有改正式部署編號，沒有合併。

本機表格不會執行公式。公式會不會被 Google 試算表算掉，要等下面的實測用眼睛看。

## 真正的隔離實測：請 Owner 做這三步

做完先把下面寫的資訊回傳，先不要打開 `www.sweetmeichicken.com`，也不要覆寫正式那支 `AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q`。信箱用 Owner 自己的測試信箱，不要用客人的信箱。

### 1. 建立測試用試算表

1. 打開 [Google 雲端硬碟](https://drive.google.com)。左上「新增」→「Google 試算表」。
2. 左上名稱改成「隔離測試」。不要按共用，不要把連結丟給客人。
3. 試算表下方的「+」新增一個分頁。在新分頁名稱上按右鍵 →「重新命名」，輸入 `隔離標記`。不要多空白。
4. 點那個分頁的 **A1**，輸入 `SMC-ISOLATED-TEST`，按 Enter。不要改字、不要加空白。腳本不會自動建立這個分頁。
5. 看瀏覽器網址。`/d/` 和 `/edit` 中間那一串就是試算表 ID。複製下來。

請回傳：

- 試算表 ID（只要 ID，不要整張表的內容）
- 分頁名稱是不是正好 `隔離標記`
- A1 是不是正好 `SMC-ISOLATED-TEST`
- 確認這不是正式訂位用的那張試算表

### 2. 部署隔離 web app

1. 在剛建的試算表，選單「擴充功能」→「Apps Script」。若要登入，用 Owner 自己的 Google 帳號。
2. 編輯器裡原有的內容全部刪掉。貼上 repo 的 `.github/pages-unpublished/booking-attribution-isolated.gs`（要含這次讀回確認的版本）。按磁碟圖示存檔。不要從官網網址下載這個檔。
3. 左側齒輪「專案設定」。往下到「指令碼內容」→「新增指令碼內容」，加三列。ID 不可留白：
   - 屬性 `SMC_ATTRIBUTION_ISOLATED`，值 `yes`
   - 屬性 `SMC_SHOP_EMAIL`，值是下一步那個測試信箱
   - 屬性 `SMC_TEST_SHEET_ID`，值是第 1 步複製的試算表 ID
4. 右上「部署」→「新增部署」。旁邊的齒輪選「網路應用程式」。
5. 「執行身分」選「我」。「誰可以存取」選「只有我」。按「部署」，同意授權。
6. 複製新出來的網址。網址應是 `https://script.google.com/macros/s/部署編號/exec`，後面不要加問號或井號。
7. 不要選到既有的正式部署，也不要按「管理部署」去編輯那支 `AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q`。

請回傳：

- 新的完整 exec 網址
- 網址裡的部署編號（`/s/` 和 `/exec` 中間那一串）
- 執行身分是不是「我」，存取是不是「只有我」
- 確認沒有修改或覆寫正式部署

部署編號回傳之後，我們才會把它加進 `.github/pages-unpublished/isolated-check-guard.js` 的 `ALLOWED_DEPLOYMENT_IDS`。正式編號即使寫進去也不會放行。這一步先不要改 guard 檔。

### 3. 提供測試收件信箱

1. 用一個 Owner 自己收得到的測試信箱。客人信和店內信都會寄到這裡。
2. 這個信箱要和第 2 步的 `SMC_SHOP_EMAIL` 相同。
3. 不要填客人的信箱，也不要填正式店內信箱，除非那個信箱本來就是這次專用的測試信箱。

請回傳：

- 測試信箱地址
- 確認 `SMC_SHOP_EMAIL` 已設成同一個地址

三項都回傳之後，才做手冊裡「用最終廣告網址送一筆」和 8 筆驗收案例。那一輪仍不要開 `SEND_ATTRIBUTION_TO_BACKEND`。
