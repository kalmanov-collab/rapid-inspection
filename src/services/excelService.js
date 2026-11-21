/**
 * שירות אקסל: קריאת קובץ הריכוז ועדכונו בתוצאות הבדיקה (גרסה 3).
 *
 * הקובץ הנתמך הוא "ריכוז מתקנים ואביזרים" (עמודות: אתר, סוג מתקן / אביזר, תיאור (כפי שבתסקיר),
 * מס' סידורי / פנימי, תאריך בדיקה אחרונה, ממצא בבדיקה, קבוצה / מחזיק, מס' תסקיר ...).
 * העמודות מזוהות לפי הכותרת; עמודות אחרות נשמרות כמו שהן.
 *
 * הייצוא כותב: את גיליון הריכוז המעודכן (מיקום מתעדכן לאחרון, שורות לפריטים חדשים, עמודות הבדיקה הנוכחית),
 * "נבדקו <תאריך>", "לא נבדקו", "סוגים" (תיאור לתסקיר ועומס לכל סוג שנאמר - נקרא בפעם הבאה), "מיקומים".
 *
 * עובד גם ב-node (בדיקות) וגם בדפדפן.
 */
import * as XLSX from 'xlsx';
import { nameKey } from '../utils/fieldParser.js';

/** מפתחות פנימיים -> כותרות אפשריות בקובץ */
const COLUMN_ALIASES = {
  site: ['אתר'],
  reportNumber: ['מס תסקיר', "מס' תסקיר", 'מספר תסקיר'],
  type: ['סוג מתקן', 'סוג אביזר'],
  description: ['תיאור (כפי שבתסקיר)', 'תיאור'],
  serial: ['מס סידורי', "מס' סידורי", 'מספר סידורי', 'סידורי'],
  lastInspection: ['תאריך בדיקה אחרונה', 'בדיקה אחרונה'],
  prevResult: ['ממצא בבדיקה', 'ממצא'],
  location: ['קבוצה / מחזיק', 'קבוצה', 'מחזיק', 'מיקום'],
  source: ['מקור'],
  swl: ['עומס עבודה בטוח (טון)', 'עומס עבודה בטוח'],
  swlSource: ['מקור העומס'],
};

/** הערך שנכתב בעמודת "מקור העומס" כשהעומס נקבע בבדיקה בשטח */
const FIELD_SOURCE = 'בדיקה בשטח';

/** עמודות הבדיקה הנוכחית שהאפליקציה מוסיפה (או מעדכנת אם כבר קיימות) */
export const RESULT_COLUMNS = {
  currentDate: 'תאריך בדיקה נוכחית',
  currentResult: 'תוצאה נוכחית',
  currentDefects: 'ליקויים / הערה נוכחית',
  currentLocation: 'מיקום נוכחי',
  previousLocation: 'מיקום קודם (אם הועבר)',
  spokenType: 'סוג כפי שנאמר',
  swl: 'עומס עבודה (טון)',
  isNew: 'פריט חדש',
  review: 'לבדיקה',
  confidence: 'ביטחון זיהוי',
};

/** גיליונות שהאפליקציה כותבת מחדש בכל ייצוא (לא מועתקים מהקובץ הקודם) */
const TYPES_SHEET = 'סוגים';
const LOCATIONS_SHEET = 'מיקומים';
const NOT_INSPECTED_SHEET = 'לא נבדקו';
const GENERATED_SHEETS = new Set([TYPES_SHEET, LOCATIONS_SHEET, NOT_INSPECTED_SHEET, 'קטלוג']);

const STATUS_TEXT = { ok: 'תקין', fail: 'פסול' };
const RESULT_HEADERS = new Set(Object.values(RESULT_COLUMNS));

// ---------- עזרים ----------

function normalizeHeader(value) {
  return String(value ?? '').replace(/['"״׳]/g, '').replace(/\s+/g, ' ').trim();
}

function findColumn(headers, candidates) {
  const usable = headers.filter((h) => !RESULT_HEADERS.has(h));
  const normalized = usable.map(normalizeHeader);
  for (const candidate of candidates) {
    const exact = normalized.findIndex((h) => h === normalizeHeader(candidate));
    if (exact !== -1) return usable[exact];
  }
  for (const candidate of candidates) {
    const partial = normalized.findIndex((h) => h.includes(normalizeHeader(candidate)));
    if (partial !== -1) return usable[partial];
  }
  return null;
}

/** תאריך מאקסל / מחרוזת -> DD/MM/YYYY */
export function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
  }
  return String(value);
}

export function todayString(date = new Date()) {
  return formatDate(date);
}

/** עומס עבודה מתוך תיאור ("6.5 טון", "3.2TON", "4250KG"); '' אם אין */
export function swlFromDescription(description) {
  const text = String(description || '');
  let m = text.match(/(\d+(?:\.\d+)?)\s*(?:TON|טון)/i);
  if (m) return Number(m[1]);
  m = text.match(/(\d+)\s*KG/i);
  if (m) return Number(m[1]) / 1000;
  return '';
}

function sheetWithRtl(sheet) {
  sheet['!views'] = [{ RTL: true }];
  return sheet;
}

// ---------- קריאה ----------

/**
 * קריאת קובץ הריכוז.
 * @param {ArrayBuffer|Uint8Array|Buffer} data
 * @returns {{sheetName, headers, columns, rows, sites, locationsBySite, typeMemory, typesSheetRows, otherSheets}}
 */
export function parseSummaryWorkbook(data) {
  const workbook = XLSX.read(data, { type: data instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: true });

  let sheetName = null;
  let headers = [];
  for (const name of workbook.SheetNames) {
    const firstRows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false, defval: '' }).slice(0, 5);
    const headerRow = firstRows.find((row) => findColumn(row.map(String), COLUMN_ALIASES.serial));
    if (headerRow) {
      sheetName = name;
      headers = headerRow.map(String);
      break;
    }
  }
  if (!sheetName) throw new Error('לא נמצא גיליון עם עמודת "מס\' סידורי"');

  const columns = Object.fromEntries(Object.entries(COLUMN_ALIASES).map(([key, names]) => [key, findColumn(headers, names)]));
  if (!columns.serial || !columns.description) throw new Error('חסרות עמודות חובה: מס\' סידורי / תיאור');

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })
    .filter((row) => String(row[columns.serial] ?? '').trim() !== '');

  const sites = [...new Set(rows.map((row) => String(columns.site ? row[columns.site] : '').trim()))].filter(Boolean);

  const locationsBySite = {};
  if (columns.location) {
    for (const row of rows) {
      const site = columns.site ? String(row[columns.site]).trim() : '';
      const location = String(row[columns.location] ?? '').trim();
      if (!location) continue;
      (locationsBySite[site] ||= new Set()).add(location);
    }
  }
  for (const site of Object.keys(locationsBySite)) locationsBySite[site] = [...locationsBySite[site]];

  // זיכרון סוגים מייצוא קודם: שם שנאמר -> תיאור לתסקיר ועומס
  const typeMemory = {};
  const typesSheetRows = [];
  if (workbook.Sheets[TYPES_SHEET]) {
    for (const row of XLSX.utils.sheet_to_json(workbook.Sheets[TYPES_SHEET], { defval: '' })) {
      const spoken = String(row['סוג כפי שנאמר'] ?? '').trim();
      if (!spoken) continue;
      const swl = row['עומס (טון)'];
      typesSheetRows.push({ key: nameKey(spoken), row: { ...row, 'פריטים היום': '', 'חדשים היום': '' } });
      typeMemory[nameKey(spoken)] = {
        reportDescription: String(row['תיאור לתסקיר'] ?? '').trim() || undefined,
        swl: swl === '' || swl === undefined ? '' : Number(swl),
      };
    }
  }

  const otherSheets = workbook.SheetNames
    .filter((name) => name !== sheetName && !GENERATED_SHEETS.has(name))
    .map((name) => ({ name, data: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' }) }));

  return { sheetName, headers, columns, rows, sites, locationsBySite, typeMemory, typesSheetRows, otherSheets };
}

// ---------- כתיבה ----------

function defectsText(entry) {
  return [...entry.defects.map((d) => d.label), entry.note].filter(Boolean).join(', ');
}

function typeInfoMap(reconciliation) {
  return Object.fromEntries(reconciliation.types.map((t) => [t.key, t]));
}

function resultCells(entry, result, typeInfo, date) {
  return {
    [RESULT_COLUMNS.currentDate]: date,
    [RESULT_COLUMNS.currentResult]: STATUS_TEXT[entry.status],
    [RESULT_COLUMNS.currentDefects]: defectsText(entry),
    [RESULT_COLUMNS.currentLocation]: entry.location,
    [RESULT_COLUMNS.previousLocation]: result.moved ? result.prev?.location ?? '' : '',
    [RESULT_COLUMNS.spokenType]: entry.type,
    [RESULT_COLUMNS.swl]: typeInfo?.swl ?? '',
    [RESULT_COLUMNS.isNew]: result.status === 'new' ? 'כן' : '',
    [RESULT_COLUMNS.review]: result.review ? result.reason : '',
    [RESULT_COLUMNS.confidence]: entry.confidence === null || entry.confidence === undefined ? '' : Math.round(entry.confidence * 100) / 100,
  };
}

/** עומס תקין לכתיבה: מספר חיובי; אחרת null */
function validSwl(value) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').trim() || NaN);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * שורות הריכוז המעודכנות: פריט ישן - מיקום (ואתר) מתעדכנים לאחרון + עמודות הבדיקה; פריט חדש - שורה חדשה.
 */
export function applyToRows(parsed, state, reconciliation, { date }) {
  const { columns } = parsed;
  const headers = [...parsed.headers, ...Object.values(RESULT_COLUMNS).filter((h) => !parsed.headers.includes(h))];
  const types = typeInfoMap(reconciliation);
  const rows = parsed.rows.map((row) => ({ ...row }));

  for (const entry of state.entries) {
    const result = reconciliation.results[entry.id];
    const typeInfo = types[entry.typeKey];
    const cells = resultCells(entry, result, typeInfo, date);

    if (result.status === 'old' && result.rowIndex !== null && result.rowIndex !== undefined) {
      const row = rows[result.rowIndex];
      if (columns.location) row[columns.location] = entry.location;
      if (columns.site && state.site) row[columns.site] = state.site;
      Object.assign(row, cells);
      // עומס עבודה בטוח: משלימים רק כשהתא בקובץ ריק - ערך שמקורו בתסקיר לא נדרס
      const typeSwl = validSwl(typeInfo?.swl);
      if (columns.swl && typeSwl !== null && validSwl(row[columns.swl]) === null) {
        row[columns.swl] = typeSwl;
        if (columns.swlSource) row[columns.swlSource] = FIELD_SOURCE;
      }
      continue;
    }

    const newSwl = validSwl(typeInfo?.swl);
    rows.push({
      ...(columns.site ? { [columns.site]: state.site } : {}),
      ...(columns.type ? { [columns.type]: typeInfo?.fileType ?? '' } : {}),
      [columns.description]: typeInfo?.reportDescription ?? entry.type,
      [columns.serial]: entry.serial,
      ...(columns.location ? { [columns.location]: entry.location } : {}),
      ...(columns.source ? { [columns.source]: FIELD_SOURCE } : {}),
      ...(columns.swl && newSwl !== null ? { [columns.swl]: newSwl } : {}),
      ...(columns.swl && columns.swlSource && newSwl !== null ? { [columns.swlSource]: FIELD_SOURCE } : {}),
      ...cells,
    });
  }
  return { headers, rows };
}

/** סדר התסקיר: מיקום -> סוג -> מספר */
function sortedEntries(state) {
  return [...state.entries].sort((a, b) =>
    a.location.localeCompare(b.location) || a.type.localeCompare(b.type) || a.serial.localeCompare(b.serial, undefined, { numeric: true }));
}

/** גיליון "נבדקו" - שורה לכל פריט שנבדק, עם כל הנתונים לתסקיר */
export function buildInspectedRows(state, reconciliation, { site, date }) {
  const types = typeInfoMap(reconciliation);
  return sortedEntries(state).map((entry) => {
    const result = reconciliation.results[entry.id];
    const typeInfo = types[entry.typeKey];
    return {
      'אתר': site,
      'תאריך בדיקה': date,
      'מיקום': entry.location,
      'סוג כפי שנאמר': entry.type,
      'תיאור לתסקיר': typeInfo?.reportDescription ?? entry.type,
      'עומס עבודה (טון)': typeInfo?.swl ?? '',
      "מס' סידורי": entry.serial,
      'תוצאה': STATUS_TEXT[entry.status],
      'ליקויים / הערה': defectsText(entry),
      'ישן / חדש': result.status === 'old' ? 'ישן' : 'חדש',
      'מיקום קודם': result.prev?.location ?? '',
      "מס' בקובץ": result.prev?.serial ?? '',
      'תסקיר קודם': result.prev?.reportNumber ?? '',
      'בדיקה קודמת': result.prev?.date ?? '',
      'לבדיקה': result.review ? result.reason : '',
    };
  });
}

/** גיליון "לא נבדקו" - פריטי האתר מהקובץ שלא נאמרו היום */
export function buildNotInspectedRows(parsed, reconciliation) {
  const { columns, rows } = parsed;
  return reconciliation.notInspected.map((i) => ({
    "מס' סידורי": rows[i][columns.serial],
    'סוג': columns.type ? rows[i][columns.type] : '',
    'תיאור': rows[i][columns.description],
    'מיקום': columns.location ? rows[i][columns.location] : '',
    'בדיקה אחרונה': columns.lastInspection ? formatDate(rows[i][columns.lastInspection]) : '',
    'ממצא אחרון': columns.prevResult ? rows[i][columns.prevResult] : '',
  }));
}

/**
 * JSON לתסקירים: קבוצה לכל מיקום × סוג = תסקיר; שורות לפי תיאור + עומס עם רשימת מספרים;
 * ליקויים (כולל הערות על פריטים תקינים) עם מספר הפריט.
 * עומס עבודה בטוח: lines[].swl בטון (מספר), או null כשלא נקבע עומס לסוג; missingSwl מפרט את הסוגים החסרים.
 */
export function buildReportJson(state, reconciliation, { clientName, site, date }) {
  const types = typeInfoMap(reconciliation);
  const groups = new Map();
  for (const entry of sortedEntries(state)) {
    const result = reconciliation.results[entry.id];
    const typeInfo = types[entry.typeKey];
    const key = `${entry.location}||${entry.typeKey}`;
    if (!groups.has(key)) {
      groups.set(key, { location: entry.location, type: typeInfo?.fileType ?? entry.type, spokenType: entry.type, lines: new Map(), defects: [] });
    }
    const group = groups.get(key);
    const description = typeInfo?.reportDescription ?? entry.type;
    const swl = validSwl(typeInfo?.swl);
    const lineKey = `${description}||${swl}`;
    if (!group.lines.has(lineKey)) group.lines.set(lineKey, { description, swl, serials: [], failedSerials: [], newSerials: [] });
    const line = group.lines.get(lineKey);
    (entry.status === 'fail' ? line.failedSerials : line.serials).push(entry.serial);
    if (result.status === 'new') line.newSerials.push(entry.serial);
    if (entry.defects.length || entry.note) {
      group.defects.push({ serial: entry.serial, status: entry.status, text: defectsText(entry), isNew: result.status === 'new' });
    }
  }
  return {
    clientName,
    site,
    date,
    counts: reconciliation.counts,
    swlUnit: 'ton',
    missingSwl: reconciliation.types.filter((t) => validSwl(t.swl) === null).map((t) => ({ type: t.reportDescription, spokenType: t.name, quantity: t.count })),
    groups: [...groups.values()].map((g) => ({
      ...g,
      lines: [...g.lines.values()].map((l) => ({ ...l, quantity: l.serials.length + l.failedSerials.length })),
    })),
    moved: state.entries
      .filter((e) => reconciliation.results[e.id].moved)
      .map((e) => ({ serial: e.serial, from: reconciliation.results[e.id].prev.location, to: e.location })),
    notInspectedCount: reconciliation.notInspected.length,
  };
}

/** חוברת העבודה המעודכנת: ריכוז + נבדקו + לא נבדקו + סוגים + מיקומים + שאר הגיליונות המקוריים */
export function buildUpdatedWorkbook(parsed, state, reconciliation, meta) {
  const workbook = XLSX.utils.book_new();
  const { headers, rows } = applyToRows(parsed, state, reconciliation, meta);
  XLSX.utils.book_append_sheet(workbook, sheetWithRtl(XLSX.utils.json_to_sheet(rows, { header: headers })), parsed.sheetName);

  const inspectedName = `נבדקו ${meta.date.replace(/\//g, '.')}`.slice(0, 31);
  const inspected = buildInspectedRows(state, reconciliation, meta);
  XLSX.utils.book_append_sheet(workbook, sheetWithRtl(XLSX.utils.json_to_sheet(inspected.length ? inspected : [{ 'אתר': meta.site }])), inspectedName);

  const notInspected = buildNotInspectedRows(parsed, reconciliation);
  XLSX.utils.book_append_sheet(workbook, sheetWithRtl(XLSX.utils.json_to_sheet(notInspected.length ? notInspected : [{ "מס' סידורי": '' }])), NOT_INSPECTED_SHEET);

  // סוגים: הסוגים של היום + זיכרון קודם שלא נאמר היום (כדי שלא יאבד)
  const typeRows = reconciliation.types.map((t) => ({
    'סוג כפי שנאמר': t.name, 'תיאור לתסקיר': t.reportDescription, 'עומס (טון)': t.swl ?? '', 'משפחה': t.fileType, 'פריטים היום': t.count, 'חדשים היום': t.newCount, 'סוג חדש': t.isNewType ? 'כן' : '',
  }));
  const todayKeys = new Set(reconciliation.types.map((t) => t.key));
  for (const { key, row } of parsed.typesSheetRows || []) if (!todayKeys.has(key)) typeRows.push(row);
  XLSX.utils.book_append_sheet(workbook, sheetWithRtl(XLSX.utils.json_to_sheet(typeRows.length ? typeRows : [{ 'סוג כפי שנאמר': '' }])), TYPES_SHEET);

  const locationRows = reconciliation.locations.map((l) => ({ 'מיקום': l.name, 'פריטים היום': l.count, 'מיקום חדש': l.isNew ? 'כן' : '' }));
  XLSX.utils.book_append_sheet(workbook, sheetWithRtl(XLSX.utils.json_to_sheet(locationRows.length ? locationRows : [{ 'מיקום': '' }])), LOCATIONS_SHEET);

  for (const other of parsed.otherSheets) {
    const name = other.name.slice(0, 31);
    if (workbook.SheetNames.includes(name)) continue;
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(other.data), name);
  }
  return workbook;
}

export function workbookToBytes(workbook) {
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}

/** קובץ "נבדקו" בלבד */
export function buildInspectedWorkbook(state, reconciliation, meta) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheetWithRtl(XLSX.utils.json_to_sheet(buildInspectedRows(state, reconciliation, meta))), 'נבדקו');
  return workbook;
}
