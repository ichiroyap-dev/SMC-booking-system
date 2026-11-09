# 輸入／輸出契約（離線隔離）

狀態：**NO_DEPLOY**。本契約只描述隔離測試紀錄。分類結果不得進入訂位解析、桌數、金額、容量、去重、開單或回覆。

官方 `程式碼.js` 不在這個公開 repo。這裡的「既有解析前上下文」是離線回放替身在解析欄位**之前**讀到的草稿旗標，不含客人個資。

## 輸入

模擬的 LINE webhook **文字訊息**事件，加上解析前上下文。一律使用假資料（假姓名、`0900000000` 這類假電話、假 userId）。

```json
{
  "event": {
    "type": "message",
    "webhookEventId": "week-0-details",
    "replyToken": "fake-reply-token",
    "timestamp": 1750000000000,
    "source": { "type": "user", "userId": "UFAKEGUEST0000000000000000000001" },
    "message": { "id": "week-0-details", "type": "text", "text": "我要訂位，我是測試一，電話0900000000，明天12:00，4位" }
  },
  "context": {
    "hasDraft": false,
    "awaitingConfirmation": false,
    "dedupSeen": false,
    "priorTurnCount": 0
  }
}
```

`context` 只有旗標與回合數。不放姓名、電話、地址、權杖或金鑰。非文字訊息（例如貼圖）沒有可用文字，規則會落到 `unknown` / `no_text`。

## 輸出

分類 enum 沿用本規格建議。此 repo 沒有既有的「訊息分類」命名（`tools/jev-dup-judge` 的 `MERGE` / `REVIEW` / `SEPARATE` 是重複訂位判官，不是這個任務）。

| 欄位 | 值 |
| --- | --- |
| `category` | `booking`、`cancel`、`chitchat`、`unknown` 之一；失敗時為 `null` |
| `confidence` | 0 到 1 的數字；失敗時為 `null` |
| `reason` | 短原因（見 `RULES.md`）；失敗時為 `null` |
| `status` | `ok`、`timeout`、`exception`、`empty`、`malformed` |
| `action` | 永遠是 `none` |
| `followed` | 永遠是 `false` |
| `shadow` | 永遠是 `true` |
| `logPath` | 預設 `memory://isolate/jev-line-classify/logs/classify.jsonl` |

成功範例：

```json
{
  "kind": "line_classify",
  "shadow": true,
  "followed": false,
  "action": "none",
  "category": "booking",
  "confidence": 0.9,
  "reason": "booking_keyword",
  "status": "ok",
  "error": null,
  "logPath": "memory://isolate/jev-line-classify/logs/classify.jsonl"
}
```

紀錄只進呼叫端提供的記憶體陣列（`sink`）或上述記憶體路徑。預設不寫檔、不寫試算表、不呼叫 LINE。

分類函式若多回 `tables`、`amount`、`bypassValidation` 等欄位，正規化時會丟掉，不會出現在紀錄裡，回放管線也讀不到。

## Fail-open

只表示：分類逾時、丟出例外、回空值或格式不對時，**原訂位回放照舊跑完**，包含缺欄追問、人數上限、同手機同時段去重、取消前對訂單編號與電話。分類失敗不得少做這些檢查，也不得多開一筆或多回一則。

分類函式只看 `structuredClone` 後的複本。它若改了複本再丟例外，訂位路徑仍使用呼叫端原來的事件物件，開單與回覆的副作用與沒加分類時逐字相同。
