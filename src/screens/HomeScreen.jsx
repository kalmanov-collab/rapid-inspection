import React, { useRef } from 'react';
import { FolderOpen, Play, Download, Trash2, Mic } from 'lucide-react';

/**
 * מסך הבית: פתיחת קובץ ריכוז, או המשך סשן שמור במכשיר.
 */
export default function HomeScreen({ saved, onFile, onResume, onExport, onDiscard, error }) {
  const fileInputRef = useRef(null);
  const counts = saved?.state ? countState(saved.state) : null;

  return (
    <div className="min-h-full bg-gray-900 text-white flex flex-col" dir="rtl">
      <header className="px-5 pt-8 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center"><Mic /></div>
          <div>
            <h1 className="text-2xl font-bold leading-tight">בדיקה מהירה</h1>
            <div className="text-sm text-gray-400">אביזרי הרמה · בדיקה קולית בשטח</div>
          </div>
        </div>
      </header>

      <main className="flex-1 px-5 space-y-4">
        {saved && (
          <section className="bg-gray-800 rounded-2xl p-4 border border-emerald-700">
            <div className="text-xs text-emerald-300 mb-1">סשן שמור במכשיר</div>
            <div className="text-lg font-bold">{saved.meta.clientName ? `${saved.meta.clientName} · ` : ''}{saved.meta.site}</div>
            <div className="text-sm text-gray-400">{saved.meta.fileName} · {saved.meta.date}</div>
            {counts && (
              <div className="mt-2 text-sm text-gray-300">
                נבדקו {counts.inspected} מתוך {counts.total} · פסולים {counts.fail} · חדשים {counts.new} · נותרו {counts.pending}
              </div>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button onClick={onResume} className="bg-emerald-600 rounded-xl py-3 font-bold flex items-center justify-center gap-1"><Play size={18} /> המשך</button>
              <button onClick={onExport} disabled={!saved.state} className="bg-blue-600 disabled:bg-gray-600 rounded-xl py-3 font-bold flex items-center justify-center gap-1"><Download size={18} /> ייצוא</button>
              <button onClick={() => { if (window.confirm('למחוק את הסשן השמור? נתונים שלא יוצאו יאבדו.')) onDiscard(); }} className="bg-gray-700 rounded-xl py-3 font-bold flex items-center justify-center gap-1"><Trash2 size={18} /> מחק</button>
            </div>
          </section>
        )}

        <section className="bg-gray-800 rounded-2xl p-4">
          <div className="font-bold mb-1">{saved ? 'קובץ ריכוז אחר' : 'התחלה'}</div>
          <p className="text-sm text-gray-400 mb-3">פתח את קובץ הריכוז (xlsx) מהטלפון - OneDrive, הורדות או כל מקום אחר. האפליקציה תזהה את האתרים שבקובץ.</p>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = ''; }} />
          <button onClick={() => fileInputRef.current?.click()} className="w-full bg-gray-700 hover:bg-gray-600 rounded-xl py-4 font-bold flex items-center justify-center gap-2"><FolderOpen /> פתח קובץ ריכוז</button>
          {error && <div className="mt-3 text-sm text-red-300">{error}</div>}
        </section>

        <section className="text-xs text-gray-500 leading-relaxed px-1">
          <div>דרוש Chrome באנדרואיד עם הרשאת מיקרופון. זיהוי הדיבור דורש רשת; הנתונים נשמרים במכשיר גם ללא רשת.</div>
          <div>בסיום: "ייצוא" מוריד את קובץ הריכוז המעודכן, גיליון "נבדקו" ו-JSON לתסקירים.</div>
        </section>
      </main>
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
