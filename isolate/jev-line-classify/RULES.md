# 分類規則（可測、本地、不呼叫 Jev）

實作：`classify.mjs` 的 `classifyMessage`。第一條命中即停止。測試鎖住 `RULE_EXAMPLES`。

這是離線規則，用來產生隔離紀錄。回放管線**另有**自己的取消／確認判斷，不讀這裡的 `category`。因此「判成閒聊」不會取消原本的缺欄回覆，「判成訂位」也不會開單。

| 順序 | 條件 | category | confidence | reason |
| --- | --- | --- | --- | --- |
| 1 | 沒有文字（空白、缺訊息、貼圖等非 text） | `unknown` | 0.95 | `no_text` |
| 2 | 含取消語（取消、撤銷、不訂了、不要訂了、cancel），且沒有「不要取消／先別取消／先不要取消」 | `cancel` | 0.92 | `cancel_keyword` |
| 3 | 含訂位語（訂位、訂桌、預約、我要訂、想訂、想預約、幫我訂、定位） | `booking` | 0.90 | `booking_keyword` |
| 4 | 解析前上下文 `awaitingConfirmation === true`，且整則是「確認／正確／沒問題／ok」 | `booking` | 0.86 | `confirm_draft` |
| 5 | 同一則同時有手機 `09` 加八碼、日期或時間、人數（`N位` 或「人數」） | `booking` | 0.78 | `booking_fields` |
| 6 | 整則是招呼或道謝（你好、您好、嗨、哈囉、在嗎、謝謝、感謝、早安、晚安、掰掰、拜拜、哈哈、呵呵） | `chitchat` | 0.84 | `chitchat_greeting` |
| 7 | 問店況且前面沒被訂位／取消命中（營業、地址在、菜單、怎麼走、停車、包廂、幾點開、幾點關、好吃嗎、有位置嗎） | `chitchat` | 0.80 | `chitchat_info` |
| 8 | 其餘 | `unknown` | 0.40 | `no_rule` |

範例（假資料）：

- `我要訂位，我是測試一，電話0900000000，明天12:00，4位` → `booking` / `booking_keyword`
- `我是測試一，電話0900000000，明天12:00，4位` → `booking` / `booking_fields`
- 已在等確認時的 `確認` → `booking` / `confirm_draft`；沒有草稿時的 `確認` → `unknown`
- `取消訂單 SMC900001，手機0900000000` → `cancel`
- `不要取消，我要訂位` → `booking`（否定取消之後才看訂位語）
- `你好` → `chitchat` / `chitchat_greeting`
- `你好，請問營業到幾點？` → `chitchat` / `chitchat_info`
- `今天天氣真好` → `unknown`

## 失敗（不是第 8 條）

`observeClassification` 包住分類函式。下列情況 `category` 為 `null`，`action` 仍是 `none`，訂位回放不改：

| status | 條件 |
| --- | --- |
| `timeout` | 丟出 `code === 'CLASSIFY_TIMEOUT'`，或時鐘顯示超過預算（預設 50ms） |
| `exception` | 其他例外 |
| `empty` | `null`、`undefined`、空字串、空物件 |
| `malformed` | 不是物件、`category` 不在 enum、`confidence` 不是 0–1 的有限數字、或 `reason` 不是 1–80 字的字串 |

逾時即使函式有回傳訂位，紀錄也不採用該回傳。多出來的桌數、金額、略過驗證旗標一律丟棄。
