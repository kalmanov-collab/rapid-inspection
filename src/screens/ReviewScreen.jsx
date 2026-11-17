import React, { useMemo, useState } from 'react';
import { ArrowRight, FileSpreadsheet, FileJson, CheckCircle2, AlertTriangle } from 'lucide-react';
import { reconcile, buildRowIndex } from '../services/reconcile';
import { buildUpdatedWorkbook, buildInspectedWorkbook, buildReportJson, workbookToBytes } from '../services/excelService';
import { downloadBytes } from '../services/sessionStore';
import { setTypeSetting, setMatchOverride, STATUS_LABELS } from '../utils/fieldSession';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * מסך הסיכום (סוף יום): כאן - ורק כאן - הרשימה מהשטח מושווית לקובץ הריכוז לפי מספר + סוג.
 * מציג ישן / חדש, פריטים לבדיקה (ספק בהתאמה), תיאור ועומס לכל סוג, וייצוא.
 */
export default function ReviewScreen({ parsed, state, meta, onChange, onBack, onFinish }) {
  const [tab, setTab] = useState('review');
  const [done, setDone] = useState({});
  const [error, setError] = useState('');

  const index = useMemo(() => buildRowIndex(parsed), [parsed]);
  const rec = useMemo(() => reconcile(parsed, state, { index }), [parsed, state, index]);
  const exportMeta = { clientName: state.clientName, site: state.site, date: meta.date };
  const dateTag = meta.date.replace(/\//g, '.');
  const baseName = (meta.fileName || 'ריכוז.xlsx').replace(/\.xlsx?$/i, '').replace(/ - מעודכן.*$/, '');

  const lists = useMemo(() => ({
    review: state.entries.filter((e) => rec.results[e.id].review),
    new: state.entries.filter((e) => rec.results[e.id].status === 'new'),
    moved: state.entries.filter((e) => rec.results[e.id].moved),
    all: state.entries,
  }), [state.entries, rec]);

  const run = (key, fn) => {
    setError('');
    try {
      fn();
      setDone((d) => ({ ...d, [key]: true }));
    } catch (err) {
      console.error(err);
      setError(`הייצוא נכשל: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 text-white flex flex-col" dir="rtl">
      <header className="px-4 pt-4 pb-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-2 text-gray-300" aria-label="חזרה לבדיקה"><ArrowRight /></button>
          <div>
            <h1 className="text-lg font-bold">סיכום והשוואה לרשימה הקודמת</h1>
            <div className="text-xs text-gray-400">{state.clientName} · {state.site} · {meta.date}</div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1.5 text-center">
          <Stat label="נבדקו" value={rec.counts.total} />
          <Stat label="ישנים" value={rec.counts.old} className="text-emerald-300" />
          <Stat label="חדשים" value={rec.counts.new} className="text-sky-300" />
          <Stat label="פסולים" value={rec.counts.fail} className="text-red-300" />
          <Stat label="לא נבדקו" value={rec.counts.notInspected} className="text-amber-300" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="flex gap-1.5 text-xs flex-wrap">
          <Tab active={tab === 'review'} onClick={() => setTab('review')}>לבדיקה ({lists.review.length})</Tab>
          <Tab active={tab === 'types'} onClick={() => setTab('types')}>סוגים ({rec.types.length})</Tab>
          <Tab active={tab === 'new'} onClick={() => setTab('new')}>חדשים ({lists.new.length})</Tab>
          <Tab active={tab === 'moved'} onClick={() => setTab('moved')}>הועברו ({lists.moved.length})</Tab>
          <Tab active={tab === 'all'} onClick={() => setTab('all')}>הכל ({lists.all.length})</Tab>
          <Tab active={tab === 'export'} onClick={() => setTab('export')}>ייצוא</Tab>
        </div>

        {tab === 'types' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 px-1">התיאור והעומס שייכנסו לתסקיר לכל סוג. נשמרים בגיליון "סוגים" בקובץ - בפעם הבאה אותו שם יזוהה מיד.</p>
            {rec.locations.some((l) => l.isNew) && <div className="text-xs text-sky-300 px-1">מיקומים חדשים: {rec.locations.filter((l) => l.isNew).map((l) => l.name).join(', ')}</div>}
            {rec.types.map((type) => (
              <div key={type.key} className="bg-gray-800 rounded-xl p-3">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>נאמר: {type.name}{type.isNewType ? ' · סוג חדש' : ''}</span>
                  <span>{type.count} פריטים · {type.newCount} חדשים</span>
                </div>
                <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                  <input key={`d-${type.key}-${type.reportDescription}`} defaultValue={type.reportDescription} onBlur={(e) => e.target.value.trim() && e.target.value !== type.reportDescription && onChange(setTypeSetting(state, type.key, { reportDescription: e.target.value.trim() }))} className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
                  <input key={`s-${type.key}-${type.swl}`} defaultValue={type.swl} type="number" step="0.05" inputMode="decimal" placeholder="טון" onBlur={(e) => String(e.target.value) !== String(type.swl) && onChange(setTypeSetting(state, type.key, { swl: e.target.value === '' ? '' : Number(e.target.value) }))} className={`w-20 bg-gray-900 border rounded-lg px-2 py-2 text-sm text-center outline-none focus:border-blue-400 ${type.swl === '' ? 'border-amber-500' : 'border-gray-600'}`} dir="ltr" />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'export' && (
          <div className="space-y-3">
            {lists.review.length > 0 && <div className="text-sm text-amber-300 flex items-center gap-2"><AlertTriangle size={16} /> {lists.review.length} פריטים מסומנים לבדיקה - כדאי לעבור עליהם לפני הייצוא.</div>}
            {rec.types.some((t) => t.swl === '') && <div className="text-sm text-amber-300 flex items-center gap-2"><AlertTriangle size={16} /> יש סוגים ללא עומס עבודה (לשונית "סוגים").</div>}
            <ExportButton icon={<FileSpreadsheet />} title="קובץ ריכוז מעודכן" subtitle="מיקום מעודכן לפריטים ישנים, שורות לחדשים, עמודות הבדיקה, גיליונות נבדקו / לא נבדקו / סוגים / מיקומים" done={done.summary}
              onClick={() => run('summary', () => downloadBytes(workbookToBytes(buildUpdatedWorkbook(parsed, state, rec, exportMeta)), `${baseName} - מעודכן ${dateTag}.xlsx`, XLSX_MIME))} />
            <ExportButton icon={<FileSpreadsheet />} title="נבדקו היום בלבד" subtitle="שורה לכל פריט שנבדק, עם הנתונים לתסקיר וסימון ישן / חדש" done={done.inspected}
              onClick={() => run('inspected', () => downloadBytes(workbookToBytes(buildInspectedWorkbook(state, rec, exportMeta)), `נבדקו - ${state.site} - ${dateTag}.xlsx`, XLSX_MIME))} />
            <ExportButton icon={<FileJson />} title="JSON לתסקירים" subtitle="קבוצה לכל מיקום × סוג; שורות לפי תיאור ועומס עם רשימת מספרים; ליקויים עם מספר הפריט" done={done.json}
              onClick={() => run('json', () => downloadBytes(new TextEncoder().encode(JSON.stringify(buildReportJson(state, rec, exportMeta), null, 2)), `תסקירים - ${state.site} - ${dateTag}.json`, 'application/json'))} />
            {error && <div className="text-sm text-red-300">{error}</div>}
            <p className="text-xs text-gray-500">הקבצים נשמרים בתיקיית ההורדות. הקובץ המעודכן נכתב כערכים (ללא הנוסחאות והעיצוב של המקור) - שמור את המקור.</p>
            <button onClick={() => { if (window.confirm('לסיים את הסשן ולמחוק אותו מהמכשיר? ודא שייצאת את הקבצים.')) onFinish(); }} className="w-full bg-red-700 rounded-xl py-3 font-bold">סיום ומחיקת הסשן מהמכשיר</button>
          </div>
        )}

        {['review', 'new', 'moved', 'all'].includes(tab) && (
          <ul className="space-y-2">
            {lists[tab].length === 0 && <li className="text-gray-500 text-sm py-6 text-center">{tab === 'review' ? 'אין פריטים לבדיקה - אפשר לעבור לייצוא' : 'אין פריטים'}</li>}
            {lists[tab].slice(0, 300).map((entry) => {
              const result = rec.results[entry.id];
              return (
                <li key={entry.id} className="bg-gray-800 rounded-xl p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base" dir="ltr">{entry.serial}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${result.status === 'old' ? 'bg-emerald-900 text-emerald-200' : 'bg-sky-900 text-sky-200'}`}>{result.status === 'old' ? 'ישן' : 'חדש'}</span>
                    {entry.status === 'fail' && <span className="px-2 py-0.5 rounded text-xs bg-red-900 text-red-200">{STATUS_LABELS.fail}</span>}
                    <span className="flex-1 text-left text-xs text-gray-400 truncate">{entry.location}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{entry.type}{result.prev ? ` · בקובץ: ${result.prev.serial}, ${result.prev.location || '-'}${result.prev.date ? `, ${result.prev.date}` : ''}` : ''}</div>
                  {result.reason && <div className="text-xs text-amber-300 mt-1">{result.reason}</div>}
                  {(result.review || result.overridden) && (
                    <div className="mt-2 flex gap-2">
                      {result.status === 'old' && <button onClick={() => onChange(setMatchOverride(state, entry.id, 'new'))} className="flex-1 bg-sky-700 rounded-lg py-1.5 text-xs font-bold">לא אותו פריט - סמן חדש</button>}
                      {result.status === 'new' && result.conflictRow !== undefined && result.kind === 'typeConflict' && <button onClick={() => onChange(setMatchOverride(state, entry.id, 'old'))} className="flex-1 bg-emerald-700 rounded-lg py-1.5 text-xs font-bold">זה אותו פריט - סמן ישן</button>}
                      {!result.overridden && <button onClick={() => onChange(setMatchOverride(state, entry.id, result.status))} className="flex-1 bg-gray-700 rounded-lg py-1.5 text-xs font-bold">נכון - אשר</button>}
                      {result.overridden && <button onClick={() => onChange(setMatchOverride(state, entry.id, null))} className="flex-1 bg-gray-700 rounded-lg py-1.5 text-xs">בטל הכרעה</button>}
                    </div>
                  )}
                </li>
              );
            })}
            {lists[tab].length > 300 && <li className="text-gray-500 text-xs text-center">מוצגים 300 מתוך {lists[tab].length} - הרשימה המלאה בקובץ המיוצא</li>}
          </ul>
        )}
      </main>

      <footer className="p-3 bg-gray-800 border-t border-gray-700 flex gap-2">
        <button onClick={onBack} className="flex-1 bg-gray-700 rounded-xl py-3 font-bold">חזרה לבדיקה</button>
        <button onClick={() => setTab('export')} className="flex-1 bg-blue-600 rounded-xl py-3 font-bold">ייצוא</button>
      </footer>
    </div>
  );
}

function ExportButton({ icon, title, subtitle, done, onClick }) {
  return (
    <button onClick={onClick} className="w-full text-right bg-gray-800 hover:bg-gray-700 rounded-2xl p-4 flex items-center gap-3 border border-gray-700">
      <div className="text-emerald-400">{icon}</div>
      <div className="flex-1">
        <div className="font-bold">{title}</div>
        <div className="text-xs text-gray-400">{subtitle}</div>
      </div>
      {done && <CheckCircle2 className="text-emerald-400" />}
    </button>
  );
}

function Stat({ label, value, className = '' }) {
  return (
    <div className="bg-gray-900 rounded-lg py-1.5">
      <div className={`text-lg font-bold leading-none ${className}`}>{value}</div>
      <div className="text-[10px] text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return <button onClick={onClick} className={`px-2.5 py-1 rounded-full ${active ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}>{children}</button>;
}
