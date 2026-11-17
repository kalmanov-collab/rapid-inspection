import { chromium } from 'playwright';
import { createServer } from 'http'; import { readFileSync, existsSync, statSync } from 'fs'; import { join, extname } from 'path';
import * as XLSX from 'xlsx';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.webmanifest':'application/manifest+json' };
const server = createServer((req,res)=>{ let f = join('dist', decodeURIComponent(req.url.split('?')[0])); if (!existsSync(f) || statSync(f).isDirectory()) f = 'dist/index.html'; res.setHeader('Content-Type', MIME[extname(f)] || 'application/octet-stream'); res.end(readFileSync(f)); }).listen(4600);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport:{width:412,height:1000}, acceptDownloads: true, locale: 'he-IL' });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
// מזהה דיבור מדומה
await page.addInitScript(() => {
  class FakeRecognition { start() { this.onstart?.(); window.__rec = this; } stop() { this.onend?.(); } abort() { this.onend?.(); } }
  window.SpeechRecognition = FakeRecognition; window.webkitSpeechRecognition = FakeRecognition;
  window.say = (text, confidence = 0.9) => window.__rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence }], { isFinal: true })] });
});
await page.goto('http://localhost:4600/'); await page.waitForTimeout(800);
await page.locator('input[type=file]').setInputFiles({ name: 'ריכוז מתקנים ואביזרים - חברת החשמל - מעודכן.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: readFileSync('/mnt/user-data/uploads/חברת החשמל/ריכוז מתקנים ואביזרים - חברת החשמל - מעודכן.xlsx') });
await page.waitForTimeout(3000);
console.log('site screen:', await page.locator('h1').innerText());
await page.locator('button', { hasText: 'קישון' }).first().click();
await page.locator('button', { hasText: 'התחל בדיקה' }).click();
await page.waitForTimeout(2500);
await page.locator('button', { hasText: 'התחל האזנה' }).click();
const say = async (t, c) => { await page.evaluate(([x, y]) => window.say(x, y), [t, c ?? 0.9]); await page.waitForTimeout(150); };
await say('מקום מחסן כלים');
await say('שאקל שבע שמיניות');
console.log('after type:', await page.evaluate(() => document.querySelector('main span.text-gray-300').innerText));
if ((await page.evaluate(() => document.querySelector('main span.text-gray-300').innerText)).startsWith('איזה')) await say('אחת');
await say('0498'); // 10498 נמצא במחסן כלים? (במאגר הוא אצל אבו זיד/קישון) - נראה
console.log('after 0498:', await page.evaluate(() => document.querySelector('main span.text-gray-300').innerText));
await say('חדש קיו 1 2 3 4 פסול חתך');
console.log('after new:', await page.evaluate(() => document.querySelector('main span.text-gray-300').innerText));
await page.waitForTimeout(600);
// רענון - הסשן צריך להישמר
await page.reload(); await page.waitForTimeout(1500);
console.log('home after reload:', (await page.locator('section').first().innerText()).split('\n').slice(0,3).join(' | '));
await page.locator('button', { hasText: 'המשך' }).click(); await page.waitForTimeout(1500);
console.log('resumed counts:', await page.locator('header').first().innerText().then(t => t.replace(/\n/g,' ')));
await page.screenshot({ path: 'tests/e2e-inspect.png', fullPage: true });
await page.locator('button', { hasText: 'סיום' }).click(); await page.waitForTimeout(500);
await page.screenshot({ path: 'tests/e2e-export.png', fullPage: true });
const [download] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: 'קובץ ריכוז מעודכן' }).click()]);
const path = await download.path(); console.log('downloaded:', download.suggestedFilename());
const wb = XLSX.read(readFileSync(path)); console.log('sheets:', wb.SheetNames);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
console.log('rows:', rows.length, 'new row:', JSON.stringify(rows.find(r => r["מס' סידורי / פנימי"] === 'Q1234')));
const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: 'JSON' }).click()]);
console.log('json:', JSON.parse(readFileSync(await dl2.path(), 'utf8')).groups.map(g => `${g.type} @ ${g.location}: ${g.lines.map(l => l.quantity).join('+')}`));
await browser.close(); server.close();
