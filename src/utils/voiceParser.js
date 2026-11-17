/**
 * מנתח פקודות קוליות למצב בדיקה מהירה של אביזרי הרמה (גרסה 2).
 *
 * הבודק עובד עם שני מצבים "דביקים" - סוג אביזר ומיקום - ובין לבין אומר רק מספרים:
 *   "רצועה ירוקה ארבע מטר"            -> מעבר סוג (התאמה לקטלוג)
 *   "מקום מחסן כלים" / "קבוצה דנה רוני" -> מעבר מיקום
 *   "אחת אפס ארבע חמש"                 -> פריט קיים לפי 4 ספרות אחרונות, תקין
 *   "אפס שתיים שלוש תשע פסול חתך"      -> פריט קיים, פסול, ליקוי
 *   "חדש קי חמש אפס אפס אחת חמש שמונה" -> פריט חדש עם מספר מלא K500158
 *   "בטל" / "חזור" / "כן" / "לא"       -> פקודות
 *
 * המנתח טהור (ללא React / Firestore) כדי שאפשר לבדוק אותו ב-node.
 */

// ---------- מילונים ----------

/** מילות ספרות בעברית (זכר/נקבה ושיבושי זיהוי נפוצים) */
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

/** שמות אותיות לועזיות כפי שנאמרות בעברית (למספר מלא של פריט חדש) */
const LETTER_WORDS = {
  איי: 'A', אי: 'A',
  בי: 'B',
  סי: 'C',
  די: 'D',
  אף: 'F',
  'ג׳י': 'G', גי: 'G',
  אייץ: 'H',
  'ג׳יי': 'J', גיי: 'J',
  קיי: 'K', קי: 'K',
  אל: 'L',
  אם: 'M',
  אן: 'N',
  או: 'O',
  פי: 'P',
  קיו: 'Q',
  אר: 'R',
  אס: 'S',
  טי: 'T',
  יו: 'U',
  וי: 'V',
  אקס: 'X',
  וואי: 'Y', ואי: 'Y',
  זד: 'Z', זט: 'Z',
};

/** סימני הפרדה במספר מלא */
const SEPARATOR_WORDS = { לוכסן: '/', סלש: '/', מקף: '-', נקודה: '.' };

/** פקודות שליטה - כל המשפט הוא הפקודה */
const COMMANDS = [
  { command: 'undo', phrases: ['בטל', 'ביטול', 'תבטל', 'מחק'] },
  { command: 'repeat', phrases: ['חזור', 'תחזור', 'מה היה', 'מה אמרתי'] },
  { command: 'status', phrases: ['מצב', 'סטטוס', 'כמה נשאר', 'כמה נשארו'] },
  { command: 'pause', phrases: ['עצור', 'הפסק', 'השהה'] },
  { command: 'resume', phrases: ['המשך', 'תמשיך'] },
  { command: 'yes', phrases: ['כן', 'נכון', 'אשר', 'אישור'] },
  { command: 'no', phrases: ['לא', 'לא נכון', 'שלילי'] },
];

/** מילות מפתח למעבר מיקום */
const LOCATION_PREFIXES = ['מקום', 'מיקום', 'קבוצה', 'קבוצת', 'מחזיק', 'צוות'];

/** ביטויי סטטוס - הארוכים נבדקים לפני הקצרים */
const STATUS_PHRASES = [
  { status: 'notFound', phrases: ['לא נמצא', 'לא נמצאה', 'לא קיים', 'חסר בשטח'] },
  { status: 'fail', phrases: ['לא תקין', 'לא תקינה', 'פסול', 'פסולה', 'נפסל', 'להשמדה', 'להוציא משימוש'] },
  { status: 'ok', phrases: ['תקין', 'תקינה', 'בסדר', 'עבר'] },
];

/** מילון ליקויים ברירת מחדל; ניתן להחליף דרך options.defects */
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

/** ניקוי הטקסט המזוהה: הסרת פיסוק, ניקוד ורווחים כפולים */
export function normalizeTranscript(text) {
  if (!text) return '';
  return String(text)
    .replace(/[֑-ׇ]/g, '')
    .replace(/[.,;:!?'"״׳()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** רק הספרות של מחרוזת */
export function digitsOf(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** 4 הספרות האחרונות של מספר סידורי - המפתח הקולי */
export function last4(serial) {
  return digitsOf(serial).slice(-4);
}

/** המרת מילה בודדת לספרה (כולל ו' החיבור: "ושבע") */
function wordToDigit(word) {
  if (/^\d+$/.test(word)) return word;
  if (/^[\d/-]+$/.test(word) && /\d/.test(word)) return digitsOf(word); // "07-2/1045" כפי שמוקלד
  if (DIGIT_WORDS[word]) return DIGIT_WORDS[word];
  if (word.length > 2 && word.startsWith('ו') && DIGIT_WORDS[word.slice(1)]) return DIGIT_WORDS[word.slice(1)];
  return null;
}

/** המרת מילה לאות לועזית (שם האות בעברית או האות עצמה) */
function wordToLetter(word) {
  if (/^[A-Za-z]$/.test(word)) return word.toUpperCase();
  const clean = word.replace(/['׳]/g, '׳');
  return LETTER_WORDS[clean] || LETTER_WORDS[word] || null;
}

/** חילוץ רצף הספרות הרציף הראשון; מחזיר את הספרות ואת האסימונים שנותרו */
function extractDigits(tokens) {
  let digits = '';
  let start = -1;
  let end = -1;
  for (let i = 0; i < tokens.length; i++) {
    const digit = wordToDigit(tokens[i]);
    if (digit !== null) {
      if (start === -1) start = i;
      digits += digit;
      end = i;
    } else if (start !== -1) {
      break;
    }
  }
  if (start === -1) return { digits: null, rest: tokens };
  return { digits, rest: [...tokens.slice(0, start), ...tokens.slice(end + 1)] };
}

/**
 * חילוץ מספר סידורי מלא (אותיות, ספרות וסימנים) מתחילת רשימת האסימונים.
 * נעצר במילה הראשונה שאינה אות, ספרה או סימן.
 */
function extractFullSerial(tokens) {
  let serial = '';
  let i = 0;
  for (; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^[A-Za-z0-9/.-]+$/.test(token)) { serial += token.toUpperCase(); continue; } // כפי שמוקלד, כולל סימנים
    const digit = wordToDigit(token);
    if (digit !== null) { serial += digit; continue; }
    if (SEPARATOR_WORDS[token]) { serial += SEPARATOR_WORDS[token]; continue; }
    const letter = wordToLetter(token);
    if (letter) { serial += letter; continue; }
    break;
  }
  return { serial: serial || null, rest: tokens.slice(i) };
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

/** חילוץ סטטוס וליקויים מרשימת אסימונים; מחזיר גם את השארית כהערה */
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

// ---------- התאמה מקורבת לקטלוג ולמיקומים ----------

/** נרמול משפט להשוואה: ספרות במילים -> ספרות, הסרת מילות קישור */
function normalizeForMatch(text) {
  const stop = new Set(['של', 'עם', 'את', 'ו', 'מטר', 'מטרים', 'מ', 'טון', 'טונות']);
  return normalizeTranscript(text)
    .split(' ')
    .map((w) => wordToDigit(w) ?? w)
    .map((w) => w.replace(/^ו(?=[א-ת]{2,})/, ''))   // ו' החיבור
    .map((w) => w.replace(/^ה(?=[א-ת]{3,})/, ''))   // ה' הידיעה
    .filter((w) => w && !stop.has(w));
}

/** דמיון בין שני משפטים: שיעור המילים של המשפט שנאמר שמופיעות בכינוי (עם סובלנות לסיומות) */
function similarity(spokenTokens, aliasTokens) {
  if (spokenTokens.length === 0 || aliasTokens.length === 0) return 0;
  const matches = (a, b) => a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a)));
  let hit = 0;
  for (const s of spokenTokens) if (aliasTokens.some((a) => matches(s, a))) hit++;
  let back = 0;
  for (const a of aliasTokens) if (spokenTokens.some((s) => matches(s, a))) back++;
  return (hit / spokenTokens.length + back / aliasTokens.length) / 2;
}

/**
 * התאמת משפט לרשומת קטלוג לפי הכינויים הקוליים.
 * @param {string} text
 * @param {Array<{id: string, description: string, aliases?: string[]}>} catalog
 * @returns {{match: 'exact'|'ambiguous'|'none', entry?: Object, candidates: Object[]}}
 */
export function matchCatalog(text, catalog) {
  const spoken = normalizeForMatch(text);
  if (spoken.length === 0 || !catalog?.length) return { match: 'none', candidates: [] };

  const scored = catalog
    .map((entry) => {
      const phrases = [...(entry.aliases || []), entry.description].filter(Boolean);
      const score = Math.max(...phrases.map((p) => similarity(spoken, normalizeForMatch(p))));
      return { entry, score };
    })
    .filter(({ score }) => score >= 0.5)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { match: 'none', candidates: [] };
  const [best, second] = scored;
  // התאמה מלאה (כל המילים בשני הכיוונים) גוברת גם אם יש כינוי קצר יותר שמכיל חלק מהמילים
  if (best.score >= 0.75 && (!second || best.score - second.score >= 0.2 || (best.score >= 0.999 && second.score < 0.999))) {
    return { match: 'exact', entry: best.entry, candidates: [] };
  }
  return { match: 'ambiguous', candidates: scored.slice(0, 3).map((s) => s.entry) };
}

/**
 * התאמת שם מיקום לרשימת המיקומים הידועים.
 * @returns {{match: 'exact'|'ambiguous'|'none', name?: string, candidates: string[]}}
 */
export function matchLocation(text, locations) {
  const spoken = normalizeForMatch(text);
  if (spoken.length === 0) return { match: 'none', candidates: [] };
  const scored = (locations || [])
    .map((name) => ({ name, score: similarity(spoken, normalizeForMatch(name)) }))
    .filter(({ score }) => score >= 0.5)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { match: 'none', candidates: [] };
  const [best, second] = scored;
  if (best.score >= 0.75 && (!second || best.score - second.score >= 0.2)) return { match: 'exact', name: best.name, candidates: [] };
  return { match: 'ambiguous', candidates: scored.slice(0, 3).map((s) => s.name) };
}

// ---------- ניתוח ----------

/**
 * ניתוח טקסט מזוהה לפקודה מובנית.
 * @param {string} transcript
 * @param {Object} [options]
 * @param {Array} [options.defects] - מילון ליקויים
 * @param {Array} [options.catalog] - קטלוג סוגים עם כינויים
 * @param {string[]} [options.locations] - מיקומים ידועים
 * @returns {Object} אחד מ:
 *   {kind:'command', command}
 *   {kind:'context', context:'type', match, entry?, candidates}
 *   {kind:'context', context:'location', match, name?, spoken, candidates}
 *   {kind:'inspection', digits, status, statusExplicit, defects, note}
 *   {kind:'newItem', serial, status, statusExplicit, defects, note}
 *   {kind:'noise'}
 */
export function parseVoiceCommand(transcript, options = {}) {
  const defects = options.defects || DEFAULT_DEFECTS;
  const text = normalizeTranscript(transcript);
  if (!text) return { kind: 'noise', raw: transcript };

  for (const { command, phrases } of COMMANDS) {
    if (phrases.includes(text)) return { kind: 'command', command, raw: transcript };
  }

  const tokens = text.split(' ');

  // מעבר מיקום: "מקום X" / "קבוצה X"
  if (LOCATION_PREFIXES.includes(tokens[0]) && tokens.length > 1) {
    const spoken = tokens.slice(1).join(' ');
    return { kind: 'context', context: 'location', spoken, ...matchLocation(spoken, options.locations), raw: transcript };
  }

  // פריט חדש עם מספר מלא: "חדש <מספר> [תוצאה]"
  if (tokens[0] === 'חדש' || tokens[0] === 'חדשה') {
    const { serial, rest } = extractFullSerial(tokens.slice(1));
    if (!serial) return { kind: 'newItem', serial: null, raw: transcript };
    const result = extractResult(rest, defects);
    return {
      kind: 'newItem',
      serial,
      status: result.status || (result.defects.length ? 'fail' : 'ok'),
      statusExplicit: Boolean(result.status),
      defects: result.defects,
      note: result.note,
      raw: transcript,
    };
  }

  // פריט קיים: ספרות (+ תוצאה)
  const { digits, rest } = extractDigits(tokens);
  const result = extractResult(rest, defects);

  // משפט עם מילים חופשיות ובלי מספר של ממש (עד 2 ספרות) - כנראה שם סוג ("רצועה ירוקה 4 מטר", "שאקל 7 שמיניות")
  if (result.note && (!digits || digits.length < 3)) {
    const catalogMatch = matchCatalog(text, options.catalog);
    if (catalogMatch.match !== 'none') return { kind: 'context', context: 'type', spoken: text, ...catalogMatch, raw: transcript };
  }

  if (digits) {
    return {
      kind: 'inspection',
      digits,
      status: result.status || (result.defects.length ? 'fail' : 'ok'),
      statusExplicit: Boolean(result.status),
      defects: result.defects,
      note: result.note,
      raw: transcript,
    };
  }

  // ללא ספרות: תוצאה בלבד (חל על הפריט הנוכחי)
  if (result.status || result.defects.length) {
    return {
      kind: 'inspection',
      digits: null,
      status: result.status || 'fail',
      statusExplicit: Boolean(result.status),
      defects: result.defects,
      note: result.note,
      raw: transcript,
    };
  }

  return { kind: 'noise', raw: transcript, note: text };
}

/** מספר להקראה ברורה: ספרות מופרדות */
export function serialToSpeech(serial) {
  return String(serial).split('').join(' ');
}
