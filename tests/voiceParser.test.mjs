// בדיקות יחידה למנתח הקולי (גרסה 2) - הרצה: node tests/voiceParser.test.mjs
import assert from 'node:assert/strict';
import { parseVoiceCommand, matchCatalog, matchLocation, last4, normalizeTranscript } from '../src/utils/voiceParser.js';

const catalog = [
  { id: 'rs-green-4', type: 'רצועת הרמה', description: "רצועת הרמה עגולה אורך 4מ'", swl: 2, aliases: ['רצועה ירוקה 4 מטר', 'רצועה עגולה ירוקה 4 מטר'] },
  { id: 'rs-green-1', type: 'רצועת הרמה', description: "רצועת הרמה עגולה אורך 1מ'", swl: 2, aliases: ['רצועה ירוקה 1 מטר'] },
  { id: 'rs-yellow-4', type: 'רצועת הרמה', description: "רצועת הרמה עגולה אורך 4מ'", swl: 3, aliases: ['רצועה צהובה 4 מטר'] },
  { id: 'sh-7-8', type: 'שאקל', description: 'שאקל הרמה במבנה Ω גודל "7/8', swl: 6.5, aliases: ['שאקל 7 שמיניות', 'שאקל שבע שמיניות'] },
  { id: 'sh-3-4', type: 'שאקל', description: 'שאקל הרמה במבנה Ω גודל "3/4', swl: 4.75, aliases: ['שאקל שלושה רבעים', 'שאקל 3 רבעים'] },
  { id: 'ch-2-2', type: 'מענב שרשרת', description: "מענב שרשרת 2 ענפים אורך 2מ'", swl: 3.2, aliases: ['מענב שרשרת שני ענפים 2 מטר', 'מענב 2 ענפים 2 מטר'] },
];
const locations = ['מחסן כלים', 'דנה רוני', 'בלסיאנו יובל', 'מרגלית דורון', 'מחסן לוגיסטי'];
const opts = { catalog, locations };

const t = (text) => parseVoiceCommand(text, opts);
let n = 0;
const check = (text, expected) => {
  const r = t(text);
  for (const [k, v] of Object.entries(expected)) {
    if (Array.isArray(v)) assert.deepEqual(r[k], v, `"${text}" -> ${k}`);
    else assert.equal(r[k], v, `"${text}" -> ${k}: expected ${v}, got ${r[k]}`);
  }
  n++;
};

// --- מעבר סוג ---
check('רצועה ירוקה ארבע מטר', { kind: 'context', context: 'type', match: 'exact' });
assert.equal(t('רצועה ירוקה ארבע מטר').entry.id, 'rs-green-4');
assert.equal(t('רצועה ירוקה 4 מטר').entry.id, 'rs-green-4');
assert.equal(t('שאקל שבע שמיניות').entry.id, 'sh-7-8');
assert.equal(t('שאקל 7 שמיניות').entry.id, 'sh-7-8');
assert.equal(t('מענב שרשרת שני ענפים שני מטר').entry?.id, 'ch-2-2');
check('רצועה ירוקה', { kind: 'context', match: 'ambiguous' });        // 1 מטר או 4 מטר
check('רצועה ארבע מטר', { kind: 'context', match: 'ambiguous' });     // ירוקה או צהובה
check('בוקר טוב לכולם', { kind: 'noise' });

// --- מעבר מיקום ---
check('מקום מחסן כלים', { kind: 'context', context: 'location', match: 'exact', name: 'מחסן כלים' });
check('קבוצה דנה רוני', { kind: 'context', context: 'location', match: 'exact', name: 'דנה רוני' });
check('קבוצה בלסיאנו', { kind: 'context', context: 'location', match: 'exact', name: 'בלסיאנו יובל' });
check('מקום מחסן', { kind: 'context', context: 'location', match: 'ambiguous' });
check('מקום ארובה', { kind: 'context', context: 'location', match: 'none', spoken: 'ארובה' });

// --- פריט קיים ---
check('אחת אפס ארבע חמש', { kind: 'inspection', digits: '1045', status: 'ok', statusExplicit: false, note: '' });
check('1045', { kind: 'inspection', digits: '1045', status: 'ok' });
check('1 0 4 5', { kind: 'inspection', digits: '1045' });
check('אפס שתיים שלוש תשע פסול חתך', { kind: 'inspection', digits: '0239', status: 'fail' });
assert.deepEqual(t('אפס שתיים שלוש תשע פסול חתך').defects.map((d) => d.code), ['CUT']);
check('1045 תקין תווית דהויה', { kind: 'inspection', digits: '1045', status: 'ok', statusExplicit: true });   // הערה על פריט תקין
assert.deepEqual(t('1045 תקין תווית דהויה').defects.map((d) => d.code), ['NO_TAG']);
check('1045 לא נמצא', { kind: 'inspection', status: 'notFound' });
check('1045 חוליה שחוקה', { kind: 'inspection', status: 'fail', note: 'חוליה' });
check('12345', { kind: 'inspection', digits: '12345' });   // יותר מ-4 ספרות = התאמה לפי סיומת ארוכה
check('פסול סדק', { kind: 'inspection', digits: null, status: 'fail' });
check('תקין', { kind: 'inspection', digits: null, status: 'ok', statusExplicit: true });

// --- פריט חדש עם מספר מלא ---
check('חדש קי חמש אפס אפס אחת חמש שמונה', { kind: 'newItem', serial: 'K500158', status: 'ok' });
check('חדש אס פי אפס אפס ארבע שבע אפס שתיים', { kind: 'newItem', serial: 'SP004702' });
check('חדש אפס שבע מקף שתיים לוכסן אחת אפס ארבע חמש', { kind: 'newItem', serial: '07-2/1045' });
check('חדש 07-2/1046 פסול קורוזיה', { kind: 'newItem', serial: '07-2/1046', status: 'fail' });
check('חדש K500159', { kind: 'newItem', serial: 'K500159' });
check('חדש', { kind: 'newItem', serial: null });

// --- פקודות ---
for (const [text, command] of [['בטל', 'undo'], ['חזור', 'repeat'], ['מצב', 'status'], ['כן', 'yes'], ['לא', 'no']]) {
  check(text, { kind: 'command', command });
}

// --- עזרים ---
assert.equal(last4('07-2/1045'), '1045');
assert.equal(last4('K500158'), '0158');
assert.equal(last4('Z23'), '23');
assert.equal(normalizeTranscript('  שלוש,   ארבע. '), 'שלוש ארבע');
assert.equal(matchCatalog('', catalog).match, 'none');
assert.equal(matchLocation('מחסן כלים', locations).name, 'מחסן כלים');

console.log(`✔ כל בדיקות הפרסר עברו (${n + 14})`);
