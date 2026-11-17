/**
 * השוואת סוף יום: הרשימה שנאספה בשטח מול הרשימה הקודמת (קובץ הריכוז).
 *
 * כלל ההתאמה (לפי בקשת המשתמש): מספר + סוג. המיקום לא משתתף בהשוואה ומתעדכן לאחרון.
 *  - מספר: מנורמל (normalizeSerial) - "07-2/1045" == "7/2/1045".
 *  - סוג: לפי משפחה (רצועה / שאקל / מענב שרשרת / ...), כי הניסוח שנאמר בשטח
 *    ("רצועה עגולה ירוקה 4 מ'") אף פעם לא יהיה זהה מילה במילה לניסוח בקובץ.
 *
 * תוצאה לכל פריט: old (קיים) / new (חדש), סוג ההתאמה, ודגל "לבדיקה" כשיש ספק.
 * החישוב מקומי ומהיר (מפתח -> שורות), גם עבור 10,000 שורות.
 */
import { normalizeSerial, nameKey } from '../utils/fieldParser.js';
import { formatDate, swlFromDescription } from './excelService.js';

// ---------- משפחות סוגים ----------

/** סדר הבדיקה חשוב: הראשון שמתאים קובע ("גלגלת העברה כבל" = גלגלת, לא כבל) */
const FAMILIES = [
  { id: 'sling', label: 'רצועת הרמה', pattern: /רצוע|חגור|עניב/ },
  { id: 'shackle', label: 'שאקל', pattern: /שאקל|שקל|שקאל/ },
  { id: 'chain', label: 'מענב שרשרת', pattern: /שרשר/ },
  { id: 'winch', label: 'כננת', pattern: /כננת/ },
  { id: 'hoist', label: 'גלגלת הרמה ידנית / מחגר', pattern: /מחגר|גלגלת הרמה|טירפור|מכשיר הרמה|מתיחה/ },
  { id: 'block', label: 'גלגלת העברה / הגשה / הנחה', pattern: /גלגלת|גלגלות|בלוק/ },
  { id: 'wire', label: 'מענב כבל פלדה', pattern: /כבל/ },
  { id: 'eyebolt', label: 'אוזן הרמה / בורג עין', pattern: /אוזן|בורג עין|עין הרמה/ },
  { id: 'ring', label: 'טבעת הרמה / סביבול', pattern: /טבעת|סביבול/ },
  { id: 'rope', label: 'חבל', pattern: /חבל/ },
  { id: 'jack', label: "מגבה / ליבר / ג'ק", pattern: /מגבה|ליבר|ג['׳]?ק\b|גק/ },
  { id: 'hook', label: 'אונקל', pattern: /אונקל|\bוו\b/ },
  { id: 'clamp', label: 'תופסן / מהדק הרמה', pattern: /חובק|תפסן|תופסן|מהדק/ },
  { id: 'beam', label: 'קורת הרמה', pattern: /קורת הרמה|קורה|מוט פיזור|ספרדר/ },
  { id: 'trolley', label: 'קרונית (חתול רץ)', pattern: /קרונית|חתול/ },
];

/** משפחת סוג מתוך טקסט; null = לא זוהתה */
export function familyOf(text) {
  const value = String(text || '');
  return FAMILIES.find((f) => f.pattern.test(value))?.id ?? null;
}

export function familyLabel(id) {
  return FAMILIES.find((f) => f.id === id)?.label ?? '';
}

/** משפחה לא מזוהה בצד אחד = תואם (אבל מסומן לבדיקה) */
function compatible(a, b) {
  return !a || !b || a === b;
}

function toTime(value) {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

// ---------- אינדקס הקובץ ----------

/**
 * אינדקס שורות הריכוז: מפתח מספר מנורמל -> אינדקסי שורות, ומשפחה לכל שורה.
 * נבנה פעם אחת לכל קובץ.
 */
export function buildRowIndex(parsed) {
  const { rows, columns } = parsed;
  const byKey = new Map();
  const meta = rows.map((row, index) => {
    const key = normalizeSerial(row[columns.serial]);
    if (key) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(index);
    }
    const typeText = columns.type ? String(row[columns.type] ?? '') : '';
    const description = String(row[columns.description] ?? '');
    return {
      key,
      site: columns.site ? String(row[columns.site] ?? '').trim() : '',
      family: familyOf(typeText) || familyOf(description),
      description,
      typeText,
      location: columns.location ? String(row[columns.location] ?? '').trim() : '',
      lastInspection: columns.lastInspection ? row[columns.lastInspection] : '',
      reportNumber: columns.reportNumber ? String(row[columns.reportNumber] ?? '') : '',
      prevResult: columns.prevResult ? String(row[columns.prevResult] ?? '') : '',
    };
  });
  return { byKey, meta };
}

/** התאמה חלקית: המספר שנאמר הוא סיומת של מספר בקובץ ("1045" מול "07-2/1045", "500158" מול "K500158") */
function isSuffixMatch(rowKey, entryKey) {
  if (!rowKey || !entryKey || rowKey === entryKey || entryKey.length < 3) return false;
  if (!rowKey.endsWith(entryKey)) return false;
  const before = rowKey[rowKey.length - entryKey.length - 1];
  return before === '/' || /[A-Z]/.test(before);
}

// ---------- השוואה ----------

/**
 * @param {Object} parsed - תוצאת parseSummaryWorkbook
 * @param {Object} state - מצב הבדיקה (fieldSession)
 * @param {Object} [options]
 * @param {Object} [options.index] - buildRowIndex(parsed) מוכן (לחיסכון)
 * @returns {{
 *   results: Object<number, {status:'old'|'new', kind, rowIndex, review, reason, prev}>,
 *   types: Array, locations: Array, notInspected: number[], counts: Object
 * }}
 */
export function reconcile(parsed, state, options = {}) {
  const index = options.index || buildRowIndex(parsed);
  const site = state.site;
  const usedRows = new Map(); // rowIndex -> entryId
  const results = {};

  const pick = (candidates) => {
    const free = candidates.filter((i) => !usedRows.has(i));
    if (free.length === 0) return null;
    return free.sort((a, b) => {
      const siteA = index.meta[a].site === site ? 0 : 1;
      const siteB = index.meta[b].site === site ? 0 : 1;
      return siteA - siteB || toTime(index.meta[b].lastInspection) - toTime(index.meta[a].lastInspection);
    })[0];
  };

  // קודם התאמות מלאות לכל הפריטים, ורק אחר כך חלקיות - כדי שהתאמה חלקית לא "תתפוס" שורה של התאמה מלאה
  const pendingPartial = [];
  const typeFamily = Object.fromEntries(state.types.map((t) => [t.key, familyOf(t.description) || familyOf(t.name)]));
  const familyFor = (entry) => (entry.typeKey in typeFamily ? typeFamily[entry.typeKey] : familyOf(entry.type));

  for (const entry of state.entries) {
    const family = familyFor(entry);
    const candidates = index.byKey.get(entry.key) || [];
    const sameFamily = candidates.filter((i) => compatible(family, index.meta[i].family));
    const chosen = pick(sameFamily);

    if (chosen !== null) {
      usedRows.set(chosen, entry.id);
      const row = index.meta[chosen];
      const reasons = [];
      if (row.site !== site) reasons.push(`נמצא באתר ${row.site || 'אחר'}`);
      if (!family || !row.family) reasons.push('הסוג לא זוהה - הותאם לפי מספר בלבד');
      results[entry.id] = { status: 'old', kind: row.site === site ? 'exact' : 'otherSite', rowIndex: chosen, review: reasons.length > 0, reason: reasons.join('; ') };
      continue;
    }

    if (candidates.length > 0) {
      const other = index.meta[candidates[0]];
      results[entry.id] = {
        status: 'new',
        kind: sameFamily.length ? 'duplicate' : 'typeConflict',
        rowIndex: null,
        review: true,
        reason: sameFamily.length ? 'המספר כבר הותאם לפריט אחר שנאמר היום' : `המספר קיים בקובץ כ"${other.description}" (${other.location || other.site})`,
        conflictRow: candidates[0],
      };
      continue;
    }
    pendingPartial.push(entry);
  }

  // התאמות חלקיות - רק באתר הנוכחי, רק באותה משפחה, רק אם יחידה
  if (pendingPartial.length) {
    const siteRows = [];
    for (let i = 0; i < index.meta.length; i++) if (index.meta[i].site === site || !index.meta[i].site) siteRows.push(i);
    for (const entry of pendingPartial) {
      const family = familyFor(entry);
      const matches = siteRows.filter((i) => !usedRows.has(i) && compatible(family, index.meta[i].family) && isSuffixMatch(index.meta[i].key, entry.key));
      if (matches.length === 1) {
        usedRows.set(matches[0], entry.id);
        const row = index.meta[matches[0]];
        results[entry.id] = { status: 'old', kind: 'partial', rowIndex: matches[0], review: true, reason: `התאמה חלקית ל-${parsed.rows[matches[0]][parsed.columns.serial]} (${row.description})` };
      } else if (matches.length > 1) {
        results[entry.id] = { status: 'new', kind: 'ambiguous', rowIndex: null, review: true, reason: `${matches.length} התאמות חלקיות - לא הוכרע` };
      } else {
        results[entry.id] = { status: 'new', kind: 'none', rowIndex: null, review: false, reason: '' };
      }
    }
  }

  // ביטחון זיהוי נמוך -> לבדיקה
  for (const entry of state.entries) {
    const result = results[entry.id];
    if (entry.confidence !== null && entry.confidence !== undefined && entry.confidence < 0.75) {
      result.review = true;
      result.reason = [result.reason, 'זיהוי קולי בביטחון נמוך'].filter(Boolean).join('; ');
    }
  }

  // הכרעות ידניות מהמסך
  for (const [id, override] of Object.entries(state.matchOverrides || {})) {
    const result = results[id];
    if (!result) continue;
    if (override === 'new' && result.status === 'old') {
      usedRows.delete(result.rowIndex);
      results[id] = { ...result, status: 'new', rowIndex: null, overridden: true, review: false };
    } else if (override === 'old' && result.status === 'new') {
      const row = result.conflictRow ?? null;
      if (row !== null && !usedRows.has(row)) {
        usedRows.set(row, Number(id));
        results[id] = { ...result, status: 'old', rowIndex: row, overridden: true, review: false };
      }
    } else if (override) {
      results[id] = { ...result, overridden: true, review: false };
    }
  }

  // פרטי השורה הקודמת לכל פריט ישן
  for (const entry of state.entries) {
    const result = results[entry.id];
    if (result.rowIndex === null || result.rowIndex === undefined) continue;
    const row = index.meta[result.rowIndex];
    result.prev = {
      serial: String(parsed.rows[result.rowIndex][parsed.columns.serial] ?? ''),
      description: row.description,
      typeText: row.typeText,
      location: row.location,
      site: row.site,
      date: formatDate(row.lastInspection),
      reportNumber: row.reportNumber,
      result: row.prevResult,
    };
    result.moved = Boolean(row.location) && nameKey(row.location) !== nameKey(entry.location);
  }

  // שורות האתר שלא נבדקו היום
  const notInspected = [];
  for (let i = 0; i < index.meta.length; i++) {
    if ((index.meta[i].site === site || (!index.meta[i].site && !parsed.columns.site)) && !usedRows.has(i)) notInspected.push(i);
  }

  const types = summarizeTypes(parsed, state, results);
  const locations = summarizeLocations(state);

  const counts = { total: state.entries.length, old: 0, new: 0, ok: 0, fail: 0, review: 0, moved: 0, notInspected: notInspected.length };
  for (const entry of state.entries) {
    const result = results[entry.id];
    counts[result.status]++;
    counts[entry.status]++;
    if (result.review) counts.review++;
    if (result.moved) counts.moved++;
  }

  return { results, types, locations, notInspected, counts };
}

/**
 * סיכום לכל סוג שנאמר: תיאור לתסקיר ועומס.
 * התיאור הוא התבנית שנבחרה בשטח (קיימת בקובץ, או סוג חדש שהבודק כתב); ניתן לעריכה במסך הסיכום.
 */
function summarizeTypes(parsed, state, results) {
  return state.types.map((type) => {
    const entries = state.entries.filter((e) => e.typeKey === type.key);
    const settings = state.typeSettings?.[type.key] || {};
    const reportDescription = settings.reportDescription ?? type.description ?? type.name;
    const family = familyOf(reportDescription) || familyOf(type.name);
    const fromText = swlFromDescription(reportDescription);
    const swl = settings.swl ?? (type.swl !== '' && type.swl !== undefined ? type.swl : fromText);
    return {
      key: type.key,
      name: type.name,
      family,
      fileType: type.fileType || familyLabel(family) || type.name,
      reportDescription,
      swl,
      count: entries.length,
      newCount: entries.filter((e) => results[e.id].status === 'new').length,
      failCount: entries.filter((e) => e.status === 'fail').length,
      isNewType: Boolean(type.isNew),
    };
  }).filter((t) => t.count > 0);
}

function summarizeLocations(state) {
  const used = new Map();
  for (const entry of state.entries) used.set(nameKey(entry.location), (used.get(nameKey(entry.location)) || 0) + 1);
  return state.locations
    .filter((l) => used.has(l.key))
    .map((l) => ({ name: l.name, key: l.key, count: used.get(l.key), isNew: !l.known }));
}
