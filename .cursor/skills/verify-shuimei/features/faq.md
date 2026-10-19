# 常見問題

客人從首頁進常見問題，展開預約題，再回到首頁的線上預約。這條不送出表單，也不打開 LINE 或電話。

## Sub-features

- `faq-nav` 從首頁主要導覽打開常見問題。
- `faq-direct` 直接打開 `/faq.html`。
- `faq-walkin` 展開「需要預約嗎？臨時來店可以用餐嗎？」
- `faq-return` 從常見問題的「線上預約」回到首頁內用表單。

## How to get to it (user POV)

- 主要導覽按「常見問題」。
- 直接打開 `/faq.html`。
- 首頁英雄區的「臨時用餐說明」會到 `/faq.html#faq-walkin`，該題應展開。

## Driving it with control-shuimei

Preconditions:

- `doctor` 通過。
- 不要點 LINE、`tel:` 或社群連結。helper 會拒絕，那不算常見問題已驗證。

- **導覽入口。** 執行 `browser open --path /`，再 `browser click --role link --name "常見問題"`。網址以 `/faq.html` 結尾，`browser wait --selector "#faq-title" --text "常見問題"`。
- **直接入口。** 執行 `browser open --path /faq.html`。同樣看得到標題「常見問題」。
- **錨點入口。** 執行 `browser open --path "/faq.html#faq-walkin"`。`browser attr --selector "#faq-walkin" --name open` 必須成功，值是空字串，代表 `open` 屬性在。接著 `browser text --selector "#faq-walkin"` 含「請先訂位再出發」。
- **展開題目。** 從收合的 `/faq.html` 執行 `browser click --selector "#faq-walkin > summary"`。`browser attr --selector "#faq-walkin" --name open` 再次成功。展開前這個屬性指令會失敗。
- **回預約。** 執行 `browser click --role link --name "線上預約"`。首頁 `#formTitleText` 是 `內用訂位`。
- **證明。** 在題目展開後執行 `browser snapshot --aria --path faq/walkin.aria.txt`、`browser screenshot --path faq/walkin.png`、`network --expect-no-booking`。快照要有「常見問題」與「請先訂位再出發」。

## Gotchas

- 「常見問題」連結有兩處（頁首、頁尾）。helper 會點無障礙樹裡較短名稱的第一個相符項。點完必須看網址是 `/faq.html`，不能只看按鈕按下去。
- 這份頁面的無障礙樹把題目露出成 statictext，沒有 button 角色。`browser click --role button --name "需要預約嗎？…"` 會失敗。用 `#faq-walkin > summary`。
- `browser text` 在題目收合時也讀得到答案，因為文字仍在 DOM。展開與否只看 `open` 屬性在不在。
- `#faq-walkin` 從錨點進來時，頁面腳本會把 `details` 打開。沒有帶 hash 的直接進入不會自動展開。
- 常見問題頁的 LINE 與電話不是這條的通過條件。
