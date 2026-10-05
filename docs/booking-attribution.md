# 預約來源與人工狀態（官網）

此文件給店務對帳用，沒有掛在官網選單。客人畫面上不顯示活動代碼。

正式把訂單寫進試算表的 Google Apps Script **不在這個 repo**。這次只改靜態官網會送出的欄位，**沒有部署 Apps Script，也沒有讀寫正式試算表**。

## 官網怎麼記來源

同一次分頁造訪（重新整理、改內用／外帶、先去常見問題再回訂位）會保留進站時的 `utm_*` 與 `gclid`。沒有帶參數的網址不會把已記住的來源清掉；若同一次造訪又從另一條帶參數的廣告網址進來，改記新的那一組。

送出預約時，下列欄位跟原有的 `action`／`type`／`name`／`phone`／`email`／`people`／`tables`／`date`／`time`／`note`／`orderItems` 一起 POST。來源**不**寫進 `note`，也**不**出現在客人的收件畫面。

| 送出欄位 | 內容 |
|---|---|
| `source` | 有任一 `utm_*` 時用 `utm_source`；有 utm 但沒有 `utm_source` 時為 `utm_missing_source`；完全沒有 utm 時為 `direct/unknown` |
| `utmSource` `utmMedium` `utmCampaign` `utmContent` `utmTerm` | 對應的 utm 原值，沒有就空白 |
| `utmAdgroup` | 網址 `utm_adgroup`，用來對品牌／非品牌 |
| `adgroupBucket` | `brand` → `品牌`；`nonbrand` → `非品牌`；其他代碼留白，原始碼仍在 `utmAdgroup` |
| `gclid` | 有就原樣附上。只有 gclid、沒有 utm 時，`source` 仍是 `direct/unknown`，不當成廣告 |

`direct/unknown` 只表示這筆官網預約看不出廣告參數。不要把它算成 Google 廣告。

## 品牌／非品牌網址

同一個活動代碼，用 `utm_adgroup` 分開群組：

- 品牌：`utm_adgroup=brand`
- 非品牌：`utm_adgroup=nonbrand`

內用到達網址（品牌例）：

`https://www.sweetmeichicken.com/?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=rsa_family&utm_adgroup=brand#booking-section`

非品牌把 `utm_adgroup=brand` 換成 `utm_adgroup=nonbrand`。外帶若另開素材，改 `mode=takeout` 與 `#takeout`，其餘來源參數同樣要帶。

## 人工狀態（試算表手改，網站不送）

網站不送這些欄，避免之後腳本把空白蓋掉已填的值。請在訂單表自行加欄，人工維護：

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

同一訂單編號只算第一次。

| 名稱 | 怎麼算 |
|---|---|
| 預約送出 | 有訂單編號的筆數 |
| 有效預約 | 人工確認為是，且取消不是是 |
| 到店實收 | 到店為是的筆數；實收金額另計，只加總到店那幾筆 |

未到不從「預約送出」或「有效預約」扣掉。這三個筆數不要加成一個總數。沒有有效預約時，每筆成本寫「無法計算」，不要寫 0。

`js/booking-attribution.js` 的 `bookingOutcomeCounts()` 就是上面這套演算法，給之後對帳用，不會自己去改試算表。

## 點擊與轉換事件（尚未接廣告代碼）

廣告像素、轉換代碼、LINE Tag 都還沒有編號，此 PR **不載入** gtag 或像素。

- 拿到訂單編號、且這個編號在本次造訪還沒計過：送出一次 `smc:booking-submitted`。只顯示收件畫面不會再計一次。
- 點市話 `tel:` 或 `https://line.me/`：送出 `smc:contact-click`。這是互動，不算預約送出，也不寫進訂單。

## 合併之後仍待做（這次不要做）

1. 不要為了這份 PR 去部署或覆蓋正式 Apps Script，也不要改正式試算表的既有訂單。
2. 官網要等這個 PR 合併後，GitHub Pages 才會更新；合併前正式站不會送出新欄位。
3. 合併並確認頁面上線後，既有腳本仍會忽略不認得的欄位，試算表**還不會**出現來源。要另開隔離複本，在現有 `action === 'book'` 寫入訂單編號的同一列加上面的來源欄位，試跑一筆假資料（例如姓名「測試同學」、編號 `SMC900001`），確認舊欄位沒被弄壞，再部署 web app。部署不在這次範圍。
4. 人工六欄可以先在試算表加上，不必等腳本；不要用網站送出的空值覆蓋。
5. 廣告後台的最終到達網址要帶 `utm_adgroup=brand` 或 `nonbrand`。只靠企劃書裡沒有 `utm_adgroup` 的那條網址，無法分開品牌與非品牌。
6. 像素編號核發後再另案接到 `smc:booking-submitted`，不要在編號還沒有時先放一段代碼。
