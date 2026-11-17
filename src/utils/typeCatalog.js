/**
 * קטלוג הסוגים הקיימים ("תבניות") מתוך קובץ הריכוז, והתאמת סוג שנאמר לתבנית.
 *
 * כלל (החלטת המשתמש): משתמשים רק בתבניות קיימות. סוג שנאמר ולא מתאים לאף תבנית לא נוסף אוטומטית -
 * הבודק נשאל אם להוסיף סוג חדש וכותב בדיוק איך הוא יופיע.
 *
 * ההתאמה נעשית פעם אחת בכל החלפת סוג (לא לכל פריט), מול כמה מאות תבניות - מיידית.
 */
import { nameKey } from './fieldParser.js';

/** צבע רצועה -> עומס עבודה בטון (EN 1492), כברירת מחדל שניתן לערוך */
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

/** אסימוני השוואה של שם שנאמר */
export function spokenTokens(text) {
  let key = nameKey(String(text || '').replace(/שקל(?=\s|$)/g, 'שאקל'));
  for (const [pattern, replacement] of SPOKEN_FRACTIONS) key = key.replace(pattern, replacement);
  return key.split(' ').filter(Boolean);
}

/** מפתח קנוני לתיאור מהקובץ - מאחד ניסוחים שונים של אותו אביזר */
export function catalogKey(description) {
  const cleaned = String(description || '')
    .replace(/[ΩωΩ]/g, ' ')                       // אומגה (בשני קידודים)
    .replace(/שקל(?=[\s,]|$)/g, 'שאקל')
    .replace(/עומס:?\s*[\d.]+\s*(?:טון|TON)/gi, ' ')
    .replace(/מפולייאסטר|מפוליאסטר/g, ' ')
    .replace(/["״׳']/g, ' ')
    .replace(/(\d)(?=[א-ת]{2,})/g, '$1 ')                        // "3/8בקצוות" -> "3/8 בקצוות"
    .replace(/(\d)\s+מ(?=\s|$)/g, '$1מ');
  return nameKey(cleaned);
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

function score(spoken, pattern) {
  if (!spoken.length || !pattern.length) return 0;
  const hit = spoken.filter((s) => pattern.some((p) => sameWord(s, p))).length / spoken.length;
  const back = pattern.filter((p) => spoken.some((s) => sameWord(s, p))).length / pattern.length;
  let value = (hit + back) / 2;
  // מספר שנאמר (אורך / גודל) ולא מופיע בתבנית שיש בה מספרים - כנראה תבנית אחרת
  const spokenNumbers = spoken.filter((t) => /\d/.test(t));
  const patternNumbers = pattern.filter((t) => /\d/.test(t));
  if (spokenNumbers.length && patternNumbers.length && !spokenNumbers.every((n) => patternNumbers.includes(n))) value *= 0.5;
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
    if (!map.has(key)) map.set(key, { key, variants: new Map(), fileTypes: new Map(), count: 0, siteCount: 0 });
    const entry = map.get(key);
    entry.count++;
    const rowSite = columns.site ? String(row[columns.site]).trim() : site;
    if (rowSite === site) entry.siteCount++;
    entry.variants.set(description, (entry.variants.get(description) || 0) + 1);
    const fileType = columns.type ? String(row[columns.type] ?? '').trim() : '';
    if (fileType) entry.fileTypes.set(fileType, (entry.fileTypes.get(fileType) || 0) + 1);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  return [...map.values()]
    .map((entry) => ({
      key: entry.key,
      description: top(entry.variants),
      fileType: top(entry.fileTypes),
      swl: [...entry.variants.keys()].map(swlFromText).find((v) => v !== '') ?? '',
      count: entry.count,
      siteCount: entry.siteCount,
      tokens: entry.key.split(' '),
    }))
    .sort((a, b) => b.siteCount - a.siteCount || b.count - a.count);
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

  const scored = catalog
    .map((entry) => ({ entry, value: score(tokens, entry.tokens || entry.key.split(' ')) }))
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
