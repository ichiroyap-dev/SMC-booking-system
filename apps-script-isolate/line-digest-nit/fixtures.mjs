// Offline fixtures for the 2026-09-27 digest translator NITs.
// Names are placeholders (測試甲…), not real guests. No phone numbers or order ids.

export const PHRASEBOOK = {
  "花生過敏": "alergi kacang",
  "不要辣": "tidak pedas",
  "小孩椅": "kursi anak",
  "不要香菜": "tanpa daun ketumbar",
  "少鹽": "sedikit garam",
  "生日": "ulang tahun",
  "不要葱": "tanpa daun bawang",
  "桶仔雞2隻": "ayam tong 2 ekor",
  "雞湯1份": "sup ayam 1 porsi",
  "9大3小": "9 dewasa 3 anak",
  "啤酂10箱要冰": "bir 10 kotak harus dingin",
  "12點到": "tiba pukul 12",
  "２份": "2 porsi",
  "要VIP桌": "minta meja VIP",
  "靠窗": "dekat jendela",
  "花生過敏 | 靠窗": "alergi kacang | dekat jendela",
  "2隻雞": "2 ekor ayam",
  "300份": "300 porsi",
  "12:30到": "tiba 12:30",
  "訂金": "uang muka",
  "尾款": "sisa pembayaran",
  "加桌": "tambah meja",
};

// Same shape appendSessionBlock_ / buildDigestText_ consume. Not sheet rows.
export const MIXED_DAY = {
  day: "Sun",
  date: "2026-10-11",
  time: "09:05",
  lunch: [
    {
      source: "內用",
      name: "測試甲先生",
      peopleToken: "(6)",
      time: "11:30",
      tables: 2,
      remarkStr: "花生過敏；不要辣 (小孩椅)",
    },
    {
      source: "內用",
      name: "測試乙小姐",
      peopleToken: "(4)",
      time: "12:00",
      tables: 1,
      remarkStr: "",
    },
    {
      source: "外帶",
      name: "測試丙",
      peopleToken: "(5k1a)",
      time: "11:00",
      tables: 1,
      remarkStr: "5k1a",
    },
  ],
  dinner: [
    {
      source: "內用",
      name: "測試丁先生",
      peopleToken: "(10)",
      time: "18:00",
      tables: 1,
      remarkStr: "不要香菜、少鹽",
    },
    {
      source: "內用",
      name: "測試戊",
      peopleToken: "人數待確認",
      time: "19:00",
      tables: null,
      remarkStr: "",
    },
    {
      source: "外帶",
      name: "測試己",
      peopleToken: "",
      time: "17:30",
      tables: 1,
      remarkStr: "",
    },
  ],
};

function dine(time, name, people, remark, tables) {
  return {
    source: "內用",
    name: name,
    peopleToken: people,
    time: time,
    tables: tables == null ? 1 : tables,
    remarkStr: remark,
  };
}

function take(time, name, remark) {
  return {
    source: "外帶",
    name: name,
    peopleToken: "",
    time: time,
    tables: 1,
    remarkStr: remark,
  };
}

// 9 dine-in + 3 takeout. Repeated remarks must collapse to one LanguageApp call each.
export const BUSY_DAY = {
  day: "Sun",
  date: "2026-10-11",
  time: "09:05",
  lunch: [
    dine("11:00", "測試01先生", "(4)", "花生過敏；不要辣 (小孩椅)"),
    dine("11:10", "測試02先生", "(2)", "花生過敏"),
    dine("11:20", "測試03小姐", "(3)", "桶仔雞2隻、雞湯1份"),
    dine("11:30", "測試04", "(8)", "9大3小"),
    dine("11:40", "測試05先生", "(5)", "不要辣"),
  ],
  dinner: [
    dine("17:30", "測試06", "(2)", ""),
    dine("17:40", "測試07", "(5k1a)", "5k1a"),
    dine("18:00", "測試08先生", "(6)", "啤酂10箱要冰"),
    dine("18:10", "測試09小姐", "(4)", "12點到"),
    take("17:00", "外帶01", "桶仔雞2隻、雞湯1份"),
    take("17:20", "外帶02", "２份"),
    take("17:50", "外帶03", "要VIP桌,不要香菜"),
  ],
};

export const BUSY_DAY_CALLS = [
  "啤酂10箱要冰",
];

export const HEADING_CASES = [
  ["🍽️ 內用 (共 0 桌)", "🍽️ Makan di tempat (total 0 meja)"],
  ["🍽️ 內用 (共 3 桌)", "🍽️ Makan di tempat (total 3 meja)"],
  ["🍽️ 內用 (共 2 筆，桌數待確認)", "🍽️ Makan di tempat (total 2 pesanan, jumlah meja menunggu konfirmasi)"],
  ["🍽️ 內用 (共 4 桌，另 1 筆桌數待確認)", "🍽️ Makan di tempat (total 4 meja, 1 pesanan jumlah meja menunggu konfirmasi)"],
  ["🥡 外帶 (共 0 筆)", "🥡 Bawa pulang (total 0 pesanan)"],
  ["🥡 外帶 (共 5 筆)", "🥡 Bawa pulang (total 5 pesanan)"],
  ["☀️ 午餐", "☀️ Makan Siang"],
  ["☀️ 午餐 (共 3 桌)", "☀️ Makan Siang (total 3 meja)"],
  ["🌙 晚餐 (共 2 筆，桌數待確認)", "🌙 Makan Malam (total 2 pesanan, jumlah meja menunggu konfirmasi)"],
  ["(總計 內用 3 桌＋外帶 2 筆)", "(Total makan di tempat 3 meja + bawa pulang 2 pesanan)"],
  ["(總計 內用 4 桌，另 1 筆桌數待確認＋外帶 2 筆)", "(Total makan di tempat 4 meja, 1 pesanan jumlah meja menunggu konfirmasi + bawa pulang 2 pesanan)"],
  ["(總計 內用 2 筆桌數待確認＋外帶 0 筆)", "(Total makan di tempat 2 pesanan, jumlah meja menunggu konfirmasi + bawa pulang 0 pesanan)"],
];
