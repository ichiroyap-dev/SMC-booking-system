# 真實 LanguageApp 驗收清單

NO_DEPLOY。這是部署前要在獨立測試專案做的清單，不是授權。不要執行主通知、不要發送、不要寫表、不要 clasp push。

離線 stub 通過不能代替這份清單。金額 token 留著，也不等於印尼文語意已通過。

上一輪真實驗收（邏輯 `bba9868`，63 例、101 次真實呼叫）沒有通過，不能部署。金額與方案代碼都還在，但：

- Google 會拿掉私用區記號。31 個帶 token 的例子全部整段退回中文。
- 維護提醒按逗號切開後，條件與指示會掉（F-1 方案 b 的預設條件已成立）。
- 短句會被補上句點，接起來變成 `Jangan mulai., Beri…`、`didinginkan.; Jangan…`。
- 常見備註譯錯：不要辣、份、筊白筍、不要X、不能吃／可以吃、N點到。

下面四項已寫進隔離稿。`64beb6f` 已經用真實 LanguageApp 跑過，沒有全部通過。新 head 還沒有重跑真實 LanguageApp，所以仍然不能部署。

## `64beb6f` 真實跑（已執行，不是全部通過）

- head：`64beb6f81dc051da230fe8173da88632e2daad45`
- 候選 SHA-256：`63030ceb32a8913a5ce9108718595f4feb18cf3a7b9dca5c159380fde26e45f0`
- 測試專案 scriptId：`1TpVd9u-MYwkRGHdU2m9TwaHtCq1QUGByMS7eIIGOMrXVTA4cOT0CvlnK`
- 121 例、53 次呼叫、約 0.66 秒、訊息 1,920 字。這是單次樣本，不是一般上限。

沒有通過的項目：

- F-A `不要辣、靠窗` 整段送翻，回傳 `Dilarang makan makanan pedas di dekat jendela`（把不辣和靠窗併成一件事）。
- F-C `烤雞不要辣` 回傳 `Ayam panggang, tanpa bumbu`（把不辣譯成不要調味料）。
- F-E `山藥雞湯米粉換筊白筍` 回傳 `Sup ubi dan ayam dengan mi beras, diganti dengan kastanye air dan rebung`（筊白筍被譯成別的蔬菜）。
- F-D `不吃牛` 回傳 `Jangan makan daging sapi`。
- F-B `不要奶油` 回傳 `Tidak ada krim`，`不要冰` 回傳 `Tidak ada es`。`不要蝦仁`、`不要雞皮` 也整段送翻。
- F-F `訂金$1,000、尾款$2,000已付` 的「已付」只掛在尾款，不擴到訂金。維持這個讀法。

這份裁示不能沿用到修改後的 head。字串非空、沒有 token、沒有服務錯誤，都不算語意通過。

## 測試環境

獨立測試 Apps Script，只呼叫這三個函式：

- `translateTaskCnToId`
- `translateNoteCnToId`
- `buildDailyReminderMessage_`

不執行主通知、不送 LINE、不寫試算表。

保存三樣東西：送進 `LanguageApp.translate` 的原文、回傳、最終輸出。

## 金額

金額與方案代碼在送翻前切開。只把中文片段送進 LanguageApp，再照原順序接回來源 token。不把 token 或私用區記號送出去。

六個入口都測：B 欄備註、總覽整行 fallback、C 欄一般翻譯、固定大組警示加尾段、純外帶警示加尾段、舊「今日預約正常」句加尾段。

各測 `$1,000`、`NT$12,000`、`$1,000.50`。來源 token 要逐字留下、只出現一次、留在自己那一段，不改千分位，也不自行補幣別。原文若是全形逗號，就保留全形逗號。`$500,2隻雞` 的逗號不是千分位，數量要分開。

請求正文不得含 `$`、`NT$`、`Rp`，也不得含方案代碼。

多段 `訂金$1,000已付；尾款NT$12,000元；找零$1,000.50已付`，以及單段 `訂金$1,000尾款$2,000`。核對已付／未付，以及每個金額的位置。不能出現誤導的 `Rp` 或其他幣別。審查樣本裡的 `Rp` 不是真實 Google 行為，不能當成品質通過。

某段任一個中文片段失敗（空、仍是中文、含 `$`／`NT$`／`Rp`、或配額），整段留原文。整行維護提醒則整句留原文。token 由程式接回，不靠譯文自己帶回來。

## 方案代碼

`加點5k1a一份` 預期 `tambah 5k1a 1 porsi`。`不要5k1a改成6k1a` 預期 `ganti 5k1a menjadi 6k1a`。`5k1a；花生過敏` 仍是兩段。取消與改用不能混在一起。代碼本身不得出現在請求正文。吃不滿的代碼句（例如只有 `加點5k1a`）整段留中文。

## 維護提醒（F-1，已改為方案 b）

店務維護提醒整句翻一次，不按逗號切開。金額仍先切走。完整性失敗就整句留原文，不留半句翻譯。

用真實 LanguageApp 重跑至少這兩則，並對照整句語意：

- `清洗製冰機，下午三點前完成，並拍照回報`
- `若發現漏水，不要啟動，先通知店長`

條件的作用範圍、順序、期限、否定和回報要求必須一致。沒有金額、對照也吃不滿的整句，送一次。整句能被對照吃滿（例如 `訂金$1,000已付`）就不送。有金額卻吃不滿，整句留中文，不把金額兩側拆開送。同一句若走備註或 C 欄、被逗號切開，只要其中一段因範圍留中文（例如「不要啟動」），整句都留中文、不送。整行維護提醒不切開，所以這句仍整句送一次。

## 句尾標點

Google 常在短譯文後面加 `.`。每個片段在接回去之前，若來源片段不是以句點、驚嘆號或問號結尾，就拿掉譯文尾端多出來的 `.。!！?？`。

用短維護句與備註確認不會再出現 `.,` 或 `.;`。來源本身有句號時，譯文的句號要留下。

## 固定對照（整段吃滿才用）

`REMARK_PHRASES_` 第三欄 `true` 表示印尼文還要店裡員工確認。改表只改那一個陣列。比對是整詞，長的先吃；同一長度時，表內整詞優先於開放句型。

對照和句型必須吃完這一段（金額、方案代碼、標點可以夾在中間）。「、」留在段內，不當分段符，也不把所有「、」拆開。吃不滿、又不是否定／過敏／換菜範圍問題，才整段送 LanguageApp。否定、過敏或換菜對不滿時，只把包含那一段的「；」項目留中文（項目裡的逗號仍綁在一起），同一備註的其他「；」項目照翻。這一段裡有金額或方案代碼、卻吃不滿，整段留中文，不送碎片。對照結果尾端的的了吧呢啊呀嘛哦喔拿掉。「嗎」是問句，不拿掉；`不要辣嗎` 整段送翻。整段只有「元」時留原文。整行維護提醒整句送翻，不套用「換」和句首「不要」的留中文規則。

列舉裡每個食材跟最近的頭（不能吃、不吃、不要、不要放、可以吃，以及不要辣、不要放辣、不吃辣、客人不要辣、不要太鹹、不要油炸、不要奶油這類完整否定詞）。否定和過敏可以跨過少鹽、靠窗、小孩椅、生日、已付。可以吃不能跨過否定、過敏或非食材（`可以吃X、少鹽、Y` 整段留中文）。有一項對不上，就留該「；」項目的中文。

句尾的。.!！先拿開，譯完再接回，最後一個食材的否定要留著。`不要辣、花生、雞蛋。` 是 `tidak pedas, tanpa kacang, tanpa telur.`。的了吧呢啊呀嘛哦喔不接回去，即使後面還有句號。問號和嗎不拿掉。對得上的問句把問號留在譯文上（`對花生、雞蛋過敏?` 是 `alergi kacang dan telur?`）。列舉因此對不上（`不要辣、花生、雞蛋?`、`不要辣、花生、雞蛋嗎`）就整段留中文。單獨的 `不要辣嗎` 仍整段送翻。

逗號（，和 ,）若把裸食材貼在否定、過敏、可以吃或「對」旁邊，或把「對…」和「…過敏」拆開，整個「；」項目留中文。不猜共用範圍，也不把逗號改成頓號。`不要辣，花生`、`不能吃花生，蝦子`、`花生，蝦子過敏` 留中文。千分位逗號不切開。`不要辣、靠窗` 和 `不要辣，靠窗` 仍是兩件事。同一備註裡其他「；」項目照翻。

X過敏只包住那個詞。`可以吃雞、花生過敏` 是 `tamu bisa makan ayam, alergi kacang`。後面還有食材（`可以吃雞、花生過敏、蝦子`、`不要辣、花生過敏、香菜`）整段留中文，不把後面的食材收進 alergi。

### 表內整詞

| 中文 | 印尼文 | 要員工確認 |
| --- | --- | --- |
| 對蝦子過敏 | alergi udang | 否（沿用目前正確譯法） |
| 花生過敏 | alergi kacang | 否（沿用目前正確譯法） |
| 不要香菜 | tanpa daun ketumbar | 否 |
| 不要葱 / 不要蔥 | tanpa daun bawang | 否 |
| 不要油炸 | jangan digoreng | 否 |
| 不要辣 | tidak pedas | 否 |
| 不要奶油 | tanpa mentega | 是 |
| 不要蝦仁 | tanpa udang kupas | 是 |
| 不要雞皮 | tanpa kulit ayam | 是 |
| 不要冰 | tanpa es | 是 |
| 客人不要辣 | tamu minta tidak pedas | 是 |
| 不要放辣 | jangan pakai cabai | 是 |
| 不要太鹹 | jangan terlalu asin | 是 |
| 不吃辣 | tamu tidak makan pedas | 是 |
| 海鮮 | makanan laut | 是 |
| 蔥花 | daun bawang cincang | 是。完整詞，不切成蔥 |
| 蛋奶 | telur dan susu | 是 |
| 蒜 | bawang putih | 是 |
| 小孩椅 | kursi anak | 否 |
| 兒童椅 | kursi anak | 是 |
| 少鹽 | sedikit garam | 否 |
| 桶仔雞 | ayam tong | 是 |
| 筊白筍 | rebung air (jiaobai) | 是。茭白筍，水竹筍；不要譯成別的蔬菜 |
| 雞湯 | sup ayam | 是 |
| 素食 | makanan vegetarian | 是 |
| 米血 | kue darah beras (mi xue) | 是 |
| 小朋友 | anak | 是 |
| 幼兒 | balita | 是 |
| 大人 | dewasa | 是 |
| 生日 | ulang tahun | 否 |
| 今晚 | malam ini | 是 |
| 今天 | hari ini | 是 |
| 明天 | besok | 是 |
| 中午 | siang | 是 |
| 晚上 | malam | 是 |
| 靠窗 | dekat jendela | 否 |
| 要VIP桌 | minta meja VIP | 否 |
| 訂金 | uang muka | 是 |
| 尾款 | sisa pembayaran | 是 |
| 找零 | kembalian | 是 |
| 已付 | sudah dibayar | 否 |
| 未付 | belum dibayar | 否 |
| 加桌 | tambah meja | 是 |
| 香菜 | daun ketumbar | 否 |
| 花生 | kacang | 否 |
| 蝦子 | udang | 否 |
| 雞蛋 | telur | 是 |
| 牛肉 | daging sapi | 是 |
| 過敏 | alergi | 否 |
| 元 | （刪掉，不譯成 yuan；整段只有「元」時留原文） | 是 |

### 單字只當 X，不作自由配對

雞、牛、蛋、奶、蝦、葱、蔥不在句中單獨吃。只當下面句型的整個 X，而且 X 要收到該句型結尾。所以 `不要雞` 可以用。`不要奶油`、`不要蝦仁`、`不要雞皮`、`不要冰`、`不要蔥花` 是完整詞，不把單字放寬。`牛奶`、`奶奶生日`、`自備蛋糕`、`半隻土雞` 仍不切單字。`不要蔥花` 是 `tanpa daun bawang cincang`。蒜是完整的一字食材，只在列舉邊界收，不放進會切開長詞的單字表。

| 中文 | 印尼文 | 要員工確認 |
| --- | --- | --- |
| 雞 | ayam | 是 |
| 牛 | daging sapi | 是 |
| 蛋 | telur | 是 |
| 奶 | susu | 是 |
| 蝦 | udang | 否 |
| 葱 / 蔥 | daun bawang | 否 |

### 開放句型（必須收到段尾，或跟其他整詞一起吃完整段）

| 句型 | 印尼文 | 說明 |
| --- | --- | --- |
| N大M小 | N dewasa M anak | 人數用詞要員工確認。必須是完整的「N大M小」 |
| N大 / N小 | N dewasa / N anak | 只在段尾。`3大桌`、`提早3小時到`、`3大靠窗` 不成立 |
| N小朋友 / N幼兒 / N大人 | N anak / N balita / N dewasa | 同上，人數用詞要確認 |
| N份 | N porsi | 不要再譯成 eksemplar |
| N隻 | N ekor | |
| N點到 / H:MM到 | tiba jam N | 要留下「到」 |
| 不能吃X / 不能吃X、Y | tamu tidak bisa makan X / tamu tidak bisa makan X dan Y | 否定管到每一項。`不能吃花生、蝦子` 是 kacang dan udang。非食材後面的食材重新說一次、不加第二個 tamu：`不能吃花生、靠窗、香菜` 是 `tamu tidak bisa makan kacang, dekat jendela, tidak bisa makan daun ketumbar` |
| 可以吃X / 可以吃X、Y | tamu bisa makan X / tamu bisa makan X dan Y | 不可加 tidak。後面換了頭，食材跟新頭：`可以吃雞、不能吃花生、蝦子` 是 `tamu bisa makan ayam, tamu tidak bisa makan kacang dan udang`。可以吃不能跨過非食材，`可以吃花生、少鹽、蝦子` 留中文 |
| 不要放X / 不要放X、Y | jangan pakai X / jangan pakai X, jangan pakai Y | 每一項都重複 jangan pakai |
| 不吃X / 不吃X、Y | tamu tidak makan X / tamu tidak makan X dan Y | 不混用 tanpa。要員工確認 |
| 不要X | tanpa X | 不要譯成 Tidak ada X。X 收在段尾 |
| 對X過敏 / 對X和Y過敏 / 對X、Y過敏 | alergi X / alergi X dan Y | 「、」與「和」都接 dan。整詞優先。`過敏` 不能先被吃掉。夾著非食材時食材仍是 alergi：`對花生、少鹽過敏` 是 `alergi kacang, sedikit garam`。沒有食材的 `對少鹽過敏` 留中文 |
| X過敏 | alergi X | `蝦子過敏` 是 alergi udang，不是 udang alergi。花生過敏等整詞優先。只包住這個詞；後面還有食材就整段留中文，例如 `不要辣、花生過敏、香菜` |
| X、Y過敏 / X和Y過敏 / XY過敏 | alergi X dan Y | 沒有「對」也要整串食材都標成過敏。`花生、蝦子過敏`、`花生蝦子過敏` 都是 alergi kacang dan udang。`花生、蒜過敏` 是 alergi kacang dan bawang putih。中間吃不滿（例如靠窗）整段留中文，不可只標最後一項 |
| 不要X、Y、Z | tanpa X, tanpa Y, tanpa Z | 後面的食材各自帶 tanpa。`不要香菜、蔥` 是 `tanpa daun ketumbar, tanpa daun bawang`。少鹽仍是 `sedikit garam`，不加 tanpa |
| 不要辣、花生 / 不要油炸、花生 | tidak pedas, tanpa kacang / jangan digoreng, tanpa kacang | 完整否定詞後面的每個食材都要排除。`不要辣、蝦子`、`不要辣、香菜` 相同。對不滿就整段留中文 |
| 不要辣、靠窗 | tidak pedas, dekat jendela | 非食材用自己的完整詞，不加 tanpa。它後面的食材仍要帶極性：`不要油炸、少鹽、香菜` 是 `jangan digoreng, sedikit garam, tanpa daun ketumbar`；`不要辣、花生、少鹽、蝦子` 是 `tidak pedas, tanpa kacang, sedikit garam, tanpa udang`；`不吃辣、少鹽、花生` 是 `tamu tidak makan pedas, sedikit garam, tanpa kacang`；`不要放花生、少鹽、香菜` 是 `jangan pakai kacang, sedikit garam, jangan pakai daun ketumbar`。單獨的 `不要小孩椅` 仍留中文。兩個緊鄰的對照詞中間補 `, `：`不要辣不要香菜` 是 `tidak pedas, tanpa daun ketumbar`。訂金／尾款接已付、未付不加逗號：`訂金已付` 是 `uang muka sudah dibayar`，`尾款未付` 是 `sisa pembayaran belum dibayar` |
| X不要辣 | X tidak pedas | X 只能是表內菜色（桶仔雞、雞湯、筊白筍、米血、素食）。`烤雞不要辣` 留中文 |
| 不吃X | tamu tidak makan X | X 是食材。`不吃牛`、`不吃花生` 成立。`不吃雞皮` 留中文。要員工確認 |
| 換X / A換B | ganti dengan X / ganti A dengan B | A、B、X 都要是表內整詞。`雞湯換筊白筍`、`換筊白筍` 成立。`山藥雞湯米粉換筊白筍` 留中文 |
| 不要A改成B | ganti A menjadi B | A、B 是方案代碼或金額，照原文接回 |
| 加點A一份 | tambah A 1 porsi | A 是方案代碼或金額 |
| 訂金X / 訂金X已付 / 訂金X未付 | uang muka X / … sudah dibayar / … belum dibayar | 整行維護提醒也用 |
| 尾款X / 尾款X已付 / 尾款X未付 | sisa pembayaran X，已付未付同上 | |
| 找零X / 找零X已付 / 找零X未付 | kembalian X，已付未付同上 | |

X 若對不到表，這句型就不成立。否定、過敏、換菜對不滿時整段留中文，不送 LanguageApp。其他整段吃不滿、又沒有金額或代碼，才整段送 LanguageApp。有金額或代碼卻吃不滿，整段留中文。`訂金$1,000、尾款$2,000已付` 的已付只接在尾款，不擴到訂金。

## 混合警示

固定警示和尾段之間的換行可能變成 `; `。固定句不在開頭時改走機翻。C 欄翻譯失敗時，中文標點仍會被正規化。這些要看完整語意，不能只因為金額還在就判定整句正確。

另外測：大組警示加換行再加金額、金額在前而警示在後、純外帶再加另一則警示、舊格式「包含12人」、C 欄多行與標點。整則訊息要完整，員工要看得懂。

## 原清單保留

品項數量、9 大 3 小、啤酒與時間、`$500,2隻雞`、`不要辣,300份`、`|` 與括號、純英文、空備註、原文 `{{0}}`、過敏與否定。

另測：不要辣、不要花生、不要放香菜、不能吃／可以吃、筊白筍、N份、N點到、不要A改成B、加點A一份、訂金／尾款／找零。確認長詞不會被短詞蓋掉，否定沒有被反過來，單字不會切開複合詞。

## 私用區

不再把私用區記號送進 LanguageApp。上一輪 31/31 被拿掉，所以不能再靠它保護金額。

驗收時確認每一筆請求都沒有 U+E000、U+E001。來源備註裡若本來就有私用區字元，輸出要原樣留下，而且該字元不得出現在請求裡。

## 完整忙日

分開記錄 B 欄與 C 欄的呼叫數、實際耗時、雙語總長度。離線忙日樣本現在只剩 1 次（`啤酒10箱要冰`），因為其餘備註已被對照吃掉。這不是所有忙日的上限。

C 欄傳 null cache，沒有整欄配額停止旗標。每日配額錯誤之後，每個尚未被對照吃掉、沒有金額、而且不是沒對上的否定或過敏的整段仍可能再呼叫一次；不重試、不暫停。有金額卻吃不滿的段不送。否定或過敏對不滿的段也不送。忙日驗收要把實際送出的呼叫算進去。

每日配額、短時間限流，以及 token 刪除、錯號、複製，繼續用 stub。不要故意耗光真實額度。

## 長度與耗時

保存完整雙語長度與實際耗時。LINE 單則 text 上限 5,000。Apps Script 一般執行限制目前是 6 分鐘，要留下餘裕。
