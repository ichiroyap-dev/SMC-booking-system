# 預約來源與人工狀態（官網）

此文件給店務對帳用，沒有掛在官網選單。活動代碼不寫進頁面內文。

帶參數進站時，客人仍可在網址列看到 `utm_*` 與 `gclid`。隱私權告知會提到這兩個參數名稱，不會寫出活動代碼。收件畫面與備註不放來源。

正式把訂單寫進試算表的 Google Apps Script **不在這個 repo**。這次只改靜態官網會送出的欄位，**沒有部署 Apps Script，也沒有讀寫正式試算表**。既有腳本看到這 9 個新欄位會不會寫表、會不會影響寄信，目前是 **待驗證**。本機契約測試不呼叫 `script.google.com`，不能代替隔離環境的寫表與寄信驗證。

## 官網怎麼記來源

同一次分頁裡，完全沒有 `utm_*` 也沒有 `gclid` 的站內導覽（重新整理、改內用／外帶、先去常見問題再回訂位）會保留前一組來源，並把閒置計時重新起算。

另一條**帶標記**的網址進來時，整組換成新的：新網址沒有的 utm 或 gclid 要清空，不可把上一組的 gclid 接到新的 utm，也不可把舊 utm 接到新的 gclid。

上次寫入後閒置超過 30 分鐘，讀取時清除。過期之後的直接造訪記 `direct/unknown`。

`sessionStorage` 讀取或寫入失敗（包含讀取本身丟出 SecurityError）時，改用這次頁面共用的同一個記憶體備援。追蹤失敗不可擋住預約送出、收件畫面或按鈕復原。

送出預約時，下面 9 個欄位跟原有的 `action`／`type`／`name`／`phone`／`email`／`people`／`tables`／`date`／`time`／`note`／`orderItems` 一起 POST。`utm_id` 目前只留在造訪紀錄，**不在這 9 欄裡**；要不要送出留待後續，避免和已對過的欄位數不一致。

| 送出欄位 | 內容 |
|---|---|
| `source` | 有任一 `utm_*` 時用 `utm_source`；有 utm 但沒有 `utm_source` 時為 `utm_missing_source`；完全沒有 utm、也沒有 gclid 時為 `direct/unknown`；只有 gclid 時為 `有點擊識別碼、來源待核對` |
| `utmSource` `utmMedium` `utmCampaign` `utmContent` `utmTerm` | 對應的 utm 原值，沒有就空白 |
| `utmAdgroup` | 網址 `utm_adgroup` 的原值（不做字元刪減） |
| `adgroupBucket` | 只接受白名單與核准別名：`brand`／`品牌` → `品牌`；`nonbrand`／`non_brand`／`non-brand`／`非品牌` → `非品牌`。其他含 `br!and` 留白 |
| `gclid` | 這次進站有就附上。只有 gclid 時不當成廣告，也不寫成 `direct/unknown` |

`direct/unknown` 只表示這筆官網預約沒有廣告參數。不要把它算成 Google 廣告。`有點擊識別碼、來源待核對` 要另列，等人對過再決定算不算廣告。

外來參數寫進試算表前要當純文字。`cleanToken` 只去掉控制字元，**不是**公式防護。官網送出前若值以 `=`、`+`、`-`、`@` 開頭，會先加一個單引號。隔離環境仍要確認儲存格沒有執行公式。

## 品牌／非品牌網址

同一個活動代碼，用 `utm_adgroup` 分開群組：

- 品牌：`utm_adgroup=brand`
- 非品牌：`utm_adgroup=nonbrand`

內用到達網址（品牌例）：

`https://www.sweetmeichicken.com/?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=rsa_family&utm_adgroup=brand#booking-section`

非品牌把 `utm_adgroup=brand` 換成 `utm_adgroup=nonbrand`。外帶若另開素材，改 `mode=takeout` 與 `#takeout`，其餘來源參數同樣要帶。

## 人工狀態（試算表手改，網站不送）

網站不送這些欄，避免之後腳本把空白蓋掉已手改的值。請在訂單表自行加欄，人工維護：

| 欄位 | 建議鍵 | 填法 |
|---|---|---|
| 人工確認 | `confirmed` | `是` 或空白 |
| 取消 | `cancelled` | `是` 或空白 |
| 未到 | `noshow` | `是` 或空白 |
| 到店 | `arrived` | `是` 或空白 |
| 實收金額 | `revenue` | 該筆實際結帳金額 |
| 更新時間 | `updatedAt` | 最後一次人工更新的時間 |

電話、LINE 人工建檔，且無法確認來源時，來源填 **未知**。不要填 `google`，也不要填 `direct/unknown`。

## 三個數字分開，不相加

這次同一訂單編號只採第一次出現的列。同編號後來若狀態不同，對帳應改取最新一列；那個規則留待對帳另案，這支 PR 不改。

| 名稱 | 怎麼算 |
|---|---|
| 預約送出 | 有訂單編號的筆數 |
| 有效預約 | 人工確認為是，且取消不是是 |
| 到店實收 | 到店為是的筆數；實收金額另計，只加總到店那幾筆 |

未到不從「預約送出」或「有效預約」扣掉。這三個筆數不要加成一個總數。沒有有效預約時，每筆成本寫「無法計算」，不要寫 0。

`js/booking-attribution.js` 的 `bookingOutcomeCounts()` 就是上面這套「只算第一次」的演算法，不會自己去改試算表。

## 點擊與轉換事件（尚未接廣告代碼）

廣告像素、轉換代碼、LINE Tag 都還沒有編號，此 PR **不載入** gtag 或像素。

- 拿到訂單編號、且這個編號有成功寫進這次造訪的去重紀錄：送出一次 `smc:booking-submitted`。只顯示收件畫面不會再計一次。儲存寫入失敗時不送這個事件，也不影響收件。
- 點市話 `tel:` 或 `https://line.me/`：送出 `smc:contact-click`。這是互動，不算預約送出，也不寫進訂單。

## 後端契約（待驗證）

官網多送的 9 個欄位是：`source`、`utmSource`、`utmMedium`、`utmCampaign`、`utmContent`、`utmTerm`、`utmAdgroup`、`adgroupBucket`、`gclid`。

沒有現行 Apps Script 的去識別化程式，因此後端會不會收下新欄位、會不會改到寫表或寄信，都還沒有證據。狀態就是待驗證。

隔離環境要做的檢查（不要用正式試算表、不要部署到正式 web app、不要寫正式訂單）：

1. 複製正式腳本到隔離專案，改連隔離試算表。
2. 只用假資料送原有欄位（姓名「測試同學」、電話 `0900000000`、編號例如 `SMC900001`），記下寫進表的欄位與寄出的信。
3. 同一隔離複本再送一筆，加上面 9 個欄位。其中一筆的 `utmCampaign` 用 `=1+1` 這類公式開頭的假字串，確認儲存格是純文字、沒有執行公式。
4. 比對：原有欄位仍寫入、訂單編號仍會回傳、信的正文沒有被新欄位改掉或變成公式。
5. 通過之後才另案部署。這份 PR 不部署。

`tools/test-booking-backend-contract.mjs` 只鎖定官網送出的形狀與文件字句，不連線、不讀寫試算表。

## 合併之後仍待做（這次不要做）

1. 不要為了這份 PR 去部署或覆蓋正式 Apps Script，也不要改正式試算表的既有訂單。
2. 官網要等這個 PR 合併後，GitHub Pages 才會更新；合併前正式站不會送出新欄位。
3. 上線前先做上一節的隔離檢查。結果出來之前，後端行為維持待驗證。
4. 人工六欄可以先在試算表加上，不必等腳本；不要用網站送出的空值覆蓋。
5. 廣告後台的最終到達網址要帶 `utm_adgroup=brand` 或 `nonbrand`。只靠沒有 `utm_adgroup` 的那條網址，無法分開品牌與非品牌。
6. 像素編號核發後再另案接到 `smc:booking-submitted`。後端重複建單的防護也另案。
