# 首頁菜單與團體聚餐

客人從首頁導覽或頁內連結看到菜單價格與團體聚餐兩段公開說明。這條不填表、不送出。

## Sub-features

- `home-menu-nav` 從主要導覽進到菜單價格。
- `home-menu-hash` 用 `/#menu` 直接進到同一段。
- `home-group-nav` 從主要導覽進到團體聚餐。
- `home-group-hash` 用 `/#group-dining` 直接進到同一段。

## How to get to it (user POV)

- 主要導覽按「菜單價格」或「團體聚餐」。
- 頁尾也有「菜單價格」「團體聚餐」。
- 打開 `/#menu` 或 `/#group-dining`。

## Driving it with control-shuimei

Preconditions:

- `doctor` 通過。
- 首頁標題是「水美土雞城」。

- **導覽到菜單。** 執行 `browser open --path /`，再 `browser click --role link --name "菜單價格"`。`browser wait --selector "#menu-title" --text "水美土雞城菜單與價格"`。內文要同時看得到「內用」與「外帶預約」兩段價位說明，用 `browser text --selector "#menu"` 確認含「NT$500」與「4500」。
- **網址到菜單。** 執行 `browser open --path "/#menu"`。同一標題仍在。
- **導覽到團體聚餐。** 執行 `browser open --path /`，再 `browser click --role link --name "團體聚餐"`。`browser wait --selector "#group-dining-title" --text "團體聚餐・家庭聚會"`。
- **網址到團體聚餐。** 執行 `browser open --path "/#group-dining"`。同一標題仍在，且段落含「超過 3 桌」。
- **證明。** 停在團體聚餐時執行 `browser snapshot --aria --path home/group.aria.txt`、`browser screenshot --path home/group.png`、`network --expect-no-booking`。快照要有「水美土雞城」與「團體聚餐・家庭聚會」。

## Gotchas

- 頁首與頁尾都有同名連結。點到之後要等對應的標題，不能把「有這個連結」當成段落已出現。
- 團體聚餐裡的 LINE 與電話連結不要點。超過 3 桌的聯絡方式只證明文字在畫面上。
- 菜單數字若改版，斷言的「NT$500」與「4500」要跟著公開菜單改，不要改去對一個永遠在的容器。
