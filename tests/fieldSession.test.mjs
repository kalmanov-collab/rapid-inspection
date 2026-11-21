// בדיקות למנוע הבדיקה בשטח (גרסה 3) - הרצה: node tests/fieldSession.test.mjs
import assert from 'node:assert/strict';
import {
  createFieldState, applyTranscript, getCounts, currentEntries, setEntryStatus, removeEntry, undo, setTypeSetting, setMatchOverride,
  chooseType, confirmNewType, activeTypeInfo, setDraft, commitDraft, setLocation,
} from '../src/utils/fieldSession.js';
import { buildTypeCatalog, matchType, catalogKey, swlFromColor } from '../src/utils/typeCatalog.js';

// ---------- קטלוג מתוך "קובץ" ----------
const D = 'תיאור';
const rowsOf = (list) => list.flatMap(([description, type, n]) => Array.from({ length: n }, () => ({ 'אתר': 'קישון', 'סוג': type, [D]: description })));
const parsed = {
  columns: { site: 'אתר', type: 'סוג', description: D },
  rows: rowsOf([
    ["רצועת הרמה עגולה אורך 4מ'", 'רצועת הרמה', 5],
    ["רצועת הרמה עגולה מפולייאסטר אורך 4 מ'", 'רצועת הרמה', 2],     // ניסוח אחר של אותה תבנית
    ["רצועת הרמה עגולה אורך 1מ'", 'רצועת הרמה', 3],
    ["רצועת הרמה שטוחה בקצוות לולאות אורך 4מ'", 'רצועת הרמה', 2],
    ['שאקל הרמה במבנה Ωגודל "7/8', 'שאקל', 4],
    ['שקל הרמה במבנה Ω,עומס: 6.5 טון,גודל:"7/8', 'שאקל', 1],
    ['שאקל הרמה במבנה Ωגודל "3/4', 'שאקל', 2],
  ]),
};
const catalog = buildTypeCatalog(parsed, 'קישון');
assert.equal(catalog.length, 5, 'ניסוחים שונים מאוחדים לתבנית אחת');
assert.equal(catalog[0].description, "רצועת הרמה עגולה אורך 4מ'");
assert.equal(catalog[0].siteCount, 7);
assert.equal(catalog.find((c) => /7\/8/.test(c.description)).swl, 6.5);
assert.equal(catalogKey('שאקל הרמה במבנה Ωגודל "7/8'), catalogKey('שקל הרמה במבנה Ω,עומס: 6.5 טון,גודל:"7/8'));

assert.equal(matchType("רצועה עגולה ירוקה 4 מ'", catalog).entry.description, "רצועת הרמה עגולה אורך 4מ'");
assert.equal(matchType('שאקל 7/8', catalog).entry.swl, 6.5);
assert.equal(matchType('שאקל שבע שמיניות', catalog).match, 'exact');
assert.equal(matchType('שאקל שלושה רבעים', catalog).entry.description, 'שאקל הרמה במבנה Ωגודל "3/4');
assert.equal(matchType('רצועה 4 מטר', catalog).match, 'ambiguous');           // עגולה או שטוחה
assert.equal(matchType('שאקל', catalog).match, 'ambiguous');
assert.equal(matchType('מחגר 3 טון', catalog).match, 'none');
assert.equal(swlFromColor('רצועה עגולה ירוקה 4 מטר'), 2);
assert.equal(swlFromColor('שאקל ירוק'), '');

// ---------- בדיקה בשטח ----------
let state = createFieldState({ site: 'קישון', knownLocations: ['מחסן כלים', 'דנה רוני', 'מחסן כלים'], catalog });
assert.equal(state.locations.length, 2, 'מיקומים כפולים מהקובץ מאוחדים');
let r;
const say = (text, conf = 0.9) => { r = applyTranscript(state, text, conf); state = r.state; return r; };

// מספר לפני מיקום / סוג -> שגיאה
say('2345/3');
assert.equal(r.feedback.beep, 'error');
say('מיקום המחסן כלים');
assert.equal(state.location, 'מחסן כלים');
say('2345/3');
assert.equal(r.feedback.beep, 'error');
assert.equal(state.entries.length, 0);

// סוג שמתאים לתבנית קיימת: השם שנאמר נשמר, התבנית מהקובץ, עומס לפי צבע
say("סוג רצועה עגולה ירוקה 4 מ'");
assert.equal(state.pending, null);
assert.equal(state.type, 'רצועה עגולה ירוקה 4 מ');
assert.equal(activeTypeInfo(state).description, "רצועת הרמה עגולה אורך 4מ'");
assert.equal(activeTypeInfo(state).swl, 2);
assert.equal(activeTypeInfo(state).isNew, false);
assert.equal(r.feedback.beep, 'context');

// רצף מספרים
for (const n of ['2345/3', '2346/3', '07-2/1045']) say(n);
assert.equal(state.entries.length, 3);
assert.equal(state.entries[2].key, '7/2/1045');
say('2347/3 פסול חתך');
say('וגם שחיקה');
assert.deepEqual(state.entries[3].defects.map((d) => d.code), ['CUT', 'WEAR']);

// אותו מספר שוב -> עדכון; בטל מחזיר
say('2345 / 03 פסול סדק');
assert.equal(state.entries.length, 4);
assert.equal(r.feedback.beep, 'dup');
say('בטל');
assert.equal(state.entries[0].status, 'ok');

// סוג עמום -> שאלה; מספרים נחסמים עד הבחירה; בחירה במספר
say('סוג רצועה 4 מטר');
assert.equal(state.pending.kind, 'chooseType');
assert.equal(r.feedback.beep, 'ask');
assert.equal(state.type, 'רצועה עגולה ירוקה 4 מ', 'הסוג לא משתנה עד הבחירה');
say('5555/1');
assert.equal(r.feedback.beep, 'error');
assert.equal(state.entries.length, 4);
const flatIndex = state.pending.candidates.findIndex((c) => /שטוחה/.test(c.description));
say(String(flatIndex + 1));
assert.equal(state.pending, null);
assert.match(activeTypeInfo(state).description, /שטוחה/);
assert.equal(state.entries.length, 4, 'הספרה שימשה לבחירה ולא נרשמה כפריט');
say('סוג רצועה 4 מטר');                       // אותו שם שוב -> מיידי, בלי שאלה
assert.equal(state.pending, null);
assert.match(activeTypeInfo(state).description, /שטוחה/);

// סוג שלא מתאים לאף תבנית -> שאלה; "בטל" משאיר את הסוג הקודם
say('סוג מחגר 3 טון');
assert.equal(state.pending.kind, 'newType');
assert.match(r.feedback.message, /להוסיף סוג חדש/);
say('בטל');
assert.equal(state.pending, null);
assert.match(activeTypeInfo(state).description, /שטוחה/);
assert.equal(state.types.length, 2, 'סוג חדש לא נוסף בלי אישור');

// אישור סוג חדש: נכתב בדיוק כפי שיופיע
say('סוג מחגר 3 טון');
r = confirmNewType(state, 'מחגר ידני 3 טון', 3); state = r.state;
assert.equal(state.type, 'מחגר 3 טון');
assert.equal(activeTypeInfo(state).description, 'מחגר ידני 3 טון');
assert.equal(activeTypeInfo(state).isNew, true);
assert.equal(activeTypeInfo(state).swl, 3);
assert.ok(state.catalog.some((c) => c.description === 'מחגר ידני 3 טון'));
say('K011377');
assert.equal(state.entries[4].type, 'מחגר 3 טון');
say('סוג מחגר ידני 3 טון');                  // עכשיו קיים בקטלוג
assert.equal(state.pending, null);

// בחירה ישירה מרשימת הסוגים במסך
r = chooseType(state, catalog.find((c) => /3\/4/.test(c.description)).key); state = r.state;
assert.equal(state.type, 'שאקל הרמה במבנה Ωגודל "3/4');

// כינוי שנלמד בעבר (גיליון "סוגים") -> מיידי
let s2 = createFieldState({ site: 'קישון', catalog, typeMemory: { [`רצועה 4`]: { reportDescription: "רצועת הרמה שטוחה בקצוות לולאות אורך 4מ'", swl: 4 } } });
s2 = applyTranscript(s2, 'סוג רצועה 4 מטר').state;
assert.equal(s2.pending, null);
assert.match(activeTypeInfo(s2).description, /שטוחה/);
assert.equal(activeTypeInfo(s2).swl, 4);

// מיקום חדש שלא היה בקובץ
say('מיקום חדש ארובה');
assert.match(r.feedback.message, /חדש/);
assert.equal(state.locations.find((l) => l.name === 'ארובה').known, false);
say('קי 500158');
assert.equal(state.entries[5].serial, 'K500158');
assert.equal(state.entries[5].location, 'ארובה');

// ספירות, ביטול שינוי מיקום
assert.equal(getCounts(state).total, 6);
assert.equal(getCounts(state).fail, 1);
say('מיקום מחסן כלים');
say('סוג רצועה עגולה ירוקה ארבע מטר');
assert.equal(currentEntries(state).length, 4);
assert.equal(currentEntries(state)[0].serial, '2347/3');
say('בטל'); say('בטל');
assert.equal(state.location, 'ארובה');

// פעולות ידניות + ביטול מחיקה
state = setEntryStatus(state, state.entries[1].id, 'fail').state;
const removedId = state.entries[2].id;
state = removeEntry(state, removedId).state;
assert.equal(state.entries.length, 5);
state = undo(state).state;
assert.equal(state.entries[2].id, removedId);

state = setTypeSetting(state, 'abc', { swl: 2 });
state = setMatchOverride(state, 1, 'new');
assert.equal(state.matchOverrides[1], 'new');
state = setMatchOverride(state, 1, null);
assert.equal(state.matchOverrides[1], undefined);

const before = state;
say('בוקר טוב');
assert.equal(state, before);

// ---------- לוח כתיבה ----------
{
  let pad = createFieldState({ site: 'קישון', knownLocations: ['מחסן כלים'], catalog });
  const run = (result) => { pad = result.state; return result.feedback; };
  run(applyTranscript(pad, 'מיקום מחסן כלים'));
  run(applyTranscript(pad, "סוג רצועה עגולה ירוקה 4 מ'"));
  assert.equal(pad.draft, '');

  // רישום הלוח: פסיק מפריד, "פסול" אחרי המספר, מספר לא מזוהה נשאר בלוח
  pad = setDraft(pad, '2345/3, 2346/3 פסול, ??, K500158, 2345/03');
  let feedback = run(commitDraft(pad));
  assert.equal(pad.entries.length, 3, 'אותו מספר פעמיים בלוח = פריט אחד');
  assert.deepEqual(pad.entries.map((e) => [e.serial, e.status]), [['2345/03', 'ok'], ['2346/3', 'fail'], ['K500158', 'ok']].map(([s, st], i) => [i === 0 ? '2345/3' : s, st]));
  assert.equal(pad.entries[0].timesSaid, 2);
  assert.equal(pad.entries[1].location, 'מחסן כלים');
  assert.equal(pad.draft, '??', 'מה שלא זוהה נשאר לתיקון');
  assert.match(feedback.message, /נרשמו 3 מהלוח.*פסולים 1.*1 לא זוהו/);

  // החלפת מיקום נחסמת כל עוד נשאר בלוח מספר לא מזוהה
  feedback = run(applyTranscript(pad, 'מיקום חדש ארובה'));
  assert.equal(pad.location, 'מחסן כלים');
  assert.equal(feedback.beep, 'error');

  // ביטול אחד מחזיר את כל הלוח
  pad = setDraft(pad, '');
  pad = setDraft(pad, '7001, 7002 פסול חתך');
  run(commitDraft(pad));
  assert.equal(pad.entries.length, 5);
  assert.equal(pad.entries[4].defects[0].code, 'CUT');
  run(undo(pad));
  assert.equal(pad.entries.length, 3);
  assert.equal(pad.draft, '7001, 7002 פסול חתך');

  // החלפת מיקום / סוג רושמת את הלוח תחת ההקשר הישן ופותחת לוח ריק
  feedback = run(applyTranscript(pad, 'מיקום חדש ארובה'));
  assert.equal(pad.location, 'ארובה');
  assert.equal(pad.draft, '');
  assert.equal(pad.entries.length, 5);
  assert.equal(pad.entries[4].location, 'מחסן כלים');
  assert.match(feedback.message, /נרשמו 2 מהלוח.*מיקום: ארובה/);

  pad = setDraft(pad, '8001');
  run(applyTranscript(pad, 'סוג שאקל 7/8'));
  assert.equal(pad.draft, '');
  assert.match(pad.entries[5].type, /רצועה עגולה ירוקה/, 'נרשם תחת הסוג הקודם');
  assert.equal(pad.entries[5].location, 'ארובה');

  // סוג דו-משמעי: הלוח נרשם כבר בשלב השאלה, תחת הסוג הפעיל
  pad = setDraft(pad, '8002');
  run(applyTranscript(pad, 'סוג רצועה 4 מטר'));
  assert.equal(pad.pending.kind, 'chooseType');
  assert.equal(pad.entries[6].typeKey, pad.entries.find((e) => e.serial === '8002').typeKey);
  assert.match(pad.entries[6].type, /שאקל/);
  assert.equal(pad.draft, '');

  // ביטול רישום כשכבר נכתב משהו חדש בלוח - שום דבר לא נמחק
  run(chooseType(pad, pad.pending.candidates[0].key));
  pad = setDraft(pad, '8101, 8102');
  run(commitDraft(pad));
  pad = setDraft(pad, '8103');
  run(undo(pad));
  assert.equal(pad.draft, '8101, 8102, 8103');

  // לוח ריק / בלי מיקום
  assert.equal(commitDraft(setDraft(pad, ' , ')).feedback.beep, 'error');
  const empty = createFieldState({ site: 'קישון', catalog });
  assert.equal(commitDraft(setDraft(empty, '123')).feedback.beep, 'error');
  assert.equal(setLocation(setDraft(empty, '123'), 'מחסן').state.draft, '');
}

console.log('✔ כל תרחישי מנוע השטח עברו');
