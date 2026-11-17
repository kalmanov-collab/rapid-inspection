import React, { useMemo, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { updateCatalogEntry, itemsOfType } from '../utils/rapidInspectionEngine';

/**
 * עורך הקטלוג: לכל תיאור - עומס עבודה וכינויים קוליים (מופרדים ב-|).
 * השינויים נשמרים בסשן ונכתבים לגיליון "קטלוג" בייצוא, כך שבפעם הבאה הם נטענים מהקובץ.
 */
export default function CatalogScreen({ state, onChange, onBack }) {
  const [query, setQuery] = useState('');

  const entries = useMemo(() => {
    const withCounts = state.catalog.map((entry) => ({ entry, count: itemsOfType(state, entry.id).length }));
    const filtered = query ? withCounts.filter(({ entry }) => entry.description.includes(query) || entry.type.includes(query) || entry.aliases.some((a) => a.includes(query))) : withCounts;
    return filtered.sort((a, b) => b.count - a.count);
  }, [state, query]);

  const update = (id, patch) => onChange(updateCatalogEntry(state, id, patch).state);

  return (
    <div className="min-h-full bg-gray-900 text-white flex flex-col" dir="rtl">
      <header className="px-4 pt-5 pb-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-2 text-gray-300" aria-label="חזרה"><ArrowRight /></button>
          <div>
            <h1 className="text-lg font-bold">קטלוג סוגים וכינויים קוליים</h1>
            <div className="text-xs text-gray-400">{state.catalog.length} תיאורים · ממוין לפי כמות פריטים</div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2">
          <Search size={16} className="text-gray-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש תיאור / כינוי" className="flex-1 bg-transparent outline-none" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-3 space-y-2">
        <p className="text-xs text-gray-400 px-1">כינוי = מה שנוח לומר בשטח כדי לעבור לסוג (למשל "רצועה ירוקה 4 מטר"). כמה כינויים מופרדים ב-|. העומס נכנס לתסקיר.</p>
        {entries.map(({ entry, count }) => (
          <div key={entry.id} className="bg-gray-800 rounded-xl p-3">
            <div className="flex justify-between items-start gap-2">
              <div>
                <div className="text-xs text-gray-400">{entry.type}</div>
                <div className="font-semibold">{entry.description}</div>
              </div>
              <div className="text-xs text-gray-400 whitespace-nowrap">{count} פריטים</div>
            </div>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <input
                defaultValue={entry.aliases.join(' | ')}
                onBlur={(e) => update(entry.id, { aliases: e.target.value.split('|').map((s) => s.trim()).filter(Boolean) })}
                placeholder="כינויים קוליים | מופרדים בקו"
                className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
              />
              <input
                type="number"
                step="0.05"
                inputMode="decimal"
                defaultValue={entry.swl === '' || entry.swl === undefined ? '' : entry.swl}
                onBlur={(e) => update(entry.id, { swl: e.target.value === '' ? '' : Number(e.target.value) })}
                placeholder="טון"
                className="w-20 bg-gray-900 border border-gray-600 rounded-lg px-2 py-2 text-sm text-center outline-none focus:border-blue-400"
                dir="ltr"
              />
            </div>
          </div>
        ))}
      </main>

      <footer className="p-3 bg-gray-800 border-t border-gray-700">
        <button onClick={onBack} className="w-full bg-emerald-600 rounded-xl py-3 font-bold">חזרה לבדיקה</button>
      </footer>
    </div>
  );
}
