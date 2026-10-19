# 內用桌菜摘要

客人選擇內用、桌菜方案與人數後，表單會算出桌菜基本費用與原則含烤雞隻數。這條只證明畫面上的摘要，不保留座位。

## Sub-features

- `dining-tab` 用預約類型頁籤進入內用訂位。
- `dining-hero` 用主視覺的內用訂位連結進入。
- `dining-url` 用 `/?mode=dining#booking-section` 進入。
- `dining-banquet` 選桌菜與 $4500 後顯示基本費用與含烤雞隻數。
- `dining-people` 成人人數會計入合計人數。

## How to get to it (user POV)

- 在預約類型頁籤按「內用訂位」。
- 在桌機主視覺（寬度 1280）按「內用訂位」。這個連結在 `md` 以下是隱藏的。
- 打開 `/?mode=dining#booking-section`。
- 手機寬度另有一排「內用訂位」。1280 寬度的驗證視窗看不到它，不要把它算進這次桌機證明。

## Driving it with control-shuimei

Preconditions:

- `doctor` 通過，網址是這次 launch 的 `http://127.0.0.1:<port>/`。
- 這次分頁還沒按過送出。
- 視窗是 launch 設好的 1280×900。

- **頁籤入口。** 打開首頁並按頁籤。執行 `browser open --path /`，再 `browser click --role tab --name "內用訂位"`。`browser attr --selector "#tabDining" --name aria-selected` 是 `true`，`browser text --selector "#formTitleText"` 是 `內用訂位`。
- **主視覺入口。** 重新開啟首頁後按連結。執行 `browser open --path /`，再 `browser click --role link --name "內用訂位"`。標題同樣變成 `內用訂位`，且 `#tabDining` 的 `aria-selected` 是 `true`。
- **網址入口。** 執行 `browser open --path "/?mode=dining#booking-section"`。標題是 `內用訂位`。
- **選桌菜。** 在任一入口之後執行 `browser click --role radio --name "桌菜"`，再 `browser click --role radio --name '$4500'`。`$4500` 要用單引號，避免 shell 把它吃掉。`#planPanel` 不再是隱藏，且看得到 `$4500`。
- **填人數與桌數。** 執行 `browser fill --selector "#adults" --value 8` 與 `browser fill --selector "#tables" --value 1`。`browser wait --selector "#peopleDisplay" --text "8"` 的合計是 8。
- **讀摘要。** 執行 `browser wait --selector "#banquetSummary" --text "桌菜基本費用：4500元×1桌；原則含烤雞1隻"`。摘要還含「加人及素食套餐費用另計，由電話確認。」
- **證明。** 執行 `browser snapshot --aria --path dining/summary.aria.txt`、`browser screenshot --path dining/summary.png`、`network --expect-no-booking`。快照同時有「水美土雞城」與那句桌菜費用；網路紀錄沒有預約主機。記下實際走的入口。

## Gotchas

- 只走頁籤時，主視覺連結與 `?mode=dining` 都還沒驗證。
- `桌菜` 的無障礙名稱後面還有價位說明。指令用短名稱，helper 只接受全名或「短名稱加空白」開頭。
- 摘要不是訂單。沒有訂單編號、沒有「預約申請已收到」，就不能說已訂位。
- 不要按「送出預約申請」。helper 會拒絕；若日誌出現 `script.google.com`，這次證明失敗。
- 週三日期會變成「週三公休不開放」。這條摘要不選日期，不能拿來證明時段。
- 當天午餐線上不開放、13:00 後當天晚餐也不開放。那是選了今天才會出現的阻擋，不是摘要計算。
