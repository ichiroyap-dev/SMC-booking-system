/**
 * Local replica of live Apps Script routing (v146 dump SHA
 * ca881a2971e07e4fa3aa20e74a00baf03840f6ffed47f8a0548e1db74a26a06a).
 *
 * Does not call LINE, Google, or clasp. Proves why Owner sees no auto-reply
 * after restore, and that a guest short “我要訂位” would still get a reply.
 */
import { strict as assert } from "node:assert";
import test from "node:test";

const MY_USER_ID = "U_owner_test_id";

function parseName(msg) {
  var m;
  m = msg.match(/(?:姓名|名字叫做|名字是|名字|我叫|叫做)\s*[:：]?\s*([\u4e00-\u9fa5]{2,4})/);
  if (m) return m[1];
  m = msg.match(/([\u4e00-\u9fa5]{1,3})(?:先生|小姐|女士|太太)/);
  if (m) return m[1];
  m = msg.match(/(?:敝姓|我姓|貴姓是)([\u4e00-\u9fa5])/);
  if (m) return m[1];
  m = msg.match(/姓(?!名)([\u4e00-\u9fa5])/);
  if (m) return m[1];
  return null;
}

function parsePeople(msg) {
  var t = msg.replace(/09\d{8}/g, " ").replace(/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/g, " ");
  var m2 = t.match(/([0-9一二兩两三四五六七八九十]{1,3})\s*(?:位|人|個|名)/);
  if (m2) {
    var n = parseInt(m2[1], 10);
    if (n > 0 && n <= 99) return n;
  }
  return null;
}

function parseDate(msg) {
  if (/大後天|後天|明天|明日|明晚|今天|今日|今晚/.test(msg)) return "parsed-date";
  return null;
}

function parseTime(msg) {
  if (/點|中午|晚上|:\d{2}/.test(msg)) return "parsed-time";
  return null;
}

function parseBookingMessage(msg) {
  var phone = (msg.match(/09\d{8}/) || [null])[0];
  return {
    name: parseName(msg),
    phone: phone,
    date: parseDate(msg),
    time: parseTime(msg),
    people: parsePeople(msg),
    note: null
  };
}

function handleOwnerCommand(msg) {
  var phoneM = msg.match(/09\d{8}/);
  if (/(暫停|接手|靜音|停止自動)/.test(msg) && phoneM) return "owner-pause";
  if (/(恢復|放手|交回|開啟自動)/.test(msg) && phoneM) return "owner-resume";
  if (/指令|說明|help|怎麼用/i.test(msg)) return "owner-help";
  return "SILENT";
}

/**
 * Mirrors live handleLineWebhook control flow for text messages.
 * pendingOnly=true mimics handleLineWebhookPendingOnly_ (pre-v146 entry).
 */
function routeText({ userId, text, human, pendingOnly }) {
  if (pendingOnly) return "pending-ack";

  if (/^(id|myid|我的id|查id|id查詢)$/i.test(text.replace(/\s/g, ""))) {
    return "id-reply";
  }
  if (userId === MY_USER_ID) {
    return handleOwnerCommand(text);
  }
  if (human) {
    if (/管家|小幫手|自動回覆|機器人|恢復自動|自動服務/.test(text)) return "human-restore";
    return "SILENT";
  }
  if (/真人|專人|客服|找老闆|店長|客訴|投訴|抱怨|不要機器人|不要自動回覆|轉接/.test(text)) {
    return "human-handoff";
  }

  var parsed = parseBookingMessage(text);
  var missing = [];
  if (!parsed.name) missing.push("name");
  if (!parsed.phone) missing.push("phone");
  if (!parsed.date) missing.push("date");
  if (!parsed.time) missing.push("time");
  if (!parsed.people) missing.push("people");
  if (missing.length > 0) return "ask-missing:" + missing.join(",");
  return "confirm-draft";
}

test("v146 Owner + 我要訂位 is silent (regression vs pending-only ack)", () => {
  assert.equal(routeText({ userId: MY_USER_ID, text: "我要訂位", pendingOnly: true }), "pending-ack");
  assert.equal(routeText({ userId: MY_USER_ID, text: "我要訂位" }), "SILENT");
});

test("v146 Owner ID / 指令 still reply (discriminator)", () => {
  assert.equal(routeText({ userId: MY_USER_ID, text: "ID" }), "id-reply");
  assert.equal(routeText({ userId: MY_USER_ID, text: "指令" }), "owner-help");
});

test("guest short 我要訂位 still gets missing-fields reply (not wait-for-confirm)", () => {
  const out = routeText({ userId: "U_guest", text: "我要訂位" });
  assert.equal(out, "ask-missing:name,phone,date,time,people");
});

test("guest human_ cache silences until 管家", () => {
  assert.equal(routeText({ userId: "U_guest", text: "我要訂位", human: true }), "SILENT");
  assert.equal(routeText({ userId: "U_guest", text: "管家", human: true }), "human-restore");
});

test("Owner path is never reached by human_ cache (checked first)", () => {
  assert.equal(routeText({ userId: MY_USER_ID, text: "我要訂位", human: true }), "SILENT");
});
