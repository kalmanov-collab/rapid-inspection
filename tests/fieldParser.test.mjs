// בדיקות למנתח הקולי בשטח (גרסה 3) - הרצה: node tests/fieldParser.test.mjs
import assert from 'node:assert/strict';
import { parseFieldCommand, normalizeSerial, nameKey, normalizeTranscript } from '../src/utils/fieldParser.js';

let n = 0;
const check = (text, expected) => {
  const r = parseFieldCommand(text);
  for (const [k, v] of Object.entries(expected)) {
    if (Array.isArray(v)) assert.deepEqual(r[k], v, `"${text}" -> ${k}`);
    else assert.equal(r[k], v, `"${text}" -> ${k}: expected ${v}, got ${r[k]}`);
  }
  n++;
  return r;
};

// --- מיקום: רק עם מילת פתיחה ---
check('מיקום מחסן', { kind: 'location', name: 'מחסן' });
check('מיקום חדש מחסן כלים', { kind: 'location', name: 'מחסן כלים' });
check('החלף מיקום דנה רוני', { kind: 'location', name: 'דנה רוני' });
check('שנה מיקום ל קבוצת בלסיאנו', { kind: 'location', name: 'קבוצת בלסיאנו' });
check('מקום ארובה', { kind: 'location', name: 'ארובה' });
check('קבוצה דנה רוני', { kind: 'location', name: 'דנה רוני' });
check('המיקום החדש מחסן 2', { kind: 'location', name: 'מחסן 2' });     // מספר בשם מיקום - לא פריט
check('מיקום', { kind: 'location', name: '' });

// --- סוג: שם עם מספרים נשמר כמו שנאמר ---
check("סוג רצועה עגולה ירוקה 4 מ'", { kind: 'type', name: 'רצועה עגולה ירוקה 4 מ' });
check('סוג חדש שאקל 7/8', { kind: 'type', name: 'שאקל 7/8' });
check('החלף סוג מענב שרשרת 2 ענפים 2 מטר', { kind: 'type', name: 'מענב שרשרת 2 ענפים 2 מטר' });
check('סוג הבא מחגר 3 טון', { kind: 'type', name: 'מחגר 3 טון' });

// --- פריט: מספר מלא כמו שהוא ---
check('2345/3', { kind: 'item', serial: '2345/3', status: 'ok', statusExplicit: false, note: '' });
check('2345 / 3', { kind: 'item', serial: '2345/3' });
check('2345 לוכסן 3', { kind: 'item', serial: '2345/3' });
check('2345 קו נטוי 3', { kind: 'item', serial: '2345/3' });
check('07-2/1045', { kind: 'item', serial: '07-2/1045' });
check('אפס שבע מקף שתיים לוכסן 1045', { kind: 'item', serial: '07-2/1045' });
check('קי 500158', { kind: 'item', serial: 'K500158' });
check('אס פי 004702', { kind: 'item', serial: 'SP004702' });
check('K500158', { kind: 'item', serial: 'K500158' });
check('2,345', { kind: 'item', serial: '2345' });
check('מספר 2345', { kind: 'item', serial: '2345' });
const failItem = check('2345/3 פסול חתך', { kind: 'item', serial: '2345/3', status: 'fail', statusExplicit: true });
assert.deepEqual(failItem.defects.map((d) => d.code), ['CUT']);
check('2345 חוליה שחוקה', { kind: 'item', serial: '2345', status: 'fail', note: 'חוליה' });
check('2345 תקין תווית דהויה', { kind: 'item', status: 'ok', statusExplicit: true });
check('1045 או 1046', { kind: 'item', serial: '1045' });     // "או" באמצע לא נקלט כאות

// --- תוצאה בלי מספר ---
check('פסול סדק', { kind: 'result', status: 'fail' });
check('תקין', { kind: 'result', status: 'ok' });

// --- פקודות ורעש ---
for (const [text, command] of [['בטל', 'undo'], ['חזור', 'repeat'], ['מצב', 'status'], ['עצור', 'pause'], ['המשך', 'resume']]) {
  check(text, { kind: 'command', command });
}
check('בוקר טוב', { kind: 'noise' });
check('', { kind: 'noise' });

// --- נרמול מספרים ---
assert.equal(normalizeSerial('07-2/1045'), '7/2/1045');
assert.equal(normalizeSerial('7/2/1045'), '7/2/1045');
assert.equal(normalizeSerial('2345 / 03'), '2345/3');
assert.equal(normalizeSerial('k500158'), 'K500158');
assert.equal(normalizeSerial('16904/03'), normalizeSerial('16904-3'));
assert.equal(normalizeSerial('0158'), '158');

// --- מפתח שם ---
assert.equal(nameKey("רצועה ירוקה ארבע מ'"), nameKey('רצועה ירוקה 4 מטר'));
assert.equal(nameKey('הרצועה הירוקה 4 מטר'), nameKey('רצועה ירוקה 4 מטר'));
assert.equal(nameKey('מחסן כלים'), nameKey('המחסן כלים'));
assert.notEqual(nameKey('רצועה ירוקה 4 מטר'), nameKey('רצועה ירוקה 1 מטר'));
assert.equal(normalizeTranscript("4 מ'"), '4 מ');

console.log(`✔ כל בדיקות המנתח עברו (${n + 15})`);
