# Jev 重複訂位判官（Jev duplicate-booking judge）— 隔離草稿

> **NO_DEPLOY／只記錄（log-only）／fail-open。** 本資料夾沒有接到任何正式 Apps Script、正式訂位表或店機專案。

## 做什麼
1. **程式（確定性）** 從 `工作表1`（內用）與 `外帶訂單`（外帶）列出「可能重複」的配對：
   - 同日期 **且** 同餐別（外帶若沒填餐別，以時間 < 16:00 判午餐）
   - **且**（真電話相同 **或** 姓名相似度 ≥ 0.8）
   - 附加訊號：同方案碼（備註如 `4.5k2a`，a＝桌）、同桌數、時間差、內用 vs 外帶交叉
   - 電話欄是 `line訂` 等佔位字 → **不算**電話相同；只剩「陳先生／陳小姐」這種姓氏＋稱謂不會互相配對
   - 兩筆都已取消的配對略過；`activeOnly:true` 時只看兩筆都有效的
2. **Jev（OpenRouter Decisions API，shadow）** 每個配對只回：
   - `verdict`（choice）：`MERGE` / `REVIEW` / `SEPARATE`
   - `same_booking`（noul）：是同一筆重複的機率 0–1
   - 防呆：Jev 回 MERGE 但機率 < 0.5 → 記為 REVIEW
3. **只寫 log**，`action` 永遠是 `none`：不合併、不取消、不寫正式表。

欄位（0 起算）：A0 時間戳、B1 姓名、C2 電話、E4 日期、F5 餐別、G6 時間、H7 備註、I8 桌數、J9 訂單編號、K10 狀態。**M 欄預估金額完全忽略。**

## 輸入／輸出
```js
const dine = rowsToBookings(sheetValues, 'dine_in');        // 2D array from 工作表1
const take = rowsToBookings(takeoutValues, 'takeout');       // 2D array from 外帶訂單
const cands = generateCandidates(dine, take, { activeOnly: true });
const entries = judgeCandidates(cands, { config: readConfig(props), transport, log });
```
Log entry 範例：
```json
{"ts":"...","kind":"dup_judge","shadow":true,"followed":false,"action":"none",
 "key":"09-27|lunch","a_id":"SMC900001","b_id":"SMC900002",
 "reasons":["same_phone","similar_name","same_plan_code"],
 "verdict":"MERGE","probability":0.93,"confidence":0.8}
```
錯誤時 `verdict:null` 並帶 `error`（金鑰字串會被遮蔽）；停用時帶 `skipped:"disabled"`。

## 設定（不可寫死金鑰）
| Key（Script Properties 或 env） | 用途 |
| --- | --- |
| `OPENROUTER_API_KEY` | 必填；沒有就只記 error，不呼叫 |
| `JEV_MODEL` | 預設 `~typesafe/jev-latest`（要固定閾值可設 `typesafe/jev-1.13`） |
| `JEV_DUP_JUDGE_ENABLED=0` 或 `JEV_ROUTER_ENABLED=0` | 關閉開關，完全不呼叫 Jev |

## 測試
```
node --test tools/jev-dup-judge/test.mjs
```
Fixture：9/27 午餐 測試同學（SMC900001 保留、SMC900002 取消；依真實重複寫入案例改寫，姓名／編號／電話／備註皆為假資料）、三筆 `line訂` 不同客人（不可配對）、陳先生 vs 陳小姐（不可配對）、內用 vs 外帶同電話（要標出交叉）。完全離線，transport 用假函式。

## 之後怎麼接（本 PR **未**接線）
- 夜間「外帶／內用對表防重」檢查結束後，把兩張表的 `getValues()` 丟進 `rowsToBookings` → `generateCandidates({activeOnly:true})` → `judgeCandidates`。
- Apps Script 的 transport：`(url,o)=>{const r=UrlFetchApp.fetch(url,{method:'post',headers:o.headers,payload:o.body,contentType:'application/json',muteHttpExceptions:true});return {status:r.getResponseCode(),body:r.getContentText()};}`
- log 寫到**獨立**的 log 表或 `Logger`，不要寫回正式訂位表。
- 只有 Owner 明示 GO 才考慮把 REVIEW/MERGE 推給店員看；任何情況下都不自動取消。

## 待確認
- `外帶訂單` 分頁的欄位是否與 `工作表1` 相同（目前假設相同，可用 `rowsToBookings(values,'takeout',columns)` 覆寫）。
- 狀態欄「取消」的實際字樣（目前用 `/取消|cancel/i`）。
- UrlFetchApp 無法設 5 秒逾時；夜間批次可接受，但要限制每晚呼叫數。
