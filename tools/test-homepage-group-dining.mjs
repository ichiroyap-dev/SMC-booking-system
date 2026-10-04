#!/usr/bin/env node
/**
 * Homepage snippet + 團體聚餐 section (offline; no network, no booking submit).
 * Usage: node tools/test-homepage-group-dining.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const faq = readFileSync(join(root, 'faq.html'), 'utf8');
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

function attr(src, re) {
    const m = src.match(re);
    return m ? m[1] : '';
}

function fullWidthUnits(s) {
    let n = 0;
    for (const ch of s) n += ch.codePointAt(0) <= 0x7f ? 0.5 : 1;
    return n;
}

const title = attr(html, /<title>([^<]*)<\/title>/);
const description = attr(html, /<meta name="description" content="([^"]*)">/);
const ogTitle = attr(html, /<meta property="og:title" content="([^"]*)">/);
const ogDescription = attr(html, /<meta property="og:description" content="([^"]*)">/);
const twTitle = attr(html, /<meta name="twitter:title" content="([^"]*)">/);
const twDescription = attr(html, /<meta name="twitter:description" content="([^"]*)">/);

assert(title.includes('水美土雞城'), 'title keeps 水美土雞城');
assert(title.includes('外埔土雞城'), 'title shows 外埔土雞城');
assert(title.includes('桶仔雞'), 'title shows 桶仔雞');
assert(title.includes('桌菜'), 'title shows 桌菜');
assert(title.includes('菜單價格'), 'title keeps 菜單價格');
assert(fullWidthUnits(title) <= 32, `title full-width units ${fullWidthUnits(title)} should be ≤ 32`);
assert(ogTitle === title && twTitle === title, 'og:title and twitter:title match <title>');

const descLen = [...description].length;
assert(descLen >= 70 && descLen <= 90, `description length ${descLen} should be 70–90`);
for (const needle of ['桶仔雞（烤雞）', '桌菜', '團體聚餐', '最多可容納 9 桌', '免費停車', '採預約制', '菜單價格']) {
    assert(description.includes(needle), `description missing ${needle}`);
}
assert(ogDescription === description && twDescription === description, 'og:description and twitter:description match meta description');

const sectionStart = html.indexOf('<section id="group-dining"');
const sectionEnd = html.indexOf('</section>', sectionStart);
assert(sectionStart > 0 && sectionEnd > sectionStart, 'homepage has #group-dining');
const section = sectionStart > 0 ? html.slice(sectionStart, sectionEnd) : '';
assert(section.includes('團體聚餐・家庭聚會'), 'section heading');
for (const needle of ['家庭聚餐', '同學會', '公司聚餐', '親友聚會', '最多可容納 9 桌', '官網預約', '#booking-section', 'line.me/R/ti/p/@xwg4507a', '04-2688-7895', '採預約制', '每桌建議最多坐12位']) {
    assert(section.includes(needle), `section missing ${needle}`);
}
assert(!section.includes('免費停車'), '團體區不再重寫停車說明');
assert(!section.includes('11:30 - 14:00'), '團體區不再重寫營業時間');
assert(!section.includes('包場'), 'section does not claim 包場');
assert(!/NT\$|\$\d|\d元/.test(section), 'section does not add a price');

const menuAt = html.indexOf('id="menu"');
const locationAt = html.indexOf('id="location-section"');
assert(menuAt > 0 && sectionStart > menuAt && sectionStart < locationAt, 'section sits after the menu and before the location block');
assert(!html.includes('id="visit-title"'), '來店安排三卡已併入交通區');

const locationEnd = html.indexOf('</section>', locationAt);
const location = locationAt > 0 ? html.slice(locationAt, locationEnd) : '';
for (const needle of ['免費', '11:30 - 14:00', '17:30 - 21:00', '每週三公休', '山路夜間較暗']) {
    assert(location.includes(needle), `location missing ${needle}`);
}
assert(html.includes('查看 Google 評價'), 'Google 評價改連到來源頁');
assert(html.includes('Restaurant Guru 推薦'), 'Restaurant Guru 單獨標示來源');
assert(!html.includes('>4.4<') && !html.includes('★★★★☆'), '評價不再寫死分數或星等');
assert(html.includes('安排前會先確認餐點與價錢'), '臨時客寫安排前先確認餐點與價錢');
assert(html.includes('未預約不保證供應烤雞'), '未預約不保證供應烤雞仍在');

const question = '團體聚餐怎麼預約？';
assert((faq.match(new RegExp(question, 'g')) || []).length >= 2, 'family FAQ in JSON-LD and on the page');
const ldText = attr(faq, new RegExp(`${question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?"text": "([^"]*)"`));
assert(ldText.includes('最多可容納 9 桌'), 'FAQ JSON-LD mentions 最多可容納 9 桌');
assert(!/4500|5000|5500|500 元|\$500/.test(ldText), 'FAQ JSON-LD does not repeat the price list');
assert(!ldText.includes('包場'), 'FAQ JSON-LD does not claim 包場');

const visible = attr(faq, new RegExp(`<summary>${question}</summary>\\s*<p[^>]*>([\\s\\S]*?)</p>`));
const visibleText = visible.replace(/<[^>]+>/g, '');
assert(visibleText.includes('最多可容納 9 桌'), 'FAQ page mentions 最多可容納 9 桌');
assert(!/4500|5000|5500|\$500/.test(visibleText), 'FAQ page does not repeat the price list');
assert(visible.includes('./#booking-section'), 'FAQ booking link stays on the reservation form');
assert(visible.includes('04-2688-7895'), 'FAQ shows the shop phone');
assert(!faq.includes('想找台中土雞城'), 'FAQ 不再用搜尋語氣當題名');
assert(!faq.includes('山路較暗') && !faq.includes('放慢車速'), 'FAQ 不再重寫首頁的夜間路線說明');
assert(faq.includes('免費戶外停車場'), 'FAQ 仍保留有免費停車場');
const summaries = faq.match(/<summary>/g) || [];
assert(summaries.length === 14, `FAQ 可見題數 ${summaries.length} 應為 14`);

const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const restaurant = ldBlocks.find((o) => o['@type'] === 'Restaurant');
assert(restaurant && String(restaurant.description).includes('最多可容納 9 桌'), 'Restaurant JSON-LD mentions 最多可容納 9 桌');
assert(restaurant && !/4500|5000|5500/.test(String(restaurant.description)), 'Restaurant JSON-LD description does not repeat menu prices');

if (failures.length) {
    console.error('FAIL');
    failures.forEach((line) => console.error(' -', line));
    process.exit(1);
}
console.log(`homepage snippet + group dining OK (title ${fullWidthUnits(title)} fw, description ${descLen} chars)`);
