#!/usr/bin/env node
// Offline checks for the simplified LINE digest Indonesian.
// Structural lines use fixed templates. Remarks stay source Chinese plus one notice.
// Does not read sheets, send LINE, or touch a live script.
// Usage: node apps-script-isolate/line-digest-nit/test-offline.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { BUSY_DAY, HEADING_CASES, MIXED_DAY } from "./fixtures.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const originalRemind = join(root, "original", "LineDailyRemind.gs");
const originalSync = join(root, "original", "DailyBookingSync.gs");
const modifiedRemind = join(root, "LineDailyRemind.gs");

const CJK = /[\u4e00-\u9fff]/;
const failures = [];
const ok = (cond, message) => {
  if (!cond) failures.push(message);
};

function loadGs(file, languageApp) {
  const context = vm.createContext({
    LanguageApp: languageApp,
    Utilities: { sleep() {} },
    console,
  });
  vm.runInContext(readFileSync(file, "utf8"), context, { filename: file });
  return context;
}

const calls = [];
const fixed = loadGs(modifiedRemind, {
  translate(text) {
    calls.push(String(text));
    throw new Error("LanguageApp must not be called: " + text);
  },
});
const previous = loadGs(originalRemind, {
  translate(text) {
    calls.push("OLD:" + String(text));
    return "ID:" + String(text).replace(/,(\d{3})/g, ".$1");
  },
});
const sync = loadGs(originalSync, { translate() { return ""; } });
const NOTICE = fixed.REMARK_CONFIRM_NOTICE_;

function resetCalls() {
  calls.length = 0;
}

function remarkLine(body) {
  return "12:00 測試甲先生 (4) | 備註：" + body;
}

function expectRemark(body) {
  return "12:00 Bapak 測試甲 (4) | Catatan: " + body + " " + NOTICE;
}

function catatanBody(line) {
  const mark = "Catatan: ";
  const at = line.indexOf(mark);
  if (at === -1) return null;
  const rest = line.slice(at + mark.length);
  const suffix = " " + NOTICE;
  if (!rest.endsWith(suffix)) return rest;
  return rest.slice(0, -suffix.length);
}

resetCalls();
for (const [input, expected] of HEADING_CASES) {
  const got = fixed.translateTaskCnToId(input);
  ok(got === expected, "heading\n  in:  " + input + "\n  got: " + got + "\n  want:" + expected);
  ok(!CJK.test(got), "heading still has Chinese: " + got);
  ok(got.indexOf("共") === -1, "heading still has 共: " + got);
}
ok(calls.length === 0, "headings called LanguageApp: " + JSON.stringify(calls));

const originalSrc = readFileSync(originalRemind, "utf8");
const modifiedSrc = readFileSync(modifiedRemind, "utf8");
ok(originalSrc.indexOf('Bawa pulang (共 "') !== -1, "original snapshot missing leftover 共 in takeout heading");
ok(modifiedSrc.indexOf('Bawa pulang (共 "') === -1, "modified takeout heading still contains 共");
ok(modifiedSrc.indexOf(' (共 "') === -1, "modified heading builder still contains 共");
ok(modifiedSrc.indexOf("LanguageApp.translate") === -1, "LanguageApp.translate is still in the candidate");
ok(modifiedSrc.indexOf("REMARK_PHRASES_") === -1, "remark phrase table is still in the candidate");
ok(modifiedSrc.indexOf("peelListTail_") === -1, "list-tail peeler is still in the candidate");
ok(NOTICE === "(Mohon konfirmasi dulu ke penanggung jawab)", "notice string drifted: " + NOTICE);

const remarks = [
  "不要辣、蒜?",
  "不要蔥，香菜、牛肉、靠窗",
  "不要蝦子，$500、芒果和香菜",
  "對花生過敏、蝦子",
  "花生過敏；不要辣 (小孩椅)",
  "不要香菜、少鹽",
  "$1,000",
  "NT$12,000",
  "$1,000.50",
  "$500,2隻雞",
  "預估金額 $2,000 (生日；不要葱)",
  "訂金$1,000；尾款$2,000",
  "花生過敏 | 靠窗",
  "5k1a",
  "12",
  "費用$1,000，請拍照",
];
for (const body of remarks) {
  resetCalls();
  const got = fixed.translateTaskCnToId(remarkLine(body));
  ok(got === expectRemark(body), "remark\n  got:  " + got + "\n  want: " + expectRemark(body));
  ok(catatanBody(got) === body, "remark body changed: " + JSON.stringify(catatanBody(got)));
  ok(got.indexOf("$1.000") === -1 && got.indexOf("$1.000.50") === -1, "amount rewritten: " + got);
  ok(got.split(NOTICE).length === 2, "notice count: " + got);
  ok(calls.length === 0, "remark called LanguageApp: " + JSON.stringify(calls));
}

resetCalls();
ok(fixed.translateTaskCnToId("12:00 測試乙小姐 (4)") === "12:00 Ibu 測試乙 (4)", "empty guest line drifted");
ok(
  fixed.translateTaskCnToId("12:00 測試乙小姐 (4) | 備註：") === "12:00 Ibu 測試乙 (4) | Catatan:",
  "empty catatan drifted",
);
ok(fixed.translateTaskCnToId("19:00 測試戊 人數待確認") === "19:00 Bapak/Ibu 測試戊 Jumlah orang menunggu konfirmasi", "headcount label drifted");
ok(fixed.translateTaskCnToId("11:00 測試丙 (5k1a)") === "11:00 Bapak/Ibu 測試丙 (5k1a)", "plan code on the name drifted");
ok(fixed.translateTaskCnToId("11:00 外帶01 | 備註：桶仔雞2隻") === "11:00 Bapak/Ibu 外帶01 | Catatan: 桶仔雞2隻 " + NOTICE, "takeout remark drifted");
ok(calls.length === 0, "structural guest lines called LanguageApp");

resetCalls();
const maintenance = "[Sun 2026-10-11 09:05 GMT+8] [2026-10-11 預約總覽]\n清洗製冰機，下午三點前完成，並拍照回報\n費用$1,000，請拍照";
const maintenanceGot = fixed.translateTaskCnToId(maintenance);
ok(maintenanceGot.split("\n")[0] === "[Minggu 11 Oktober 2026 09:05 GMT+8] [Ringkasan Reservasi 11 Oktober 2026]", "maintenance header: " + maintenanceGot.split("\n")[0]);
ok(maintenanceGot.split("\n")[1] === "清洗製冰機，下午三點前完成，並拍照回報 " + NOTICE, "maintenance line drifted: " + maintenanceGot.split("\n")[1]);
ok(maintenanceGot.split("\n")[2] === "費用$1,000，請拍照 " + NOTICE, "maintenance amount drifted: " + maintenanceGot.split("\n")[2]);
ok(maintenanceGot.indexOf("$1.000") === -1, "maintenance amount became $1.000");
ok(calls.length === 0, "maintenance called LanguageApp");

resetCalls();
ok(fixed.translateNoteCnToId("") === "Tidak ada keterangan", "empty note drifted");
ok(fixed.translateNoteCnToId("無") === "Tidak ada keterangan", "無 note drifted");
ok(fixed.translateNoteCnToId("⚠️ 注意：包含 12 人大組訂位！") === "⚠️ Perhatian: Termasuk reservasi grup besar 12 orang!", "group warning drifted");
ok(fixed.translateNoteCnToId("🛵 純外帶日，無內用桌") === "🛵 Hari khusus bawa pulang (Antaran), tidak ada meja di tempat.", "takeout warning drifted");
ok(fixed.translateNoteCnToId("✅ 今日預約正常 (共 5 桌)") === "✅ Reservasi hari ini normal (Total 5 meja)", "normal warning drifted");
ok(fixed.translateNoteCnToId("臨時改爐火") === "臨時改爐火 " + NOTICE, "free C note drifted");
ok(
  fixed.translateNoteCnToId("⚠️ 注意：包含 12 人大組訂位！；不要辣、蒜?") ===
    "⚠️ Perhatian: Termasuk reservasi grup besar 12 orang!；不要辣、蒜? " + NOTICE,
  "warning tail drifted",
);
ok(
  fixed.translateNoteCnToId("🛵 純外帶日，無內用桌；訂金$1,000已付") ===
    "🛵 Hari khusus bawa pulang (Antaran), tidak ada meja di tempat.；訂金$1,000已付 " + NOTICE,
  "takeout tail amount drifted",
);
ok(fixed.translateNoteCnToId("若發現漏水，不要啟動，先通知店長").indexOf("$1.000") === -1, "note rewrote an amount");
ok(fixed.translateNoteCnToId("若發現漏水，不要啟動，先通知店長") === "若發現漏水，不要啟動，先通知店長 " + NOTICE, "ops note drifted");
ok(calls.length === 0, "notes called LanguageApp: " + JSON.stringify(calls));

const chinese = sync.buildDigestText_(MIXED_DAY.day, MIXED_DAY.date, MIXED_DAY.time, MIXED_DAY.lunch, MIXED_DAY.dinner);
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
  "11:30 Bapak 測試甲 (6) | Catatan: 花生過敏；不要辣 (小孩椅) " + NOTICE,
  "",
  "12:00 Ibu 測試乙 (4)",
  "",
  "🥡 Bawa pulang (total 1 pesanan)",
  "",
  "11:00 Bapak/Ibu 測試丙 (5k1a) | Catatan: 5k1a " + NOTICE,
  "",
  "🌙 Makan Malam",
  "",
  "🍽️ Makan di tempat (total 1 meja, 1 pesanan jumlah meja menunggu konfirmasi)",
  "",
  "18:00 Bapak 測試丁 (10) | Catatan: 不要香菜、少鹽 " + NOTICE,
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
ok(indonesian.indexOf("$1.000") === -1, "mixed day rewrote an amount");
for (const line of indonesian.split("\n")) {
  if (/Makan di tempat|Bawa pulang|Makan Siang|Makan Malam|^\(Total |^\[Minggu /.test(line)) {
    ok(!CJK.test(line), "heading still has Chinese: " + line);
  }
}
ok(calls.length === 0, "mixed day called LanguageApp");

const busyCn = sync.buildDigestText_(BUSY_DAY.day, BUSY_DAY.date, BUSY_DAY.time, BUSY_DAY.lunch, BUSY_DAY.dinner);
const busyRemarks = []
  .concat(BUSY_DAY.lunch, BUSY_DAY.dinner)
  .map((row) => row.remarkStr)
  .filter((text) => text);
resetCalls();
const busyIdText = fixed.translateTaskCnToId(busyCn);
const busyBodies = busyIdText.split("\n").filter((line) => line.indexOf("Catatan:") !== -1).map(catatanBody);
ok(JSON.stringify(busyBodies) === JSON.stringify(busyRemarks), "busy remarks\n  got:  " + JSON.stringify(busyBodies) + "\n  want: " + JSON.stringify(busyRemarks));
ok(busyIdText.indexOf("共") === -1, "busy Indonesian still contains 共");
ok(busyIdText.indexOf("$1.000") === -1, "busy day rewrote an amount");
for (const line of busyIdText.split("\n")) {
  if (/Makan di tempat|Bawa pulang|Makan Siang|Makan Malam|^\(Total |^\[Minggu /.test(line)) {
    ok(!CJK.test(line), "busy heading still has Chinese: " + line);
  }
}
ok(calls.length === 0, "busy day called LanguageApp: " + JSON.stringify(calls));

const busyNote = "⚠️ 注意：包含 12 人大組訂位！";
const busyNoteId = fixed.translateNoteCnToId(busyNote);
const busyMessage = fixed.buildDailyReminderMessage_(busyCn, busyIdText, busyNote, busyNoteId);
ok(busyMessage.indexOf(busyCn) !== -1, "Chinese task missing from the LINE message");
ok(busyMessage.indexOf(busyIdText) !== -1, "Indonesian task missing from the LINE message");
ok(busyMessage.indexOf("共 5 桌") !== -1, "Chinese heading lost 共 inside the CN half");
ok(!/Tugas \(ID\)：[\s\S]*共/.test(busyMessage), "共 leaked into the ID half");
const oldShell = previous.buildDailyReminderMessage_(busyCn, "ID", busyNote, "NOTE");
const newShell = fixed.buildDailyReminderMessage_(busyCn, "ID", busyNote, "NOTE");
ok(oldShell === newShell, "Chinese message shell drifted");

function sliceFunction(src, name) {
  const key = "function " + name + "(";
  const start = src.indexOf(key);
  if (start < 0) return "";
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return "";
}

const unchangedFns = [
  "checkAndSendDailyReminders",
  "isBookingOverviewTask_",
  "dailyReminderTitle_",
  "stripRedundantNormalNoteLines_",
  "shouldOmitOperationalNote_",
  "buildDailyReminderMessage_",
  "replaceUnconfirmedPeopleToken_",
  "sanitizeDigestLineForPush_",
  "sanitizeDigestTaskForPush_",
  "translateTotalLine_",
  "maskLineUserId_",
  "sendToLineMessagingAPI",
  "diagnoseLineApiNoSend",
  "doPost",
];
for (const name of unchangedFns) {
  ok(sliceFunction(modifiedSrc, name) === sliceFunction(originalSrc, name), "locked function drifted: " + name);
}

const newCallCount = calls.length;
const beforeBusy = previous.translateTaskCnToId(busyCn);
const beforeAmount = previous.translateTaskCnToId(remarkLine("$1,000"));

if (failures.length) {
  console.error("FAIL " + failures.length);
  for (const message of failures) console.error("- " + message);
  process.exit(1);
}

console.log("PASS line-digest-nit offline (" + HEADING_CASES.length + " headings, remarks stay Chinese)");
console.log("notice: " + NOTICE);
console.log("busy ID digest chars: " + busyIdText.length);
console.log("busy LINE message chars: " + busyMessage.length);
console.log("LanguageApp calls: " + newCallCount);
console.log("");
console.log("--- sample before (09-27 translator) ---");
console.log(beforeBusy);
console.log(beforeAmount);
console.log("--- sample after ---");
console.log(busyIdText);
console.log(fixed.translateTaskCnToId(remarkLine("$1,000")));
console.log(fixed.translateTaskCnToId(remarkLine("不要辣、蒜?")));
console.log(fixed.translateTaskCnToId(remarkLine("不要蔥，香菜、牛肉、靠窗")));
console.log(fixed.translateTaskCnToId(remarkLine("不要蝦子，$500、芒果和香菜")));
console.log(fixed.translateTaskCnToId(remarkLine("對花生過敏、蝦子")));
