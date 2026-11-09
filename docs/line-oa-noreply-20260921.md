# 官方 LINE OA（@xwg4507a）v146 不自動回覆 — 診斷（2026-09-21）

**狀態：** 只讀對齊 live Apps Script dump。**未 clasp push、未改 webhook URL、未動店務 OpenClaw。**  
**證據檔 SHA256：** `ca881a2971e07e4fa3aa20e74a00baf03840f6ffed47f8a0548e1db74a26a06a`（與 `RESTORE_REPORT` `after_sha` 一致 = 今晚部署的 `程式碼.js`）。

本倉庫是官網 SMC-booking-system。官方 OA 真正跑在 Google Apps Script，不在此 repo runtime。下列是對 **attached live dump** 的結論，供 Owner GO。

---

## 1) 根因（有程式證據）

**老闆用「已寫入 `MY_USER_ID` 的那支 LINE」對官方 OA 測「我要訂位」時，v146 會刻意不回。** 這不是 webhook 被 PendingInbox 攔截，也不是「短句要等確認才回」。

今晚入口從 `handleLineWebhookPendingOnly_` 改回 `handleLineWebhook(ev)` 之後，老闆帳號重新走進這段：

1. `doPost` 對 LINE `events` **確實**呼叫 `handleLineWebhook(ev)`（不再進待審入口）。
2. `handleLineWebhook` 在解析訂位**之前**，若 `userId === MY_USER_ID`，改走 `handleOwnerCommand` 然後 `return`。
3. `handleOwnerCommand` 只回三種管理句（暫停/恢復 + 手機、或「指令／說明／help」）。**其餘老闆訊息落空，註解寫明「一律不回應」。**

對照 **還原前**（`PendingInbox.js` 的 `handleLineWebhookPendingOnly_`）：任何文字都會 `sendLineReply(「已收到您的訊息…」)`，**沒有** `MY_USER_ID` 分流。所以老闆今晚若用同一支 LINE 測，會感覺「剛恢復自動開單反而完全不回」——其實是還原了「老闆靜音」行為，不是入口沒接上。

客人道（`userId !== MY_USER_ID`）傳短句「我要訂位」會進 `parseBookingMessage` → 五欄皆缺 → **立刻**回「還差貴姓／手機／日期／時間／人數」。不是等確認才回。

---

## 2) 假設清單（保留／丟棄）

| 假設 | 結論 | 證據 |
|------|------|------|
| 入口仍走 PendingInbox 待審 | **丟棄** | `doPost` LINE 迴圈是 `handleLineWebhook(ev)`。`handleLineWebhookPendingOnly_` 仍在專案但無人呼叫。 |
| 短句「我要訂位」要等確認態才回，看起來像沒回 | **丟棄（客人道）** | 缺欄就 `sendLineReply` 追問。見下方流程。 |
| Owner `MY_USER_ID` 不進訂位回覆 | **成立（今晚症狀的主因）** | 還原後的 `handleLineWebhook` 第 0 段 + `handleOwnerCommand` 落空。 |
| `human_` 真人靜音 | **對老闆測試丟棄；對客人保留** | `human_` 檢查在 `MY_USER_ID` **之後**。老闆訊息到不了這裡。客人若曾按「真人」或老闆對該手機下「暫停」，3 小時內會靜音。 |
| `sendLineReply` 改讀 Script Properties 舊 token | **丟棄（Reply 路徑）** | `sendLineReply` / `pushToLine` **只用**檔案頂部 `CHANNEL_ACCESS_TOKEN`。Properties 的 `LINE_CHANNEL_ACCESS_TOKEN` 只出現在 PendingInbox 查 displayName，不影響 Reply API。 |
| Webhook 指錯部署（非 Qd8） | **無法在 dump 內證實；若「ID」也不回再查** | dump 不含 Webhook URL。Verify 常見 302 是 Apps Script Web App 特性，不代表一定沒送到。 |
| OA Manager **回應設定 = 聊天**（非機器人） | **無法遠端讀設定；用「ID」一句鑑別** | 若連「ID」都沒回，才優先查 chatMode / webhook / token。若「ID」有回、「我要訂位」沒回 → 就是老闆靜音路徑，不是 chatMode。 |
| 還原的 `handleLineWebhook` 把客人短句弄掛 | **丟棄** | 純程式 parser；「我要訂位」五欄皆空 → 必走缺欄回覆。Gemini 金鑰註解說格式不對，**此路徑不呼叫 Gemini**。 |
| `sendLineReply` token 失效 / 失敗被吞 | **次要、僅當「ID」也沒回時** | `muteHttpExceptions: true` 且**不記 HTTP 狀態**（`pushToLine` 才會 log 非 200）。無法在此環境打 LINE API。 |

---

## 3) 碼面對齊（live dump，勿把金鑰貼進 git）

### 入口已恢復自動開單

`doPost`：有 `events` →（可選簽章；無 header 則略過）→ `handleLineWebhook(ev)`。

`verifyLineSignatureIfPossible_`：沒設 `LINE_CHANNEL_SECRET`、或 Apps Script 拿不到 `X-Line-Signature` 時 **放行**。不是「無回覆」的主因。

### 老闆靜音（主因）

順序固定：

1. 非文字 message → 不回（貼圖／語音看起來也像沒機器人）。
2. 訊息去重鎖 60 秒。
3. **「ID」／「我的id」** → 回 userId（**在老闆分流之前**，老闆也能測管道）。
4. **`userId === MY_USER_ID` → `handleOwnerCommand` → return（不訂位）。**
5. `human_` 靜音（只對客人）。
6. 查詢／取消／parse → 缺欄或確認稿。

`handleOwnerCommand` 落空註解原文大意：其餘老闆訊息一律不回應，避免自己測試被打擾。

### 客人「我要訂位」

`parseName` / `parseDate` / `parseTime` / `parsePeople` 對這句都抓不到 → `missing.length > 0` → 問候 +「還差五項」。

### Reply token

`sendLineReply` Bearer = 檔案常數，不是 Properties。失敗只進 `catch`；HTTP 4xx/401 會被 `muteHttpExceptions` 吞掉且無 log。

---

## 4) Owner 立刻做的鑑別（不用改碼、不用 clasp）

用**個人 LINE** 打開官方帳號 `@xwg4507a`（不要在 OA Manager 裡「以官方帳號身份」傳訊；那不是客人 webhook）。

依序傳：

| 順序 | 你傳 | 若機器人有回 | 代表 |
|------|------|--------------|------|
| A | `ID` | 一串 `U…` userId | Webhook 有進 v146、Reply token 能發、這則對話不是 platform Chat 吞掉 |
| B | `指令` | 管理指令說明 | 你的 userId **等於** `MY_USER_ID`，管理路徑活著 |
| C | `我要訂位` | **沒回** | **預期。** 不要當成 webhook 掛了 |
| D | 另一支**未**設成 `MY_USER_ID` 的 LINE 傳 `我要訂位` | 應出現「很高興為您服務／還差…」 | 自動訂位對客人已通 |

**判讀：**

- **A 有回、C 沒回、B 有回** → 根因就是老闆帳號靜音。客人通道可用 D 確認。無需今晚改部署。
- **A 也沒回** → 才查 LINE 設定／token／Webhook（下一節）。到 Apps Script「執行項目」看今晚 `doPost` 有沒有被 LINE 叫到。
- **D 也沒回、但 A 有回** → 少見（例如該客人 `human_` 還在）。請該帳號傳「管家」，或等 3 小時 cache 過期。

在 Apps Script 編輯器執行 `testNotifyOwner`（dump 內已有）：收得到推播 → 檔案內 token + `MY_USER_ID` 與 Push API 一致。收不到 → 看執行 log 的 HTTP 碼（推播有記；Reply 沒記）。

---

## 5) 僅當「ID」也沒回：LINE Developers / OA Manager

**兩 OA 獨立。只動「水美土雞城」官方訂位 `@xwg4507a`。不要改「店務通知」的 `line.sweetmeichicken.com` webhook。**

### LINE Official Account Manager（@xwg4507a）

1. **回應設定 → 回應模式 = 機器人（Bot）**，不要停在「聊天（Chat）」。Chat 會讓 Messaging API 回覆異常或看起來沒機器人。
2. 關閉 LINE 內建自動回應／問候（避免跟 Apps Script 搶，或讓你以為只有內建在回）。
3. 若曾在 Manager 聊天室**人工回過**某位客人，該則對話可能被平台切到人工；對該客人改回機器人，或請對方傳「管家」（這只清 Apps Script `human_`，平台 Chat 仍要在 Manager 切）。

### LINE Developers Console（同一個 Channel，不是店務）

1. Messaging API → **Use webhook = Enabled**。
2. Webhook URL 必須是 Apps Script **Qd8** 部署的 `/exec`（`AKfycbyQd8zm…`）。不要指到 S87／ASa（即使今晚三份程式同步），也不要指到店務網域。
3. Verify：Apps Script Web App 常 **302**，Verify 紅字不一定等於沒在收 event。以「執行項目」有 `doPost`、或上面 A 有回為準。
4. Channel access token：程式註解寫過金鑰外洩、應重新發行。**重新發行後必須改檔案常數並重新部署**，否則 Reply/Push 會 401。未 GO 前不要 clasp push。
5. 看 Webhook error statistics：若大量失敗，才是 URL／權限（Web App「誰可以存取」須為 **任何人**）問題。

---

## 6) 建議修法（要 Owner GO 才上 live）

**現況建議：先不要部署。** 用第 4 節確認客人 LINE 會回即可營業。

若希望老闆自己測訂位時不要「完全沒回」，隔離 patch 在：

`docs/patches/apps-script-v146-owner-silent-hint.isolate.diff`

內容：

- 老闆傳訂位／預約類句子時，回一句「此帳號是管理帳號，請用另一支 LINE 測」。
- `sendLineReply` 記下 HTTP 狀態（與 `pushToLine` 對齊），方便下次查 token。

**套用方式：** Owner GO 後才貼進 Apps Script／clasp push／部署新版。本 PR **不是** live 部署。

不建議為了測試拿掉 `MY_USER_ID` 分流（老闆日常聊天會被當成客人開單）。

---

## 7) 本環境做不到的事

- 未呼叫 LINE API、未讀 OA Manager、未讀 Apps Script 執行 log。
- 未驗證 Qd8 URL 是否仍貼在 Developers Console。
- 未動店務 OpenClaw webhook。
