# 外帶品項小計

客人切到外帶、用加減按鈕調整品項數量後，會看到目前訂單與預估小計。這條不送出外帶預約。

## Sub-features

- `takeout-tab` 用頁籤進入外帶預約。
- `takeout-hero` 用主視覺的外帶預約連結進入。
- `takeout-url` 用 `/?mode=takeout#takeout` 進入。
- `takeout-step` 把預約限定甕窯雞加到 1 隻。
- `takeout-total` 顯示預估小計 NT$1,000。

## How to get to it (user POV)

- 在預約類型頁籤按「外帶預約」。
- 在桌機主視覺按「外帶預約」。
- 打開 `/?mode=takeout#takeout`。

## Driving it with control-shuimei

Preconditions:

- `doctor` 通過。
- 外帶數量都是 0，目前訂單顯示「尚未選擇品項。」

- **頁籤入口。** 執行 `browser open --path /`，再 `browser click --role tab --name "外帶預約"`。`browser attr --selector "#tabTakeout" --name aria-selected` 是 `true`，`browser text --selector "#formTitleText"` 是 `外帶預約`。
- **主視覺入口。** 執行 `browser open --path /`，再 `browser click --role link --name "外帶預約"`。標題是 `外帶預約`。
- **網址入口。** 執行 `browser open --path "/?mode=takeout#takeout"`。標題是 `外帶預約`，取餐日期標籤是 `取餐日期`。用 `browser text --selector "#dateLabel"` 確認。
- **加一隻甕窯雞。** 執行 `browser click --role button --name "增加預約限定甕窯雞"`。`browser wait --selector "#takeoutSummaryList" --text "甕窯雞 × 1隻"`。
- **讀小計。** 執行 `browser wait --selector "#takeoutSummaryTotal" --text '預估小計 NT$1,000'`。金額用單引號，避免 shell 吃掉 `$1`。空狀態「尚未選擇品項。」不再顯示。
- **再減回去。** 執行 `browser click --role button --name "減少預約限定甕窯雞"`。`browser wait --selector "#takeoutSummaryEmpty" --text "尚未選擇品項。"`，小計區塊隱藏。
- **證明。** 加回 1 隻後執行 `browser snapshot --aria --path takeout/summary.aria.txt`、`browser screenshot --path takeout/summary.png`、`network --expect-no-booking`。快照要有「水美土雞城」與「甕窯雞 × 1隻」。

## Gotchas

- 畫面上的品名是「預約限定甕窯雞／甕窯雞」。用「桶仔雞」去對可見文字會失敗，那不是客人看到的名字。
- 不要按「送出預約申請」。外帶送出一樣會打到正式預約端點，helper 會拒絕。
- 自養土雞是按斤估重，小計句子會多「到店實秤」。這條用甕窯雞，避免把估重句當成這次的證明。
- 只走頁籤時，主視覺與網址入口尚未驗證。
