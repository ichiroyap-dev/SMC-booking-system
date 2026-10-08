# 隔離 Apps Script 驗收（內用）

這份給 Owner 或 hub 在**自己的 Google 帳號**做。本機測試沒有連 Google，也沒有寄出真信。

不要把 `apps-script/booking-attribution-isolated.gs` 貼上正式預約專案，不要改正式 web app 網址，不要寫正式試算表。官網 `SEND_ATTRIBUTION_TO_BACKEND` 維持 `false`。正式腳本原始碼不在這個 repo，這支隔離腳本**不是**正式腳本的補丁；這裡通過之後，還要把同樣的「缺來源仍收單」移植到正式腳本，才能另案開旗標。

客人信不可以出現 `launch_202610`、`ag_brand`、`ag_geo_dining`。那些只出現在「訂單」分頁與「店內對帳」信。

## 準備

1. 新建一張空白試算表，名稱含「隔離測試」。不要共用給客人。
2. 擴充功能 → Apps Script，新增專案。把 `apps-script/booking-attribution-isolated.gs` 全部貼上，存檔。
3. 專案設定 → 指令碼內容，新增：
   - `SMC_ATTRIBUTION_ISOLATED` = `yes`
   - `SMC_SHOP_EMAIL` = 你自己的測試信箱
   - `SMC_TEST_SHEET_ID` = 該試算表網址中的 ID
4. 部署 → 新增部署 → 類型選網路應用程式 → 執行身分選自己 → 存取權限選「只有我」。複製測試用網址。不要覆蓋正式那支 `AKfycby…`。
5. 下面每筆都用 POST、`Content-Type: application/json`。信箱請改成你的測試信箱；正文不因信箱改變。
6. `_testOrderId` 只在這支隔離腳本有效，官網不會送這個欄。

收到時間欄會是按下當下的 ISO 時間。本機測試把它固定成 `2026-10-08T00:00:00.000Z`，試算表上不必相同，但不可空白。

表頭（訂單分頁第 1 列）：

`訂單編號` `收到時間` `動作` `類型` `姓名` `電話` `信箱` `人數` `桌數` `日期` `時間` `備註` `品項` `來源` `utm來源` `utm媒介` `utm活動` `utm內容` `utm關鍵字` `utm廣告群組` `群組分類` `點擊識別碼`

## 案例 1｜只有原來的 11 欄（旗標關閉時官網就是這樣）

編號 `SMC900001`。

```json
{"action":"book","type":"dining","name":"測試同學","phone":"0900000000","email":"改成你的測試信箱","people":"2","tables":"1","date":"2026-10-22","time":"12:00","note":"散客 大人2位；靠窗","orderItems":"","_testOrderId":"SMC900001"}
```

預期回應：`status` 為 `success`，`orderId` 為 `SMC900001`。

訂單列：備註一字不差是 `散客 大人2位；靠窗`。來源到點擊識別碼 9 欄都空白。姓名 `測試同學`、電話 `0900000000`、類型 `dining`、人數 `2`、桌數 `1`。

客人信正文：

```text
水美土雞城｜預約申請已收到
訂單編號：SMC900001
申請類型：內用
預約日期與時間：2026-10-22 12:00
人數：2
桌數：1
備註：散客 大人2位；靠窗
郵件上的「已收到」是收件通知，細節以電話確認為準。
```

店內信在同一套訂位內容下面，來源 9 行都是空的（`來源：` 後面沒有字）。沒有 `google`。

## 案例 2｜廣告・品牌 `ag_brand`

編號 `SMC900101`。在案例 1 的 JSON 加上：

```json
"source":"google","utmSource":"google","utmMedium":"cpc","utmCampaign":"launch_202610","utmContent":"ag_brand","utmTerm":"","utmAdgroup":"","adgroupBucket":"品牌","gclid":""
```

訂單列：備註仍是 `散客 大人2位；靠窗`。來源 `google`、utm媒介 `cpc`、utm活動 `launch_202610`、utm內容 `ag_brand`、群組分類 `品牌`。utm廣告群組與點擊識別碼空白。

客人信與案例 1 相同格式，編號改 `SMC900101`。正文不得出現 `launch_202610`、`ag_brand`、`品牌`、`utm`。

店內信要有：`來源：google`、`utm內容：ag_brand`、`群組分類：品牌`、`utm活動：launch_202610`，以及同一句備註、同一個編號。主旨 `【店內對帳】預約 SMC900101`。

## 案例 3｜廣告・非品牌 `ag_geo_dining`

編號 `SMC900102`。同案例 2，但 `utmContent` 為 `ag_geo_dining`、`adgroupBucket` 為 `非品牌`。

訂單列群組分類是 `非品牌`，utm內容是 `ag_geo_dining`。案例 2 那一列仍是 `ag_brand`／`品牌`，不可被這筆改掉。

客人信不得出現 `ag_geo_dining` 或 `launch_202610`。

## 案例 4｜非廣告 `direct/unknown`

編號 `SMC900103`。`source` 為 `direct/unknown`，其餘 8 個來源欄是空字串。

訂單列來源是 `direct/unknown`，不是 `google`。群組分類空白。備註不變。客人信不得出現 `direct/unknown`。店內信要有 `來源：direct/unknown`。

## 案例 5｜來源不明（只有點擊識別碼）

編號 `SMC900104`。`source` 為 `有點擊識別碼、來源待核對`，`gclid` 為 `TESTGCLID9000`，其餘 utm 與群組分類空白。

訂單列與店內信都要有這句來源和 `TESTGCLID9000`。不可寫成 `google`，也不可寫成 `direct/unknown`。客人信不得出現 `TESTGCLID9000` 或「有點擊識別碼」。

## 案例 6｜公式開頭

編號 `SMC900105`。同案例 2，但 `utmCampaign` 改成 `=1+1`（不要自己先加引號）。

預期：訂單成功。utm活動儲存格**不是數字 2**。試算表可能顯示 `=1+1`（前面的單引號是文字標記）或 `'=1+1`。店內信正文含 `'=1+1`。客人信不得出現 `=1+1`。備註仍是原來那句。

## 案例 7｜格式壞掉仍收單

編號 `SMC900106`。同案例 1 的訂位欄，另加 `"source":{"bad":true}`、`"utmContent":["ag_brand"]`、`"adgroupBucket":"品牌<script>"`、`"gclid":12345`。

預期：`success`，備註不變，來源 9 欄都空白，沒有把 `ag_brand` 寫進去。客人信與案例 1 相同格式。

## 案例 8｜同一編號再送一次

把案例 2 的 JSON 再 POST 一次。

預期：回應仍是 `success` 與 `SMC900101`。訂單分頁裡 `SMC900101` **只有一列**。郵件預覽也只有原本那一封，不會再寄第二封。該列仍是 `ag_brand`／`品牌`。

## 對過才算過

每一筆都要四邊相同：回應的 `orderId`、訂單列的訂單編號、客人信、店內信。備註四邊都是 `散客 大人2位；靠窗`。

本機可先跑 `node tools/test-booking-reconciliation.mjs`（不連 Google）。它通過只代表隔離腳本的邏輯；試算表與真信仍要你做上面 8 筆。

通過之後也不要把 `js/booking-attribution.js` 的 `SEND_ATTRIBUTION_TO_BACKEND` 改成 `true`。正式腳本還沒接上之前，開了旗標會把來源送進一支尚未驗證的正式 web app。
