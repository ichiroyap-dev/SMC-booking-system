---
name: verify-shuimei
description: "Drive the 水美土雞城 public booking site in a local browser and prove on-screen behavior. Use when a change touches index.html, faq.html, or the dining/takeout/FAQ UI and needs a scripted check that never posts to the live Apps Script."
---

# 驗證水美土雞城官網

這份技能給下一個代理用。官網是靜態頁（`index.html`、`faq.html`），沒有套件腳本、沒有資料庫。客人看到的是首頁預約表單與常見問題。正式寫入 Google 試算表的 Apps Script 不在這個 repo。驗證只開本機靜態站與隔離的 headless Chrome，不連正式表、不寄信、不發 LINE。

只支援 Linux／cloud agent。需要 Node 22+（全域 `WebSocket`）與 Chrome（預設 `/usr/local/bin/google-chrome`，可用 `CHROME_PATH`）。少一樣就立刻失敗，不會先去開 Chrome。

同一 `SHUIMEI_RUN_ID` 不能開兩份。要並行就各用一個 id；每個 id 有自己的連接埠、Chrome 設定檔與證據目錄。不要去開別人已經在用的那份。新分頁與新視窗會在腳本執行前被關掉，攔截只掛在這次的主分頁上。

## Launch

在 repo 根目錄執行。預設 id 是 `local`。這次沒有 migration，也沒有種子資料；空的 Chrome 設定檔就是乾淨狀態。

```bash
SHUIMEI_RUN_ID=local node .cursor/skills/verify-shuimei/scripts/control-shuimei.mjs launch
```

就緒時 stdout 出現 `ready url=http://127.0.0.1:<port>/`，且首頁已畫出 `#brand-title`（水美土雞城）與 `#bookingForm`。`styled=true` 表示 Tailwind 已套上（標題字級至少 40px）。`styled=false` 時表單仍可操作，但截圖不會是正式版面，先查 `cdn.tailwindcss.com` 與 `fonts.googleapis.com` 是否進得來，不要把未套版的畫面當成視覺回歸。

視窗固定 1280×900。這個寬度看得到桌機主視覺的「內用訂位／外帶預約」，手機頂部那排快速按鈕是藏起來的。

結束時拆掉這次啟動的程序（見 Cleanup）。不要留著跨任務複用。

## Doctor

任何畫面看起來不對，先跑 doctor，不要直接操作。

```bash
SHUIMEI_RUN_ID=local node .cursor/skills/verify-shuimei/scripts/control-shuimei.mjs doctor
```

通過要同時成立：

- supervisor 與這次啟動的 Chrome pid 都還在。
- `http://127.0.0.1:<port>/` 的 `X-Shuimei-Verify` 是 `<runId>:<pid>`，內文含「水美土雞城」與 `id="bookingForm"`。
- Chrome 目前網址屬於這次的 site URL，而且頁面上的驗證記號與 state 一致。記號用 `Page.addScriptToEvaluateOnNewDocument` 掛上，站內換頁（例如點「常見問題」）之後仍然在。
- 啟動時記下的 git HEAD 等於現在的 `HEAD`。不一致就 cleanup 再 launch。doctor 印出的 `head` 必須就是這次 commit。
- `network.jsonl` 存在、每一行都是 JSON，而且沒有任何預約主機（`script.google.com`、`script.googleusercontent.com`、`docs.google.com`、`sheets.google.com`、`sheets.googleapis.com`、`line.me`、`line-apps.com`），也沒有被放行的 POST／PUT／PATCH／DELETE。檔案不見、是空的、或有一行解析失敗時，doctor 與 `network` 都要非 0 結束並印出 `insufficient evidence`。不可以當成乾淨。

doctor 退出碼 0 才可以往下操作。

## Drive

指令都透過同一個 helper。角色名稱以無障礙名稱為準，不要用座標。

```bash
NODE=".cursor/skills/verify-shuimei/scripts/control-shuimei.mjs"
SHUIMEI_RUN_ID=local node "$NODE" browser open --path /
SHUIMEI_RUN_ID=local node "$NODE" browser click --role tab --name "內用訂位"
SHUIMEI_RUN_ID=local node "$NODE" browser click --role radio --name "桌菜"
SHUIMEI_RUN_ID=local node "$NODE" browser click --role radio --name '$4500'
SHUIMEI_RUN_ID=local node "$NODE" browser fill --selector "#adults" --value 8
SHUIMEI_RUN_ID=local node "$NODE" browser fill --selector "#tables" --value 1
SHUIMEI_RUN_ID=local node "$NODE" browser wait --selector "#peopleDisplay" --text 8
SHUIMEI_RUN_ID=local node "$NODE" browser wait --selector "#banquetSummary" --text "桌菜基本費用：4500元×1桌；原則含烤雞1隻"
SHUIMEI_RUN_ID=local node "$NODE" browser text --selector "#formTitleText"
SHUIMEI_RUN_ID=local node "$NODE" browser attr --selector "#tabDining" --name aria-selected
SHUIMEI_RUN_ID=local node "$NODE" browser scroll --selector "#banquetSummary"
SHUIMEI_RUN_ID=local node "$NODE" browser snapshot --aria --path dining/summary.aria.txt
SHUIMEI_RUN_ID=local node "$NODE" browser screenshot --path dining/summary.png
SHUIMEI_RUN_ID=local node "$NODE" network --expect-no-booking
```

`open --path` 只能是站內路徑（`/`、`/faq.html`、`/#menu`）。外站 URL 會被拒絕。

點擊會拒絕這三類，拒絕時退出碼是 1，不要改 helper 去放行：

- `#submitBtn`、`#cancelSubmitBtn`，或名稱含「送出預約申請」「確認取消此筆預約」。
- `tel:`、`mailto:`，以及任何離開 `127.0.0.1` 的連結（LINE、Facebook、Instagram、Google Maps）。
- 名稱比對：無障礙名稱要完全相等，或是「名稱 + 空白」開頭。`桌菜` 會對上「桌菜 4500／5000／5500…」。對不上就會列出同角色的附近名稱。

放行的網路只有 GET／HEAD，而且主機只限 `127.0.0.1`、`cdn.tailwindcss.com`、`fonts.googleapis.com`、`fonts.gstatic.com`。其餘包含地圖 iframe、`script.google.com`、LINE，都會在送出前被擋下，並寫進 `network.jsonl`。字型主機是頁面讀取字體，不是試算表。

每條功能的步驟在 `features/`。地圖列了多個入口時，只走其中一個不算其他入口已驗證。

## Evidence

證據目錄是 `/tmp/shuimei-verify-evidence/<SHUIMEI_RUN_ID>/`。launch 的 stdout 會印出實際路徑。

每次證明要留下：

- 動作當下的結果，不只最後一張圖。`text`、`attr`、`wait` 的 stdout 就是動作結果。
- `browser snapshot --aria` 的無障礙樹，裡面要看得到「水美土雞城」與這次斷言的句子。
- `browser screenshot` 的 PNG。截圖從頁面頂端往下最多 5000px，所以標題「水美土雞城」在畫面裡。
- `network.jsonl`。UI 證明結束時跑 `network --expect-no-booking`，預約主機必須是 0 筆，包含「被擋下的嘗試」。有被擋下的地圖或獎章請求可以存在，那表示請求沒有送出，不是寫表。
- 副作用：這幾條地圖功能不寫檔、不寫表、不發訊息。證明就是畫面上的摘要，加上 network log 裡沒有預約主機。不要用改 DOM 或測試用端點代替按鈕與欄位。

`screenshot` 與 `snapshot` 的 `--path` 若是相對路徑，會寫進證據目錄；絕對路徑也必須落在該目錄裡。

## Cleanup

只結束 state 裡記下的 supervisor pid 與 chrome pid，再刪 `/tmp/shuimei-verify/<id>/`（含 Chrome 設定檔）。不要用程序名稱去殺 Chrome。

```bash
SHUIMEI_RUN_ID=local node .cursor/skills/verify-shuimei/scripts/control-shuimei.mjs cleanup
```

證據目錄不會被刪。cleanup 之後要確認 PNG、ARIA 檔與 `network.jsonl` 還在。刪掉證據的 cleanup 算失敗。

失敗重試前也要先 cleanup，避免連接埠與設定檔留著。

## Helpers

Helper 是 `.cursor/skills/verify-shuimei/scripts/control-shuimei.mjs`。在 repo 根目錄用 `node` 呼叫，不必安裝、不必放進 PATH。

| 指令 | 作用 |
|---|---|
| `launch` | 開本機靜態站與隔離 Chrome，印出 url 與證據目錄 |
| `doctor` | 唯讀確認這份實例還能操作 |
| `browser open --path <path>` | 打開站內路徑 |
| `browser click --role <role> --name <name>` | 依無障礙角色與名稱點擊 |
| `browser fill --selector <css> --value <text>` | 填欄位並送出 input/change |
| `browser text --selector <css>` | 印出元素文字 |
| `browser attr --selector <css> --name <attr>` | 印出屬性 |
| `browser wait --selector <css> --text <text>` | 等到元素可見且含文字，預設 3 秒 |
| `browser scroll --selector <css>` | 把元素捲到畫面中間 |
| `browser snapshot --aria --path <file>` | 把無障礙樹寫進證據目錄 |
| `browser screenshot --path <file>` | 把頁面截圖寫進證據目錄 |
| `network --expect-no-booking` | 印出主機統計；有預約主機，或日誌不能當證據，就失敗 |
| `selftest` | 送一筆只會被擋下的測試 POST 到 `script.google.com` 的假路徑，並要求 `network --expect-no-booking` 失敗。安全網是好的時，這個指令結束碼是 0。跑完日誌就不再是乾淨的，要 cleanup 再 launch 才能做 UI 證明 |
| `cleanup` | 只收這次的程序與設定檔，包含啟動失敗時寫下的 Chrome pid。保留證據 |

環境變數只有 `SHUIMEI_RUN_ID`（預設 `local`）與選用的 `CHROME_PATH`（預設 `/usr/local/bin/google-chrome`）。不要加 API 金鑰。

## 維護

功能有改動時用 `/maintain-verification-skill` 對這份地圖重跑，不要只改句子。沒有人要求時不必自訂排程。
