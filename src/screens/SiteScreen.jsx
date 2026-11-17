import React, { useMemo, useState } from 'react';
import { ArrowRight, MapPin } from 'lucide-react';

/**
 * בחירת אתר מתוך קובץ הריכוז ושם הלקוח לתסקיר.
 */
export default function SiteScreen({ parsed, meta, onStart, onBack, error }) {
  const [clientName, setClientName] = useState('חברת החשמל');
  const [site, setSite] = useState(parsed.sites[0] || '');

  const siteStats = useMemo(() => {
    const stats = {};
    const { columns, rows } = parsed;
    for (const row of rows) {
      const name = columns.site ? String(row[columns.site]).trim() : '(כל הקובץ)';
      stats[name] = stats[name] || { items: 0, locations: new Set() };
      stats[name].items++;
      if (columns.location && row[columns.location]) stats[name].locations.add(String(row[columns.location]).trim());
    }
    return stats;
  }, [parsed]);

  const sites = parsed.sites.length ? parsed.sites : Object.keys(siteStats);

  return (
    <div className="min-h-full bg-gray-900 text-white flex flex-col" dir="rtl">
      <header className="px-5 pt-6 pb-3 flex items-center gap-2">
        <button onClick={onBack} className="p-2 text-gray-300" aria-label="חזרה"><ArrowRight /></button>
        <div>
          <h1 className="text-xl font-bold">בחירת אתר</h1>
          <div className="text-xs text-gray-400">{meta?.fileName} · {parsed.rows.length.toLocaleString()} פריטים</div>
        </div>
      </header>

      <main className="flex-1 px-5 space-y-4">
        <label className="block">
          <span className="text-sm text-gray-400">שם הלקוח (לתסקיר)</span>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2 outline-none focus:border-blue-400" />
        </label>

        <div className="space-y-2">
          {sites.map((name) => {
            const stats = siteStats[name] || { items: 0, locations: new Set() };
            const active = site === name;
            return (
              <button key={name} onClick={() => setSite(name)} className={`w-full text-right rounded-xl px-4 py-3 border ${active ? 'bg-emerald-900/50 border-emerald-500' : 'bg-gray-800 border-gray-700'}`}>
                <div className="font-bold">{name}</div>
                <div className="text-xs text-gray-400 flex items-center gap-1"><MapPin size={12} /> {stats.items.toLocaleString()} פריטים · {stats.locations.size} מיקומים</div>
              </button>
            );
          })}
        </div>

        {error && <div className="text-sm text-red-300">{error}</div>}
      </main>

      <footer className="p-4">
        <button onClick={() => onStart(site, clientName.trim())} disabled={!site} className="w-full bg-emerald-600 disabled:bg-gray-600 rounded-xl py-4 font-bold text-lg">התחל בדיקה ב{site}</button>
      </footer>
    </div>
  );
}
