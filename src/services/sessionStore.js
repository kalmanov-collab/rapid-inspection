/**
 * שמירה מקומית במכשיר (IndexedDB) - הסשן שורד סגירת דפדפן ועובד ללא רשת.
 * נשמרים: הקובץ המפוענח (כל השורות), המצב השוטף של הבדיקה, ופרטי הסשן.
 */
import { get, set, del } from 'idb-keyval';

const KEYS = { parsed: 'rapid.parsed', state: 'rapid.state', meta: 'rapid.meta' };

export async function saveParsed(parsed) {
  await set(KEYS.parsed, parsed);
}

export async function saveMeta(meta) {
  await set(KEYS.meta, meta);
}

/** שמירת מצב הבדיקה - נקרא אחרי כל שינוי; הלוג מקוצר כדי לא לנפח את האחסון */
export async function saveState(state) {
  await set(KEYS.state, { ...state, log: state.log.slice(0, 50) });
}

export async function loadSaved() {
  const [parsed, state, meta] = await Promise.all([get(KEYS.parsed), get(KEYS.state), get(KEYS.meta)]);
  if (!parsed || !meta) return null;
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
