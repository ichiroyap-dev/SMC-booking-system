# 預約來源與人工狀態（官網）

此文件給店務對帳用，沒有掛在官網選單。活動代碼不寫進頁面內文。

帶參數進站時，客人仍可在網址列看到 `utm_*` 與 `gclid`。隱私權告知會提到這兩個參數名稱，不會寫出活動代碼。收件畫面與備註不放來源。

正式把訂單寫進試算表的 Google Apps Script **不在這個 repo**。這次**沒有部署 Apps Script，也沒有讀寫正式試算表**。既有腳本看到這 9 個新欄位會不會寫表、會不會影響寄信，目前是 **待驗證**。

來源欄位**預設關閉**，不放進正式 POST。`js/booking-attribution.js` 的 `SEND_ATTRIBUTION_TO_BACKEND` 維持 `false` 時，內用與外帶、有沒有 UTM，送出的 JSON 都與這次改動前相同（同樣的欄位、同樣的備註）。來源只留在這次分頁。

`tools/test-booking-backend-contract.mjs` **不能證明後端相容**。它不連線、不讀寫試算表，也**不能**當作把旗標打開的理由。

## 官網怎麼記來源

同一次分頁裡，完全沒有 `utm_*` 也沒有 `gclid` 的站內導覽（重新整理、改內用／外帶、先去常見問題再回訂位）會保留前一組來源，並把閒置計時重新起算。

另一條**帶標記**的網址進來時，整組換成新的：新網址沒有的 utm 或 gclid 要清空，不可把上一組的 gclid 接到新的 utm，也不可把舊 utm 接到新的 gclid。

上次寫入後閒置超過 30 分鐘，讀取時清除。過期之後的直接造訪記 `direct/unknown`。

`sessionStorage` 讀取或寫入失敗（包含讀取本身丟出 SecurityError）時，改用這次頁面共用的同一個記憶體備援。探測成功之後若寫入失敗，會清掉舊紀錄、把**最新**來源固定寫進這個備援，之後不再讀原生儲存裡的舊來源。追蹤失敗不可擋住預約送出、收件畫面或按鈕復原。收件畫面若畫不出來，畫面上仍要留下含訂單編號的成功提示，表單維持已填內容但先鎖住，送出按鈕保持停用，避免客人再按一次。要再填下一筆，須按「再預約一筆」且表單確實清空後才重開。清空若失敗（收件後自動清空，或按了再預約一筆），表單維持鎖定、送出維持停用，原訂單編號留在畫面上，並請客人重新整理頁面後再預約下一筆。

`pageshow` 且 `persisted === true`（從上一頁快取還原）優先只讀既有紀錄並檢查 30 分鐘期限，**不解析網址**重建來源。快取還原時 Navigation Timing 的 type 可能仍是 `navigate`，也不能拿來重建。

只有 `persisted` 不是 true 時，才看 `performance.getEntriesByType('navigation')[0].type`：`reload` 是重新整理，`back_forward` 是沒用快取的歷史返回。30 分鐘內同一條帶標記網址再被讀到，不算新造訪，也不把閒置計時重新起算（`seenAt` 維持上次寫入）。

已過期之後，`reload` 與 `back_forward` 都**不用**網址上的舊參數恢復廣告來源，記 `direct/unknown`。只有明確的 `navigate` 且網址帶 `utm_*` 或 `gclid` 時，才寫成一筆新的**帶標記進站**並更新 `seenAt`。這只表示這次導覽網址帶著那些參數，**不是**已證實的新廣告點擊；網址上的同一個 `gclid` 不能當成新點擊。另一條帶標記網址若是 `navigate`，整組換成新來源。

沒有傳入導覽類型、傳入空白、Navigation Timing 讀不到、丟出例外，或類型不是 `navigate`／`reload`／`back_forward` 時，都不從網址參數建立來源。未過期的既有紀錄仍可讀；已過期或本來就沒有紀錄，則記 `direct/unknown`。過期後網址完全沒有這些參數，也記 `direct/unknown`，不恢復舊來源。

下面 9 個欄位目前只在瀏覽器裡計算。旗標維持關閉時**不會**跟訂單一起 POST。`utm_id` 只留在造訪紀錄，**不在這 9 欄裡**；要不要送出留待後續。九個欄位的值一律是字串。群組分類只會是 `品牌`、`非品牌` 或空白，`__proto__`、`constructor`、`toString` 這類名字不會變成物件或函式。

| 瀏覽器內欄位 | 內容 |
|---|---|
| `source` | 有任一 `utm_*` 時用 `utm_source`；有 utm 但沒有 `utm_source` 時為 `utm_missing_source`；完全沒有 utm、也沒有 gclid 時為 `direct/unknown`；只有 gclid 時為 `有點擊識別碼、來源待核對` |
| `utmSource` `utmMedium` `utmCampaign` `utmContent` `utmTerm` | 對應的 utm 原值，沒有就空白 |
| `utmAdgroup` | 網址 `utm_adgroup` 的原值（不做字元刪減） |
| `adgroupBucket` | 只接受白名單與核准別名：`brand`／`品牌` → `品牌`；`nonbrand`／`non_brand`／`non-brand`／`非品牌` → `非品牌`。其他含 `br!and` 留白 |
| `gclid` | 這次進站有就附上。只有 gclid 時不當成廣告，也不寫成 `direct/unknown` |

`direct/unknown` 只表示這筆官網預約沒有廣告參數。不要把它算成 Google 廣告。`有點擊識別碼、來源待核對` 要另列，等人對過再決定算不算廣告。

外來參數寫進試算表前要當純文字。`cleanToken` 只去掉控制字元，**不是**公式防護。官網送出前若值以 `=`、`+`、`-`、`@` 開頭，會先加一個單引號。隔離環境仍要確認儲存格沒有執行公式。

## 品牌／非品牌網址

有 `utm_adgroup` 時，只用它分類，不用 `utm_content` 蓋過：

- 品牌：`utm_adgroup=brand`
- 非品牌：`utm_adgroup=nonbrand`

舊例（素材放在 `utm_content`，群組放在 `utm_adgroup`）：

`https://www.sweetmeichicken.com/?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=rsa_family&utm_adgroup=brand#booking-section`

`rsa_family` 這類素材代碼不分類。`utm_adgroup` 有值但不在白名單（含 `br!and`）時，分類留白。

### 第一輪最終到達網址（文案定稿）

定稿把廣告群組放在 `utm_content`，**沒有** `utm_adgroup`，也沒有 `gclid`。`mode=dining` 與 `#booking-section` 會打開內用訂位區。

- 品牌 `ag_brand`：`https://www.sweetmeichicken.com/?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=ag_brand#booking-section`
- 非品牌 `ag_geo_dining`：`https://www.sweetmeichicken.com/?mode=dining&utm_source=google&utm_medium=cpc&utm_campaign=launch_202610&utm_content=ag_geo_dining#booking-section`

沒有 `utm_adgroup` 時，只認這兩個原值：`ag_brand` → `品牌`，`ag_geo_dining` → `非品牌`。原值仍留在 `utmContent`。尚未投放的 `ag_group`、`ag_chongyang`、`ag_takeout` 不猜分類。外帶若另開，改 `mode=takeout` 與 `#takeout`；這一輪不開外帶廣告。

活動代碼不出現在頁面內文、收件畫面、備註或客人信。

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

## 訂單編號與來源快照

來源在按下送出時先拍照（9 個字串）。後端回傳訂單編號之後，這張快照只綁到該編號，留在這次分頁，不進備註、收件畫面，旗標關閉時也不進正式 POST。

- 請求還沒回來時，就算造訪紀錄被換成另一組來源，這一筆仍用按下送出時的快照。
- 同一編號再記一次：不覆寫快照、不重複送出 `smc:booking-submitted`。
- 「再預約一筆」或清空成功後的下一筆，是新編號，用那次按下送出時的快照。不會回頭改上一筆。
- 收件失敗或清空失敗而沒有送出的下一筆，不會多一個編號，也不會多一筆綁定。

## 點擊與轉換事件（尚未接廣告代碼）

廣告像素、轉換代碼、LINE Tag 都還沒有編號，此 PR **不載入** gtag 或像素。

- 拿到訂單編號、且這個編號有成功寫進這次造訪的去重紀錄：送出一次 `smc:booking-submitted`。只顯示收件畫面不會再計一次。儲存寫入失敗時不送這個事件，也不影響收件。
- 點市話 `tel:` 或 `https://line.me/`：送出 `smc:contact-click`。這是互動，不算預約送出，也不寫進訂單。

## 後端契約（待驗證，旗標預設關閉）

日後若打開旗標，才會多送這 9 個欄位：`source`、`utmSource`、`utmMedium`、`utmCampaign`、`utmContent`、`utmTerm`、`utmAdgroup`、`adgroupBucket`、`gclid`。

沒有現行 Apps Script 的去識別化程式，因此後端會不會收下新欄位、會不會改到寫表或寄信，都還沒有證據。狀態就是待驗證。這份 PR 不把新欄位送進正式請求。

正式腳本的原始碼不在這個 repo，隔離腳本**不是**正式腳本的補丁。`apps-script/booking-attribution-isolated.gs` 依前端看得到的 11 欄 POST 契約，另外寫一支只給隔離專案用的實作：缺來源、多來源或格式不對時仍收單，備註原樣寫入，來源欄空白或改成純文字。客人信不放活動代碼；店內信才放來源對帳。步驟與預期的表、信在 `docs/booking-attribution-isolated-runbook.md`。本機對帳腳本是 `tools/test-booking-reconciliation.mjs`。

隔離環境要做的檢查（不要用正式試算表、不要部署到正式 web app、不要寫正式訂單）：

1. 不要把隔離腳本貼上正式專案。開一個新的 Apps Script，連一張新的測試試算表。正式腳本原始碼不在 repo，無法在這裡對 diff。
2. 只用假資料送原有欄位（姓名「測試同學」、電話 `0900000000`、編號例如 `SMC900001`），記下寫進表的欄位與寄出的信。
3. 同一隔離複本再送一筆，加上面 9 個欄位。其中一筆的 `utmCampaign` 用 `=1+1` 這類公式開頭的假字串，確認儲存格是純文字、沒有執行公式。
4. 比對：原有欄位仍寫入、訂單編號仍會回傳、客人信的正文沒有被新欄位改掉或變成公式。店內信才看得到來源。
5. 上面四步都通過，而且正式腳本也接上同樣的失敗仍收單行為之後，才把 `js/booking-attribution.js` 的 `SEND_ATTRIBUTION_TO_BACKEND` 改成 `true`，並**另案**部署靜態官網。這份 PR 不改那一行，也不部署。

`tools/test-booking-backend-contract.mjs` 只核對「旗標關閉時送出形狀與改動前相同」以及這份文件的字句。它**不能證明後端相容**，也不能代替上面的寫表與寄信檢查。

## 合併之後仍待做（這次不要做）

1. 不要為了這份 PR 去部署或覆蓋正式 Apps Script，也不要改正式試算表的既有訂單。
2. 旗標維持關閉時，就算這個 PR 之後合併、GitHub Pages 更新，正式請求仍是舊欄位。不要在隔離檢查完成前把 `SEND_ATTRIBUTION_TO_BACKEND` 改成 `true`。
3. 打開旗標之前先做上一節的隔離檢查。結果出來之前，後端行為維持待驗證。
4. 人工六欄可以先在試算表加上，不必等腳本；不要用網站送出的空值覆蓋。
5. 第一輪最終到達網址用 `utm_content=ag_brand` 或 `ag_geo_dining`（見上節），不必再加 `utm_adgroup`。若網址另外帶了 `utm_adgroup`，分類只看 `utm_adgroup`。
6. 像素編號核發後再另案接到 `smc:booking-submitted`。後端重複建單的防護也另案。
