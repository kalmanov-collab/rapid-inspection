/**
 * שירות אקסל: קריאת קובץ הריכוז, בניית סשן לאתר, ועדכון הקובץ בתוצאות הבדיקה.
 *
 * הקובץ הנתמך הוא "ריכוז מתקנים ואביזרים" (גיליון עם העמודות: אתר, סוג מתקן / אביזר, תיאור (כפי שבתסקיר),
 * מס' סידורי / פנימי, תאריך בדיקה אחרונה, ממצא בבדיקה, קבוצה / מחזיק, מס' תסקיר ...).
 * הזיהוי לפי כותרות, כך שסדר העמודות לא משנה ועמודות נוספות נשמרות.
 *
 * גיליון אופציונלי "קטלוג" (תיאור, עומס, כינויים) מאפשר לקבוע כינויים קוליים ועומס לכל תיאור;
 * הגיליון נכתב בייצוא כדי שאפשר יהיה לערוך אותו באקסל ולטעון שוב.
 *
 * הקובץ עובד גם ב-node (בדיקות) וגם בדפדפן.
 */
import * as XLSX from 'xlsx';

/** מפתחות פנימיים -> כותרות אפשריות בקובץ (התאמה לפי הכלה, ללא תלות בגרשיים) */
const COLUMN_ALIASES = {
  site: ['אתר'],
  reportNumber: ['מס תסקיר', "מס' תסקיר", 'מספר תסקיר'],
  type: ['סוג מתקן', 'סוג אביזר', 'סוג'],
  description: ['תיאור'],
  serial: ['מס סידורי', "מס' סידורי", 'מספר סידורי', 'סידורי'],
  lastInspection: ['תאריך בדיקה אחרונה', 'בדיקה אחרונה'],
  prevResult: ['ממצא בבדיקה', 'ממצא'],
  location: ['קבוצה / מחזיק', 'קבוצה', 'מחזיק', 'מיקום'],
  source: ['מקור'],
};

/** עמודות הבדיקה הנוכחית שהאפליקציה מוסיפה (או מעדכנת אם כבר קיימות) */
export const RESULT_COLUMNS = {
  currentDate: 'תאריך בדיקה נוכחית',
  currentResult: 'תוצאה נוכחית',
  currentDefects: 'ליקויים / הערה נוכחית',
  currentLocation: 'מיקום נוכחי',
  previousLocation: 'מיקום קודם (אם הועבר)',
  swl: 'עומס עבודה (טון)',
  isNew: 'פריט חדש',
  confidence: 'ביטחון זיהוי',
};

const CATALOG_SHEET = 'קטלוג';
const STATUS_TEXT = { ok: 'תקין', fail: 'פסול', notFound: 'לא נמצא', pending: '' };

// ---------- עזרים ----------

function normalizeHeader(value) {
  return String(value ?? '').replace(/['"״׳]/g, '').replace(/\s+/g, ' ').trim();
}

function findColumn(headers, candidates) {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const exact = normalized.findIndex((h) => h === normalizeHeader(candidate));
    if (exact !== -1) return headers[exact];
  }
  for (const candidate of candidates) {
    const partial = normalized.findIndex((h) => h.includes(normalizeHeader(candidate)));
    if (partial !== -1) return headers[partial];
  }
  return null;
}

/** תאריך מאקסל / מחרוזת -> DD/MM/YYYY */
export function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) return `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
  }
  return String(value);
}

export function todayString(date = new Date()) {
  return formatDate(date);
}

/** עומס עבודה מתוך תיאור ("6.5 טון", "3.2TON", "4250KG") */
export function swlFromDescription(description) {
  const text = String(description || '');
  let m = text.match(/(\d+(?:\.\d+)?)\s*(?:TON|טון)/i);
  if (m) return Number(m[1]);
  m = text.match(/(\d+)\s*KG/i);
  if (m) return Number(m[1]) / 1000;
  return '';
}

const ALIAS_STOP_WORDS = new Set(['הרמה', 'במבנה', 'גודל', 'אורך', 'מפולייאסטר', 'בקצוות', 'לולאות']);

const FRACTION_WORDS = {
  '1/4': 'רבע', '5/16': 'חמש שש עשרה', '3/8': 'שלוש שמיניות', '1/2': 'חצי', '5/8': 'חמש שמיניות', '3/4': 'שלושה רבעים',
  '7/8': 'שבע שמיניות', '1': 'אינץ', '1-1/8': 'אינץ ושמינית', '1-1/4': 'אינץ ורבע', '1-3/8': 'אינץ ושלוש שמיניות',
  '1-1/2': 'אינץ וחצי', '1-3/4': 'אינץ ושלושה רבעים', '2': 'שני אינץ', '2-1/2': 'שני אינץ וחצי',
};

/**
 * כינויים קוליים ברירת מחדל מתוך תיאור הפריט - מה שנוח לומר בשטח.
 * המשתמש יכול לערוך אותם בגיליון "קטלוג".
 */
export function defaultAliases(type, description) {
  const text = String(description || '');
  const aliases = new Set();
  const length = text.match(/אורך\s*(\d+(?:\.\d+)?)\s*מ/);
  const lengthWords = length ? `${length[1]} מטר` : '';

  if (/רצוע|חגור|עניב/.test(text)) {
    const shape = /שטוח/.test(text) ? 'שטוחה' : /עגול/.test(text) ? 'עגולה' : '';
    if (lengthWords) {
      aliases.add(`רצועה ${shape} ${lengthWords}`.replace(/\s+/g, ' '));
      aliases.add(`רצועה ${lengthWords}`);
    }
  } else if (/שאקל|שקל/.test(text)) {
    const size = text.match(/(\d(?:-\d\/\d+)?(?:\/\d+)?)\s*"?/g)?.map((s) => s.trim().replace(/"/g, '')).find((s) => FRACTION_WORDS[s]);
    if (size) {
      aliases.add(`שאקל ${FRACTION_WORDS[size]}`);
      aliases.add(`שאקל ${size.replace('-', ' ו')}`);
    }
  } else if (/מענב|שרשרת/.test(text)) {
    const legs = text.match(/(\d)\s*ענפ/) ? text.match(/(\d)\s*ענפ/)[1] : /חד[\s-]?ענפ/.test(text) ? '1' : '';
    const legWords = legs === '1' ? 'ענף אחד' : legs ? `${legs} ענפים` : '';
    aliases.add(`מענב ${legWords} ${lengthWords}`.replace(/\s+/g, ' ').trim());
    if (/כבל/.test(text)) aliases.add(`מענב כבל ${lengthWords}`.trim());
  } else if (/מחגר|גלגלת/.test(text)) {
    const tons = text.match(/(\d+(?:\.\d+)?)\s*(?:טון|TON)/i);
    const kind = /מחגר/.test(text) ? 'מחגר' : 'גלגלת';
    if (tons) aliases.add(`${kind} ${tons[1]} טון`);
  }

  // תמיד: התיאור עצמו בלי מילות מילוי, כגיבוי
  const cleaned = text
    .replace(/[\u03A9\u03C9\u2126"״׳']/g, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*מ(?=\s|$)/g, '$1 מטר')
    .split(/\s+/)
    .filter((word) => word && !ALIAS_STOP_WORDS.has(word))
    .join(' ');
  if (cleaned) aliases.add(cleaned);
  return [...aliases].filter(Boolean);
}

/**
 * מפתח קנוני לתיאור - מאחד ניסוחים שונים של אותו אביזר מתסקירים שונים
 * ("שאקל במבנה Ωגודל "7/8", "שאקל הרמה במבנה Ωגודל "7/8", "שקל הרמה במבנה Ω,עומס: 6.5 טון,גודל:"7/8").
 */
const CANONICAL_STOP_WORDS = new Set(['הרמה', 'במבנה', 'גודל', 'מפולייאסטר', 'עם']);

export function canonicalKey(description) {
  return String(description || '')
    .replace(/שקל/g, 'שאקל')
    .replace(/עומס:?\s*[\d.]+\s*(?:טון|TON)/gi, ' ')
    .replace(/[\u03A9\u03C9\u2126"״׳',:()]/g, ' ')   // אומגה בשני קידודים (Ω / Ω), גרשיים ופיסוק
    .replace(/(\d+(?:\.\d+)?)\s+מ(?=\s|$)/g, '$1מ')
    .split(/\s+/)
    .filter((word) => word && !CANONICAL_STOP_WORDS.has(word))
    .join(' ');
}

function slug(text) {
  return String(text).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// ---------- קריאה ----------

/**
 * קריאת קובץ הריכוז.
 * @param {ArrayBuffer|Uint8Array|Buffer} data
 * @returns {{sheetName, headers, columns, rows, sites, catalogOverrides, otherSheets}}
 */
export function parseSummaryWorkbook(data) {
  const workbook = XLSX.read(data, { type: data instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: true });

  // הגיליון הראשון שמכיל עמודת מס' סידורי
  let sheetName = null;
  let headers = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const firstRows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, blankrows: false, defval: '' }).slice(0, 5);
    const headerRowIndex = firstRows.findIndex((row) => findColumn(row.map(String), COLUMN_ALIASES.serial));
    if (headerRowIndex !== -1) {
      sheetName = name;
      headers = firstRows[headerRowIndex].map(String);
      break;
    }
  }
  if (!sheetName) throw new Error('לא נמצא גיליון עם עמודת "מס\' סידורי"');

  const columns = Object.fromEntries(Object.entries(COLUMN_ALIASES).map(([key, names]) => [key, findColumn(headers, names)]));
  if (!columns.serial || !columns.description) throw new Error('חסרות עמודות חובה: מס\' סידורי / תיאור');

  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  const rows = rawRows.filter((row) => String(row[columns.serial] ?? '').trim() !== '');

  const sites = [...new Set(rows.map((row) => String(columns.site ? row[columns.site] : '').trim()))].filter(Boolean);

  // גיליון קטלוג אופציונלי: תיאור -> { swl, aliases }
  const catalogOverrides = {};
  if (workbook.Sheets[CATALOG_SHEET]) {
    for (const row of XLSX.utils.sheet_to_json(workbook.Sheets[CATALOG_SHEET], { defval: '' })) {
      const description = String(row['תיאור'] ?? '').trim();
      if (!description) continue;
      const aliases = String(row['כינויים קוליים'] ?? row['כינויים'] ?? '').split('|').map((s) => s.trim()).filter(Boolean);
      const swl = row['עומס (טון)'] ?? row['עומס'] ?? '';
      catalogOverrides[description] = { aliases, swl: swl === '' ? '' : Number(swl) };
    }
  }

  const otherSheets = workbook.SheetNames.filter((name) => name !== sheetName && name !== CATALOG_SHEET).map((name) => ({
    name,
    data: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' }),
  }));

  return { sheetName, headers, columns, rows, sites, catalogOverrides, otherSheets };
}

/**
 * בניית סשן לאתר מתוך הקובץ: קטלוג (לפי תיאור), מיקומים ופריטים.
 */
export function buildSession(parsed, site, { clientName = '' } = {}) {
  const { columns, rows, catalogOverrides } = parsed;
  const siteRows = columns.site ? rows.filter((row) => String(row[columns.site]).trim() === site) : rows;
  if (siteRows.length === 0) throw new Error(`אין פריטים לאתר "${site}"`);

  // ניסוחים שונים של אותו אביזר מאוחדים לרשומת קטלוג אחת; התיאור הנפוץ ביותר הוא הקנוני
  const variantCounts = new Map();
  for (const row of siteRows) {
    const description = String(row[columns.description]).trim();
    if (!description) continue;
    const key = canonicalKey(description);
    if (!variantCounts.has(key)) variantCounts.set(key, new Map());
    const variants = variantCounts.get(key);
    variants.set(description, (variants.get(description) || 0) + 1);
  }

  const catalogMap = new Map(); // תיאור (כל ניסוח) -> רשומת קטלוג
  for (const row of siteRows) {
    const description = String(row[columns.description]).trim();
    if (!description || catalogMap.has(description)) continue;
    const key = canonicalKey(description);
    const variants = [...variantCounts.get(key).entries()].sort((a, b) => b[1] - a[1]);
    const canonical = variants[0][0];
    const existing = [...catalogMap.values()].find((entry) => entry.description === canonical);
    if (existing) {
      catalogMap.set(description, existing);
      continue;
    }
    const type = columns.type ? String(row[columns.type]).trim() : '';
    const override = catalogOverrides[canonical] || catalogOverrides[description];
    const swlFromAny = variants.map(([v]) => swlFromDescription(v)).find((v) => v !== '') ?? '';
    const entry = {
      id: slug(canonical) || `type-${catalogMap.size + 1}`,
      type,
      description: canonical,
      swl: override?.swl !== undefined && override.swl !== '' ? override.swl : swlFromAny,
      aliases: override?.aliases?.length ? override.aliases : defaultAliases(type, canonical),
    };
    catalogMap.set(description, entry);
  }
  const catalog = [...new Set(catalogMap.values())].sort((a, b) => a.type.localeCompare(b.type) || a.description.localeCompare(b.description));

  const seen = new Set();
  const items = siteRows.map((row) => {
    const serial = String(row[columns.serial]).trim();
    let id = serial;
    let n = 2;
    while (seen.has(id)) id = `${serial}#${n++}`;
    seen.add(id);
    const description = String(row[columns.description]).trim();
    return {
      id,
      serial,
      catalogId: catalogMap.get(description)?.id || null,
      location: columns.location ? String(row[columns.location]).trim() : '',
      prevReportNumber: columns.reportNumber ? String(row[columns.reportNumber]).trim() : '',
      prevInspection: columns.lastInspection ? formatDate(row[columns.lastInspection]) : '',
      prevResult: columns.prevResult ? String(row[columns.prevResult]).trim() : '',
    };
  });

  const locations = [...new Set(items.map((i) => i.location).filter(Boolean))];
  return { clientName, siteName: site, catalog, locations, items };
}

// ---------- כתיבה ----------

function defectsText(item) {
  const parts = item.defects.map((d) => d.label);
  if (item.note) parts.push(item.note);
  return parts.join(', ');
}

/**
 * עדכון שורות הריכוז בתוצאות הסשן: עמודות הבדיקה הנוכחית לפריטים שנבדקו, ושורות חדשות לפריטים חדשים.
 * @returns {{headers: string[], rows: Object[]}}
 */
export function applySessionToRows(parsed, state, { site, date }) {
  const { columns } = parsed;
  const resultHeaders = Object.values(RESULT_COLUMNS);
  const headers = [...parsed.headers, ...resultHeaders.filter((h) => !parsed.headers.includes(h))];

  // מיפוי פריטי הסשן לפי מספר סידורי (ללא סיומת #n של כפילויות)
  const bySerial = new Map();
  for (const id of state.order) {
    const item = state.items[id];
    if (!bySerial.has(item.serial)) bySerial.set(item.serial, []);
    bySerial.get(item.serial).push(item);
  }

  const usedIds = new Set();
  const rows = parsed.rows.map((row) => {
    const rowSite = columns.site ? String(row[columns.site]).trim() : site;
    if (rowSite !== site) return { ...row };
    const serial = String(row[columns.serial]).trim();
    const candidates = (bySerial.get(serial) || []).filter((item) => !usedIds.has(item.id));
    const item = candidates[0];
    if (!item || item.status === 'pending') return { ...row };
    usedIds.add(item.id);
    return { ...row, ...resultCells(item, date) };
  });

  // פריטים חדשים (לא היו בקובץ)
  for (const id of state.order) {
    const item = state.items[id];
    if (!item.isNew || usedIds.has(id)) continue;
    rows.push({
      ...(columns.site ? { [columns.site]: site } : {}),
      ...(columns.type ? { [columns.type]: item.type } : {}),
      [columns.description]: item.description,
      [columns.serial]: item.serial,
      ...(columns.location ? { [columns.location]: item.location } : {}),
      ...(columns.source ? { [columns.source]: 'בדיקה בשטח' } : {}),
      ...resultCells(item, date),
    });
  }

  return { headers, rows };
}

function resultCells(item, date) {
  return {
    [RESULT_COLUMNS.currentDate]: date,
    [RESULT_COLUMNS.currentResult]: STATUS_TEXT[item.status] ?? item.status,
    [RESULT_COLUMNS.currentDefects]: defectsText(item),
    [RESULT_COLUMNS.currentLocation]: item.location,
    [RESULT_COLUMNS.previousLocation]: item.prevLocation && item.prevLocation !== item.location ? item.prevLocation : '',
    [RESULT_COLUMNS.swl]: item.swl ?? '',
    [RESULT_COLUMNS.isNew]: item.isNew ? 'כן' : '',
    [RESULT_COLUMNS.confidence]: item.confidence === null || item.confidence === undefined ? '' : Math.round(item.confidence * 100) / 100,
  };
}

/** הפריטים שנבדקו בסשן, בסדר של התסקיר: סוג -> מיקום -> תיאור -> מספר */
export function inspectedItems(state) {
  return state.order
    .map((id) => state.items[id])
    .filter((item) => item.status !== 'pending')
    .sort((a, b) => a.type.localeCompare(b.type) || a.location.localeCompare(b.location) || a.description.localeCompare(b.description) || a.serial.localeCompare(b.serial, undefined, { numeric: true }));
}

/** גיליון "נבדקו" - שורה לכל פריט שנבדק, עם הנתונים הנדרשים לתסקיר */
export function buildInspectedRows(state, { site, date }) {
  return inspectedItems(state).map((item) => ({
    'אתר': site,
    'תאריך בדיקה': date,
    'סוג': item.type,
    'מיקום': item.location,
    'תיאור לתסקיר': item.description,
    'עומס עבודה (טון)': item.swl ?? '',
    "מס' סידורי": item.serial,
    'תוצאה': STATUS_TEXT[item.status],
    'ליקויים / הערה': defectsText(item),
    'פריט חדש': item.isNew ? 'כן' : '',
    'מיקום קודם': item.prevLocation && item.prevLocation !== item.location ? item.prevLocation : '',
    'תסקיר קודם': item.prevReportNumber,
    'בדיקה קודמת': item.prevInspection,
  }));
}

/** JSON למחולל התסקירים: קבוצות של סוג × מיקום, בכל קבוצה שורות לפי תיאור עם רשימת מספרים */
export function buildReportJson(state, { clientName, site, date }) {
  const groups = new Map();
  for (const item of inspectedItems(state)) {
    if (item.status === 'notFound') continue;
    const key = `${item.type}||${item.location}`;
    if (!groups.has(key)) groups.set(key, { type: item.type, location: item.location, lines: new Map(), defects: [] });
    const group = groups.get(key);
    const lineKey = `${item.description}||${item.swl}`;
    if (!group.lines.has(lineKey)) group.lines.set(lineKey, { description: item.description, swl: item.swl ?? '', serials: [], failedSerials: [] });
    const line = group.lines.get(lineKey);
    (item.status === 'fail' ? line.failedSerials : line.serials).push(item.serial);
    if (item.defects.length || item.note) group.defects.push({ serial: item.serial, status: item.status, text: defectsText(item), isNew: item.isNew });
  }
  return {
    clientName,
    site,
    date,
    counts: countItems(state),
    notFound: state.order.map((id) => state.items[id]).filter((i) => i.status === 'notFound').map((i) => ({ serial: i.serial, description: i.description, location: i.location })),
    moved: state.moved.map((id) => state.items[id]).map((i) => ({ serial: i.serial, from: i.prevLocation, to: i.location })),
    groups: [...groups.values()].map((g) => ({ ...g, lines: [...g.lines.values()].map((l) => ({ ...l, quantity: l.serials.length + l.failedSerials.length })) })),
  };
}

function countItems(state) {
  const counts = { total: state.order.length, ok: 0, fail: 0, notFound: 0, pending: 0, new: 0 };
  for (const id of state.order) {
    const item = state.items[id];
    counts[item.status]++;
    if (item.isNew) counts.new++;
  }
  return counts;
}

/** גיליון קטלוג לייצוא (ניתן לעריכה באקסל ולטעינה חוזרת) */
function buildCatalogRows(catalog) {
  return catalog.map((entry) => ({ 'סוג': entry.type, 'תיאור': entry.description, 'עומס (טון)': entry.swl ?? '', 'כינויים קוליים': (entry.aliases || []).join(' | ') }));
}

/**
 * בניית חוברת העבודה המעודכנת: הריכוז (כל האתרים) עם עמודות הבדיקה, גיליון "נבדקו", "קטלוג" ושאר הגיליונות המקוריים.
 */
export function buildUpdatedWorkbook(parsed, state, meta) {
  const { headers, rows } = applySessionToRows(parsed, state, meta);
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  summarySheet['!views'] = [{ RTL: true }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, parsed.sheetName);

  const inspected = buildInspectedRows(state, meta);
  const inspectedSheet = XLSX.utils.json_to_sheet(inspected.length ? inspected : [{ 'אתר': meta.site, 'תאריך בדיקה': meta.date }]);
  inspectedSheet['!views'] = [{ RTL: true }];
  XLSX.utils.book_append_sheet(workbook, inspectedSheet, `נבדקו ${meta.date.replace(/\//g, '.')}`.slice(0, 31));

  const catalogSheet = XLSX.utils.json_to_sheet(buildCatalogRows(state.catalog));
  catalogSheet['!views'] = [{ RTL: true }];
  XLSX.utils.book_append_sheet(workbook, catalogSheet, CATALOG_SHEET);

  for (const other of parsed.otherSheets) {
    if (workbook.SheetNames.includes(other.name)) continue;
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(other.data), other.name.slice(0, 31));
  }
  return workbook;
}

/** חוברת -> bytes (לשמירה / הורדה) */
export function workbookToBytes(workbook) {
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}
