/**
 * מנתח פקודות קוליות לבדיקה בשטח (גרסה 3).
 *
 * עקרון: בזמן הבדיקה אין שום חיפוש בקובץ. המנתח רק מסווג את המשפט:
 *   "מיקום מחסן" / "מיקום חדש מחסן" / "החלף מיקום מחסן"      -> מעבר מיקום
 *   "סוג רצועה עגולה ירוקה 4 מ'" / "סוג חדש ..." / "החלף סוג ..." -> מעבר סוג
 *   "2345/3" / "2345 לוכסן 3" / "קי 500158 פסול חתך"            -> פריט (מספר מלא + תוצאה)
 *   "פסול סדק" (בלי מספר)                                       -> תוצאה לפריט האחרון
 *   "בטל" / "חזור" / "מצב" / "עצור" / "המשך"                     -> פקודות
 *
 * המיקום והסוג חייבים מילת פתיחה ("מיקום" / "סוג"), כי שם סוג מכיל מספרים ("4 מטר")
 * ובלי מילת הפתיחה הוא היה נקלט כמספר פריט.
 */

// ---------- מילונים ----------

const DIGIT_WORDS = {
  אפס: '0',
  אחת: '1', אחד: '1',
  שתיים: '2', שניים: '2', שתים: '2', שנים: '2',
  שלוש: '3', שלושה: '3',
  ארבע: '4', ארבעה: '4',
  חמש: '5', חמישה: '5',
  שש: '6', שישה: '6',
  שבע: '7', שבעה: '7',
  שמונה: '8',
  תשע: '9', תשעה: '9',
};

/** שמות אותיות לועזיות כפי שנאמרות בעברית - מתקבלות רק בתחילת המספר (קידומת) */
const LETTER_WORDS = {
  איי: 'A', אי: 'A', בי: 'B', סי: 'C', די: 'D', אף: 'F', 'ג׳י': 'G', גי: 'G', אייץ: 'H', 'ג׳יי': 'J', גיי: 'J',
  קיי: 'K', קי: 'K', אל: 'L', אם: 'M', אן: 'N', או: 'O', פי: 'P', קיו: 'Q', אר: 'R', אס: 'S', טי: 'T', יו: 'U', וי: 'V',
  'דאבל יו': 'W', אקס: 'X', וואי: 'Y', ואי: 'Y', זד: 'Z', זט: 'Z',
};

/** מילים שמייצגות סימן הפרדה במספר */
const SEPARATOR_WORDS = { לוכסן: '/', סלש: '/', מקף: '-', נקודה: '.' };

const CONTROL_COMMANDS = [
  { command: 'undo', phrases: ['בטל', 'ביטול', 'תבטל', 'מחק'] },
  { command: 'repeat', phrases: ['חזור', 'תחזור', 'מה היה', 'מה אמרתי'] },
  { command: 'status', phrases: ['מצב', 'סטטוס', 'כמה'] },
  { command: 'pause', phrases: ['עצור', 'הפסק', 'השהה'] },
  { command: 'resume', phrases: ['המשך', 'תמשיך'] },
];

const LOCATION_WORDS = ['מיקום', 'מקום', 'קבוצה'];
const TYPE_WORDS = ['סוג'];
/** מילים שמותר לומר לפני/אחרי מילת הפתיחה: "מיקום חדש X", "החלף מיקום X", "שנה סוג ל X" */
const CHANGE_WORDS = ['חדש', 'חדשה', 'החדש', 'החדשה', 'החלף', 'תחליף', 'שנה', 'תשנה', 'עבור', 'את', 'ה', 'ל', 'הבא'];

const STATUS_PHRASES = [
  { status: 'fail', phrases: ['לא תקין', 'לא תקינה', 'פסול', 'פסולה', 'נפסל', 'להשמדה', 'להוציא משימוש'] },
  { status: 'ok', phrases: ['תקין', 'תקינה', 'בסדר'] },
];

export const DEFAULT_DEFECTS = [
  { code: 'WEAR', label: 'שחיקה', keywords: ['שחיקה', 'שחוק', 'שחוקה', 'בלאי', 'בלוי', 'בלויה'] },
  { code: 'CRACK', label: 'סדק', keywords: ['סדק', 'סדוק', 'סדוקה', 'סדקים'] },
  { code: 'DEFORM', label: 'עיוות', keywords: ['עיוות', 'מעוות', 'מעוותת', 'כפוף', 'כפופה', 'עקום', 'עקומה', 'פתיחה'] },
  { code: 'CORROSION', label: 'קורוזיה', keywords: ['קורוזיה', 'חלודה', 'חלוד'] },
  { code: 'NO_TAG', label: 'חסר תווית / סימון', keywords: ['חסר תווית', 'בלי תווית', 'אין תווית', 'חסר סימון', 'ללא סימון', 'לא קריא', 'תווית דהויה'] },
  { code: 'LATCH', label: 'לשונית ביטחון פגומה', keywords: ['לשונית', 'נצרה', 'וו פתוח', 'בלי לשונית', 'חסר לשונית'] },
  { code: 'CUT', label: 'חתך / קרע', keywords: ['חתך', 'חתוך', 'חתוכה', 'קרע', 'קרוע', 'קרועה'] },
  { code: 'STITCH', label: 'תפרים פגומים', keywords: ['תפר', 'תפרים', 'תפירה'] },
  { code: 'ELONGATION', label: 'התארכות', keywords: ['התארכות', 'מתארך', 'התארך'] },
  { code: 'PIN', label: 'פין / בורג פגום', keywords: ['פין', 'בורג', 'הברגה'] },
];

// ---------- עזרי טקסט ----------

/** ניקוי טקסט מזוהה: ניקוד, פיסוק (לא "/" ו-"-" שהם חלק ממספרים), רווחים */
export function normalizeTranscript(text) {
  if (!text) return '';
  return String(text)
    .replace(/[֑-ׇ]/g, '')
    .replace(/קו נטוי/g, 'לוכסן')
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')   // "2,345" -> "2345"
    .replace(/[,;:!?"״()]/g, ' ')
    .replace(/(\S)'(?=\s|$)/g, '$1')         // "מ'" -> "מ"
    .replace(/\s+/g, ' ')
    .trim();
}

function wordToDigits(word) {
  if (/^\d+$/.test(word)) return word;
  if (DIGIT_WORDS[word]) return DIGIT_WORDS[word];
  if (word.length > 2 && word.startsWith('ו') && DIGIT_WORDS[word.slice(1)]) return DIGIT_WORDS[word.slice(1)];
  return null;
}

/** האם במשפט יש מספר כלשהו (ספרה או מילת ספרה) */
function hasDigits(tokens) {
  return tokens.some((t) => /\d/.test(t) || wordToDigits(t) !== null);
}

/**
 * חילוץ מספר סידורי מלא מתחילת המשפט. אותיות לועזיות בשמן מתקבלות רק לפני הספרה הראשונה,
 * כדי שמילים כמו "או" / "אם" באמצע משפט לא ייקלטו כאותיות.
 */
function extractSerial(tokens) {
  let serial = '';
  let seenDigit = false;
  let i = 0;
  if (tokens[0] === 'מספר' || tokens[0] === 'מס') i = 1;
  for (; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^[A-Za-z0-9/.\-_]+$/.test(token)) {
      serial += token.toUpperCase();
      if (/\d/.test(token)) seenDigit = true;
      continue;
    }
    const digits = wordToDigits(token);
    if (digits !== null) { serial += digits; seenDigit = true; continue; }
    if (SEPARATOR_WORDS[token] && serial) { serial += SEPARATOR_WORDS[token]; continue; }
    const twoWords = `${token} ${tokens[i + 1] || ''}`;
    if (!seenDigit && LETTER_WORDS[twoWords]) { serial += LETTER_WORDS[twoWords]; i++; continue; }
    if (!seenDigit && LETTER_WORDS[token]) { serial += LETTER_WORDS[token]; continue; }
    break;
  }
  serial = serial.replace(/[/.\-_]+$/, ''); // סימן הפרדה בסוף = כנראה רעש
  return { serial: /\d/.test(serial) ? serial : null, rest: tokens.slice(i) };
}

function findPhrase(tokens, phrase) {
  const parts = phrase.split(' ');
  outer: for (let i = 0; i + parts.length <= tokens.length; i++) {
    for (let j = 0; j < parts.length; j++) if (tokens[i + j] !== parts[j]) continue outer;
    return i;
  }
  return -1;
}

function removePhrase(tokens, index, phrase) {
  return [...tokens.slice(0, index), ...tokens.slice(index + phrase.split(' ').length)];
}

/** סטטוס, ליקויים והערה מתוך שארית המשפט */
function extractResult(tokens, defects) {
  let status = null;
  for (const { status: candidate, phrases } of STATUS_PHRASES) {
    for (const phrase of phrases) {
      const index = findPhrase(tokens, phrase);
      if (index !== -1) {
        status = candidate;
        tokens = removePhrase(tokens, index, phrase);
        break;
      }
    }
    if (status) break;
  }
  const found = [];
  for (const defect of defects) {
    for (const keyword of [...defect.keywords].sort((a, b) => b.length - a.length)) {
      const index = findPhrase(tokens, keyword);
      if (index !== -1) {
        if (!found.some((d) => d.code === defect.code)) found.push({ code: defect.code, label: defect.label });
        tokens = removePhrase(tokens, index, keyword);
      }
    }
  }
  return { status, defects: found, note: tokens.join(' ').trim() };
}

/**
 * זיהוי פקודת הקשר: מילת פתיחה (מיקום/סוג) באחת משלוש המילים הראשונות, ומילות "החלף/חדש" מסביבה.
 * מחזיר את השם שנאמר אחריה, או null.
 */
function extractContext(tokens, keywords) {
  const index = tokens.slice(0, 3).findIndex((t) => keywords.includes(t) || keywords.some((k) => t === `ה${k}` || t === `ל${k}`));
  if (index === -1) return null;
  if (!tokens.slice(0, index).every((t) => CHANGE_WORDS.includes(t))) return null;
  let rest = tokens.slice(index + 1);
  while (rest.length && CHANGE_WORDS.includes(rest[0])) rest = rest.slice(1);
  return rest.join(' ').trim();
}

// ---------- מפתחות השוואה ----------

/**
 * נרמול מספר סידורי להשוואה: אותיות גדולות, ללא רווחים, כל מפריד הופך ל-"/", ללא אפסים מובילים בכל מקטע.
 * "07-2/1045" == "7/2/1045" ;  "2345 / 03" == "2345/3" ;  "k500158" == "K500158"
 */
export function normalizeSerial(serial) {
  return String(serial ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[-._\\]+/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
    .split('/')
    .map((segment) => (/^\d+$/.test(segment) ? segment.replace(/^0+(?=\d)/, '') : segment))
    .join('/');
}

const MATCH_STOP_WORDS = new Set(['של', 'עם', 'את', 'מטר', 'מטרים', 'מ', 'טון', 'טונות', 'הרמה', 'אורך', 'גודל', 'במבנה']);

/**
 * מפתח לשם (סוג / מיקום): "רצועה ירוקה ארבע מ'" == "רצועה ירוקה 4 מטר" == "הרצועה הירוקה 4 מטר".
 */
export function nameKey(name) {
  return normalizeTranscript(name)
    .toLowerCase()
    .split(' ')
    .map((w) => wordToDigits(w) ?? w)
    .filter((w) => w && !MATCH_STOP_WORDS.has(w))            // לפני הסרת ה' הידיעה, כדי ש"הרמה" לא תהפוך ל"רמה"
    .map((w) => w.replace(/^ו(?=[א-ת]{2,})/, '').replace(/^ה(?=[א-ת]{3,})/, ''))
    .map((w) => w.replace(/(\d)מ$/, '$1'))
    .filter((w) => w && !MATCH_STOP_WORDS.has(w))
    .join(' ');
}

// ---------- ניתוח ----------

/**
 * @returns אחד מ:
 *   {kind:'command', command}
 *   {kind:'location', name}            name ריק = נאמר "מיקום" בלי שם
 *   {kind:'type', name}
 *   {kind:'item', serial, status, statusExplicit, defects, note}
 *   {kind:'result', status, statusExplicit, defects, note}   (בלי מספר - לפריט האחרון)
 *   {kind:'noise', text}
 */
export function parseFieldCommand(transcript, options = {}) {
  const defects = options.defects || DEFAULT_DEFECTS;
  const text = normalizeTranscript(transcript);
  if (!text) return { kind: 'noise', text: '', raw: transcript };

  for (const { command, phrases } of CONTROL_COMMANDS) {
    if (phrases.includes(text)) return { kind: 'command', command, raw: transcript };
  }

  const tokens = text.split(' ');

  const location = extractContext(tokens, LOCATION_WORDS);
  if (location !== null) return { kind: 'location', name: location, raw: transcript };

  const type = extractContext(tokens, TYPE_WORDS);
  if (type !== null) return { kind: 'type', name: type, raw: transcript };

  if (hasDigits(tokens) || /^[A-Za-z]/.test(tokens[0])) {
    const { serial, rest } = extractSerial(tokens);
    if (serial) {
      const result = extractResult(rest, defects);
      return {
        kind: 'item',
        serial,
        status: result.status || (result.defects.length ? 'fail' : 'ok'),
        statusExplicit: Boolean(result.status),
        defects: result.defects,
        note: result.note,
        raw: transcript,
      };
    }
  }

  const result = extractResult(tokens, defects);
  if (result.status || result.defects.length) {
    return {
      kind: 'result',
      status: result.status || 'fail',
      statusExplicit: Boolean(result.status),
      defects: result.defects,
      note: result.note,
      raw: transcript,
    };
  }

  return { kind: 'noise', text, raw: transcript };
}

/** מספר להקראה: תו אחר תו */
export function serialToSpeech(serial) {
  return String(serial).replace(/\//g, ' לוכסן ').replace(/-/g, ' מקף ').split('').join(' ').replace(/\s+/g, ' ');
}
