# SMC Tesla 能源動態監測

水美土雞城（SMC）用這支小工具，把 Tesla 電能現況寫進 **Google 試算表**。  
這不是公開網站，也不需要把 Tesla 登入權杖放在網頁上。

目標試算表（已存在，可先是空的）：

- 標題：`SMC Tesla 能源動態監測`
- ID：`1wYslB5UNTLc_Cy3DsdD4Zly9ZmDDY_8qu3UfVvvm0WA`
- 連結：https://docs.google.com/spreadsheets/d/1wYslB5UNTLc_Cy3DsdD4Zly9ZmDDY_8qu3UfVvvm0WA/edit

預設能源站 id（水美土雞城）：`2534007359185439`

---

## 給水美總管：這張表有哪些分頁

第一次成功寫入後，工具會建立（或覆用）三個分頁：

| 分頁 | 英文也可叫 | 做什麼 |
| --- | --- | --- |
| **即時現況** | Live | 永遠只有「一列表頭 + 一列現在的數值」。每次執行會覆寫這一列。 |
| **歷史紀錄** | History | 只往下累加。每次在表頭下方 **插入一列**，所以 **最新在最上面**。 |
| **說明** | Guide | 簡短操作說明。只有分頁是空的時候才寫入，之後不會覆蓋你手寫的備註。 |

請不要把密碼、refresh token、服務帳戶 JSON 貼進任何分頁。

### 欄位（即時現況 / 歷史紀錄 相同）

| 欄 | 意思 | 備註 |
| --- | --- | --- |
| 時間 (Asia/Taipei) | 這筆資料的時間 | 固定顯示台灣時間 |
| 電量% | Powerwall 電量 | 一位小數 |
| 太陽能kW | 太陽能發電功率 | Tesla 原始單位是瓦，這裡換成 kW、兩位小數 |
| 負載kW | 現場用電（廚房／店面負載） | 同上 |
| 電池充放電kW | 電池功率 | **正數 = 放電**（電池在供電）；**負數 = 充電** |
| 市電kW | 與台電交換的功率 | **正數 = 買電**；**負數 = 賣電** |
| 市電方向 | 買電 / 賣電 / 持平 | 接近 0（約 ±50 W）算持平，避免數字一直跳 |
| island/grid_status | 併網狀態 | 例如 `on_grid / Active`；停電離網會看到 `off_grid` |
| 備註 | 人讀的一句話 | 例如「電池充電 3.18 kW」 |

圖表建議：用 **歷史紀錄** 的時間 + 太陽能kW / 負載kW / 電量%。

---

## 給水美總管：第一次怎麼接線

你不需要會寫程式。請找一位能用終端機的人，照順序做完。

### A. Google 試算表寫入（服務帳戶，最單純）

1. 用 Google 帳號打開 [Google Cloud Console](https://console.cloud.google.com/)。
2. 建一個專案（或用現有專案）→ 啟用 **Google Sheets API**。
3. **IAM 與管理 → 服務帳戶** → 建立服務帳戶。
4. 為該帳戶建立金鑰，類型選 **JSON**，下載到操作電腦。  
   檔名類似 `smc-sheets-xxxxx.json`。這把鑰匙能寫入試算表，**不要上傳 GitHub、不要放到網站、不要貼進 Sheet。**
5. 打開 JSON，複製 `client_email`（長得像 `something@....iam.gserviceaccount.com`）。
6. 打開目標試算表 → 共用 → 貼上那個 email → 權限選 **編輯者**。
7. 在操作電腦記下 JSON 的完整路徑，稍後填進 `GOOGLE_APPLICATION_CREDENTIALS`。

（進階：工程師本機也可用 `gcloud auth application-default login`，不必服務帳戶。）

### B. Tesla Fleet API 權杖

需要 Tesla 開發者應用的：

- `TESLA_FLEET_CLIENT_ID`
- `TESLA_FLEET_CLIENT_SECRET`（重新換發 access token 時若 Tesla 要求再填）
- 已授權水美站點的 `access_token` / `refresh_token`（OAuth `offline_access`）

**建議**把 token 放在操作電腦的 JSON 檔（可讓程式在換發後自動覆寫），不要只放在環境變數裡——Tesla 的 refresh token **用過會換新的**，舊的很快失效。

可複製 `tokens.example.json` 成例如 `/home/ops/secrets/tesla-tokens.json`，只在那台電腦填真值。

預設 API 主機：`https://fleet-api.prd.na.vn.cloud.tesla.com`  
預設換發網址：`https://auth.tesla.com/oauth2/v3/token`  
若換發失敗，把 `TESLA_TOKEN_URL` 改成 Tesla 文件現在寫的  
`https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token`。

### C. 在操作電腦安裝並試跑

需要 Python **3.10 或更新**。

```bash
cd tools/tesla-energy-monitor
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp env.example .env         # 然後用文字編輯器填路徑與 ID，不要提交 .env
```

先不寫入試算表（也不打 Tesla，只用範例數字）：

```bash
python3 update.py --dry-run --fixture fixtures/live_status_redacted.json
```

成功時會印出一列中文欄位。結束碼 `0`。

接上真實 token 後：

```bash
python3 update.py --dry-run
python3 update.py --quiet
```

`--quiet`：成功就完全不印字，結束碼仍是 `0`。  
`--sheet-id`：必要時覆寫預設試算表。  
`--site-id`：必要時覆寫預設能源站。

### D. 之後定期跑（建議 5–15 分鐘一次）

每次執行 **只呼叫一次** Tesla `GET /api/1/energy_sites/{id}/live_status`。  
不要每秒跑：Fleet API 有速率限制，也可能計費。

Linux / macOS 例（每 15 分鐘）：

```cron
*/15 * * * * cd /path/to/SMC-booking-system/tools/tesla-energy-monitor && .venv/bin/python update.py --quiet
```

Windows 可用「工作排程器」跑同一支 `update.py --quiet`。

---

## 環境變數

| 變數 | 必填？ | 預設 | 說明 |
| --- | --- | --- | --- |
| `TESLA_FLEET_CLIENT_ID` | 換發 token 時要 | （無） | Fleet 應用 client id |
| `TESLA_FLEET_CLIENT_SECRET` | 視 Tesla 應用而定 | （無） | 有填才送到換發請求 |
| `TESLA_ACCESS_TOKEN` | 與 JSON 二擇一 | （無） | 會蓋過 JSON 裡的同名欄 |
| `TESLA_REFRESH_TOKEN` | 建議要 | （無） | access 過期或 401 時用來換新的 |
| `TESLA_TOKENS_JSON` | 建議 | （無） | 本機 JSON 路徑；換發成功會覆寫此檔 |
| `TESLA_ENERGY_SITE_ID` | 否 | `2534007359185439` | 水美土雞城 |
| `TESLA_FLEET_API_BASE` | 否 | NA Fleet host | 區域主機，不要加結尾 `/` |
| `TESLA_TOKEN_URL` | 否 | `https://auth.tesla.com/oauth2/v3/token` | 換發 endpoint |
| `TESLA_SHEET_ID` | 否 | 上面的 Sheet ID | `--sheet-id` 優先 |
| `GOOGLE_APPLICATION_CREDENTIALS` | 寫入 Sheet 時要 | （無） | 服務帳戶 JSON 的完整路徑 |

`.env` 會自動被讀取（若已 `pip install` 本資料夾的套件）。**不要把 `.env`、token JSON、Google 金鑰提交進 git。**

---

## 絕對不要做的事

- 不要把 Tesla private key、client secret、access / refresh token 提交到這個 repo。
- 不要放進公開網站、`.well-known`、GitHub Pages。
- 不要貼進這張試算表（試算表會給很多人看）。
- 不要改訂位 / LINE / Guard 相關程式；本工具只活在 `tools/tesla-energy-monitor/`。

---

## 開發者：測試

不需 Tesla 或 Google 帳號：

```bash
cd tools/tesla-energy-monitor
python3 -m unittest discover -s tests -v
```

`fixtures/live_status_redacted.json` 是虛構但功率守恆的午餐時段範例（太陽能 18.24 kW、賣電），數字不是水美真實讀值。
