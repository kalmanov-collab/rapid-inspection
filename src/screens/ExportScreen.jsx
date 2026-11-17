import React, { useMemo, useState } from 'react';
import { ArrowRight, FileSpreadsheet, FileJson, CheckCircle2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { buildUpdatedWorkbook, buildInspectedRows, buildReportJson, workbookToBytes } from '../services/excelService';
import { downloadBytes } from '../services/sessionStore';

/**
 * ייצוא: קובץ ריכוז מעודכן (עם עמודות הבדיקה ושורות לפריטים חדשים), גיליון "נבדקו" בלבד, ו-JSON לתסקירים.
 */
export default function ExportScreen({ parsed, state, meta, onBack, onFinish }) {
  const [done, setDone] = useState({});
  const [error, setError] = useState('');
  const exportMeta = useMemo(() => ({ clientName: meta.clientName, site: meta.site, date: meta.date }), [meta]);
  const counts = useMemo(() => countState(state), [state]);
  const dateTag = meta.date.replace(/\//g, '.');
  const baseName = (meta.fileName || 'ריכוז.xlsx').replace(/\.xlsx?$/i, '');

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

  const exportSummary = () => run('summary', () => {
    const workbook = buildUpdatedWorkbook(parsed, state, exportMeta);
    downloadBytes(workbookToBytes(workbook), `${baseName} - מעודכן ${dateTag}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  const exportInspected = () => run('inspected', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(buildInspectedRows(state, exportMeta));
    sheet['!views'] = [{ RTL: true }];
    XLSX.utils.book_append_sheet(workbook, sheet, 'נבדקו');
    downloadBytes(workbookToBytes(workbook), `נבדקו - ${meta.site} - ${dateTag}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  const exportJson = () => run('json', () => {
    const json = JSON.stringify(buildReportJson(state, exportMeta), null, 2);
    downloadBytes(new TextEncoder().encode(json), `תסקירים - ${meta.site} - ${dateTag}.json`, 'application/json');
  });

  return (
    <div className="min-h-full bg-gray-900 text-white flex flex-col" dir="rtl">
      <header className="px-5 pt-6 pb-3 flex items-center gap-2">
        <button onClick={onBack} className="p-2 text-gray-300" aria-label="חזרה לבדיקה"><ArrowRight /></button>
        <div>
          <h1 className="text-xl font-bold">ייצוא</h1>
          <div className="text-xs text-gray-400">{meta.clientName} · {meta.site} · {meta.date}</div>
        </div>
      </header>

      <main className="flex-1 px-5 space-y-4">
        <section className="bg-gray-800 rounded-2xl p-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="נבדקו" value={`${counts.inspected}/${counts.total}`} />
          <Stat label="תקינים" value={counts.ok} className="text-emerald-300" />
          <Stat label="פסולים" value={counts.fail} className="text-red-300" />
          <Stat label="לא נמצאו" value={counts.notFound} className="text-amber-300" />
          <Stat label="חדשים" value={counts.new} className="text-sky-300" />
          <Stat label="מעברים" value={state.moved.length} />
        </section>

        {counts.pending > 0 && <div className="text-sm text-amber-300">שים לב: {counts.pending} פריטים מהרשימה עדיין לא נבדקו. הם נשארים בקובץ ללא תוצאה.</div>}

        <ExportButton icon={<FileSpreadsheet />} title="קובץ ריכוז מעודכן" subtitle="כל האתרים, עם עמודות הבדיקה הנוכחית, שורות לפריטים חדשים, גיליון נבדקו וגיליון קטלוג" done={done.summary} onClick={exportSummary} />
        <ExportButton icon={<FileSpreadsheet />} title="נבדקו היום בלבד" subtitle="גיליון אחד עם הפריטים שנבדקו והנתונים לתסקיר" done={done.inspected} onClick={exportInspected} />
        <ExportButton icon={<FileJson />} title="JSON לתסקירים" subtitle="קבוצות סוג × מיקום עם שורות לפי תיאור, כמות, עומס ורשימת מספרים; ליקויים עם מספר הפריט" done={done.json} onClick={exportJson} />

        {error && <div className="text-sm text-red-300">{error}</div>}
        <p className="text-xs text-gray-500">הקבצים נשמרים בתיקיית ההורדות של הטלפון. הקובץ המעודכן נכתב כערכים (ללא נוסחאות ועיצוב של הקובץ המקורי).</p>
      </main>

      <footer className="p-4 flex gap-2">
        <button onClick={onBack} className="flex-1 bg-gray-700 rounded-xl py-3 font-bold">חזרה לבדיקה</button>
        <button onClick={() => { if (window.confirm('לסיים את הסשן ולמחוק אותו מהמכשיר? ודא שייצאת את הקבצים.')) onFinish(); }} className="flex-1 bg-red-700 rounded-xl py-3 font-bold">סיום ומחיקה</button>
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
    <div className="bg-gray-900 rounded-lg py-2">
      <div className={`text-xl font-bold ${className}`}>{value}</div>
      <div className="text-[11px] text-gray-400">{label}</div>
    </div>
  );
}

function countState(state) {
  const counts = { total: state.order.length, pending: 0, ok: 0, fail: 0, notFound: 0, new: 0 };
  for (const id of state.order) {
    const item = state.items[id];
    counts[item.status]++;
    if (item.isNew) counts.new++;
  }
  counts.inspected = counts.ok + counts.fail + counts.notFound;
  return counts;
}
