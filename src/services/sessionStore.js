/**
 * שמירה מקומית במכשיר (IndexedDB) - הסשן שורד סגירת דפדפן ועובד ללא רשת.
 * נשמרים: הקובץ המפוענח (כל השורות), המצב השוטף של הבדיקה, ופרטי הסשן.
 */
import { get, set, del } from 'idb-keyval';

// גרסה 3: מפתחות חדשים - סשן שמור מהגרסה הקודמת (מבנה אחר) לא נטען
const KEYS = { parsed: 'rapid3.parsed', state: 'rapid3.state', meta: 'rapid3.meta' };

export async function saveParsed(parsed) {
  await set(KEYS.parsed, parsed);
}

export async function saveMeta(meta) {
  await set(KEYS.meta, meta);
}

/** שמירת מצב הבדיקה - נקרא אחרי כל שינוי; ההיסטוריה (לביטול) מקוצרת כדי לא לנפח את האחסון */
export async function saveState(state) {
  await set(KEYS.state, { ...state, history: state.history.slice(-30) });
}

export async function loadSaved() {
  const [parsed, state, meta] = await Promise.all([get(KEYS.parsed), get(KEYS.state), get(KEYS.meta)]);
  if (!parsed || !meta) return null;
  if (state && !Array.isArray(state.entries)) return { parsed, state: null, meta };
  return { parsed, state: state || null, meta };
}

export async function clearSaved() {
  await Promise.all(Object.values(KEYS).map((key) => del(key)));
}

/** הורדת קובץ למכשיר (באנדרואיד נשמר בתיקיית ההורדות) */
export function downloadBytes(bytes, fileName, mimeType = 'application/octet-stream') {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
