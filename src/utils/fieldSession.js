/**
 * מנוע הבדיקה בשטח (גרסה 3) - פונקציות טהורות, ללא React וללא גישה לקובץ הריכוז.
 *
 * בזמן הבדיקה אין חיפוש פריטים: כל מספר שנאמר נרשם מיד תחת המיקום והסוג הפעילים.
 * ההשוואה לרשימה הקודמת (ישן / חדש) נעשית רק בסוף - ראו reconcile.js.
 *
 * סוגים: רק תבניות קיימות מהקובץ (state.catalog). סוג שנאמר מותאם לתבנית פעם אחת, בהחלפת הסוג:
 *   התאמה ברורה -> מיד; כמה אפשרויות -> בחירה במסך / במספר; אין התאמה -> שאלה "להוסיף סוג חדש?"
 *   והבודק כותב בדיוק איך הסוג יופיע. השם שנאמר נשמר כ"כינוי" - בפעם הבאה ההתאמה מיידית.
 *
 * כל פעולה מחזירה { state, feedback }:
 *   feedback = { beep?: 'ok'|'fail'|'context'|'dup'|'ask'|'error'|'undo', message?, speak?, control? }
 */
import { parseFieldCommand, normalizeSerial, nameKey } from './fieldParser.js';
import { matchType, catalogKey, swlFromColor } from './typeCatalog.js';

export const STATUS_LABELS = { ok: 'תקין', fail: 'פסול' };

/** סף ביטחון זיהוי שמתחתיו הפריט מסומן "לבדיקה" במסך הסיכום */
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

const MAX_HISTORY = 200;

/**
 * @param {Object} params
 * @param {string} params.site
 * @param {string} [params.clientName]
 * @param {string[]} [params.knownLocations] - מיקומים מהקובץ
 * @param {Array} [params.catalog] - תבניות הסוגים מהקובץ (buildTypeCatalog)
 * @param {Object} [params.typeMemory] - כינויים שנלמדו בעבר: nameKey(שם שנאמר) -> { reportDescription, swl }
 */
export function createFieldState({ site, clientName = '', knownLocations = [], catalog = [], typeMemory = {} }) {
  const locations = [];
  const seen = new Set();
  for (const name of knownLocations) {
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    locations.push({ name, key, known: true });
  }
  return {
    site,
    clientName,
    startedAt: Date.now(),
    location: null,
    type: null,
    locations,
    types: [],            // { name (כפי שנאמר), key, description (התבנית), fileType, swl, isNew }
    catalog,
    typeMemory,
    pending: null,        // { kind: 'chooseType', spoken, candidates } | { kind: 'newType', spoken }
    entries: [],
    seq: 0,
    lastId: null,
    history: [],
    typeSettings: {},     // typeKey -> { reportDescription, swl } (עריכה במסך הסיכום)
    matchOverrides: {},   // entryId -> 'old' | 'new'
  };
}

// ---------- עזרים ----------

function pushHistory(state, action) {
  return [...state.history, action].slice(-MAX_HISTORY);
}

export function getCounts(state) {
  const counts = { total: state.entries.length, ok: 0, fail: 0, here: 0 };
  const typeKey = state.type ? nameKey(state.type) : null;
  const locationKey = state.location ? nameKey(state.location) : null;
  for (const entry of state.entries) {
    counts[entry.status]++;
    if (entry.typeKey === typeKey && nameKey(entry.location) === locationKey) counts.here++;
  }
  return counts;
}

/** הפריטים של המיקום והסוג הפעילים, האחרון ראשון */
export function currentEntries(state) {
  const typeKey = state.type ? nameKey(state.type) : null;
  const locationKey = state.location ? nameKey(state.location) : null;
  return state.entries.filter((e) => e.typeKey === typeKey && nameKey(e.location) === locationKey).reverse();
}

export function activeTypeInfo(state) {
  return state.type ? state.types.find((t) => t.key === nameKey(state.type)) || null : null;
}

function describeEntry(entry) {
  const parts = [entry.serial, STATUS_LABELS[entry.status]];
  if (entry.defects.length) parts.push(entry.defects.map((d) => d.label).join(', '));
  if (entry.note) parts.push(entry.note);
  return parts.join(' · ');
}

// ---------- מיקום ----------

export function setLocation(state, name) {
  const clean = String(name || '').trim();
  if (!clean) return { state, feedback: { beep: 'error', message: 'אמור "מיקום" ואת שם המיקום', speak: 'איזה מיקום?' } };
  const key = nameKey(clean);
  const existing = state.locations.find((l) => l.key === key);
  const finalName = existing ? existing.name : clean;
  const locations = existing ? state.locations : [...state.locations, { name: clean, key, known: false }];
  const isNew = !existing || !existing.known;
  return {
    state: { ...state, location: finalName, locations, history: pushHistory(state, { kind: 'context', previous: contextSnapshot(state) }) },
    feedback: { beep: 'context', message: `מיקום: ${finalName}${isNew ? ' (חדש)' : ''}`, speak: `מיקום ${finalName}` },
  };
}

function contextSnapshot(state) {
  return { location: state.location, locations: state.locations, type: state.type, types: state.types, pending: state.pending, catalog: state.catalog };
}

// ---------- סוג ----------

/** הפעלת סוג: name = כפי שנאמר, pattern = התבנית מהקטלוג (או סוג חדש שנכתב) */
function activateType(state, name, pattern, isNew = false) {
  const key = nameKey(name);
  const existing = state.types.find((t) => t.key === key);
  const swl = pattern.swl !== '' && pattern.swl !== undefined ? pattern.swl : swlFromColor(name);
  const info = existing || { name, key, description: pattern.description, fileType: pattern.fileType || '', swl, isNew };
  const types = existing ? state.types : [...state.types, info];
  return {
    state: { ...state, type: info.name, types, pending: null, history: pushHistory(state, { kind: 'context', previous: contextSnapshot(state) }) },
    feedback: {
      beep: 'context',
      message: `סוג: ${info.description}${info.swl !== '' ? ` · ${info.swl} טון` : ''}${info.isNew ? ' (סוג חדש)' : ''}`,
      speak: `סוג ${info.name}`,
    },
  };
}

/** "סוג X" - התאמה לתבנית קיימת; לעולם לא מוסיף סוג חדש בלי אישור מפורש */
export function setType(state, name) {
  const clean = String(name || '').trim();
  if (!clean) return { state, feedback: { beep: 'error', message: 'אמור "סוג" ואת שם הסוג', speak: 'איזה סוג?' } };
  const key = nameKey(clean);

  // 1. כבר נאמר בסשן הזה
  const known = state.types.find((t) => t.key === key);
  if (known) return activateType(state, known.name, known);

  // 2. כינוי שנלמד בעבר (גיליון "סוגים" בקובץ)
  const memory = state.typeMemory?.[key];
  if (memory?.reportDescription) {
    const pattern = state.catalog.find((entry) => entry.key === catalogKey(memory.reportDescription));
    return activateType(state, clean, { description: memory.reportDescription, fileType: pattern?.fileType || '', swl: memory.swl !== '' && memory.swl !== undefined ? memory.swl : pattern?.swl ?? '' });
  }

  // 3. התאמה לקטלוג
  const result = matchType(clean, state.catalog);
  if (result.match === 'exact') return activateType(state, clean, result.entry);
  if (result.match === 'ambiguous') {
    return {
      state: { ...state, pending: { kind: 'chooseType', spoken: clean, candidates: result.candidates } },
      feedback: { beep: 'ask', message: `"${clean}" - בחר סוג מהרשימה (או אמור את המספר)`, speak: 'איזה סוג?' },
    };
  }
  return {
    state: { ...state, pending: { kind: 'newType', spoken: clean } },
    feedback: { beep: 'ask', message: `"${clean}" לא מתאים לאף סוג קיים - להוסיף סוג חדש?`, speak: 'סוג לא מוכר. להוסיף סוג חדש?' },
  };
}

/** בחירת תבנית קיימת (מתוך שאלה פתוחה או מרשימת הסוגים במסך) */
export function chooseType(state, key) {
  const pattern = state.catalog.find((entry) => entry.key === key);
  if (!pattern) return { state, feedback: { beep: 'error', message: 'סוג לא נמצא' } };
  const name = state.pending?.spoken || pattern.description;
  return activateType(state, name, pattern);
}

/** אישור סוג חדש: description = בדיוק כפי שיופיע בתסקיר */
export function confirmNewType(state, description, swl = '') {
  const clean = String(description || '').trim();
  if (!clean) return { state, feedback: { beep: 'error', message: 'יש לכתוב את שם הסוג' } };
  const key = catalogKey(clean);
  const existingPattern = state.catalog.find((entry) => entry.key === key);
  const name = state.pending?.spoken || clean;
  if (existingPattern) return activateType(state, name, existingPattern);
  const pattern = { key, description: clean, fileType: '', swl: swl === '' || swl === null ? '' : Number(swl), count: 0, siteCount: 0, tokens: key.split(' ') };
  const result = activateType({ ...state, catalog: [pattern, ...state.catalog] }, name, pattern, true);
  // ההיסטוריה צריכה להחזיר גם את הקטלוג הקודם
  const history = [...result.state.history];
  history[history.length - 1] = { kind: 'context', previous: contextSnapshot(state) };
  return { state: { ...result.state, history }, feedback: result.feedback };
}

export function cancelPending(state) {
  if (!state.pending) return { state, feedback: {} };
  return { state: { ...state, pending: null }, feedback: { beep: 'undo', message: state.type ? `נשאר הסוג: ${state.type}` : 'בוטל' } };
}

// ---------- פריטים ----------

/** רישום פריט תחת המיקום והסוג הפעילים. אותו מספר באותו סוג שנאמר שוב - מעדכן את הרישום הקיים. */
export function addEntry(state, { serial, status = 'ok', defects = [], note = '' }, confidence = 1) {
  if (state.pending) return { state, feedback: { beep: 'error', message: 'קודם יש לבחור סוג', speak: 'בחר סוג' } };
  if (!state.location) return { state, feedback: { beep: 'error', message: 'אין מיקום פעיל - אמור "מיקום" ואת השם', speak: 'אין מיקום' } };
  if (!state.type) return { state, feedback: { beep: 'error', message: 'אין סוג פעיל - אמור "סוג" ואת השם', speak: 'אין סוג' } };
  const cleanSerial = String(serial || '').trim().toUpperCase();
  const key = normalizeSerial(cleanSerial);
  if (!key) return { state, feedback: { beep: 'error', message: 'מספר לא תקין' } };

  const typeKey = nameKey(state.type);
  const time = Date.now();
  const duplicate = state.entries.find((e) => e.key === key && e.typeKey === typeKey);

  if (duplicate) {
    const updated = { ...duplicate, status, defects, note, location: state.location, time, confidence, timesSaid: duplicate.timesSaid + 1 };
    return {
      state: {
        ...state,
        entries: state.entries.map((e) => (e.id === duplicate.id ? updated : e)),
        lastId: duplicate.id,
        history: pushHistory(state, { kind: 'update', id: duplicate.id, previous: duplicate, previousLastId: state.lastId }),
      },
      feedback: { beep: 'dup', message: `${cleanSerial} נאמר כבר - עודכן (${STATUS_LABELS[status]})` },
    };
  }

  const id = state.seq + 1;
  const entry = { id, serial: cleanSerial, key, type: state.type, typeKey, location: state.location, status, defects, note, time, confidence, timesSaid: 1 };
  return {
    state: { ...state, entries: [...state.entries, entry], seq: id, lastId: id, history: pushHistory(state, { kind: 'add', id, previousLastId: state.lastId }) },
    feedback: { beep: status === 'fail' ? 'fail' : 'ok', message: describeEntry(entry) },
  };
}

/** תוצאה שנאמרה בלי מספר ("פסול סדק") - חלה על הפריט האחרון; ליקויים מצטברים */
export function applyResultToLast(state, { status, statusExplicit, defects = [], note = '' }) {
  const last = state.entries.find((e) => e.id === state.lastId);
  if (!last) return { state, feedback: { beep: 'error', message: 'אין פריט אחרון', speak: 'איזה מספר?' } };
  const mergedDefects = [...last.defects, ...defects.filter((d) => !last.defects.some((x) => x.code === d.code))];
  const nextStatus = statusExplicit ? status : defects.length ? 'fail' : last.status;
  const updated = { ...last, status: nextStatus, defects: mergedDefects, note: [last.note, note].filter(Boolean).join(' ') };
  return {
    state: {
      ...state,
      entries: state.entries.map((e) => (e.id === last.id ? updated : e)),
      history: pushHistory(state, { kind: 'update', id: last.id, previous: last, previousLastId: state.lastId }),
    },
    feedback: { beep: nextStatus === 'fail' ? 'fail' : 'ok', message: describeEntry(updated) },
  };
}

export function undo(state) {
  if (state.pending) return cancelPending(state);
  const action = state.history[state.history.length - 1];
  if (!action) return { state, feedback: { beep: 'error', message: 'אין מה לבטל' } };
  const history = state.history.slice(0, -1);
  switch (action.kind) {
    case 'add': {
      const removed = state.entries.find((e) => e.id === action.id);
      return {
        state: { ...state, entries: state.entries.filter((e) => e.id !== action.id), lastId: action.previousLastId, history },
        feedback: { beep: 'undo', message: `בוטל: ${removed?.serial ?? ''}`, speak: 'בוטל' },
      };
    }
    case 'update':
      return {
        state: { ...state, entries: state.entries.map((e) => (e.id === action.id ? action.previous : e)), lastId: action.previousLastId, history },
        feedback: { beep: 'undo', message: `בוטל עדכון: ${action.previous.serial}`, speak: 'בוטל' },
      };
    case 'remove': {
      const entries = [...state.entries];
      entries.splice(action.index, 0, action.entry);
      return { state: { ...state, entries, lastId: action.previousLastId, history }, feedback: { beep: 'undo', message: `שוחזר: ${action.entry.serial}` } };
    }
    case 'context':
      return { state: { ...state, ...action.previous, history }, feedback: { beep: 'undo', message: 'בוטל שינוי מיקום / סוג', speak: 'בוטל' } };
    default:
      return { state: { ...state, history }, feedback: {} };
  }
}

// ---------- עיבוד משפט קולי ----------

export function applyTranscript(state, transcript, confidence = 1) {
  const parsed = parseFieldCommand(transcript);

  // שאלת סוג פתוחה: ספרה בודדת בוחרת מהרשימה
  if (state.pending?.kind === 'chooseType' && parsed.kind === 'item' && /^[1-9]$/.test(parsed.serial)) {
    const candidate = state.pending.candidates[Number(parsed.serial) - 1];
    if (candidate) return chooseType(state, candidate.key);
  }

  switch (parsed.kind) {
    case 'location':
      return setLocation(state, parsed.name);
    case 'type':
      return setType(state, parsed.name);
    case 'item':
      return addEntry(state, parsed, confidence);
    case 'result':
      return applyResultToLast(state, parsed);
    case 'command':
      return handleCommand(state, parsed.command);
    default:
      return { state, feedback: { message: parsed.text ? `לא הובן: "${parsed.text}"` : '' } };
  }
}

function handleCommand(state, command) {
  switch (command) {
    case 'undo':
      return undo(state);
    case 'repeat': {
      const last = state.entries.find((e) => e.id === state.lastId);
      if (!last) return { state, feedback: { beep: 'error', message: 'אין פריט אחרון' } };
      return { state, feedback: { message: describeEntry(last), speak: `${last.serial}, ${STATUS_LABELS[last.status]}` } };
    }
    case 'status': {
      const c = getCounts(state);
      const text = `נרשמו ${c.total}, פסולים ${c.fail}. כאן ${c.here}.`;
      return { state, feedback: { message: text, speak: text } };
    }
    case 'pause':
      return { state, feedback: { control: 'pause', message: 'האזנה מושהית' } };
    case 'resume':
      return { state, feedback: { control: 'resume', message: 'ממשיך' } };
    default:
      return { state, feedback: {} };
  }
}

// ---------- פעולות ידניות מהמסך ----------

export function setEntryStatus(state, id, status) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return { state, feedback: {} };
  const updated = { ...entry, status };
  return {
    state: { ...state, entries: state.entries.map((e) => (e.id === id ? updated : e)), history: pushHistory(state, { kind: 'update', id, previous: entry, previousLastId: state.lastId }) },
    feedback: { beep: status === 'fail' ? 'fail' : 'ok', message: describeEntry(updated) },
  };
}

export function removeEntry(state, id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return { state, feedback: {} };
  return {
    state: {
      ...state,
      entries: state.entries.filter((e) => e.id !== id),
      lastId: state.lastId === id ? null : state.lastId,
      history: pushHistory(state, { kind: 'remove', entry, index: state.entries.indexOf(entry), previousLastId: state.lastId }),
    },
    feedback: { beep: 'undo', message: `נמחק: ${entry.serial}` },
  };
}

// ---------- הגדרות מסך הסיכום ----------

export function setTypeSetting(state, typeKey, patch) {
  return { ...state, typeSettings: { ...state.typeSettings, [typeKey]: { ...state.typeSettings[typeKey], ...patch } } };
}

export function setMatchOverride(state, entryId, value) {
  const matchOverrides = { ...state.matchOverrides };
  if (value) matchOverrides[entryId] = value;
  else delete matchOverrides[entryId];
  return { ...state, matchOverrides };
}
