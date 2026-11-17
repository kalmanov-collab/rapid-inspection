// בדיקות תרחיש למנוע הבדיקה המהירה (גרסה 2) - הרצה: node tests/rapidInspectionEngine.test.mjs
import assert from 'node:assert/strict';
import {
  createInitialState, applyTranscript, applyManualResult, applyManualNewItem, selectType, selectLocation, getCounts, itemsOfType,
} from '../src/utils/rapidInspectionEngine.js';

const catalog = [
  { id: 'rs-green-4', type: 'רצועת הרמה', description: "רצועת הרמה עגולה אורך 4מ'", swl: 2, aliases: ['רצועה ירוקה 4 מטר'] },
  { id: 'rs-green-1', type: 'רצועת הרמה', description: "רצועת הרמה עגולה אורך 1מ'", swl: 2, aliases: ['רצועה ירוקה 1 מטר'] },
  { id: 'sh-7-8', type: 'שאקל', description: 'שאקל הרמה במבנה Ω גודל "7/8', swl: 6.5, aliases: ['שאקל שבע שמיניות'] },
];
const session = {
  catalog,
  locations: ['מחסן כלים', 'דנה רוני', 'בלסיאנו יובל'],
  items: [
    { serial: '07-2/1045', catalogId: 'rs-green-4', location: 'מחסן כלים', prevReportNumber: '27098' },
    { serial: '07-2/1046', catalogId: 'rs-green-4', location: 'מחסן כלים' },
    { serial: '96-4/91045', catalogId: 'rs-green-4', location: 'דנה רוני' },   // אותן 4 ספרות אחרונות כמו 1045
    { serial: 'SP004702', catalogId: 'rs-green-1', location: 'מחסן כלים' },
    { serial: '10498', catalogId: 'sh-7-8', location: 'דנה רוני' },
    { serial: '24337', catalogId: 'sh-7-8', location: 'דנה רוני' },
  ],
};

let state = createInitialState(session);
let r;
const say = (text, conf = 0.9) => { r = applyTranscript(state, text, conf); state = r.state; return r; };

// מספר בלי סוג פעיל -> שגיאה
say('1046');
assert.equal(r.feedback.beep, 'error');
assert.equal(state.items['07-2/1046'].status, 'pending');

// מעבר מיקום וסוג
say('מקום מחסן כלים');
assert.equal(state.activeLocation, 'מחסן כלים');
say('רצועה ירוקה ארבע מטר');
assert.equal(state.activeTypeId, 'rs-green-4');
assert.match(r.feedback.message, /3 ברשימה/);

// פריט קיים - תקין
say('אחת אפס ארבע שש');
assert.equal(state.items['07-2/1046'].status, 'ok');
assert.equal(r.feedback.beep, 'ok');
assert.equal(state.moved.length, 0);

// שני פריטים עם אותן 4 ספרות -> "מה הספרה לפני?" -> ספרה אחת
say('1045 פסול חתך');
assert.equal(state.pendingQuestion?.type, 'disambiguate');
assert.equal(r.feedback.beep, 'ask');
say('תשע');                                   // 91045
assert.equal(state.pendingQuestion, null);
assert.equal(state.items['96-4/91045'].status, 'fail');
assert.deepEqual(state.items['96-4/91045'].defects.map((d) => d.code), ['CUT']);
// הפריט היה ב"דנה רוני" ונמצא ב"מחסן כלים" -> עדכון מיקום אוטומטי + רשימת מעברים
assert.equal(state.items['96-4/91045'].location, 'מחסן כלים');
assert.equal(state.items['96-4/91045'].prevLocation, 'דנה רוני');
assert.deepEqual(state.moved, ['96-4/91045']);
assert.match(r.feedback.message, /הועבר מ-דנה רוני/);

// הערה על פריט תקין - נשמרת, הסטטוס תקין
say('1045');
assert.equal(state.pendingQuestion?.type, 'disambiguate');
say('07-2/1045 תקין תווית דהויה');          // סיומת ארוכה יותר
assert.equal(state.items['07-2/1045'].status, 'ok');
assert.deepEqual(state.items['07-2/1045'].defects.map((d) => d.code), ['NO_TAG']);

// מספר לא ברשימה -> בקשה למספר מלא -> פריט חדש בסוג ובמיקום הפעילים
say('7780');
assert.equal(state.pendingQuestion?.type, 'needFullSerial');
say('אס פי אפס אפס שבע שבע שמונה אפס');     // בלי "חדש" - ספרות ואותיות לא מתפרשות כ-newItem...
// ...לכן האפליקציה מצפה ל"חדש <מספר>" או לספרות בלבד; נבדוק את שתי הדרכים:
if (state.pendingQuestion) say('חדש אס פי אפס אפס שבע שבע שמונה אפס');
assert.equal(state.pendingQuestion, null);
const newItem = state.items['SP007780'];
assert.ok(newItem, 'פריט חדש נוצר');
assert.equal(newItem.isNew, true);
assert.equal(newItem.catalogId, 'rs-green-4');
assert.equal(newItem.location, 'מחסן כלים');
assert.equal(newItem.status, 'ok');
assert.equal(r.feedback.beep, 'new');

// "חדש" + מספר מלא במשפט אחד, פסול
say('חדש אפס שבע מקף שתיים לוכסן שתיים אפס אפס אחת פסול קורוזיה');
assert.equal(state.items['07-2/2001'].status, 'fail');
assert.equal(state.items['07-2/2001'].isNew, true);
assert.equal(getCounts(state).new, 2);

// "בטל" על פריט חדש מסיר אותו
say('בטל');
assert.equal(state.items['07-2/2001'], undefined);
assert.ok(!state.order.includes('07-2/2001'));
assert.equal(getCounts(state).new, 1);

// "חדש" עם מספר שכבר קיים באותו סוג -> עדכון של הקיים, לא כפילות
say('חדש 07-2/1046 פסול שחיקה');
assert.equal(state.items['07-2/1046'].status, 'fail');
assert.equal(getCounts(state).total, 7);

// מספר שקיים בסוג אחר -> שאלה; "כן" מעביר לסוג הפעיל
say('0498');
assert.equal(state.pendingQuestion?.type, 'crossType');
say('כן');
assert.equal(state.items['10498'].catalogId, 'rs-green-4');
assert.equal(state.items['10498'].status, 'ok');

// מספר שקיים בסוג אחר -> "לא" -> מספר מלא -> חדש
say('4337');
assert.equal(state.pendingQuestion?.type, 'crossType');
say('לא');
assert.equal(state.pendingQuestion?.type, 'needFullSerial');
say('חדש 4337');
assert.equal(state.items['4337'].isNew, true);
assert.equal(state.items['24337'].status, 'pending');     // השאקל המקורי לא נגע

// סוג עמום -> בחירה במספר
say('רצועה ירוקה');
assert.equal(state.pendingQuestion?.type, 'chooseType');
say('שתיים');
assert.equal(state.activeTypeId, catalog.find((e) => e.description.includes("1מ'")).id);

// מיקום לא מוכר -> שאלה -> כן -> נוסף
say('מקום ארובה');
assert.equal(state.pendingQuestion?.type, 'newLocation');
say('כן');
assert.equal(state.activeLocation, 'ארובה');
assert.ok(state.locations.includes('ארובה'));

// ביטחון נמוך -> תור לבדיקה חוזרת
say('4702', 0.5);
assert.deepEqual(state.reviewQueue, ['SP004702']);
assert.equal(state.items['SP004702'].location, 'ארובה');       // עודכן אוטומטית

// המשך תיאור ללא מספר חל על הפריט הנוכחי
say('פסול סדק');
assert.equal(state.items['SP004702'].status, 'fail');

// פקודת מצב
say('מצב');
assert.match(r.feedback.speak, /חדשים 2/);

// פעולות ידניות
state = selectType(state, 'sh-7-8').state;
state = selectLocation(state, 'דנה רוני').state;
state = applyManualResult(state, '24337', 'notFound').state;
assert.equal(state.items['24337'].status, 'notFound');
state = applyManualNewItem(state, 'k999', 'ok').state;
assert.equal(state.items['K999'].catalogId, 'sh-7-8');
assert.equal(state.items['K999'].location, 'דנה רוני');
assert.equal(itemsOfType(state, 'sh-7-8').length, 2);   // 10498 הועבר לרצועות

const c = getCounts(state);
assert.equal(c.total, 9);
assert.equal(c.pending, 0);

console.log('✔ כל תרחישי המנוע עברו');
