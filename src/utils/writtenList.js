/**
 * מנתח רשימת מספרים שנכתבה בלוח הכתיבה (כתב יד שהומר לטקסט על ידי המכשיר).
 *
 * הפורמט: מספרים מופרדים בפסיק (או בשורה חדשה / נקודה-פסיק); "פסול" אחרי המספר פוסל את הפריט.
 *   "2345/3, 2346/3 פסול, K500158, 07-2/1045 פסול חתך"
 *
 * אין כאן חיפוש בקובץ ואין תלות ב-React - פונקציה טהורה שנבדקת ב-Node.
 */
import { DEFAULT_DEFECTS, normalizeSerial } from './fieldParser.js';

const SEPARATORS = /[,،;\n]+/;
const HEBREW_LETTER = /[א-ת]/;
/** "פסול" וגם שיבושי זיהוי כתב יד נפוצים שלו ("פסןל", "פסו") - כל מילה שמתחילה ב"פס" */
const FAIL_WORD = /^(פס[א-ת]*|נפסל|נפסלה|להשמדה)$/;
const OK_WORD = /^(תקין|תקינה|בסדר)$/;
/** סימון פסילה בלי מילה: X אחרי המספר, מופרד ברווח ("2345/3 X") */
const FAIL_MARK = /\s+[xX✗✘×]\s*$/;

/** ניקוי מספר שנכתב: בלי רווחים, לוכסן הפוך -> לוכסן, בלי סימנים תלויים בקצוות */
function cleanSerial(raw) {
  return raw
    .replace(/\s+/g, '')
    .replace(/\\/g, '/')
    .replace(/^[.\-/'"`׳״]+|[.\-/'"`׳״:]+$/g, '')
    .toUpperCase();
}

function isValidSerial(serial) {
  return /^[0-9A-Z][0-9A-Z/\-.]*$/.test(serial) && /\d/.test(serial) && Boolean(normalizeSerial(serial));
}

/** סטטוס, ליקויים והערה מתוך הטקסט העברי שאחרי המספר */
function parseRemarks(text, defectList) {
  let status = null;
  let rest = text;
  if (/לא\s+תקינ?ה?/.test(rest)) {
    status = 'fail';
    rest = rest.replace(/לא\s+תקינ?ה?/, ' ');
  }
  let words = rest.split(/\s+/).map((w) => w.replace(/^[.:-]+|[.:-]+$/g, '')).filter(Boolean);

  // ליקויים: ביטוי שלם (גם של כמה מילים, "חסר תווית"), הארוך קודם - כמו בזיהוי הקולי
  const defects = [];
  for (const defect of defectList) {
    for (const keyword of [...defect.keywords].sort((a, b) => b.length - a.length)) {
      const phrase = keyword.split(' ');
      const index = words.findIndex((_, i) => phrase.every((part, offset) => words[i + offset] === part));
      if (index === -1) continue;
      if (!defects.some((d) => d.code === defect.code)) defects.push({ code: defect.code, label: defect.label });
      words = [...words.slice(0, index), ...words.slice(index + phrase.length)];
    }
  }

  const noteWords = [];
  for (const word of words) {
    if (FAIL_WORD.test(word)) status = 'fail';
    else if (OK_WORD.test(word)) status = status || 'ok';
    else noteWords.push(word);
  }
  return { status, defects, note: noteWords.join(' ') };
}

/**
 * @param {string} text - תוכן לוח הכתיבה
 * @param {Object} [options]
 * @param {Array} [options.defects] - מילון ליקויים (ברירת מחדל: DEFAULT_DEFECTS)
 * @returns {{ items: Array<{raw: string, serial: string, status: 'ok'|'fail', defects: Array, note: string, valid: boolean}>,
 *            validCount: number, failCount: number, invalidCount: number }}
 */
export function parseWrittenList(text, options = {}) {
  const defectList = options.defects || DEFAULT_DEFECTS;
  const items = [];

  for (const rawToken of String(text ?? '').split(SEPARATORS)) {
    const raw = rawToken.trim();
    if (!raw) continue;

    const hebrewAt = raw.search(HEBREW_LETTER);
    let serialPart = hebrewAt === -1 ? raw : raw.slice(0, hebrewAt);
    const remarks = parseRemarks(hebrewAt === -1 ? '' : raw.slice(hebrewAt), defectList);

    let marked = false;
    if (FAIL_MARK.test(serialPart)) {
      marked = true;
      serialPart = serialPart.replace(FAIL_MARK, '');
    }
    const serial = cleanSerial(serialPart);

    // "2345/3, פסול" - פסיק מיותר לפני התוצאה: חלה על הפריט הקודם
    if (!serial && items.length && items[items.length - 1].valid && (remarks.status || remarks.defects.length)) {
      const previous = items[items.length - 1];
      previous.status = remarks.status || 'fail';
      previous.defects = [...previous.defects, ...remarks.defects.filter((d) => !previous.defects.some((x) => x.code === d.code))];
      previous.note = [previous.note, remarks.note].filter(Boolean).join(' ');
      previous.raw = `${previous.raw}, ${raw}`;
      continue;
    }

    const status = marked ? 'fail' : remarks.status || (remarks.defects.length ? 'fail' : 'ok');
    items.push({ raw, serial, status, defects: remarks.defects, note: remarks.note, valid: isValidSerial(serial) });
  }

  const valid = items.filter((item) => item.valid);
  return {
    items,
    validCount: valid.length,
    failCount: valid.filter((item) => item.status === 'fail').length,
    invalidCount: items.length - valid.length,
  };
}
