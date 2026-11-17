// בדיקת סבב מלא על קובץ הריכוז האמיתי - הרצה: node tests/excelService.test.mjs [path-to-xlsx]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as XLSX from 'xlsx';
import {
  parseSummaryWorkbook, buildSession, defaultAliases, swlFromDescription, buildUpdatedWorkbook, workbookToBytes,
  buildInspectedRows, buildReportJson, RESULT_COLUMNS,
} from '../src/services/excelService.js';
import { createInitialState, applyTranscript } from '../src/utils/rapidInspectionEngine.js';

// --- כינויים ברירת מחדל ---
assert.deepEqual(defaultAliases('רצועת הרמה', "רצועת הרמה עגולה אורך 4מ'").slice(0, 2), ['רצועה עגולה 4 מטר', 'רצועה 4 מטר']);
assert.ok(defaultAliases('שאקל', 'שאקל הרמה במבנה Ωגודל "7/8').includes('שאקל שבע שמיניות'));
assert.ok(defaultAliases('שאקל', 'שאקל הרמה במבנה Ωגודל "1-1/8').includes('שאקל אינץ ושמינית'));
assert.ok(defaultAliases('מענב שרשרת', "מענב שרשרת 2 ענפים אורך 2מ'").includes('מענב 2 ענפים 2 מטר'));
assert.ok(defaultAliases('מענב שרשרת', "מענב שרשרת חד-ענפי אורך 1מ'").includes('מענב ענף אחד 1 מטר'));
assert.equal(swlFromDescription('שקל הרמה במבנה Ω,עומס: 6.5 טון'), 6.5);
assert.equal(swlFromDescription('מענב שרשרת G8 3.2TON'), 3.2);
assert.equal(swlFromDescription("רצועת הרמה עגולה אורך 4מ'"), '');

const path = process.argv[2] || '/mnt/user-data/uploads/חברת החשמל/ריכוז מתקנים ואביזרים - חברת החשמל - מעודכן.xlsx';
if (!existsSync(path)) {
  console.log('✔ בדיקות הכינויים עברו (קובץ ריכוז לא נמצא - דילוג על בדיקת הסבב המלא)');
  process.exit(0);
}

// --- קריאה ---
const parsed = parseSummaryWorkbook(readFileSync(path));
assert.equal(parsed.sheetName, 'מרכז מתקנים ואביזרים');
assert.ok(parsed.rows.length > 9000, `rows: ${parsed.rows.length}`);
assert.deepEqual(parsed.sites.sort(), ['אורות רבין', 'אשדוד', 'גזר', 'חיפה', 'קישון', 'רוטנברג'].sort());
assert.equal(parsed.columns.serial, "מס' סידורי / פנימי");

// --- סשן לקישון ---
const session = buildSession(parsed, 'קישון', { clientName: 'חברת החשמל' });
assert.ok(session.items.length > 3000, `items: ${session.items.length}`);
assert.ok(session.catalog.length > 100);
assert.ok(session.locations.includes('מחסן כלים'));
const strap4 = session.catalog.find((e) => e.description === "רצועת הרמה עגולה אורך 4מ'");
assert.ok(strap4 && strap4.aliases.includes('רצועה 4 מטר'));
const shackles78 = session.catalog.filter((e) => /7\/8/.test(e.description) && /שאקל|שקל/.test(e.description));
assert.equal(shackles78.length, 1, `ניסוחים שונים של שאקל 7/8 מאוחדים: ${shackles78.map((e) => e.description).join(' | ')}`);
assert.equal(shackles78[0].swl, 6.5, 'העומס נלקח מהניסוח שמכיל אותו');
assert.equal(session.items.filter((i) => i.catalogId === shackles78[0].id).length > 50, true);

// --- בדיקה קולית מדומה ---
let state = createInitialState(session);
const say = (t, c = 0.9) => { const r = applyTranscript(state, t, c); state = r.state; return r; };
say('מקום מחסן כלים');
assert.equal(state.activeLocation, 'מחסן כלים');
let r = say('רצועה ארבע מטר');
if (state.pendingQuestion?.type === 'chooseType') {
  const index = state.pendingQuestion.candidates.findIndex((e) => e.id === strap4.id);
  assert.ok(index >= 0, 'הרצועה העגולה בין המועמדים');
  say(String(index + 1));
}
assert.equal(state.activeTypeId, strap4.id, r.feedback.message);
const strapItem = session.items.find((i) => i.catalogId === strap4.id);
const key4 = strapItem.serial.replace(/\D/g, '').slice(-4);
r = say(key4);
if (state.pendingQuestion?.type === 'disambiguate') say(strapItem.serial);
assert.equal(state.items[strapItem.id].status, 'ok', r.feedback.message);
say('חדש קיו 7 7 8 0 פסול חתך');
assert.equal(state.items['Q7780'].isNew, true);
assert.equal(state.items['Q7780'].status, 'fail');

// --- ייצוא ---
const meta = { clientName: 'חברת החשמל', site: 'קישון', date: '17/11/2026' };
const inspected = buildInspectedRows(state, meta);
assert.equal(inspected.length, 2);
assert.equal(inspected.find((row) => row["מס' סידורי"] === 'Q7780')['תוצאה'], 'פסול');

const json = buildReportJson(state, meta);
assert.equal(json.groups.length, 1);
assert.equal(json.groups[0].lines.reduce((n, l) => n + l.quantity, 0), 2);
assert.equal(json.groups[0].defects[0].serial, 'Q7780');

const workbook = buildUpdatedWorkbook(parsed, state, meta);
const bytes = workbookToBytes(workbook);
const outPath = process.env.OUT || '/tmp/claude-0/-home-claude/770c7e58-4613-5342-bf50-575d330ac2d6/scratchpad/ריכוז-מעודכן-test.xlsx';
writeFileSync(outPath, Buffer.from(bytes));

// --- קריאה חוזרת של הקובץ המעודכן ---
const again = parseSummaryWorkbook(readFileSync(outPath));
assert.equal(again.rows.length, parsed.rows.length + 1, 'שורה אחת נוספה לפריט החדש');
const updatedRow = again.rows.find((row) => String(row[again.columns.serial]) === strapItem.serial && row[again.columns.site] === 'קישון');
assert.equal(updatedRow[RESULT_COLUMNS.currentResult], 'תקין');
assert.equal(updatedRow[RESULT_COLUMNS.currentDate], '17/11/2026');
const newRow = again.rows.find((row) => String(row[again.columns.serial]) === 'Q7780');
assert.equal(newRow[RESULT_COLUMNS.isNew], 'כן');
assert.equal(newRow[again.columns.description], strap4.description);
assert.equal(newRow[again.columns.location], 'מחסן כלים');
assert.ok(again.catalogOverrides[strap4.description].aliases.includes('רצועה 4 מטר'), 'גיליון קטלוג נכתב ונקרא');
assert.ok(XLSX.read(readFileSync(outPath)).SheetNames.some((n) => n.startsWith('נבדקו')));

console.log(`✔ סבב אקסל מלא עבר: ${parsed.rows.length} שורות, ${session.items.length} פריטים בקישון, ${session.catalog.length} סוגים`);
