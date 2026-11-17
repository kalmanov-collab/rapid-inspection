/**
 * מנוע המצב של בדיקה מהירה (גרסה 2) - פונקציות טהורות ללא React וללא Firestore.
 *
 * עקרונות (החלטות 16/11/2026):
 *  - הסשן מקובץ לפי סוג אביזר (רשומת קטלוג); הבודק מחזיק "סוג פעיל" ו"מיקום פעיל".
 *  - פריט קיים מזוהה לפי 4 הספרות האחרונות של המס' הסידורי בתוך הסוג הפעיל.
 *  - מספר שלא נמצא -> פריט חדש, תמיד עם מספר מלא, עם הסוג והמיקום הפעילים.
 *  - פריט שנמצא במיקום אחר מזה שבתסקיר הקודם -> המיקום מתעדכן אוטומטית ונרשם ברשימת "מעברים".
 *  - אין סטטוס "תקין עם הערה": הערה על פריט תקין נשמרת ונכנסת לסעיף הליקויים עם מספר הפריט.
 *
 * כל קריאה ל-applyTranscript מחזירה { state, feedback, updatedItem? }.
 */
import { parseVoiceCommand, digitsOf, serialToSpeech } from './voiceParser.js';

export const ITEM_STATUS = { PENDING: 'pending', OK: 'ok', FAIL: 'fail', NOT_FOUND: 'notFound' };

export const STATUS_LABELS = { pending: 'ממתין', ok: 'תקין', fail: 'פסול', notFound: 'לא נמצא' };

/** סף ביטחון שמתחתיו הפריט נכנס לרשימת "לבדיקה חוזרת" */
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

const MAX_LOG = 300;

// ---------- בנייה ----------

function buildItem(raw, catalogById) {
  const serial = String(raw.serial ?? '').trim();
  const entry = raw.catalogId ? catalogById[raw.catalogId] : null;
  return {
    id: raw.id || serial,
    serial,
    catalogId: raw.catalogId || null,
    type: raw.type || entry?.type || '',
    description: raw.description || entry?.description || '',
    swl: raw.swl ?? entry?.swl ?? '',
    location: raw.location || '',
    prevLocation: raw.prevLocation || '',
    prevReportNumber: raw.prevReportNumber || '',
    prevInspection: raw.prevInspection || '',
    prevResult: raw.prevResult || '',
    status: raw.status || ITEM_STATUS.PENDING,
    defects: raw.defects || [],
    note: raw.note || '',
    inspectedAt: raw.inspectedAt || null,
    confidence: raw.confidence ?? null,
    isNew: Boolean(raw.isNew),
  };
}

/**
 * יצירת מצב התחלתי.
 * @param {Object} session - { items, catalog, locations }
 * @param {Object} [options] - { defects }
 */
export function createInitialState(session, options = {}) {
  const catalog = session.catalog || [];
  const catalogById = Object.fromEntries(catalog.map((e) => [e.id, e]));
  const items = {};
  const order = [];
  for (const raw of session.items || []) {
    const item = buildItem(raw, catalogById);
    if (!item.serial || items[item.id]) continue; // התעלמות מכפילויות
    items[item.id] = item;
    order.push(item.id);
  }
  const locations = [...new Set([...(session.locations || []), ...order.map((id) => items[id].location).filter(Boolean)])];
  return {
    items,
    order,
    catalog,
    catalogById,
    locations,
    activeTypeId: null,
    activeLocation: null,
    currentId: null,
    history: [],
    pendingQuestion: null,
    reviewQueue: [],
    moved: [],
    log: [],
    defectsDictionary: options.defects || null,
  };
}

// ---------- עזרים ----------

export function getCounts(state) {
  const counts = { total: state.order.length, pending: 0, ok: 0, fail: 0, notFound: 0, new: 0, moved: state.moved.length };
  for (const id of state.order) {
    const item = state.items[id];
    counts[item.status]++;
    if (item.isNew) counts.new++;
  }
  return counts;
}

/** הפריטים של סוג נתון (לפי רשומת קטלוג, או לפי תיאור כשאין קטלוג) */
export function itemsOfType(state, catalogId) {
  const entry = state.catalogById[catalogId];
  return state.order
    .map((id) => state.items[id])
    .filter((item) => item.catalogId === catalogId || (entry && !item.catalogId && item.description === entry.description));
}

function statusToBeep(status) {
  if (status === ITEM_STATUS.FAIL) return 'fail';
  if (status === ITEM_STATUS.NOT_FOUND) return 'notFound';
  return 'ok';
}

function describeItem(item) {
  const parts = [serialToSpeech(item.serial), item.description, STATUS_LABELS[item.status]];
  if (item.defects.length) parts.push(item.defects.map((d) => d.label).join(', '));
  if (item.note) parts.push(item.note);
  return parts.filter(Boolean).join(', ');
}

function withLog(state, entry) {
  return { ...state, log: [{ time: Date.now(), ...entry }, ...state.log].slice(0, MAX_LOG) };
}

function activeTypeEntry(state) {
  return state.activeTypeId ? state.catalogById[state.activeTypeId] : null;
}

/** מזהה ייחודי לפריט חדש (מספר סידורי; אם קיים - עם סיומת) */
function uniqueId(state, serial) {
  let id = serial;
  let n = 2;
  while (state.items[id]) id = `${serial}#${n++}`;
  return id;
}

// ---------- החלת תוצאות ----------

/**
 * החלת תוצאת בדיקה על פריט קיים.
 * @param {boolean} merge - המשך תיאור ללא מספר: ליקויים מצטברים, הסטטוס נשאר אלא אם נאמר במפורש
 */
function applyInspection(state, id, parsed, confidence, merge = false) {
  const existing = state.items[id];
  const previous = { ...existing };

  const defects = merge
    ? [...existing.defects, ...parsed.defects.filter((d) => !existing.defects.some((e) => e.code === d.code))]
    : parsed.defects;

  let status = parsed.status;
  if (merge && !parsed.statusExplicit && parsed.defects.length === 0) status = existing.status;

  const note = merge && existing.note ? `${existing.note} ${parsed.note}`.trim() : parsed.note;

  // עדכון מיקום אוטומטי למיקום הפעיל
  let location = existing.location;
  let prevLocation = existing.prevLocation;
  let moved = state.moved;
  if (state.activeLocation && existing.location !== state.activeLocation) {
    prevLocation = existing.prevLocation || existing.location;
    location = state.activeLocation;
    if (!moved.includes(id) && prevLocation) moved = [...moved, id];
  }

  const updated = { ...existing, status, defects, note, location, prevLocation, inspectedAt: Date.now(), confidence };

  const reviewQueue =
    confidence < LOW_CONFIDENCE_THRESHOLD && !state.reviewQueue.includes(id) ? [...state.reviewQueue, id] : state.reviewQueue;

  const alreadyInspected = existing.status !== ITEM_STATUS.PENDING && !merge;
  const movedNow = location !== existing.location && Boolean(existing.location);

  const nextState = withLog(
    {
      ...state,
      items: { ...state.items, [id]: updated },
      currentId: id,
      history: [...state.history, { id, previous, wasNew: false, movedBefore: state.moved }],
      pendingQuestion: null,
      reviewQueue,
      moved,
    },
    { kind: 'inspection', id, status, raw: parsed.raw, confidence },
  );

  const extras = [];
  if (alreadyInspected) extras.push('נבדק כבר קודם - עודכן');
  if (movedNow) extras.push(`הועבר מ-${existing.location}`);
  const message = `${existing.serial} - ${STATUS_LABELS[status]}${defects.length ? ': ' + defects.map((d) => d.label).join(', ') : ''}${note ? ' (' + note + ')' : ''}${extras.length ? ' [' + extras.join('; ') + ']' : ''}`;

  return {
    state: nextState,
    feedback: { beep: statusToBeep(status), message, speak: alreadyInspected ? 'שים לב, הפריט כבר נבדק. עודכן.' : null },
    updatedItem: updated,
  };
}

/** יצירת פריט חדש עם מספר מלא, בסוג ובמיקום הפעילים */
function addNewItem(state, serial, parsed, confidence) {
  const entry = activeTypeEntry(state);
  if (!entry) return { state, feedback: { beep: 'error', message: 'אין סוג פעיל - אמור קודם את סוג האביזר', speak: 'איזה סוג?' } };

  const id = uniqueId(state, serial);
  const item = buildItem(
    { id, serial, catalogId: entry.id, type: entry.type, description: entry.description, swl: entry.swl, location: state.activeLocation || '', isNew: true },
    state.catalogById,
  );
  const withItem = {
    ...state,
    items: { ...state.items, [id]: item },
    order: [...state.order, id],
    pendingQuestion: null,
  };
  const result = applyInspection(withItem, id, parsed, confidence, false);
  // סימון בהיסטוריה שהפריט נוצר עכשיו, כדי ש"בטל" יסיר אותו
  const history = [...result.state.history];
  history[history.length - 1] = { ...history[history.length - 1], wasNew: true };
  const locationWarning = state.activeLocation ? '' : ' - ללא מיקום!';
  return {
    state: { ...result.state, history },
    feedback: { ...result.feedback, beep: 'new', message: `חדש: ${result.feedback.message}${locationWarning}`, speak: state.activeLocation ? null : 'שים לב, אין מיקום פעיל' },
    updatedItem: result.updatedItem,
  };
}

/** חיפוש פריט לפי סיומת ספרות */
function findBySuffix(items, digits) {
  return items.filter((item) => digitsOf(item.serial).endsWith(digits));
}

/** העברת פריט לסוג הפעיל (כשנמצא תחת סוג אחר) */
function moveToActiveType(state, id) {
  const entry = activeTypeEntry(state);
  const item = state.items[id];
  const updated = { ...item, catalogId: entry.id, type: entry.type, description: entry.description, swl: entry.swl };
  return { ...state, items: { ...state.items, [id]: updated } };
}

// ---------- מצב דביק ----------

function setActiveType(state, entry) {
  const count = itemsOfType({ ...state, activeTypeId: entry.id }, entry.id);
  const pending = count.filter((i) => i.status === ITEM_STATUS.PENDING).length;
  const nextState = withLog({ ...state, activeTypeId: entry.id, pendingQuestion: null }, { kind: 'type', catalogId: entry.id });
  const message = `סוג: ${entry.description}${entry.swl ? ` (${entry.swl} טון)` : ''} - ${count.length} ברשימה, ${pending} ממתינים`;
  return { state: nextState, feedback: { beep: 'ok', message, speak: `${entry.description}, ${count.length} פריטים` } };
}

function setActiveLocation(state, name, isNewLocation = false) {
  const locations = state.locations.includes(name) ? state.locations : [...state.locations, name];
  const nextState = withLog({ ...state, activeLocation: name, locations, pendingQuestion: null }, { kind: 'location', name });
  return { state: nextState, feedback: { beep: 'ok', message: `מיקום: ${name}${isNewLocation ? ' (חדש)' : ''}`, speak: name } };
}

// ---------- פקודות ----------

function handleCommand(state, command) {
  switch (command) {
    case 'undo': {
      const last = state.history[state.history.length - 1];
      if (!last) return { state, feedback: { beep: 'error', message: 'אין מה לבטל' } };
      let items = { ...state.items };
      let order = state.order;
      if (last.wasNew) {
        delete items[last.id];
        order = order.filter((id) => id !== last.id);
      } else {
        items[last.id] = { ...items[last.id], ...last.previous };
      }
      const nextState = withLog(
        {
          ...state,
          items,
          order,
          history: state.history.slice(0, -1),
          currentId: last.wasNew ? null : last.id,
          pendingQuestion: null,
          reviewQueue: state.reviewQueue.filter((id) => id !== last.id),
          moved: last.movedBefore || state.moved.filter((id) => id !== last.id),
        },
        { kind: 'undo', id: last.id },
      );
      const serial = last.wasNew ? last.id.split('#')[0] : items[last.id].serial;
      return { state: nextState, feedback: { beep: 'undo', message: `בוטל: ${serial}${last.wasNew ? ' (פריט חדש הוסר)' : ''}`, speak: `בוטל ${serialToSpeech(serial)}` } };
    }
    case 'repeat': {
      const item = state.currentId ? state.items[state.currentId] : null;
      if (!item) return { state, feedback: { beep: 'error', message: 'אין פריט נוכחי' } };
      return { state, feedback: { message: describeItem(item), speak: describeItem(item) } };
    }
    case 'status': {
      const c = getCounts(state);
      const entry = activeTypeEntry(state);
      const typePart = entry ? ` בסוג הפעיל נותרו ${itemsOfType(state, entry.id).filter((i) => i.status === ITEM_STATUS.PENDING).length}.` : '';
      const text = `נבדקו ${c.ok + c.fail + c.notFound} מתוך ${c.total}. פסולים ${c.fail}. חדשים ${c.new}. נותרו ${c.pending}.${typePart}`;
      return { state, feedback: { message: text, speak: text } };
    }
    case 'pause':
      return { state, feedback: { control: 'pause', message: 'האזנה מושהית' } };
    case 'resume':
      return { state, feedback: { control: 'resume', message: 'ממשיך' } };
    default:
      return { state, feedback: { message: 'אין שאלה פתוחה' } };
  }
}

// ---------- שאלות פתוחות ----------

/** בחירה מתוך רשימה לפי מספר סידורי ("אחת" / "שתיים") */
function pickByNumber(parsed, candidates) {
  if (parsed.kind !== 'inspection' || !parsed.digits || parsed.digits.length > 1) return null;
  const index = Number(parsed.digits) - 1;
  return candidates[index] ?? null;
}

function handlePendingQuestion(state, parsed, confidence) {
  const question = state.pendingQuestion;
  const cleared = { ...state, pendingQuestion: null };
  const isNo = parsed.kind === 'command' && parsed.command === 'no';
  const isYes = parsed.kind === 'command' && parsed.command === 'yes';

  if (isNo) {
    if (question.type === 'crossType') return askFullSerial(cleared, question.parsed);
    return { state: cleared, feedback: { beep: 'undo', message: 'בוטל' } };
  }

  switch (question.type) {
    case 'disambiguate': {
      // "מה הספרה לפני?" - ספרה אחת לפני, או סיומת ארוכה יותר
      if (parsed.kind !== 'inspection' || !parsed.digits) return null;
      const longer = parsed.digits.length > question.digits.length ? parsed.digits : parsed.digits + question.digits;
      const found = question.candidates.filter((id) => digitsOf(state.items[id].serial).endsWith(longer));
      if (found.length === 1) return applyInspection(cleared, found[0], { ...question.parsed, ...resultOverride(parsed, question.parsed) }, confidence);
      if (found.length === 0) return { state: cleared, feedback: { beep: 'error', message: 'לא נמצאה התאמה - נסה שוב' } };
      return { state, feedback: { beep: 'ask', message: `עדיין ${found.length} אפשרויות - עוד ספרה` , speak: 'עוד ספרה' } };
    }
    case 'crossType': {
      if (isYes) {
        const moved = moveToActiveType(cleared, question.id);
        const result = applyInspection(moved, question.id, question.parsed, confidence);
        return { ...result, feedback: { ...result.feedback, message: `${result.feedback.message} [הועבר לסוג הפעיל]` } };
      }
      return null; // קלט אחר - השאלה נזנחת
    }
    case 'needFullSerial': {
      // התשובה היא מספר מלא גם בלי המילה "חדש": מנתחים אותה מחדש כמספר מלא (אותיות, ספרות וסימנים)
      let answer = parsed;
      if (parsed.kind === 'inspection' && parsed.digits) answer = parseAsNewItem(state, parsed.raw);
      if (answer.kind !== 'newItem' || !answer.serial) return null;
      const merged = { ...question.parsed, ...resultOverride(answer, question.parsed), raw: parsed.raw };
      return createOrApplyFullSerial(cleared, answer.serial, merged, confidence);
    }
    case 'chooseType': {
      const pick = pickByNumber(parsed, question.candidates);
      if (pick) return setActiveType(cleared, pick);
      return null;
    }
    case 'chooseLocation': {
      const pick = pickByNumber(parsed, question.candidates);
      if (pick) return setActiveLocation(cleared, pick);
      return null;
    }
    case 'newLocation': {
      if (isYes) return setActiveLocation(cleared, question.name, true);
      return null;
    }
    default:
      return null;
  }
}

/** כשעונים לשאלה עם תוצאה חדשה ("פסול חתך") - היא גוברת על מה שנאמר קודם */
function resultOverride(parsed, original) {
  if (parsed.kind !== 'inspection' && parsed.kind !== 'newItem') return {};
  const hasResult = parsed.statusExplicit || parsed.defects.length > 0;
  if (!hasResult) return { note: parsed.note || original.note };
  return { status: parsed.status, statusExplicit: parsed.statusExplicit, defects: parsed.defects, note: parsed.note || original.note };
}

/** ניתוח משפט כמספר מלא של פריט חדש (כאילו נאמר "חדש" לפניו) */
function parseAsNewItem(state, raw) {
  return parseVoiceCommand(`חדש ${raw}`, { defects: state.defectsDictionary || undefined, catalog: state.catalog, locations: state.locations });
}

function askFullSerial(state, parsed) {
  return {
    state: { ...state, pendingQuestion: { type: 'needFullSerial', parsed } },
    feedback: { beep: 'ask', message: `${parsed.digits || ''} לא ברשימה - אמור את המספר המלא (או "לא" לביטול)`, speak: 'לא ברשימה. מספר מלא?' },
  };
}

/** מספר מלא: אם קיים - עדכון (או שאלת סוג), אחרת פריט חדש */
function createOrApplyFullSerial(state, serial, parsed, confidence) {
  const existingId = state.order.find((id) => state.items[id].serial.toUpperCase() === serial.toUpperCase());
  if (existingId) {
    const existing = state.items[existingId];
    if (state.activeTypeId && existing.catalogId && existing.catalogId !== state.activeTypeId) {
      return askCrossType(state, existingId, { ...parsed, digits: serial });
    }
    return applyInspection(state, existingId, parsed, confidence);
  }
  return addNewItem(state, serial, parsed, confidence);
}

function askCrossType(state, id, parsed) {
  const item = state.items[id];
  return {
    state: { ...state, pendingQuestion: { type: 'crossType', id, parsed } },
    feedback: {
      beep: 'ask',
      message: `${item.serial} קיים כ"${item.description}" - להעביר לסוג הפעיל? (כן / לא = חדש)`,
      speak: `קיים בסוג אחר, ${item.description}. להעביר?`,
    },
  };
}

// ---------- הפונקציה הראשית ----------

/**
 * עיבוד טקסט מזוהה מול המצב הנוכחי.
 * @returns {{state: Object, feedback: Object, updatedItem?: Object}}
 */
export function applyTranscript(state, transcript, confidence = 1) {
  const parsed = parseVoiceCommand(transcript, {
    defects: state.defectsDictionary || undefined,
    catalog: state.catalog,
    locations: state.locations,
  });

  if (parsed.kind === 'noise') {
    return { state, feedback: { message: parsed.note ? `לא הובן: "${parsed.note}"` : '' } };
  }

  if (state.pendingQuestion) {
    const handled = handlePendingQuestion(state, parsed, confidence);
    if (handled) return handled;
    state = { ...state, pendingQuestion: null };
  }

  if (parsed.kind === 'command') return handleCommand(state, parsed.command);

  if (parsed.kind === 'context' && parsed.context === 'type') {
    if (parsed.match === 'exact') return setActiveType(state, parsed.entry);
    const list = parsed.candidates.map((e, i) => `${i + 1}. ${e.description}${e.swl ? ` ${e.swl} טון` : ''}`).join(' / ');
    return {
      state: { ...state, pendingQuestion: { type: 'chooseType', candidates: parsed.candidates } },
      feedback: { beep: 'ask', message: `איזה סוג? ${list}`, speak: `איזה? ${parsed.candidates.map((e, i) => `${i + 1}, ${e.description}`).join('. ')}` },
    };
  }

  if (parsed.kind === 'context' && parsed.context === 'location') {
    if (parsed.match === 'exact') return setActiveLocation(state, parsed.name);
    if (parsed.match === 'ambiguous') {
      const list = parsed.candidates.map((n, i) => `${i + 1}. ${n}`).join(' / ');
      return {
        state: { ...state, pendingQuestion: { type: 'chooseLocation', candidates: parsed.candidates } },
        feedback: { beep: 'ask', message: `איזה מיקום? ${list}`, speak: `איזה? ${parsed.candidates.map((n, i) => `${i + 1}, ${n}`).join('. ')}` },
      };
    }
    return {
      state: { ...state, pendingQuestion: { type: 'newLocation', name: parsed.spoken } },
      feedback: { beep: 'ask', message: `מיקום חדש "${parsed.spoken}"? (כן / לא)`, speak: `מיקום חדש, ${parsed.spoken}?` },
    };
  }

  if (parsed.kind === 'newItem') {
    if (!parsed.serial) return askFullSerial(state, { ...parsed, kind: 'inspection', digits: '' });
    return createOrApplyFullSerial(state, parsed.serial, parsed, confidence);
  }

  // parsed.kind === 'inspection'
  if (!parsed.digits) {
    if (!state.currentId) return { state, feedback: { beep: 'error', message: 'לא נאמר מספר ואין פריט נוכחי', speak: 'איזה מספר?' } };
    return applyInspection(state, state.currentId, parsed, confidence, true);
  }

  if (!state.activeTypeId) {
    return { state, feedback: { beep: 'error', message: 'אין סוג פעיל - אמור קודם את סוג האביזר (למשל "רצועה ירוקה 4 מטר")', speak: 'איזה סוג?' } };
  }

  const inType = findBySuffix(itemsOfType(state, state.activeTypeId), parsed.digits);
  if (inType.length === 1) return applyInspection(state, inType[0].id, parsed, confidence);
  if (inType.length > 1) {
    return {
      state: { ...state, pendingQuestion: { type: 'disambiguate', digits: parsed.digits, candidates: inType.map((i) => i.id), parsed } },
      feedback: { beep: 'ask', message: `יש ${inType.length} עם ${parsed.digits} (${inType.map((i) => i.serial).join(' / ')}) - מה הספרה לפני?`, speak: `יש ${inType.length}. מה הספרה לפני?` },
    };
  }

  // לא בסוג הפעיל - אולי בסוג אחר
  const elsewhere = findBySuffix(state.order.map((id) => state.items[id]), parsed.digits);
  if (elsewhere.length === 1) return askCrossType(state, elsewhere[0].id, parsed);

  return askFullSerial(state, parsed);
}

// ---------- פעולות ידניות מהמסך ----------

export function applyManualResult(state, id, status, confidence = 1) {
  if (!state.items[id]) return { state, feedback: { beep: 'error', message: 'פריט לא נמצא' } };
  const parsed = { kind: 'inspection', digits: null, status, statusExplicit: true, defects: [], note: '', raw: `[ידני] ${state.items[id].serial} ${STATUS_LABELS[status]}` };
  return applyInspection({ ...state, pendingQuestion: null }, id, parsed, confidence);
}

export function applyManualNewItem(state, serial, status = 'ok') {
  const clean = String(serial || '').trim().toUpperCase();
  if (!clean) return { state, feedback: { beep: 'error', message: 'חסר מספר' } };
  const parsed = { kind: 'newItem', serial: clean, status, statusExplicit: true, defects: [], note: '', raw: `[ידני] חדש ${clean}` };
  return createOrApplyFullSerial({ ...state, pendingQuestion: null }, clean, parsed, 1);
}

export function selectType(state, catalogId) {
  const entry = state.catalogById[catalogId];
  if (!entry) return { state, feedback: {} };
  return setActiveType({ ...state, pendingQuestion: null }, entry);
}

export function selectLocation(state, name) {
  if (!name) return { state, feedback: {} };
  return setActiveLocation({ ...state, pendingQuestion: null }, name, !state.locations.includes(name));
}

/** עריכת רשומת קטלוג (כינויים / עומס) - מתעדכן גם בפריטים של הסוג */
export function updateCatalogEntry(state, id, patch) {
  const entry = state.catalogById[id];
  if (!entry) return { state, feedback: {} };
  const updatedEntry = { ...entry, ...patch };
  const catalog = state.catalog.map((e) => (e.id === id ? updatedEntry : e));
  const items = { ...state.items };
  if (patch.swl !== undefined || patch.description !== undefined) {
    for (const itemId of state.order) {
      if (items[itemId].catalogId === id) items[itemId] = { ...items[itemId], swl: updatedEntry.swl, description: updatedEntry.description };
    }
  }
  return { state: { ...state, catalog, catalogById: { ...state.catalogById, [id]: updatedEntry }, items }, feedback: {} };
}
