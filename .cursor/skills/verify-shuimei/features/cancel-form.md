# 取消表單畫面

客人打開取消／變更預約，看到線上取消要填預訂手機與訂單編號，也看得到變更時改走電話或 LINE 的說明。這條不送出取消。

## Sub-features

- `cancel-tab` 用「取消／變更預約」打開表單。
- `cancel-url` 用 `/?mode=cancel#cancel` 打開同一表單。
- `cancel-fields` 顯示預訂手機與訂單編號兩欄。
- `cancel-hold` 不按確認取消。

## How to get to it (user POV)

- 在預約頁籤旁按「取消／變更預約」。
- 打開 `/?mode=cancel#cancel`。

## Driving it with control-shuimei

Preconditions:

- `doctor` 通過。
- 沒有真實訂單編號。不要填客人的手機或編號。

- **按鈕入口。** 執行 `browser open --path /`，再 `browser click --role button --name "取消／變更預約"`。`browser text --selector "#formTitleText"` 是 `取消或變更預約`。`browser attr --selector "#tabCancel" --name aria-pressed` 是 `true`。
- **網址入口。** 執行 `browser open --path "/?mode=cancel#cancel"`。標題同樣是 `取消或變更預約`。
- **看欄位。** 執行 `browser wait --selector "#cancelForm" --text "預訂手機號碼"`。同一段文字含「專屬訂單編號」與「不必先取消再重訂」。
- **停在送出前。** 不要執行點擊「確認取消此筆預約」。若代理仍執行，helper 要以拒絕結束，而且 `network --expect-no-booking` 仍必須沒有預約主機。
- **證明。** 執行 `browser snapshot --aria --path cancel/form.aria.txt`、`browser screenshot --path cancel/form.png`、`network --expect-no-booking`。快照要有「水美土雞城」與「取消或變更預約」。

## Gotchas

- 按鈕文字是「取消／變更預約」（斜線是全形／）。標題是「取消或變更預約」（或）。兩句不要互換。
- 這條不能證明取消成功。正式端點不在本機，也不許打。
- 畫面上的 LINE 與市話不要點。
- 沒有編號時，變更說明要求改走電話或 LINE。不要為了讓送出成功而捏一筆正式訂單。
