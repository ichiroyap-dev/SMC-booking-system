#!/usr/bin/env node
/**
 * Homepage 招牌菜色 gallery (offline; no network).
 * Usage: node tools/test-featured-dishes.mjs
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

const dishes = [
    ['dish_01', '雞汁炒米粉'],
    ['dish_02', '飄香甕窯雞'],
    ['dish_03', '剝皮辣椒雞湯'],
    ['dish_04', '客家嫩燜筍'],
    ['dish_05', '清蒸石斑魚'],
    ['dish_06', '客家炸婆菜'],
];

const start = html.indexOf('<section id="featured-dishes"');
const end = html.indexOf('</section>', start);
assert(start > 0 && end > start, 'homepage has #featured-dishes');
const section = start > 0 ? html.slice(start, end) : '';

const h2Match = section.match(/<h2 id="featured-dishes-title"[^>]*>[\s\S]*?<\/h2>/);
const heading = h2Match ? h2Match[0] : '';
assert(h2Match, 'featured-dishes h2 exists');
assert(/<h2 id="featured-dishes-title"[^>]*>\s*招牌菜色\s*<span\b[^>]*>\s*（每桌價格不同，菜色及菜量皆會有所調整）\s*<\/span>\s*<\/h2>/.test(heading), 'note text is inside the featured-dishes h2');
const priceScan = section.replace('（每桌價格不同，菜色及菜量皆會有所調整）', '');
assert(!/NT\$|\$\d|\d元|價格/.test(priceScan), 'section does not show a price');

let cursor = 0;
for (const [file, name] of dishes) {
    const pictureAt = section.indexOf(`<source srcset="${file}.webp?v=20261014" type="image/webp">`, cursor);
    assert(pictureAt > cursor, `${file} webp source is in order`);
    const imgAt = section.indexOf(`<img src="${file}.jpg?v=20261014" alt="水美土雞城 ${name}" width="800" height="600" loading="lazy">`, pictureAt);
    assert(imgAt > pictureAt, `${name} jpg fallback, alt, size, and lazy load`);
    const captionAt = section.indexOf(`<figcaption class="featured-dish-name">${name}</figcaption>`, imgAt);
    assert(captionAt > imgAt, `${name} caption is the dish name only`);
    cursor = captionAt;
    for (const ext of ['jpg', 'webp']) {
        const path = join(root, `${file}.${ext}`);
        const size = statSync(path).size;
        assert(size > 0 && size < 200 * 1024, `${file}.${ext} is under 200KB (${size})`);
    }
}

const signatureAt = html.indexOf('id="signature-dishes"');
const menuAt = html.indexOf('id="menu"');
assert(signatureAt > 0 && start > signatureAt && start < menuAt, 'gallery sits after the existing signature block and before the menu');

const bookingAt = html.indexOf('id="booking-section"');
assert(bookingAt > menuAt, 'booking form stays after the menu');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('featured dishes ok');
