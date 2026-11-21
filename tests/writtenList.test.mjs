// בדיקות למנתח לוח הכתיבה - הרצה: node tests/writtenList.test.mjs
import assert from 'node:assert/strict';
import { parseWrittenList } from '../src/utils/writtenList.js';

const serials = (text) => parseWrittenList(text).items.map((i) => `${i.serial}${i.status === 'fail' ? '!' : ''}${i.valid ? '' : '?'}`);

// פסיק מפריד; רווחים בתוך מספר לא משנים
assert.deepEqual(serials('2345/3, 2346/3,2347 / 3'), ['2345/3', '2346/3', '2347/3']);
// "פסול" אחרי המספר
assert.deepEqual(serials('2345/3 פסול, 2346/3'), ['2345/3!', '2346/3']);
assert.deepEqual(serials('2345/3פסול'), ['2345/3!']);
// שיבושי זיהוי של "פסול", "לא תקין", וסימון X
assert.deepEqual(serials('11 פסןל, 12 פסו, 13 לא תקין, 14 X, 15 x'), ['11!', '12!', '13!', '14!', '15!']);
// פסיק מיותר לפני "פסול" - חל על הקודם
assert.deepEqual(serials('2345/3, פסול, 2346/3'), ['2345/3!', '2346/3']);
// שורה חדשה / נקודה-פסיק / פסיקים כפולים / פסיק בסוף
assert.deepEqual(serials('100\n101; 102,, 103,'), ['100', '101', '102', '103']);
// אותיות, מקפים, אפסים מובילים, לוכסן הפוך
assert.deepEqual(serials('k500158, 07-2/1045, 12\\4, AB-17'), ['K500158', '07-2/1045', '12/4', 'AB-17']);
// סימנים תלויים בקצוות
assert.deepEqual(serials('.2345/3. , "77"'), ['2345/3', '77']);
// לא תקין: בלי ספרות / תווים זרים
assert.deepEqual(serials('abc, 12#4, ??, פסול'), ['ABC?', '12#4?', '???', '!?']);

// ליקוי והערה
const [cut, note, ok] = parseWrittenList('500 פסול חתך, 501 תקין תווית מלוכלכת, 502 תקין').items;
assert.equal(cut.status, 'fail');
assert.equal(cut.defects[0].code, 'CUT');
assert.equal(note.status, 'ok');
assert.equal(note.note, 'תווית מלוכלכת');
assert.equal(parseWrittenList('503 חסר תווית').items[0].defects[0].code, 'NO_TAG');
assert.equal(ok.status, 'ok');
assert.equal(parseWrittenList('600 סדק').items[0].status, 'fail', 'ליקוי בלי "פסול" = פסול');

const summary = parseWrittenList('1, 2 פסול, zz, 3');
assert.deepEqual([summary.validCount, summary.failCount, summary.invalidCount], [3, 1, 1]);
assert.equal(parseWrittenList('').items.length, 0);
assert.equal(parseWrittenList(null).items.length, 0);

console.log('✔ כל בדיקות לוח הכתיבה עברו');
