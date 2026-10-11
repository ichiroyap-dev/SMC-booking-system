#!/usr/bin/env node
// Offline checks for the 2026-09-27 LINE digest Indonesian NITs.
// Stubs LanguageApp. Does not read sheets, send LINE, or touch a live script.
// Usage: node apps-script-isolate/line-digest-nit/test-offline.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { BUSY_DAY, BUSY_DAY_CALLS, HEADING_CASES, MIXED_DAY, PHRASEBOOK } from "./fixtures.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const originalRemind = join(root, "original", "LineDailyRemind.gs");
const originalSync = join(root, "original", "DailyBookingSync.gs");
const modifiedRemind = join(root, "LineDailyRemind.gs");

const CJK = /[\u4e00-\u9fff]/;
const failures = [];
const ok = (cond, message) => {
  if (!cond) failures.push(message);
};

function makeLanguageApp(calls) {
  return {
    translate(text, from, to) {
      calls.push({ text: String(text), from, to });
      const raw = String(text);
      if (Object.prototype.hasOwnProperty.call(PHRASEBOOK, raw)) return PHRASEBOOK[raw];
      const keys = Object.keys(PHRASEBOOK).sort((a, b) => b.length - a.length);
      let out = raw;
      for (const key of keys) {
        if (out.indexOf(key) !== -1) out = out.split(key).join(PHRASEBOOK[key]);
      }
      return out === raw ? "ID:" + raw : out;
    },
  };
}

function loadGs(file, languageApp) {
  const sleeps = [];
  const context = vm.createContext({
    LanguageApp: languageApp,
    Utilities: {
      sleep(ms) {
        sleeps.push(ms);
      },
    },
    console,
  });
  context.__sleeps = sleeps;
  vm.runInContext(readFileSync(file, "utf8"), context, { filename: file });
  return context;
}

const newCalls = [];
const oldCalls = [];
const fixed = loadGs(modifiedRemind, makeLanguageApp(newCalls));
const previous = loadGs(originalRemind, makeLanguageApp(oldCalls));
const sync = loadGs(originalSync, makeLanguageApp([]));

function resetCalls() {
  newCalls.length = 0;
  oldCalls.length = 0;
}

function assertNoCjk(label, text) {
  ok(!CJK.test(text), label + " still has Chinese: " + text);
  ok(text.indexOf("共") === -1, label + " still has 共: " + text);
}

// --- NIT1: headings and count lines ---
resetCalls();
for (const [input, expected] of HEADING_CASES) {
  const got = fixed.translateTaskCnToId(input);
  ok(got === expected, "heading\n  in:  " + input + "\n  got: " + got + "\n  want:" + expected);
  assertNoCjk("heading " + input, got);
}
ok(newCalls.length === 0, "headings must not call LanguageApp, calls=" + newCalls.length);

// Snapshot still has the leftover character, so this isolate is the fix.
const originalSrc = readFileSync(originalRemind, "utf8");
ok(originalSrc.indexOf('Bawa pulang (共 "') !== -1, "original snapshot missing leftover 共 in takeout heading");
const modifiedSrc = readFileSync(modifiedRemind, "utf8");
ok(modifiedSrc.indexOf('Bawa pulang (共 "') === -1, "modified takeout heading still contains 共");
ok(modifiedSrc.indexOf(' (共 "') === -1, "modified heading builder still contains 共");

// --- NIT2: multi-segment remark ---
resetCalls();
const multiIn = "11:30 測試甲先生 (6) | 備註：花生過敏；不要辣 (小孩椅)";
const multiWant = "11:30 Bapak 測試甲 (6) | Catatan: alergi kacang; tidak pedas (kursi anak)";
const multiGot = fixed.translateTaskCnToId(multiIn);
ok(multiGot === multiWant, "multi-segment\n  got:  " + multiGot + "\n  want: " + multiWant);
ok(
  JSON.stringify(newCalls.map((c) => c.text)) === JSON.stringify(["花生過敏", "不要辣", "小孩椅"]),
  "multi-segment calls: " + JSON.stringify(newCalls),
);
ok(newCalls.every((c) => c.from === "zh-TW" && c.to === "id"), "LanguageApp locale drifted");
ok(multiGot.indexOf("; ") !== -1 && multiGot.indexOf(" (") !== -1, "separators dropped: " + multiGot);
ok(multiGot.indexOf("；") === -1 && multiGot.indexOf("、") === -1, "Chinese punctuation left in remark: " + multiGot);
const multiTail = multiGot.split("Catatan: ")[1] || "";
assertNoCjk("multi-segment tail", multiTail);

resetCalls();
const listIn = "18:00 測試丁先生 (10) | 備註：不要香菜、少鹽";
const listGot = fixed.translateTaskCnToId(listIn);
ok(
  listGot === "18:00 Bapak 測試丁 (10) | Catatan: tanpa daun ketumbar, sedikit garam",
  "enumeration remark: " + listGot,
);
ok(
  JSON.stringify(newCalls.map((c) => c.text)) === JSON.stringify(["不要香菜", "少鹽"]),
  "enumeration calls: " + JSON.stringify(newCalls),
);

resetCalls();
const amountIn = "12:10 測試甲先生 (8) | 備註：預估金額 $2,000 (生日；不要葱)";
const amountGot = fixed.translateTaskCnToId(amountIn);
ok(
  amountGot === "12:10 Bapak 測試甲 (8) | Catatan: Perkiraan biaya $2,000 (ulang tahun; tanpa daun bawang)",
  "amount + segments: " + amountGot,
);
ok(
  JSON.stringify(newCalls.map((c) => c.text)) === JSON.stringify(["生日", "不要葱"]),
  "amount calls should skip the already-replaced label: " + JSON.stringify(newCalls),
);
ok(newCalls.every((c) => c.text.indexOf("$") === -1 && c.text.indexOf("2,000") === -1), "amount leaked into LanguageApp: " + JSON.stringify(newCalls));

// One segment failing must not drop the others or the separators.
resetCalls();
const flaky = loadGs(modifiedRemind, {
  translate(text) {
    if (text === "不要辣") throw new Error("stub failure");
    return PHRASEBOOK[text] || ("ID:" + text);
  },
});
const flakyGot = flaky.translateTaskCnToId(multiIn);
ok(
  flakyGot === "11:30 Bapak 測試甲 (6) | Catatan: alergi kacang; 不要辣 (kursi anak)",
  "partial failure: " + flakyGot,
);

resetCalls();
const singleGot = fixed.translateTaskCnToId("11:40 測試甲先生 (6) | 備註：花生過敏");
ok(singleGot === "11:40 Bapak 測試甲 (6) | Catatan: alergi kacang", "single segment: " + singleGot);
ok(JSON.stringify(newCalls.map((c) => c.text)) === JSON.stringify(["花生過敏"]), "single segment calls: " + JSON.stringify(newCalls));

// --- empty remark: no LanguageApp ---
resetCalls();
const emptyGot = fixed.translateTaskCnToId("12:00 測試乙小姐 (4)");
ok(emptyGot === "12:00 Ibu 測試乙 (4)", "empty remark: " + emptyGot);
ok(newCalls.length === 0, "empty remark called LanguageApp: " + JSON.stringify(newCalls));
const emptyLabelGot = fixed.translateTaskCnToId("12:00 測試乙小姐 (4) | 備註：");
ok(emptyLabelGot === "12:00 Ibu 測試乙 (4) | Catatan:", "empty catatan label: " + JSON.stringify(emptyLabelGot));
ok(newCalls.length === 0, "empty catatan label called LanguageApp");

// --- plan code / numbers only ---
resetCalls();
const codeGot = fixed.translateTaskCnToId("11:00 測試丙 (5k1a) | 備註：5k1a");
ok(codeGot === "11:00 Bapak/Ibu 測試丙 (5k1a) | Catatan: 5k1a", "plan code: " + codeGot);
ok(newCalls.length === 0, "plan code was sent to LanguageApp: " + JSON.stringify(newCalls));
const digitsGot = fixed.translateTaskCnToId("11:05 測試丙 | 備註：12");
ok(digitsGot === "11:05 Bapak/Ibu 測試丙 | Catatan: 12", "digits only: " + digitsGot);
ok(newCalls.length === 0, "digits-only remark called LanguageApp");

resetCalls();
const mixedCodeGot = fixed.translateTaskCnToId("11:10 測試丙 (5k1a) | 備註：5k1a；花生過敏");
ok(
  mixedCodeGot === "11:10 Bapak/Ibu 測試丙 (5k1a) | Catatan: 5k1a; alergi kacang",
  "code beside Chinese: " + mixedCodeGot,
);
ok(
  JSON.stringify(newCalls.map((c) => c.text)) === JSON.stringify(["花生過敏"]),
  "code must not be part of the LanguageApp text: " + JSON.stringify(newCalls),
);

// --- mixed dine-in + takeout day, Chinese composer untouched ---
const chinese = sync.buildDigestText_(
  MIXED_DAY.day,
  MIXED_DAY.date,
  MIXED_DAY.time,
  MIXED_DAY.lunch,
  MIXED_DAY.dinner,
);
const chineseWant = [
  "[Sun 2026-10-11 09:05 GMT+8] [2026-10-11 預約總覽]",
  "☀️ 午餐",
  "",
  "🍽️ 內用 (共 3 桌)",
  "",
  "11:30 測試甲先生 (6) | 備註：花生過敏；不要辣 (小孩椅)",
  "",
  "12:00 測試乙小姐 (4)",
  "",
  "🥡 外帶 (共 1 筆)",
  "",
  "11:00 測試丙 (5k1a) | 備註：5k1a",
  "",
  "🌙 晚餐",
  "",
  "🍽️ 內用 (共 1 桌，另 1 筆桌數待確認)",
  "",
  "18:00 測試丁先生 (10) | 備註：不要香菜、少鹽",
  "",
  "19:00 測試戊 人數待確認",
  "",
  "🥡 外帶 (共 1 筆)",
  "",
  "17:30 測試己",
  "",
  "(總計 內用 4 桌，另 1 筆桌數待確認＋外帶 2 筆)",
].join("\n");
ok(chinese === chineseWant, "Chinese digest drifted:\n" + chinese);

resetCalls();
const indonesian = fixed.translateTaskCnToId(chinese);
const indonesianWant = [
  "[Minggu 11 Oktober 2026 09:05 GMT+8] [Ringkasan Reservasi 11 Oktober 2026]",
  "☀️ Makan Siang",
  "",
  "🍽️ Makan di tempat (total 3 meja)",
  "",
  "11:30 Bapak 測試甲 (6) | Catatan: alergi kacang; tidak pedas (kursi anak)",
  "",
  "12:00 Ibu 測試乙 (4)",
  "",
  "🥡 Bawa pulang (total 1 pesanan)",
  "",
  "11:00 Bapak/Ibu 測試丙 (5k1a) | Catatan: 5k1a",
  "",
  "🌙 Makan Malam",
  "",
  "🍽️ Makan di tempat (total 1 meja, 1 pesanan jumlah meja menunggu konfirmasi)",
  "",
  "18:00 Bapak 測試丁 (10) | Catatan: tanpa daun ketumbar, sedikit garam",
  "",
  "19:00 Bapak/Ibu 測試戊 Jumlah orang menunggu konfirmasi",
  "",
  "🥡 Bawa pulang (total 1 pesanan)",
  "",
  "17:30 Bapak/Ibu 測試己",
  "",
  "(Total makan di tempat 4 meja, 1 pesanan jumlah meja menunggu konfirmasi + bawa pulang 2 pesanan)",
].join("\n");
ok(indonesian === indonesianWant, "mixed day Indonesian drifted:\n" + indonesian);
ok(indonesian.indexOf("共") === -1, "mixed day Indonesian still contains 共");
for (const line of indonesian.split("\n")) {
  if (/Makan di tempat|Bawa pulang|Makan Siang|Makan Malam|^\(Total /.test(line)) {
    assertNoCjk("mixed heading", line);
  }
  const catatanAt = line.indexOf("Catatan:");
  if (catatanAt !== -1) assertNoCjk("mixed catatan", line.slice(catatanAt));
}
ok(
  JSON.stringify(newCalls.map((c) => c.text)) === JSON.stringify(["花生過敏", "不要辣", "小孩椅", "不要香菜", "少鹽"]),
  "mixed day LanguageApp calls: " + JSON.stringify(newCalls),
);
ok(chinese === sync.buildDigestText_(MIXED_DAY.day, MIXED_DAY.date, MIXED_DAY.time, MIXED_DAY.lunch, MIXED_DAY.dinner), "translator mutated the Chinese digest");

function remarkOf(line) {
  const at = line.indexOf("Catatan:");
  return at === -1 ? "" : line.slice(at);
}

function assertPieceCalls(label, line, wantCalls, wantTail) {
  resetCalls();
  const got = fixed.translateTaskCnToId(line);
  ok(remarkOf(got) === wantTail, label + "\n  got:  " + got + "\n  want: " + wantTail);
  ok(JSON.stringify(newCalls.map((c) => c.text)) === JSON.stringify(wantCalls), label + " calls: " + JSON.stringify(newCalls));
  ok(!/ayam2|2ekor|sup1|1porsi/.test(got), label + " glued qty: " + got);
  return got;
}

const qtyGot = assertPieceCalls(
  "qty inside Chinese",
  "11:00 外帶01 | 備註：桶仔雞2隻、雞湯1份",
  ["桶仔雞2隻", "雞湯1份"],
  "Catatan: ayam tong 2 ekor, sup ayam 1 porsi",
);
const partyGot = assertPieceCalls(
  "9大3小",
  "11:30 測試04 (8) | 備註：9大3小",
  ["9大3小"],
  "Catatan: 9 dewasa 3 anak",
);
const beerGot = assertPieceCalls(
  "qty mid-phrase",
  "18:00 測試08先生 (6) | 備註：啤酂10箱要冰",
  ["啤酂10箱要冰"],
  "Catatan: bir 10 kotak harus dingin",
);
const arriveGot = assertPieceCalls(
  "digits then Chinese",
  "18:10 測試09小姐 (4) | 備註：12點到",
  ["12點到"],
  "Catatan: tiba pukul 12",
);
const fwGot = assertPieceCalls(
  "full-width digits",
  "17:20 外帶02 | 備註：２份",
  ["２份"],
  "Catatan: 2 porsi",
);
const semiGot = assertPieceCalls(
  "half-width semicolon",
  "11:12 測試甲先生 (2) | 備註：不要辣;少鹽",
  ["不要辣", "少鹽"],
  "Catatan: tidak pedas; sedikit garam",
);
const commaGot = assertPieceCalls(
  "half-width comma",
  "11:13 測試甲先生 (2) | 備註：不要香菜,少鹽",
  ["不要香菜", "少鹽"],
  "Catatan: tanpa daun ketumbar, sedikit garam",
);
const vipGot = assertPieceCalls(
  "Chinese plus English",
  "17:50 外帶03 | 備註：要VIP桌,不要香菜",
  ["要VIP桌", "不要香菜"],
  "Catatan: minta meja VIP, tanpa daun ketumbar",
);
const pipeGot = assertPieceCalls(
  "pipe is a remark separator",
  "11:30 測試甲先生 (6) | 備註：花生過敏 | 靠窗",
  ["花生過敏", "靠窗"],
  "Catatan: alergi kacang | dekat jendela",
);

resetCalls();
const codeInPhrase = fixed.translateTaskCnToId("18:20 測試甲先生 (4) | 備註：靠窗5.5k9a");
ok(remarkOf(codeInPhrase) === "Catatan: dekat jendela 5.5k9a", "plan code phrase: " + codeInPhrase);
ok(newCalls.length === 1 && newCalls[0].text.indexOf("5.5k9a") === -1, "plan code was sent raw: " + JSON.stringify(newCalls));
ok(newCalls[0].text.indexOf("\uE000") !== -1, "plan code placeholder missing: " + JSON.stringify(newCalls[0].text));
ok(codeInPhrase.indexOf("5.5k9a") !== -1, "plan code not restored: " + codeInPhrase);

resetCalls();
const dropped = loadGs(modifiedRemind, {
  translate(text) {
    newCalls.push({ text: String(text), from: "zh-TW", to: "id" });
    return "dekat jendela";
  },
});
const droppedGot = dropped.translateTaskCnToId("18:20 測試甲先生 (4) | 備註：靠窗5.5k9a");
ok(remarkOf(droppedGot) === "Catatan: 靠窗5.5k9a", "lost placeholder must keep the original segment: " + droppedGot);
ok(droppedGot.indexOf("dekat jendela") === -1, "lost placeholder appended a translation: " + droppedGot);

resetCalls();
const newlineBody = fixed.translateRemarkBodyToId_("桶仔雞2隻\n雞湯1份", {});
ok(newlineBody === "ayam tong 2 ekor\nsup ayam 1 porsi", "newline split: " + JSON.stringify(newlineBody));

// Translator returns the Chinese unchanged, an empty string, or a trailing period.
resetCalls();
const unchangedApp = loadGs(modifiedRemind, {
  translate(text) {
    newCalls.push({ text: String(text) });
    return text;
  },
});
const unchangedGot = unchangedApp.translateTaskCnToId("11:30 測試04 (8) | 備註：9大3小");
ok(remarkOf(unchangedGot) === "Catatan: 9大3小", "unchanged translation: " + unchangedGot);
ok(newCalls.length === 1, "unchanged should call once: " + newCalls.length);

resetCalls();
const emptyApp = loadGs(modifiedRemind, {
  translate(text) {
    newCalls.push({ text: String(text) });
    return "";
  },
});
const emptyTransGot = emptyApp.translateTaskCnToId("11:30 測試04 (8) | 備註：9大3小");
ok(remarkOf(emptyTransGot) === "Catatan: 9大3小", "empty translation must keep Chinese: " + emptyTransGot);
ok(newCalls.length === 1, "empty translation should not retry: " + newCalls.length);
ok(emptyApp.__sleeps.length === 0, "empty translation slept: " + JSON.stringify(emptyApp.__sleeps));

resetCalls();
const periodApp = loadGs(modifiedRemind, {
  translate(text) {
    newCalls.push({ text: String(text) });
    return (PHRASEBOOK[text] || text) + ".";
  },
});
const periodGot = periodApp.translateTaskCnToId("11:40 測試甲先生 (6) | 備註：花生過敏");
ok(remarkOf(periodGot) === "Catatan: alergi kacang.", "trailing period stripped: " + periodGot);

resetCalls();
let retryN = 0;
const retryApp = loadGs(modifiedRemind, {
  translate(text) {
    retryN += 1;
    newCalls.push({ text: String(text) });
    if (retryN === 1) throw new Error("busy");
    return PHRASEBOOK[text] || ("ID:" + text);
  },
});
const retryGot = retryApp.translateTaskCnToId("11:40 測試甲先生 (6) | 備註：花生過敏");
ok(remarkOf(retryGot) === "Catatan: alergi kacang", "retry then success: " + retryGot);
ok(retryN === 2, "retry call count: " + retryN);
ok(JSON.stringify(retryApp.__sleeps) === JSON.stringify([250]), "retry pause: " + JSON.stringify(retryApp.__sleeps));

resetCalls();
let failN = 0;
const failApp = loadGs(modifiedRemind, {
  translate() {
    failN += 1;
    throw new Error("down");
  },
});
const failGot = failApp.translateTaskCnToId("11:40 測試甲先生 (6) | 備註：花生過敏");
ok(remarkOf(failGot) === "Catatan: 花生過敏", "final failure keeps Chinese: " + failGot);
ok(failN === 2, "final failure should try twice: " + failN);
ok(JSON.stringify(failApp.__sleeps) === JSON.stringify([250]), "generic error waits 250ms: " + JSON.stringify(failApp.__sleeps));

resetCalls();
const noteFail = loadGs(modifiedRemind, {
  translate() {
    newCalls.push({ text: "note" });
    throw new Error("down");
  },
});
const hiddenNote = noteFail.translateNoteCnToId("臨時改爐火");
ok(hiddenNote === "臨時改爐火", "note failure hid the warning: " + hiddenNote);
ok(noteFail.__sleeps.length === 1, "note failure pause: " + JSON.stringify(noteFail.__sleeps));
ok(noteFail.translateNoteCnToId("⚠️ 注意：包含 12 人大組訂位！") === "⚠️ Perhatian: Termasuk reservasi grup besar 12 orang!", "known warning drifted");
ok(noteFail.translateNoteCnToId("") === "Tidak ada keterangan", "empty note drifted");
ok(noteFail.translateNoteCnToId("無") === "Tidak ada keterangan", "無 note drifted");

const PH = (id) => "\uE000" + id + "\uE001";

resetCalls();
const multiAmt = fixed.translateTaskCnToId("12:00 測試甲先生 (4) | 備註：訂金$1,000；尾款$2,000");
ok(remarkOf(multiAmt) === "Catatan: uang muka $1,000; sisa pembayaran $2,000", "multiple amounts kept in segment: " + multiAmt);
ok(JSON.stringify(newCalls.map((c) => c.text)) === JSON.stringify(["訂金" + PH(0), "尾款" + PH(1)]), "multiple amounts calls: " + JSON.stringify(newCalls));
ok(multiAmt.indexOf("$1,000 $2,000") === -1 && multiAmt.indexOf("$1.000") === -1, "amounts were appended or reformatted: " + multiAmt);

resetCalls();
const lostAmt = loadGs(modifiedRemind, {
  translate(text) {
    newCalls.push({ text: String(text) });
    return String(text).replace("訂金", "uang muka").replace("尾款", "sisa pembayaran").replace(/\uE000\d+\uE001/g, "");
  },
});
const lostAmtGot = lostAmt.translateTaskCnToId("12:00 測試甲先生 (4) | 備註：訂金$1,000；尾款$2,000");
ok(remarkOf(lostAmtGot) === "Catatan: 訂金$1,000; 尾款$2,000", "multiple amounts lost stay in original segments: " + lostAmtGot);
ok(lostAmtGot.indexOf("uang muka") === -1 && lostAmtGot.indexOf("sisa pembayaran") === -1, "lost amounts kept a partial translation: " + lostAmtGot);
ok(lostAmtGot.indexOf("$1.000") === -1 && lostAmtGot.indexOf("$2.000") === -1, "lost amounts were reformatted: " + lostAmtGot);
ok(lostAmtGot.indexOf("$1, 000") === -1 && lostAmtGot.indexOf("$2, 000") === -1, "lost amounts were spaced inside the number: " + lostAmtGot);

resetCalls();
const multiCode = fixed.translateTaskCnToId("18:20 測試甲先生 (4) | 備註：靠窗5k1a；加桌5.5k9a");
ok(remarkOf(multiCode) === "Catatan: dekat jendela 5k1a; tambah meja 5.5k9a", "multiple plan codes kept: " + multiCode);
ok(newCalls.length === 2, "multiple plan codes call count: " + JSON.stringify(newCalls));
ok(newCalls.every((c) => c.text.indexOf("5k1a") === -1 && c.text.indexOf("5.5k9a") === -1), "plan codes sent raw: " + JSON.stringify(newCalls));

resetCalls();
const lostCode = loadGs(modifiedRemind, {
  translate(text) {
    return String(text).replace(/\uE000\d+\uE001/g, "");
  },
});
const lostCodeGot = lostCode.translateTaskCnToId("18:20 測試甲先生 (4) | 備註：靠窗5k1a；加桌5.5k9a");
ok(remarkOf(lostCodeGot) === "Catatan: 靠窗5k1a; 加桌5.5k9a", "multiple plan codes lost: " + lostCodeGot);

resetCalls();
const mangled = loadGs(modifiedRemind, {
  translate(text) {
    newCalls.push({ text: String(text) });
    if (String(text).indexOf("尾款") !== -1) return "sisa pembayaran \uE0009\uE001";
    return String(text).replace("訂金", "uang muka");
  },
});
const mangledGot = mangled.translateTaskCnToId("12:00 測試甲先生 (4) | 備註：訂金$1,000；尾款$2,000");
ok(remarkOf(mangledGot) === "Catatan: uang muka $1,000; 尾款$2,000", "mangled placeholder falls back: " + mangledGot);
ok(mangledGot.indexOf("\uE000") === -1, "mangled sentinel leaked: " + mangledGot);

resetCalls();
const duplicated = loadGs(modifiedRemind, {
  translate(text) {
    const raw = String(text);
    if (raw.indexOf("尾款") !== -1) return raw + raw;
    return raw.replace("訂金", "uang muka");
  },
});
const duplicatedGot = duplicated.translateTaskCnToId("12:00 測試甲先生 (4) | 備註：訂金$1,000；尾款$2,000");
ok(remarkOf(duplicatedGot) === "Catatan: uang muka $1,000; 尾款$2,000", "duplicated placeholder falls back: " + duplicatedGot);
ok((duplicatedGot.match(/\$2,000/g) || []).length === 1, "duplicated amount was repeated: " + duplicatedGot);
ok(duplicatedGot.indexOf("$1,000 $2") === -1 && duplicatedGot.indexOf("$1.000") === -1, "duplicated token was appended or reformatted: " + duplicatedGot);

const qtyAmountGot = assertPieceCalls(
  "amount regex does not swallow quantity",
  "11:00 外帶01 | 備註：$500,2隻雞",
  ["2隻雞"],
  "Catatan: $500, 2 ekor ayam",
);
ok(qtyAmountGot.indexOf("$500,2") === -1, "quantity stayed inside the amount: " + qtyAmountGot);

resetCalls();
const literalBrace = fixed.translateTaskCnToId("12:00 測試甲先生 (2) | 備註：見{{0}}；$1,000");
ok(literalBrace.indexOf("{{0}}") !== -1, "literal {{0}} is not a placeholder: " + literalBrace);
ok(literalBrace.indexOf("$1,000") !== -1 && literalBrace.indexOf("$1.000") === -1, "literal brace case changed the amount: " + literalBrace);
ok(literalBrace.indexOf("{{$1") === -1 && literalBrace.indexOf("{{1") === -1, "literal {{0}} was overwritten: " + literalBrace);

resetCalls();
const sentinelApp = loadGs(modifiedRemind, {
  translate(text) {
    newCalls.push({ text: String(text) });
    return String(text).replace("標記", "tanda");
  },
});
const sentinelGot = sentinelApp.translateTaskCnToId("12:00 測試甲先生 (2) | 備註：標記\uE000；$1,000");
ok(remarkOf(sentinelGot) === "Catatan: tanda\uE000; $1,000", "source sentinel collided with placeholder: " + JSON.stringify(sentinelGot));

const commaQtyGot = assertPieceCalls(
  "comma before quantity is spaced",
  "11:00 外帶01 | 備註：不要辣,300份",
  ["不要辣", "300份"],
  "Catatan: tidak pedas, 300 porsi",
);
ok(commaQtyGot.indexOf(",300") === -1, "comma glued to 300: " + commaQtyGot);

const timeGot = assertPieceCalls(
  "fullwidth time colon stays 12:30",
  "18:10 測試09小姐 (4) | 備註：12：30到",
  ["12:30到"],
  "Catatan: tiba 12:30",
);
ok(timeGot.indexOf("12: 30") === -1 && timeGot.indexOf("12：30") === -1, "time colon was broken: " + timeGot);
resetCalls();
const bareTime = fixed.translateTaskCnToId("18:11 測試09小姐 (4) | 備註：12：30");
ok(remarkOf(bareTime) === "Catatan: 12:30", "bare fullwidth time: " + bareTime);
ok(newCalls.length === 0, "bare time called LanguageApp: " + JSON.stringify(newCalls));

resetCalls();
const slashGot = fixed.translateTaskCnToId("11:00 外帶01 | 備註：不要辣/少鹽");
ok(newCalls.length === 1 && newCalls[0].text === "不要辣/少鹽", "slash is not a separator: " + JSON.stringify(newCalls));
ok(remarkOf(slashGot) === "Catatan: tidak pedas/sedikit garam", "slash remark: " + slashGot);

resetCalls();
const spaceGot = fixed.translateTaskCnToId("11:00 外帶01 | 備註：不要辣 少鹽");
ok(newCalls.length === 1 && newCalls[0].text === "不要辣 少鹽", "whitespace is not a separator: " + JSON.stringify(newCalls));
ok(remarkOf(spaceGot) === "Catatan: tidak pedas sedikit garam", "spaced remark: " + spaceGot);

resetCalls();
let quotaN = 0;
const quotaApp = loadGs(modifiedRemind, {
  translate() {
    quotaN += 1;
    throw new Error("Service invoked too many times for one day: translate");
  },
});
const quotaGot = quotaApp.translateTaskCnToId("12:00 測試甲先生 (4) | 備註：訂金$1,000；尾款$2,000");
ok(remarkOf(quotaGot) === "Catatan: 訂金$1,000; 尾款$2,000", "daily quota skips retry: " + quotaGot);
ok(quotaN === 1, "daily quota should not call the second segment or retry: " + quotaN);
ok(quotaApp.__sleeps.length === 0, "daily quota slept: " + JSON.stringify(quotaApp.__sleeps));

resetCalls();
let shortN = 0;
const shortApp = loadGs(modifiedRemind, {
  translate() {
    shortN += 1;
    throw new Error("Service invoked too many times in a short time: translate");
  },
});
const shortGot = shortApp.translateTaskCnToId("11:40 測試甲先生 (6) | 備註：花生過敏");
ok(remarkOf(shortGot) === "Catatan: 花生過敏", "short-time limit still falls back after retry: " + shortGot);
ok(shortN === 2, "short-time limit should retry once: " + shortN);
ok(JSON.stringify(shortApp.__sleeps) === JSON.stringify([1000]), "short-time waits 1000ms: " + JSON.stringify(shortApp.__sleeps));

function noBrokenAmount(text) {
  return (
    text.indexOf("$1, 000") === -1 &&
    text.indexOf("$2, 000") === -1 &&
    text.indexOf("NT$12, 000") === -1 &&
    text.indexOf("$1, 000.50") === -1 &&
    text.indexOf("$1.000") === -1 &&
    text.indexOf("$2.000") === -1 &&
    text.indexOf("$1.000.50") === -1
  );
}

function amountLine(remark) {
  return "12:00 測試甲先生 (4) | 備註：" + remark;
}

function amountApp(mode, counter) {
  return loadGs(modifiedRemind, {
    translate(text) {
      counter.n += 1;
      const raw = String(text);
      if (mode === "empty") return "";
      if (mode === "identity") return raw;
      if (mode === "generic") throw new Error("down");
      if (mode === "quota") throw new Error("Service invoked too many times: translate.");
      if (mode === "lost") {
        return raw
          .replace(/訂金/g, "uang muka")
          .replace(/尾款/g, "sisa pembayaran")
          .replace(/已付/g, "sudah dibayar")
          .replace(/未付/g, "belum dibayar")
          .replace(/元/g, "yuan")
          .replace(/\uE000\d+\uE001/g, "");
      }
      if (mode === "renumbered") return raw.replace(/\uE000(\d+)\uE001/g, "\uE0009\uE001");
      if (mode === "duplicated") return raw.replace(/\uE000\d+\uE001/g, (ph) => ph + ph);
      return raw
        .replace(/訂金/g, "uang muka")
        .replace(/尾款/g, "sisa pembayaran")
        .replace(/已付/g, "sudah dibayar")
        .replace(/未付/g, "belum dibayar")
        .replace(/元/g, "yuan");
    },
  });
}

const amountShapes = [
  {
    name: "$1,000已付",
    remark: "$1,000已付",
    success: "Catatan: $1,000 sudah dibayar",
    source: "Catatan: $1,000已付",
    forbidNt: true,
  },
  {
    name: "NT$12,000元",
    remark: "NT$12,000元",
    success: "Catatan: NT$12,000 yuan",
    source: "Catatan: NT$12,000元",
    forbidNt: false,
  },
  {
    name: "$1,000.50已付",
    remark: "$1,000.50已付",
    success: "Catatan: $1,000.50 sudah dibayar",
    source: "Catatan: $1,000.50已付",
    forbidNt: true,
  },
];

const amountModes = ["success", "empty", "identity", "generic", "quota", "lost", "renumbered", "duplicated"];
for (const shape of amountShapes) {
  for (const mode of amountModes) {
    const counter = { n: 0 };
    const app = amountApp(mode, counter);
    const got = app.translateTaskCnToId(amountLine(shape.remark));
    const want = mode === "success" ? shape.success : shape.source;
    const label = "amount " + mode + " keeps " + shape.name;
    ok(remarkOf(got) === want, label + ": " + got);
    ok(noBrokenAmount(got), label + " broke the number: " + got);
    ok(got.indexOf(shape.remark.indexOf("NT$") === 0 ? "NT$12,000" : shape.remark.slice(0, shape.remark.search(/[\u4e00-\u9fff]/))) !== -1, label + " dropped the source token: " + got);
    if (shape.forbidNt) ok(got.indexOf("NT$") === -1, label + " added NT$: " + got);
    if (mode === "quota") {
      ok(counter.n === 1, label + " retried: " + counter.n);
      ok(app.__sleeps.length === 0, label + " slept: " + JSON.stringify(app.__sleeps));
    } else if (mode === "generic") {
      ok(counter.n === 2, label + " call count: " + counter.n);
      ok(JSON.stringify(app.__sleeps) === JSON.stringify([250]), label + " pause: " + JSON.stringify(app.__sleeps));
    } else {
      ok(counter.n === 1, label + " call count: " + counter.n);
      ok(app.__sleeps.length === 0, label + " slept: " + JSON.stringify(app.__sleeps));
    }
  }
}

const pairRemark = "訂金$1,000已付；尾款$2,000未付";
const pairSource = "Catatan: 訂金$1,000已付; 尾款$2,000未付";
const pairSuccess = "Catatan: uang muka $1,000 sudah dibayar; sisa pembayaran $2,000 belum dibayar";
for (const mode of amountModes) {
  const counter = { n: 0 };
  const app = amountApp(mode, counter);
  const got = app.translateTaskCnToId(amountLine(pairRemark));
  const want = mode === "success" ? pairSuccess : pairSource;
  const label = "two amounts " + mode;
  ok(remarkOf(got) === want, label + ": " + got);
  ok(noBrokenAmount(got), label + " broke a number: " + got);
  const halves = (remarkOf(got).replace(/^Catatan:\s*/, "")).split("; ");
  ok(halves.length === 2, label + " segment count: " + remarkOf(got));
  ok(halves[0].indexOf("$1,000") !== -1 && halves[0].indexOf("$2,000") === -1, label + " first segment: " + halves[0]);
  ok(halves[1].indexOf("$2,000") !== -1 && halves[1].indexOf("$1,000") === -1, label + " second segment: " + halves[1]);
  ok(got.indexOf("NT$") === -1, label + " added NT$: " + got);
  if (mode === "quota") {
    ok(counter.n === 1, label + " called the second segment: " + counter.n);
    ok(app.__sleeps.length === 0, label + " slept: " + JSON.stringify(app.__sleeps));
  } else if (mode === "generic") {
    ok(counter.n === 4, label + " call count: " + counter.n);
    ok(JSON.stringify(app.__sleeps) === JSON.stringify([250, 250]), label + " pause: " + JSON.stringify(app.__sleeps));
  } else {
    ok(counter.n === 2, label + " call count: " + counter.n);
  }
}

const quotaMessages = [
  "Service invoked too many times: translate.",
  "Exception: Service invoked too many times: translate.",
  "Service invoked too many times: Calendar.",
  "Service invoked too many times for one day: translate",
];
for (const message of quotaMessages) {
  ok(fixed.isDailyTranslateQuotaError_(new Error(message)) === true, "daily quota matches " + message);
  ok(fixed.isShortTimeLimitError_(new Error(message)) === false, "short-time false for " + message);
  const counter = { n: 0 };
  const app = loadGs(modifiedRemind, {
    translate() {
      counter.n += 1;
      throw new Error(message);
    },
  });
  const got = app.translateTaskCnToId(amountLine(pairRemark));
  ok(remarkOf(got) === pairSource, "quota path " + message + ": " + got);
  ok(noBrokenAmount(got), "quota path spaced " + message + ": " + got);
  ok(counter.n === 1, "quota path calls " + message + ": " + counter.n);
  ok(app.__sleeps.length === 0, "quota path slept " + message + ": " + JSON.stringify(app.__sleeps));
}

const notQuota = ["quota exceeded", "每日配額", "配額不足", "daily quota"];
for (const message of notQuota) {
  ok(fixed.isDailyTranslateQuotaError_(new Error(message)) === false, "not daily quota: " + message);
  const counter = { n: 0 };
  const app = loadGs(modifiedRemind, {
    translate() {
      counter.n += 1;
      throw new Error(message);
    },
  });
  const got = app.translateTaskCnToId("11:40 測試甲先生 (6) | 備註：花生過敏");
  ok(remarkOf(got) === "Catatan: 花生過敏", "generic fallback for " + message + ": " + got);
  ok(counter.n === 2, "generic retry for " + message + ": " + counter.n);
  ok(JSON.stringify(app.__sleeps) === JSON.stringify([250]), "generic 250ms for " + message + ": " + JSON.stringify(app.__sleeps));
}

ok(
  fixed.isDailyTranslateQuotaError_(new Error("Service invoked too many times in a short time: translate.")) === false,
  "short-time is not daily quota",
);
ok(
  fixed.isShortTimeLimitError_(new Error("Service invoked too many times in a short time: translate.")) === true,
  "short-time detector",
);

{
  const counter = { n: 0 };
  const app = loadGs(modifiedRemind, {
    translate() {
      counter.n += 1;
      throw new Error("Service invoked too many times: translate.");
    },
  });
  app.translateTaskCnToId(amountLine(pairRemark));
  const afterTask = counter.n;
  const note = app.translateNoteCnToId("臨時改爐火");
  ok(note === "臨時改爐火", "C-column after quota keeps Chinese: " + note);
  ok(counter.n === afterTask + 1, "C-column null cache may call once after task quota: " + counter.n);
  ok(app.__sleeps.length === 0, "C-column quota did not sleep: " + JSON.stringify(app.__sleeps));
}

// --- busy day: 9 dine-in + 3 takeout, cached call bound ---
const busyCn = sync.buildDigestText_(BUSY_DAY.day, BUSY_DAY.date, BUSY_DAY.time, BUSY_DAY.lunch, BUSY_DAY.dinner);
const busyCnLines = [
  "[Sun 2026-10-11 09:05 GMT+8] [2026-10-11 預約總覽]",
  "☀️ 午餐",
  "",
  "🍽️ 內用 (共 5 桌)",
  "",
  "11:00 測試01先生 (4) | 備註：花生過敏；不要辣 (小孩椅)",
  "",
  "11:10 測試02先生 (2) | 備註：花生過敏",
  "",
  "11:20 測試03小姐 (3) | 備註：桶仔雞2隻、雞湯1份",
  "",
  "11:30 測試04 (8) | 備註：9大3小",
  "",
  "11:40 測試05先生 (5) | 備註：不要辣",
  "",
  "🌙 晚餐",
  "",
  "🍽️ 內用 (共 4 桌)",
  "",
  "17:30 測試06 (2)",
  "",
  "17:40 測試07 (5k1a) | 備註：5k1a",
  "",
  "18:00 測試08先生 (6) | 備註：啤酂10箱要冰",
  "",
  "18:10 測試09小姐 (4) | 備註：12點到",
  "",
  "🥡 外帶 (共 3 筆)",
  "",
  "17:00 外帶01 | 備註：桶仔雞2隻、雞湯1份",
  "",
  "17:20 外帶02 | 備註：２份",
  "",
  "17:50 外帶03 | 備註：要VIP桌,不要香菜",
  "",
  "(總計 內用 9 桌＋外帶 3 筆)",
];
const busyGotLines = busyCn.split("\n");
ok(busyGotLines.length === busyCnLines.length, "busy Chinese line count " + busyGotLines.length + " != " + busyCnLines.length + "\n" + busyCn);
for (let i = 0; i < busyCnLines.length; i++) {
  ok(busyGotLines[i] === busyCnLines[i], "busy CN line " + i + "\n  got:  " + busyGotLines[i] + "\n  want: " + busyCnLines[i]);
}

const busyNote = "⚠️ 注意：包含 12 人大組訂位！";
const busyId = "ID";
const oldMsgLines = previous.buildDailyReminderMessage_(busyCn, busyId, busyNote, "NOTE").split("\n");
const newMsgLines = fixed.buildDailyReminderMessage_(busyCn, busyId, busyNote, "NOTE").split("\n");
ok(oldMsgLines.length === newMsgLines.length, "CN message line count drifted");
for (let i = 0; i < oldMsgLines.length; i++) {
  ok(oldMsgLines[i] === newMsgLines[i], "old-vs-new Chinese message line " + i + "\n  old: " + oldMsgLines[i] + "\n  new: " + newMsgLines[i]);
}

resetCalls();
const busyIdText = fixed.translateTaskCnToId(busyCn);
ok(JSON.stringify(newCalls.map((c) => c.text)) === JSON.stringify(BUSY_DAY_CALLS), "busy calls: " + JSON.stringify(newCalls.map((c) => c.text)));
ok(newCalls.length <= BUSY_DAY_CALLS.length, "busy call bound exceeded: " + newCalls.length);
ok(newCalls.length === 11, "busy unique call count: " + newCalls.length);
const busyTails = busyIdText.split("\n").filter((line) => line.indexOf("Catatan:") !== -1).map(remarkOf);
const busyTailWant = [
  "Catatan: alergi kacang; tidak pedas (kursi anak)",
  "Catatan: alergi kacang",
  "Catatan: ayam tong 2 ekor, sup ayam 1 porsi",
  "Catatan: 9 dewasa 3 anak",
  "Catatan: tidak pedas",
  "Catatan: 5k1a",
  "Catatan: bir 10 kotak harus dingin",
  "Catatan: tiba pukul 12",
  "Catatan: ayam tong 2 ekor, sup ayam 1 porsi",
  "Catatan: 2 porsi",
  "Catatan: minta meja VIP, tanpa daun ketumbar",
];
ok(JSON.stringify(busyTails) === JSON.stringify(busyTailWant), "busy tails:\n" + busyTails.join("\n"));
for (const tail of busyTails) {
  if (tail === "Catatan: 5k1a") continue;
  assertNoCjk("busy tail", tail);
}

// Before sample comes from the unmodified 09-27 translator plus the same stub.
resetCalls();
const beforeMulti = previous.translateTaskCnToId(multiIn);
const beforeHead = previous.translateTaskCnToId("🍽️ 內用 (共 3 桌)\n🥡 外帶 (共 1 筆)");
ok(beforeMulti.indexOf("花生過敏") !== -1, "expected the old translator to leave Chinese, got: " + beforeMulti);
ok(
  JSON.stringify(oldCalls.map((c) => c.text)) === JSON.stringify(["花生過敏 不要辣 小孩椅"]),
  "old translator call shape changed: " + JSON.stringify(oldCalls),
);
ok(beforeHead.indexOf("共") !== -1, "old headings should still show 共: " + beforeHead);

if (failures.length) {
  console.error("FAIL " + failures.length);
  for (const message of failures) console.error("- " + message);
  process.exit(1);
}

console.log("PASS line-digest-nit offline (" + HEADING_CASES.length + " headings + remark/day fixtures)");
console.log("");
console.log("--- sample before (09-27 translator, stub LanguageApp) ---");
console.log(beforeHead);
console.log(beforeMulti);
console.log("--- sample after ---");
console.log(fixed.translateTaskCnToId("🍽️ 內用 (共 3 桌)\n🥡 外帶 (共 1 筆)"));
console.log(multiGot);
console.log("--- qty / digits / pipe / plan code ---");
console.log(qtyGot);
console.log(partyGot);
console.log(beerGot);
console.log(arriveGot);
console.log(fwGot);
console.log(semiGot);
console.log(commaGot);
console.log(vipGot);
console.log(pipeGot);
console.log(codeInPhrase);
console.log("--- busy day calls " + BUSY_DAY_CALLS.length + " ---");
console.log(busyIdText);
