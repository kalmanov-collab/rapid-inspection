// בדיקת קצה-לקצה על ה-dist הבנוי (דורש playwright; לא חלק מ-npm test)
import { chromium } from 'playwright';
import { createServer } from 'http'; import { readFileSync, existsSync, statSync } from 'fs'; import { join, extname } from 'path';
import * as XLSX from 'xlsx';
const FILE = process.argv[2] || '/mnt/user-data/uploads/חברת החשמל/ריכוז מתקנים ואביזרים - חברת החשמל - מעודכן.xlsx';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => { let f = join('dist', decodeURIComponent(req.url.split('?')[0])); if (!existsSync(f) || statSync(f).isDirectory()) f = 'dist/index.html'; res.setHeader('Content-Type', MIME[extname(f)] || 'application/octet-stream'); res.end(readFileSync(f)); }).listen(4610);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 412, height: 1000 }, acceptDownloads: true, locale: 'he-IL' });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.addInitScript(() => {
  class FakeRecognition { start() { this.onstart?.(); window.__rec = this; } stop() { this.onend?.(); } abort() { this.onend?.(); } }
  window.SpeechRecognition = FakeRecognition; window.webkitSpeechRecognition = FakeRecognition;
  window.say = (text, confidence = 0.9) => window.__rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence }], { isFinal: true })] });
});
await page.goto('http://localhost:4610/'); await page.waitForTimeout(800);
await page.locator('input[type=file]').setInputFiles({ name: 'ריכוז מתקנים ואביזרים - חברת החשמל - מעודכן.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: readFileSync(FILE) });
await page.locator('button', { hasText: 'קישון' }).first().click({ timeout: 20000 });
await page.locator('button', { hasText: 'התחל בדיקה' }).click();
await page.locator('button', { hasText: 'התחל האזנה' }).click({ timeout: 20000 });
const status = () => page.evaluate(() => document.querySelector('main span.text-gray-300').innerText);
const say = async (t, c) => { const t0 = Date.now(); await page.evaluate(([x, y]) => window.say(x, y), [t, c ?? 0.9]); await page.waitForTimeout(60); return Date.now() - t0; };

await say('מיקום מחסן כלים'); console.log('1', await status());
await say("סוג רצועה עגולה ירוקה 4 מ'"); console.log('2', await status());
if (await page.locator('text=לאיזה סוג הכוונה').count()) { console.log('   (שאלת סוג - בוחר 1)'); await say('1'); console.log('  ', await status()); }
// מספרים אמיתיים מהקובץ + חדשים
const wb = XLSX.read(readFileSync(FILE), { cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).filter((r) => r['אתר'] === 'קישון' && /רצועת הרמה עגולה אורך 4מ/.test(r['תיאור (כפי שבתסקיר)']));
const real = rows.slice(0, 40).map((r) => String(r["מס' סידורי / פנימי"]));
let ms = 0;
for (const serial of real) ms += await say(serial);
for (let i = 0; i < 20; i++) ms += await say(`9${100 + i}/7`);
await say('9120/7 פסול חתך');
console.log(`3 ${real.length + 21} מספרים נרשמו; זמן ממוצע לפריט כולל המתנת הבדיקה: ${Math.round(ms / (real.length + 20))}ms ·`, await status());
await say('סוג מחגר כלשהו מיוחד'); console.log('4', await status());
await page.locator('input').first().fill('מחגר ידני מיוחד 2 טון');
await page.locator('input[type=number]').first().fill('2');
await page.locator('button', { hasText: 'הוסף סוג חדש' }).click(); await page.waitForTimeout(100); console.log('5', await status());
await say('מיקום חדש ארובה'); await say('קי 778899');
await page.screenshot({ path: 'tests/e2e-field.png' });
await page.reload(); await page.waitForTimeout(1500);
await page.locator('button', { hasText: 'סיכום' }).click({ timeout: 20000 }); await page.waitForTimeout(1200);
console.log('6 סיכום:', (await page.locator('header').innerText()).replace(/\n/g, ' '));
await page.screenshot({ path: 'tests/e2e-review.png' });
await page.locator('button', { hasText: /^סוגים/ }).click(); await page.waitForTimeout(200);
await page.screenshot({ path: 'tests/e2e-types.png' });
await page.locator('footer button', { hasText: 'ייצוא' }).click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: 'קובץ ריכוז מעודכן' }).click()]);
const out = XLSX.read(readFileSync(await dl.path()));
const outRows = XLSX.utils.sheet_to_json(out.Sheets[out.SheetNames[0]], { defval: '' });
console.log('7 גיליונות:', out.SheetNames.join(' | '), '· שורות:', outRows.length);
console.log('  חדשים בקובץ:', outRows.filter((r) => r['פריט חדש'] === 'כן').length, '· עודכנו:', outRows.filter((r) => r['תוצאה נוכחית'] && r['פריט חדש'] !== 'כן').length);
console.log('  סוגים:', JSON.stringify(XLSX.utils.sheet_to_json(out.Sheets['סוגים'], { defval: '' }).map((t) => [t['סוג כפי שנאמר'], t['תיאור לתסקיר'], t['עומס (טון)'], t['סוג חדש']])));
const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: 'JSON' }).click()]);
console.log('8 JSON:', JSON.parse(readFileSync(await dl2.path(), 'utf8')).groups.map((g) => `${g.location} / ${g.lines[0].description} ×${g.lines[0].quantity}`).join(' ; '));
await browser.close(); server.close();
