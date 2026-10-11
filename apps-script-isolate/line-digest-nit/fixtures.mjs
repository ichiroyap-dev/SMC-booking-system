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
