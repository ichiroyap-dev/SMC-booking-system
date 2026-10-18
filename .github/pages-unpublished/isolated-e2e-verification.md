# 隔離驗證（第 2 輪退回後）

要貼進 Apps Script 的程式停在 commit `319ca184f94d9639f49f635fac7901aae17a76fc`。這份報告是下一個 commit，連結指回那個 SHA。

必須是新建的獨立試算表專案，不要貼進任何既有專案。隔離腳本沒有 `doPost`，只有 `doGet`。

沒有部署，沒有寫入 Google 試算表，沒有寄信，沒有合併。`SEND_ATTRIBUTION_TO_BACKEND` 仍是 `false`。正式訂位 POST 仍是 11 欄。正式部署編號仍是 `AKfycbyQd8zmDyDt74tziKSyrr9h4PiPoxaQzUfVze6hpPHUv47GWGUG82mKxGIVhzJljYc37Q`。

## 固定檔案

| 檔案 | raw 連結 | SHA-256 |
| --- | --- | --- |
| `.github/pages-unpublished/booking-attribution-isolated.gs` | https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/319ca184f94d9639f49f635fac7901aae17a76fc/.github/pages-unpublished/booking-attribution-isolated.gs | `12a4232da55dcfd38d248c3a3d923a4f92a7017b6719642e7131605bbfcc3dd3` |
| `.github/pages-unpublished/IsolatedCheck.html` | https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/319ca184f94d9639f49f635fac7901aae17a76fc/.github/pages-unpublished/IsolatedCheck.html | `c6ce8cda0968b5ef8af1de6bd04529c2d8d4c8dd839168a1582c04e2ef4f0cce` |

PowerShell：

```powershell
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/319ca184f94d9639f49f635fac7901aae17a76fc/.github/pages-unpublished/booking-attribution-isolated.gs' -OutFile booking-attribution-isolated.gs
Get-FileHash .\booking-attribution-isolated.gs -Algorithm SHA256
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ichiroyap-dev/SMC-booking-system/319ca184f94d9639f49f635fac7901aae17a76fc/.github/pages-unpublished/IsolatedCheck.html' -OutFile IsolatedCheck.html
Get-FileHash .\IsolatedCheck.html -Algorithm SHA256
```

## 這一輪的紅燈與綠燈

每一項都先加測試再改程式。Node `v22.14.0`。

| 項目 | 紅燈 | 綠燈 |
| --- | --- | --- |
| 八案例四種前綴 | 結束碼 1，8 項。紀錄 `isolated-red-formula.log` | `test-booking-reconciliation.mjs` 結束碼 0 |
| 空白與格式錯誤信箱 | 結束碼 1，6 項。紀錄 `isolated-red-email.log` | 同上，結束碼 0。紀錄 `isolated-green-recon-r3.log` |
| 移除 doPost | 結束碼 1，4 項。紀錄 `isolated-red-dopost.log` | `test-isolated-e2e.mjs` 結束碼 0。紀錄 `isolated-green-e2e-r3.log` |

公式紅燈的 8 項：內容欄、關鍵字、廣告群組還沒有 `+ - @`；沒有「四種前綴都通過」；沒有公式核對表；不符時仍繼續後面的案例；手冊沒有列出四種原值與 `getFormula`。

信箱紅燈的 6 項：空白時仍收單並可被看成已寄出，八案例也不停；`not-an-email` 同樣會寫表。

doPost 紅燈的 4 項：仍定義 `doPost`；手冊還沒寫必須新建專案、未知時不可重新整理重送，也還在教改 guard 白名單。

八案例全成功是 14 封信。私人頁每一筆新單 2 封。

## 先前「13 項」怎麼重現

13 這個數字不能從單一 commit 重現。`isolated-e2e-red-entry.log` 是當時還沒 commit 的測試檔，配上腳本 `5d4b789` 跑出來的。只 checkout 一個 commit 會得到另一組失敗數，所以總管重現時對不上 13。

現在可重現的做法：其餘檔案保持這支 PR 在 `319ca184f94d9639f49f635fac7901aae17a76fc` 的測試，只把 `.gs` 換成 `5a87907`：

```bash
git show 5a87907:.github/pages-unpublished/booking-attribution-isolated.gs > .github/pages-unpublished/booking-attribution-isolated.gs
node tools/test-isolated-e2e.mjs
```

結束碼 1，18 項。紀錄 `.github/pages-unpublished/isolated-e2e-red-rebuild-r3.log`。跑完要把 `.gs` 放回 `319ca184f94d9639f49f635fac7901aae17a76fc`。

## 請 Owner 做的三步

必須是新建的獨立試算表專案，不要貼進任何既有專案。未核對雜湊前不要貼。不要打開 `www.sweetmeichicken.com`。不要覆寫正式部署。信箱用 Owner 自己的測試信箱。結果未知時，不可以重新整理後重送。

1. **先準備測試表和信箱。** 用自己的帳號新增「隔離測試」試算表，不共用。新增「隔離標記」分頁，A1 填 `SMC-ISOLATED-TEST`。記下試算表 ID。選定自己收得到信的測試信箱，不用客人信箱。
2. **核對程式，先跑八案例。** 用上面的 raw 連結與 `Get-FileHash -Algorithm SHA256`。從新試算表開 Apps Script，貼上腳本，新增 `IsolatedCheck` HTML。設定 `SMC_ATTRIBUTION_ISOLATED=yes`、`SMC_SHOP_EMAIL=測試信箱`、`SMC_TEST_SHEET_ID=測試表 ID`。先不要部署，執行 `runIsolatedEightCases`。首次執行可能出現 Google 授權畫面。全成功預期 14 封測試信。核對訂單、郵件預覽、驗收結果，以及公式核對的四格：原值 `=1+1`、`+1+1`、`-1+1`、`@cmd`，讀回是帶前導單引號的文字，`getFormula` 為空。任何 unknown、讀回不符或公式異常，整批停止，不重跑、不部署，先回報原列。
3. **全部核對通過才開私人頁。** 新增網路應用程式部署，執行身分「我」、存取「只有我」。不要覆寫正式部署。用同帳號開新網址，帶入品牌欄位送一次。網頁每一筆新單再 2 封。未知或沒有回應就停，不可以重新整理後重送。`127.0.0.1` 那頁只留給模擬測試，不要拿來送這個部署。

做完後一次回傳：測試表 ID、測試信箱、八案例的驗收結果、公式核對四格、exec 網址、存取是不是「只有我」，以及確認沒有改正式環境。
