// בדיקות להשוואת סוף יום ולייצוא - הרצה: node tests/reconcile.test.mjs [path-to-real-xlsx]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseSummaryWorkbook, buildUpdatedWorkbook, workbookToBytes, buildReportJson, buildInspectedRows, RESULT_COLUMNS } from '../src/services/excelService.js';
import { reconcile, familyOf, buildRowIndex } from '../src/services/reconcile.js';
import { createFieldState, applyTranscript, setTypeSetting, setMatchOverride } from '../src/utils/fieldSession.js';
import { buildTypeCatalog } from '../src/utils/typeCatalog.js';

// ---------- משפחות ----------
assert.equal(familyOf("רצועה עגולה ירוקה 4 מ'"), 'sling');
assert.equal(familyOf('רצועת הרמה'), 'sling');
assert.equal(familyOf('שאקל 7/8'), 'shackle');
assert.equal(familyOf('שקל הרמה במבנה Ω'), 'shackle');
assert.equal(familyOf('מענב שרשרת 2 ענפים'), 'chain');
assert.equal(familyOf('גלגלת העברה כבל 4TON'), 'block');
assert.equal(familyOf('גלגלת הרמה ידנית / מחגר'), 'hoist');
assert.equal(familyOf('כננת / גלגלת הרמה חשמלית'), 'winch');
assert.equal(familyOf('מענב כבל פלדה'), 'wire');
assert.equal(familyOf('משהו אחר'), null);

// ---------- קובץ סינתטי ----------
const header = ['אתר', "מס' תסקיר", 'סוג מתקן / אביזר', 'תיאור (כפי שבתסקיר)', "מס' סידורי / פנימי", 'תאריך בדיקה אחרונה', 'ממצא בבדיקה', 'קבוצה / מחזיק', 'מקור', 'הערות'];
const data = [
  header,
  ['קישון', 27098, 'רצועת הרמה', "רצועת הרמה עגולה אורך 4מ'", '07-2/1045', new Date(2026, 6, 23), 'תקין', 'מחסן כלים', 'תסקיר', 'הערה מקורית'],
  ['קישון', 27098, 'רצועת הרמה', "רצועת הרמה עגולה אורך 4מ'", '07-2/1046', new Date(2026, 6, 23), 'תקין', 'מחסן כלים', 'תסקיר', ''],
  ['קישון', 27102, 'רצועת הרמה', "רצועת הרמה עגולה אורך 4מ'", '96-4/2001', new Date(2026, 6, 23), 'תקין', 'דנה רוני', 'תסקיר', ''],
  ['קישון', 27102, 'שאקל', 'שאקל הרמה במבנה Ω גודל "7/8', '10498', new Date(2026, 6, 23), 'תקין', 'דנה רוני', 'תסקיר', ''],
  ['קישון', 27109, 'רצועת הרמה', "רצועת הרמה עגולה אורך 4מ'", 'K500158', new Date(2026, 6, 23), 'תקין', 'בלסיאנו יובל', 'תסקיר', ''],
  ['קישון', 27109, 'רצועת הרמה', "רצועת הרמה עגולה אורך 4מ'", '3000', new Date(2026, 6, 23), 'תקין', 'בלסיאנו יובל', 'תסקיר', ''],
  ['גזר', 25000, 'רצועת הרמה', "רצועת הרמה עגולה אורך 4מ'", '5555/1', new Date(2025, 1, 1), 'תקין', 'מחסן לוגיסטי', 'תסקיר', ''],
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'מרכז מתקנים ואביזרים');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['סיכום'], ['x', 1]]), 'סיכום לפי אתר');
const parsed = parseSummaryWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
assert.equal(parsed.columns.location, 'קבוצה / מחזיק');
assert.deepEqual(parsed.locationsBySite['קישון'].sort(), ['בלסיאנו יובל', 'דנה רוני', 'מחסן כלים'].sort());

// ---------- יום בדיקה ----------
let state = createFieldState({ site: 'קישון', clientName: 'חברת החשמל', knownLocations: parsed.locationsBySite['קישון'], catalog: buildTypeCatalog(parsed, 'קישון'), typeMemory: parsed.typeMemory });
const say = (t, c = 0.9) => { state = applyTranscript(state, t, c).state; };
say('מיקום מחסן כלים');
say('סוג רצועה עגולה ירוקה 4 מטר');
say('07-2/1045');                 // ישן, מלא
say('7/2/1046 פסול חתך');         // ישן, מלא בכתיב אחר
say('96-4/2001');                 // ישן - הועבר מדנה רוני
say('2345/3');                    // חדש
say('500158');                    // האות K לא נקלטה -> התאמה חלקית ל-K500158 (לבדיקה)
say('10498');                     // קיים כשאקל -> חדש + לבדיקה
say('5555/1');                    // קיים באתר אחר -> ישן + לבדיקה
say('9999', 0.5);                 // חדש, ביטחון נמוך -> לבדיקה
say('מיקום חדש ארובה');
say('סוג שאקל 7/8');
say('10498 תקין תווית דהויה');    // ישן, הועבר מדנה רוני, הערה על תקין

const rec = reconcile(parsed, state);
const byserial = Object.fromEntries(state.entries.map((e) => [`${e.serial}|${e.type}`, rec.results[e.id]]));
const r = (serial, type = 'רצועה עגולה ירוקה 4 מטר') => byserial[`${serial}|${type}`];

assert.equal(r('07-2/1045').status, 'old');
assert.equal(r('07-2/1045').kind, 'exact');
assert.equal(r('07-2/1045').moved, false);
assert.equal(r('7/2/1046').status, 'old');
assert.equal(r('96-4/2001').status, 'old');
assert.equal(r('96-4/2001').moved, true);
assert.equal(r('96-4/2001').prev.location, 'דנה רוני');
assert.equal(r('2345/3').status, 'new');
assert.equal(r('2345/3').review, false);
assert.equal(r('500158').status, 'old');
assert.equal(r('500158').kind, 'partial');
assert.equal(r('500158').review, true);
assert.equal(r('10498').status, 'new');
assert.equal(r('10498').kind, 'typeConflict');
assert.match(r('10498').reason, /שאקל/);
assert.equal(r('5555/1').status, 'old');
assert.equal(r('5555/1').kind, 'otherSite');
assert.equal(r('5555/1').review, true);
assert.equal(r('9999').review, true);
assert.equal(r('10498', 'שאקל 7/8').status, 'old');
assert.equal(r('10498', 'שאקל 7/8').moved, true);

assert.equal(rec.counts.total, 9);
assert.equal(rec.counts.old, 6);
assert.equal(rec.counts.new, 3);
assert.deepEqual(rec.notInspected.map((i) => parsed.rows[i]["מס' סידורי / פנימי"]), ['3000']);

// סוגים: תיאור לתסקיר מהפריטים שהותאמו; מיקומים: ארובה חדש
const sling = rec.types.find((t) => t.name === 'רצועה עגולה ירוקה 4 מטר');
assert.equal(sling.reportDescription, "רצועת הרמה עגולה אורך 4מ'");
assert.equal(sling.fileType, 'רצועת הרמה');
assert.equal(sling.newCount, 3);
assert.equal(rec.locations.find((l) => l.name === 'ארובה').isNew, true);
assert.equal(rec.locations.find((l) => l.name === 'מחסן כלים').isNew, false);

// הכרעה ידנית ועריכת סוג
state = setMatchOverride(state, state.entries.find((e) => e.serial === '500158').id, 'new');
state = setMatchOverride(state, state.entries.find((e) => e.serial === '10498' && e.type !== 'שאקל 7/8').id, 'new');
assert.equal(sling.swl, 2, 'עומס לפי צבע הרצועה');
state = setTypeSetting(state, sling.key, { swl: 2.5 });
const rec2 = reconcile(parsed, state, { index: buildRowIndex(parsed) });
assert.equal(rec2.results[state.entries.find((e) => e.serial === '500158').id].status, 'new');
assert.equal(rec2.notInspected.length, 2, 'K500158 חזר ל"לא נבדקו"');
assert.equal(rec2.types.find((t) => t.key === sling.key).swl, 2.5);

// ---------- ייצוא ----------
const meta = { clientName: 'חברת החשמל', site: 'קישון', date: '17/11/2026' };
const out = XLSX.read(workbookToBytes(buildUpdatedWorkbook(parsed, state, rec2, meta)), { type: 'array', cellDates: true });
assert.deepEqual(out.SheetNames, ['מרכז מתקנים ואביזרים', 'נבדקו 17.11.2026', 'לא נבדקו', 'סוגים', 'מיקומים', 'סיכום לפי אתר']);
const rows = XLSX.utils.sheet_to_json(out.Sheets['מרכז מתקנים ואביזרים'], { defval: '' });
assert.equal(rows.length, data.length - 1 + 4, '4 שורות חדשות (2345/3, 500158, 10498 כרצועה, 9999)');
const moved = rows.find((row) => row["מס' סידורי / פנימי"] === '96-4/2001');
assert.equal(moved['קבוצה / מחזיק'], 'מחסן כלים', 'המיקום עודכן לאחרון');
assert.equal(moved[RESULT_COLUMNS.previousLocation], 'דנה רוני');
assert.equal(moved[RESULT_COLUMNS.currentResult], 'תקין');
const failed = rows.find((row) => row["מס' סידורי / פנימי"] === '07-2/1046');
assert.equal(failed[RESULT_COLUMNS.currentResult], 'פסול');
assert.equal(failed[RESULT_COLUMNS.currentDefects], 'חתך / קרע');
const untouched = rows.find((row) => row["מס' סידורי / פנימי"] === '3000');
assert.equal(untouched[RESULT_COLUMNS.currentResult], '');
assert.equal(rows.find((row) => row["מס' סידורי / פנימי"] === '07-2/1045')['הערות'], 'הערה מקורית', 'עמודות קיימות נשמרות');
const otherSite = rows.find((row) => row["מס' סידורי / פנימי"] === '5555/1');
assert.equal(otherSite['אתר'], 'קישון', 'פריט מאתר אחר עבר לאתר הנוכחי');
const fresh = rows.find((row) => row["מס' סידורי / פנימי"] === '2345/3');
assert.equal(fresh[RESULT_COLUMNS.isNew], 'כן');
assert.equal(fresh['תיאור (כפי שבתסקיר)'], "רצועת הרמה עגולה אורך 4מ'");
assert.equal(fresh['סוג מתקן / אביזר'], 'רצועת הרמה');
assert.equal(fresh['מקור'], 'בדיקה בשטח');
assert.equal(fresh[RESULT_COLUMNS.swl], 2.5);
const shackleOk = rows.find((row) => row["מס' סידורי / פנימי"] === '10498' && row['סוג מתקן / אביזר'] === 'שאקל');
assert.equal(shackleOk['קבוצה / מחזיק'], 'ארובה');
assert.equal(shackleOk[RESULT_COLUMNS.currentDefects], 'חסר תווית / סימון');

const typesSheet = XLSX.utils.sheet_to_json(out.Sheets['סוגים'], { defval: '' });
assert.equal(typesSheet.find((t) => t['סוג כפי שנאמר'] === 'רצועה עגולה ירוקה 4 מטר')['עומס (טון)'], 2.5);

// הזיכרון נקרא בפעם הבאה
const reparsed = parseSummaryWorkbook(workbookToBytes(buildUpdatedWorkbook(parsed, state, rec2, meta)));
assert.equal(reparsed.typeMemory[sling.key].swl, 2.5);
assert.equal(reparsed.typeMemory[sling.key].reportDescription, "רצועת הרמה עגולה אורך 4מ'");
assert.equal(reparsed.rows.length, data.length - 1 + 4);

const inspected = buildInspectedRows(state, rec2, meta);
assert.equal(inspected.length, 9);
assert.equal(inspected[0]['מיקום'], 'ארובה');

const json = buildReportJson(state, rec2, meta);
assert.equal(json.groups.length, 2);
const storeGroup = json.groups.find((g) => g.location === 'מחסן כלים');
assert.equal(storeGroup.lines[0].quantity, 8);
assert.deepEqual(storeGroup.lines[0].failedSerials, ['7/2/1046']);
assert.equal(json.moved.length, 3);   // 96-4/2001, 10498 (שאקל), 5555/1 (מאתר אחר)
assert.equal(json.groups.find((g) => g.location === 'ארובה').defects[0].status, 'ok');

assert.equal(storeGroup.lines[0].swl, 2.5, 'העומס שנקבע לסוג נכנס ל-JSON');
assert.equal(json.swlUnit, 'ton');
assert.equal(json.groups.find((g) => g.location === 'ארובה').lines[0].swl, null, 'סוג ללא עומס -> null');
assert.deepEqual(json.missingSwl.map((t) => t.spokenType), ['שאקל 7/8']);

// ---------- עמודת "עומס עבודה בטוח (טון)" בקובץ ----------
{
  const header2 = [...header, 'עומס עבודה בטוח (טון)', 'מקור העומס'];
  const withLoad = (row, load, source) => [...row, load, source];
  const data2 = [
    header2,
    withLoad(['קישון', 1, 'שאקל', 'שאקל הרמה במבנה Ω גודל "3/4', 'A1', '', 'תקין', 'מחסן כלים', 'תסקיר', ''], 4.75, 'תסקיר'),
    withLoad(['קישון', 1, 'שאקל', 'שאקל הרמה במבנה Ω גודל "3/4', 'A2', '', 'תקין', 'מחסן כלים', 'תסקיר', ''], 4.75, 'תסקיר'),
    withLoad(['קישון', 1, 'שאקל', 'שאקל הרמה במבנה Ω גודל "3/4', 'A3', '', 'פסול', 'מחסן כלים', 'תסקיר', ''], '', 'לא נרשם בתסקיר'),
    withLoad(['קישון', 1, 'שאקל', 'שאקל הרמה במבנה Ω גודל "3/4', 'A4', '', 'תקין', 'מחסן כלים', 'תסקיר', ''], 3.25, 'תסקיר – לאמת'),
    withLoad(['קישון', 2, 'רצועת הרמה', "רצועת הרמה עגולה אורך 6מ' צבע כתום", 'B1', '', 'תקין', 'מחסן כלים', 'תסקיר', ''], 25, 'תסקיר'),
    withLoad(['קישון', 2, 'רצועת הרמה', "רצועת הרמה עגולה אורך 2מ'", 'C1', '', 'תקין', 'מחסן כלים', 'תסקיר', ''], 1, 'תסקיר'),
    withLoad(['קישון', 2, 'רצועת הרמה', "רצועת הרמה עגולה אורך 2מ'", 'C2', '', 'תקין', 'מחסן כלים', 'תסקיר', ''], 2, 'תסקיר'),
  ];
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(data2), 'מרכז מתקנים ואביזרים');
  const parsed2 = parseSummaryWorkbook(XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(parsed2.columns.swl, 'עומס עבודה בטוח (טון)');
  assert.equal(parsed2.columns.swlSource, 'מקור העומס');
  assert.equal(parsed2.columns.source, 'מקור');
  const catalog2 = buildTypeCatalog(parsed2, 'קישון');
  assert.equal(catalog2.find((c) => /3\/4/.test(c.description)).swl, 4.75, 'העומס הנפוץ בקובץ');
  assert.equal(catalog2.find((c) => /כתום/.test(c.description)).swl, 25, 'כתום מעל 10 טון - מהקובץ, לא מהצבע');
  assert.equal(catalog2.find((c) => /2מ/.test(c.description)).swl, '', 'עומסים מפוזרים - בלי עומס לתבנית');

  let s2 = createFieldState({ site: 'קישון', knownLocations: ['מחסן כלים'], catalog: catalog2 });
  const say2 = (t) => { s2 = applyTranscript(s2, t, 0.9).state; };
  say2('מיקום מחסן כלים');
  say2('סוג שאקל 3/4');
  ['A1', 'A3', 'A4', 'N1'].forEach(say2);
  say2('סוג רצועה עגולה כתומה 6 מטר');
  say2('B1');
  const rec3 = reconcile(parsed2, s2);
  const meta2 = { clientName: 'x', site: 'קישון', date: '21/11/2026' };
  const rows2 = XLSX.utils.sheet_to_json(buildUpdatedWorkbook(parsed2, s2, rec3, meta2).Sheets['מרכז מתקנים ואביזרים'], { defval: '' });
  const row2 = (serial) => rows2.find((x) => x["מס' סידורי / פנימי"] === serial);
  assert.equal(row2('N1')['עומס עבודה בטוח (טון)'], 4.75, 'פריט חדש מקבל את עומס הסוג');
  assert.equal(row2('N1')['מקור העומס'], 'בדיקה בשטח');
  assert.equal(row2('A3')['עומס עבודה בטוח (טון)'], 4.75, 'תא ריק מושלם');
  assert.equal(row2('A3')['מקור העומס'], 'בדיקה בשטח');
  assert.equal(row2('A4')['עומס עבודה בטוח (טון)'], 3.25, 'ערך מהתסקיר לא נדרס');
  assert.equal(row2('A4')['מקור העומס'], 'תסקיר – לאמת');
  assert.equal(row2('A2')['עומס עבודה בטוח (טון)'], 4.75);
  const json2 = buildReportJson(s2, rec3, meta2);
  assert.deepEqual(json2.groups.map((g) => g.lines[0].swl).sort((a, b) => a - b), [4.75, 25]);
  assert.deepEqual(json2.missingSwl, []);
}

// ---------- הקובץ האמיתי (אם קיים) ----------
const realPath = process.argv[2] || '/mnt/user-data/uploads/חברת החשמל/ריכוז מתקנים ואביזרים - חברת החשמל - מעודכן.xlsx';
if (existsSync(realPath)) {
  const t0 = Date.now();
  const real = parseSummaryWorkbook(readFileSync(realPath));
  const t1 = Date.now();
  const site = 'קישון';
  const realCatalog = buildTypeCatalog(real, site);
  let s = createFieldState({ site, knownLocations: real.locationsBySite[site], catalog: realCatalog });
  const sayReal = (t) => { s = applyTranscript(s, t).state; };
  sayReal('מיקום מחסן כלים');
  sayReal('סוג שאקל 7/8');
  assert.equal(s.pending, null, `שאקל 7/8 מותאם מיד לתבנית: ${JSON.stringify(s.pending?.candidates?.map((c) => c.description))}`);
  const siteShackles = real.rows.filter((row) => row['אתר'] === site && /7\/8/.test(row['תיאור (כפי שבתסקיר)']) && /שאקל|שקל/.test(row['תיאור (כפי שבתסקיר)'])).slice(0, 300);
  for (const row of siteShackles) sayReal(String(row["מס' סידורי / פנימי"]));
  for (let i = 0; i < 150; i++) sayReal(`Q${7000 + i}/1`);      // ~שליש חדשים
  const t2 = Date.now();
  const realRec = reconcile(real, s);
  const t3 = Date.now();
  assert.equal(realRec.counts.new, 150);
  assert.equal(realRec.counts.old, siteShackles.length);
  const bytes = workbookToBytes(buildUpdatedWorkbook(real, s, realRec, { ...meta, site }));
  const t4 = Date.now();
  writeFileSync('/tmp/claude-0/-home-claude/770c7e58-4613-5342-bf50-575d330ac2d6/scratchpad/ריכוז-v3-test.xlsx', Buffer.from(bytes));
  const again = parseSummaryWorkbook(bytes);
  assert.equal(again.rows.length, real.rows.length + 150);
  console.log(`  קובץ אמיתי: ${real.rows.length} שורות, ${realCatalog.length} תבניות סוג; קריאה ${t1 - t0}ms; ${s.entries.length} פריטים נאמרו (${t2 - t1}ms); השוואה ${t3 - t2}ms; ייצוא ${t4 - t3}ms`);
}

console.log('✔ השוואה וייצוא - כל הבדיקות עברו');
