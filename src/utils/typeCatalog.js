/**
 * קטלוג הסוגים הקיימים ("תבניות") מתוך קובץ הריכוז, והתאמת סוג שנאמר לתבנית.
 *
 * כלל (החלטת המשתמש): משתמשים רק בתבניות קיימות. סוג שנאמר ולא מתאים לאף תבנית לא נוסף אוטומטית -
 * הבודק נשאל אם להוסיף סוג חדש וכותב בדיוק איך הוא יופיע.
 *
 * ההתאמה נעשית פעם אחת בכל החלפת סוג (לא לכל פריט), מול כמה מאות תבניות - מיידית.
 */
import { nameKey } from './fieldParser.js';

/**
 * צבע רצועה -> עומס עבודה בטון (EN 1492), כברירת מחדל שניתן לערוך.
 * כתום הוא גם הצבע של כל עומס מעל 10 טון - שם העומס נלקח מעמודת העומס בקובץ (התבנית), לא מהצבע.
 */
const COLOR_SWL = [['סגול', 1], ['ירוק', 2], ['צהוב', 3], ['אפור', 4], ['אדום', 5], ['חום', 6], ['כחול', 8], ['כתום', 10]];

export function swlFromColor(text) {
  const value = String(text || '');
  if (!/רצוע|חגור|עניב/.test(value)) return '';
  return COLOR_SWL.find(([color]) => value.includes(color))?.[1] ?? '';
}

function swlFromText(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*(?:TON|טון)/i);
  return m ? Number(m[1]) : '';
}

/** שברים כפי שנאמרים -> כפי שנכתבים בקובץ */
const SPOKEN_FRACTIONS = [
  [/(^| )7 שמיניות/g, '$17/8'], [/(^| )5 שמיניות/g, '$15/8'], [/(^| )3 שמיניות/g, '$13/8'],
  [/(^| )3 רבעים/g, '$13/4'], [/(^| )3 רבעי/g, '$13/4'],
];

/** צבעי רצועות: צורה קנונית <- כל ההטיות ("ירוקה", "אדומות", "כתום") */
const COLOR_FORMS = [
  ['סגול', /^סגול(ה|ים|ות)?$/], ['ירוק', /^ירוק(ה|ים|ות)?$/], ['צהוב', /^צהוב(ה|ים|ות)?$/], ['אפור', /^אפור(ה|ים|ות)?$/],
  ['אדום', /^אדו(ם|מה|מים|מות)$/], ['חום', /^חו(ם|מה|מים|מות)$/], ['כחול', /^כחול(ה|ים|ות)?$/], ['כתום', /^כתו(ם|מה|מים|מות)$/],
];
const COLOR_NAMES = new Set(COLOR_FORMS.map(([name]) => name));

/** הצבע הקנוני של מילה, או null אם אינה צבע */
function colorOf(word) {
  return COLOR_FORMS.find(([, pattern]) => pattern.test(word))?.[0] ?? null;
}

/** אסימונים משותפים לשם שנאמר ולתיאור מהקובץ: המילה "צבע" מושמטת, והצבע עצמו בצורה קנונית */
function canonicalTokens(key) {
  return key.split(' ').filter((w) => w && w !== 'צבע').map((w) => colorOf(w) ?? w);
}

const HALF_WORDS = { אחד: 1, אחת: 1, שניים: 2, שתיים: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9 };

/** "חצי מטר" -> 0.5 ; "מטר וחצי" -> 1.5 ; "4 וחצי" / "ארבע וחצי" -> 4.5 */
function spokenHalves(text) {
  return text
    .replace(/(^|\s)מטר וחצי(?=\s|$)/g, '$11.5 מטר')
    .replace(/(^|\s)(\d+|[א-ת]+) וחצי(?=\s|$)/g, (match, lead, word) => {
      const number = /^\d+$/.test(word) ? Number(word) : HALF_WORDS[word];
      return number === undefined ? match : `${lead}${number}.5`;
    })
    .replace(/(^|\s)ו?חצי(?=\s|$)/g, '$10.5');
}

/** אסימוני השוואה של שם שנאמר */
export function spokenTokens(text) {
  let key = nameKey(spokenHalves(String(text || '').replace(/שקל(?=\s|$)/g, 'שאקל')));
  for (const [pattern, replacement] of SPOKEN_FRACTIONS) key = key.replace(pattern, replacement);
  return canonicalTokens(key);
}

/** מפתח קנוני לתיאור מהקובץ - מאחד ניסוחים שונים של אותו אביזר */
export function catalogKey(description) {
  const cleaned = String(description || '')
    .replace(/[ΩωΩ]/g, ' ')                       // אומגה (בשני קידודים)
    .replace(/שקל(?=[\s,]|$)/g, 'שאקל')
    .replace(/עומס:?\s*[\d.]+\s*(?:טון|TON)/gi, ' ')
    .replace(/מפולייאסטר|מפוליאסטר/g, ' ')
    .replace(/רצועות(?=\s)/g, 'רצועת').replace(/עגולות(?=\s|$)/g, 'עגולה').replace(/שטוחות(?=\s|$)/g, 'שטוחה')   // רבים -> יחיד
    .replace(/["״׳']/g, ' ')
    .replace(/(\d)(?=[א-ת]{2,})/g, '$1 ')                        // "3/8בקצוות" -> "3/8 בקצוות"
    .replace(/(\d)\s+מ(?=\s|$)/g, '$1מ');
  return canonicalTokens(nameKey(cleaned)).join(' ');
}

/** שתי מילים "אותה מילה": זהות, או אותו גזע (רצועה/רצועת, ירוק/ירוקה). מספרים - רק זהות. */
function sameWord(a, b) {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  const min = Math.min(a.length, b.length);
  if (min < 4) return false;
  let common = 0;
  while (common < min && a[common] === b[common]) common++;
  return common >= min - 1;
}

function score(spoken, pattern, colorInCatalog = false) {
  if (!spoken.length || !pattern.length) return 0;
  const hit = spoken.filter((s) => pattern.some((p) => sameWord(s, p))).length / spoken.length;
  const back = pattern.filter((p) => spoken.some((s) => sameWord(s, p))).length / pattern.length;
  let value = (hit + back) / 2;
  // מספר שנאמר (אורך / גודל) ולא מופיע בתבנית שיש בה מספרים - כנראה תבנית אחרת
  const spokenNumbers = spoken.filter((t) => /\d/.test(t));
  const patternNumbers = pattern.filter((t) => /\d/.test(t));
  if (spokenNumbers.length && patternNumbers.length && !spokenNumbers.every((n) => patternNumbers.includes(n))) value *= 0.5;
  // צבע שנאמר (= עומס הרצועה): תבנית בצבע אחר היא אביזר אחר.
  // כשבקובץ יש תבניות עם הצבע הזה, תבנית בלי צבע (רצועה שלא נרשם לה עומס) היא התאמה חלשה יותר.
  const spokenColors = spoken.filter((t) => COLOR_NAMES.has(t));
  const patternColors = pattern.filter((t) => COLOR_NAMES.has(t));
  if (spokenColors.length && patternColors.length && !spokenColors.every((c) => patternColors.includes(c))) value *= 0.3;
  else if (spokenColors.length && !patternColors.length && colorInCatalog) value *= 0.8;
  return value;
}

/**
 * בניית הקטלוג מכל הקובץ. ניסוחים שונים של אותו אביזר מאוחדים; התיאור המוצג הוא הנפוץ ביותר.
 * @returns {Array<{key, description, fileType, swl, count, siteCount, tokens}>} ממוין לפי שכיחות באתר
 */
export function buildTypeCatalog(parsed, site) {
  const { rows, columns } = parsed;
  const map = new Map();
  for (const row of rows) {
    const description = String(row[columns.description] ?? '').trim();
    const key = catalogKey(description);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, variants: new Map(), fileTypes: new Map(), loads: new Map(), count: 0, siteCount: 0 });
    const entry = map.get(key);
    entry.count++;
    const rowSite = columns.site ? String(row[columns.site]).trim() : site;
    if (rowSite === site) entry.siteCount++;
    entry.variants.set(description, (entry.variants.get(description) || 0) + 1);
    // עומס עבודה בטוח מעמודת הקובץ (אם קיימת)
    const load = columns.swl ? Number(row[columns.swl]) : NaN;
    if (columns.swl && row[columns.swl] !== '' && Number.isFinite(load) && load > 0) entry.loads.set(load, (entry.loads.get(load) || 0) + 1);
    const fileType = columns.type ? String(row[columns.type] ?? '').trim() : '';
    if (fileType) entry.fileTypes.set(fileType, (entry.fileTypes.get(fileType) || 0) + 1);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  return [...map.values()]
    .map((entry) => ({
      key: entry.key,
      description: top(entry.variants),
      fileType: top(entry.fileTypes),
      swl: dominantLoad(entry.loads) ?? [...entry.variants.keys()].map(swlFromText).find((v) => v !== '') ?? '',
      count: entry.count,
      siteCount: entry.siteCount,
      tokens: entry.key.split(' '),
    }))
    .sort((a, b) => b.siteCount - a.siteCount || b.count - a.count);
}

/** סף ההסכמה שמעליו עומס מהקובץ נחשב "העומס של הסוג" */
const LOAD_AGREEMENT = 0.6;

/**
 * העומס של תבנית לפי עמודת העומס בקובץ: הערך הנפוץ, בתנאי שרוב ברור של השורות מסכים עליו.
 * תבנית שהעומסים בה מפוזרים (למשל רצועה בלי צבע בתיאור) - undefined, והבודק ישלים במסך הסיכום.
 */
function dominantLoad(loads) {
  if (!loads.size) return undefined;
  const total = [...loads.values()].reduce((sum, n) => sum + n, 0);
  const [value, count] = [...loads.entries()].sort((a, b) => b[1] - a[1])[0];
  return count / total >= LOAD_AGREEMENT ? value : undefined;
}

/**
 * התאמת סוג שנאמר לקטלוג.
 * @returns {{match:'exact'|'ambiguous'|'none', entry?, candidates: Array}}
 */
export function matchType(spoken, catalog) {
  const tokens = spokenTokens(spoken);
  if (!tokens.length || !catalog?.length) return { match: 'none', candidates: [] };
  const joined = tokens.join(' ');
  const identical = catalog.find((entry) => entry.key === joined);
  if (identical) return { match: 'exact', entry: identical, candidates: [] };

  const spokenColors = tokens.filter((t) => COLOR_NAMES.has(t));
  const colorInCatalog = spokenColors.length > 0 && catalog.some((entry) => spokenColors.every((c) => (entry.tokens || entry.key.split(' ')).includes(c)));
  const scored = catalog
    .map((entry) => ({ entry, value: score(tokens, entry.tokens || entry.key.split(' '), colorInCatalog) }))
    .filter(({ value }) => value >= 0.5)
    .sort((a, b) => b.value - a.value || b.entry.siteCount - a.entry.siteCount);
  if (!scored.length) return { match: 'none', candidates: [] };
  const [best, second] = scored;
  if (best.value >= 0.75 && (!second || best.value - second.value >= 0.15)) return { match: 'exact', entry: best.entry, candidates: [] };
  // תבנית שקיימת באתר הנוכחי גוברת על ניסוחים דומים שקיימים רק באתרים אחרים
  const close = scored.filter((s) => best.value - s.value < 0.15);
  if (best.value >= 0.75 && best.entry.siteCount > 0 && close.slice(1).every((s) => s.entry.siteCount === 0)) {
    return { match: 'exact', entry: best.entry, candidates: [] };
  }
  return { match: 'ambiguous', candidates: scored.slice(0, 6).map((s) => s.entry) };
}
