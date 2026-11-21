import React, { useMemo, useState } from 'react';
import { X, Mic, MicOff, Undo2, Check, Ban, Volume2, ListChecks, Tag, MapPin, Plus, Search, Trash2, HelpCircle, PenLine } from 'lucide-react';
import useFieldSession from '../hooks/useFieldSession';
import { getCounts, currentEntries, activeTypeInfo, chooseType, confirmNewType, cancelPending, setDraft, commitDraft, STATUS_LABELS } from '../utils/fieldSession';
import WritingPad from './WritingPad';

/**
 * מסך הבדיקה בשטח: מיקום וסוג פעילים, ורצף מספרים שנרשמים מיד (בלי חיפוש בקובץ).
 * המספרים נקלטים בקול, בהקלדה, או בכתיבה בעט בלוח הכתיבה (חצי מסך / 3/4 מסך).
 *
 * @param {Object} props
 * @param {Object} props.state - מצב הבדיקה
 * @param {(state: Object) => void} props.onChange
 * @param {Function} props.onReview - מעבר למסך הסיכום
 * @param {Function} props.onClose
 */
export default function FieldInspectionScreen({ state, onChange, onReview, onClose }) {
  const field = useFieldSession({ state, onChange });
  const [manualSerial, setManualSerial] = useState('');
  const [picker, setPicker] = useState(null); // 'location' | 'type'
  const [pad, setPad] = useState(loadPadPreference); // { open, size: 'half' | 'large' }

  const counts = useMemo(() => getCounts(state), [state]);
  const entries = useMemo(() => currentEntries(state), [state]);
  const typeInfo = activeTypeInfo(state);
  const last = state.entries.find((e) => e.id === state.lastId) || null;
  const { speech } = field;
  const ready = Boolean(state.location && state.type && !state.pending);

  const apply = field.apply;

  const updatePad = (patch) => {
    const next = { ...pad, ...patch };
    setPad(next);
    savePadPreference(next);
  };
  const draft = state.draft || '';
  // שאלת סוג פתוחה מוצגת במקום הלוח; אחרי התשובה הלוח חוזר (ריק - לסוג החדש)
  const showPad = pad.open && !state.pending && !picker;

  const submitManual = (status) => {
    const serial = manualSerial.trim();
    if (!serial) return;
    field.addManual(serial, status);
    setManualSerial('');
  };

  return (
    <div className="fixed inset-0 bg-gray-900 text-white flex flex-col" dir="rtl">
      <header className="px-4 pt-3 pb-2 bg-gray-800 border-b border-gray-700">
        <div className="flex justify-between items-center">
          <div>
            <div className="font-bold text-lg leading-tight">בדיקה בשטח</div>
            <div className="text-xs text-gray-300">{state.clientName ? `${state.clientName} · ` : ''}{state.site}</div>
          </div>
          <div className="flex items-center gap-3 text-center">
            <Counter label="נרשמו" value={counts.total} />
            <Counter label="פסולים" value={counts.fail} className="text-red-300" />
            <Counter label="כאן" value={counts.here} className="text-emerald-300" />
            <button onClick={onClose} className="p-2 text-gray-300" aria-label="סגור"><X size={24} /></button>
          </div>
        </div>
      </header>

      {/* מיקום וסוג פעילים */}
      <div className="px-3 py-2 bg-gray-800 border-b border-gray-700 space-y-2">
        <ContextChip icon={<MapPin size={16} />} label="מיקום" value={state.location} placeholder='אמור "מיקום" ואת השם, או בחר' onClick={() => setPicker('location')} />
        <ContextChip
          icon={<Tag size={16} />}
          label="סוג"
          value={typeInfo ? `${typeInfo.description}${typeInfo.swl !== '' ? ` · ${typeInfo.swl} טון` : ''}` : null}
          hint={typeInfo && typeInfo.name !== typeInfo.description ? `נאמר: ${typeInfo.name}${typeInfo.isNew ? ' · סוג חדש' : ''}` : typeInfo?.isNew ? 'סוג חדש' : ''}
          placeholder='אמור "סוג" ואת השם, או בחר'
          onClick={() => setPicker('type')}
        />
      </div>

      {showPad && (
        <>
          <div className="flex-1 min-h-0 overflow-hidden px-3 py-1 flex items-center gap-2 text-sm">
            {field.isSpeaking ? <Volume2 size={18} className="text-blue-300 animate-pulse shrink-0" /> : speech.isListening ? <Mic size={18} className="text-emerald-400 animate-pulse shrink-0" /> : <MicOff size={18} className="text-gray-500 shrink-0" />}
            <span className="text-gray-300 truncate">{speech.error || speech.interimText || field.lastMessage || 'כתוב מספרים מופרדים בפסיק; "פסול" אחרי מספר פוסל אותו'}</span>
          </div>
          <WritingPad
            text={draft}
            onText={(text) => onChange(setDraft(state, text))}
            onCommit={() => apply(commitDraft(state))}
            onUndo={field.undo}
            onClose={() => updatePad({ open: false })}
            ready={ready}
            size={pad.size}
            onSize={(size) => updatePad({ size })}
            speech={speech}
            hereCount={counts.here}
          />
        </>
      )}

      {!showPad && <main className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="flex items-center gap-2 text-sm min-h-[1.5rem]">
          {field.isSpeaking ? <Volume2 size={18} className="text-blue-300 animate-pulse" /> : speech.isListening ? <Mic size={18} className="text-emerald-400 animate-pulse" /> : <MicOff size={18} className="text-gray-500" />}
          <span className="text-gray-300 truncate">{speech.error || speech.interimText || field.lastMessage || (speech.isListening ? 'מקשיב...' : 'לחץ על המיקרופון כדי להתחיל')}</span>
        </div>

        {/* שאלת סוג פתוחה */}
        {state.pending?.kind === 'chooseType' && (
          <div className="bg-blue-900/60 border border-blue-400 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm"><HelpCircle size={18} className="text-blue-300 shrink-0" />"{state.pending.spoken}" - לאיזה סוג הכוונה? (אפשר לומר את המספר)</div>
            {state.pending.candidates.map((candidate, index) => (
              <button key={candidate.key} onClick={() => apply(chooseType(state, candidate.key))} className="w-full text-right bg-blue-700 hover:bg-blue-600 rounded-lg px-3 py-2 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-blue-900 text-sm flex items-center justify-center shrink-0">{index + 1}</span>
                <span className="flex-1">{candidate.description}</span>
                <span className="text-xs text-blue-200 whitespace-nowrap">{candidate.siteCount || candidate.count} פריטים</span>
              </button>
            ))}
            <div className="flex gap-2">
              <button onClick={() => onChange({ ...state, pending: { kind: 'newType', spoken: state.pending.spoken } })} className="flex-1 bg-gray-700 rounded-lg py-2 text-sm flex items-center justify-center gap-1"><Plus size={14} /> סוג חדש</button>
              <button onClick={() => apply(cancelPending(state))} className="flex-1 bg-gray-700 rounded-lg py-2 text-sm">בטל</button>
            </div>
          </div>
        )}
        {state.pending?.kind === 'newType' && (
          <NewTypeForm
            spoken={state.pending.spoken}
            onConfirm={(description, swl) => apply(confirmNewType(state, description, swl))}
            onPickExisting={() => setPicker('type')}
            onCancel={() => apply(cancelPending(state))}
          />
        )}

        {/* הפריט האחרון */}
        <div className={`rounded-2xl border-2 p-4 ${last ? (last.status === 'fail' ? 'bg-red-100 text-red-900 border-red-400' : 'bg-emerald-100 text-emerald-900 border-emerald-400') : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
          {last ? (
            <>
              <div className="flex justify-between items-start gap-2">
                <div className="text-4xl font-black tracking-wider break-all" dir="ltr">{last.serial}</div>
                <div className="text-xl font-bold whitespace-nowrap">{STATUS_LABELS[last.status]}</div>
              </div>
              {(last.defects.length > 0 || last.note) && <div className="mt-1 text-sm font-semibold">{[...last.defects.map((d) => d.label), last.note].filter(Boolean).join(', ')}</div>}
              <div className="mt-2 flex gap-2">
                <button onClick={() => field.setStatus(last.id, last.status === 'fail' ? 'ok' : 'fail')} className="flex-1 bg-white/70 rounded-lg py-2 text-sm font-bold">{last.status === 'fail' ? 'סמן תקין' : 'סמן פסול'}</button>
                <button onClick={field.undo} className="flex-1 bg-white/70 rounded-lg py-2 text-sm font-bold flex items-center justify-center gap-1"><Undo2 size={16} /> בטל</button>
              </div>
            </>
          ) : (
            <div className="text-center py-4">{ready ? 'אמור מספר פריט' : 'קבע מיקום וסוג כדי להתחיל'}</div>
          )}
        </div>

        {/* קלט ידני */}
        <form className="bg-gray-800 rounded-xl p-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); submitManual('ok'); }}>
          <input value={manualSerial} onChange={(e) => setManualSerial(e.target.value)} placeholder="מספר (הקלדה)" disabled={!ready} className="flex-1 min-w-0 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-lg text-center outline-none focus:border-blue-400 disabled:opacity-50" dir="ltr" />
          <button type="submit" disabled={!ready || !manualSerial.trim()} className="bg-emerald-600 disabled:bg-gray-600 px-4 rounded-lg font-bold flex items-center gap-1"><Check size={18} /> תקין</button>
          <button type="button" onClick={() => submitManual('fail')} disabled={!ready || !manualSerial.trim()} className="bg-red-600 disabled:bg-gray-600 px-4 rounded-lg font-bold flex items-center gap-1"><Ban size={18} /> פסול</button>
        </form>

        {/* הפריטים של המיקום והסוג הפעילים */}
        <div className="bg-gray-800 rounded-xl p-3">
          <div className="text-xs text-gray-400 mb-1">נרשמו כאן ({entries.length})</div>
          <ul className="divide-y divide-gray-700">
            {entries.length === 0 && <li className="text-gray-500 text-sm py-2 text-center">עדיין אין פריטים במיקום ובסוג האלה</li>}
            {entries.slice(0, 60).map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="font-mono text-base flex-1" dir="ltr">{entry.serial}</span>
                <span className="text-gray-400 truncate">{[...entry.defects.map((d) => d.label), entry.note].filter(Boolean).join(', ')}</span>
                <button onClick={() => field.setStatus(entry.id, entry.status === 'fail' ? 'ok' : 'fail')} className={`px-2 py-0.5 rounded border text-xs ${entry.status === 'fail' ? 'bg-red-100 text-red-800 border-red-400' : 'bg-emerald-100 text-emerald-800 border-emerald-400'}`}>{STATUS_LABELS[entry.status]}</button>
                <button onClick={() => field.remove(entry.id)} className="p-1 text-gray-400" aria-label="מחק"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        </div>
      </main>}

      {!showPad && <footer className="p-3 bg-gray-800 border-t border-gray-700 flex gap-2">
        <button onClick={speech.isListening ? speech.stop : speech.start} disabled={!speech.isSupported} className={`flex-1 py-4 rounded-xl font-bold text-lg flex justify-center items-center gap-2 ${speech.isListening ? 'bg-red-600' : 'bg-emerald-600'} disabled:bg-gray-600`}>
          {speech.isListening ? <><MicOff /> עצור האזנה</> : <><Mic /> התחל האזנה</>}
        </button>
        <button onClick={() => updatePad({ open: true })} className="relative px-4 rounded-xl bg-sky-700 font-bold flex items-center gap-1" aria-label="לוח כתיבה">
          <PenLine size={18} /> כתיבה
          {draft.trim() && <span className="absolute -top-1 -left-1 w-3 h-3 rounded-full bg-amber-400" title="יש בלוח מספרים שטרם נרשמו" />}
        </button>
        <button onClick={onReview} className="px-4 rounded-xl bg-blue-600 font-bold flex items-center gap-1"><ListChecks size={18} /> סיכום</button>
      </footer>}

      {picker === 'location' && (
        <PickerSheet
          title="מיקום"
          options={state.locations.map((l) => ({ id: l.name, label: l.name, hint: l.known ? '' : 'חדש' }))}
          addLabel="מיקום חדש"
          onPick={(name) => { field.changeLocation(name); setPicker(null); }}
          onAdd={(name) => { field.changeLocation(name); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'type' && (
        <PickerSheet
          title="סוג (תבניות קיימות בקובץ)"
          options={state.catalog.map((c) => ({ id: c.key, label: c.description, hint: `${c.siteCount ? `${c.siteCount} באתר` : `${c.count} באתרים אחרים`}${c.swl !== '' ? ` · ${c.swl} טון` : ''}` }))}
          addLabel="סוג חדש"
          onPick={(key) => { apply(chooseType(state, key)); setPicker(null); }}
          onAdd={(name) => { onChange({ ...state, pending: { kind: 'newType', spoken: state.pending?.spoken || name } }); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

const PAD_PREFERENCE_KEY = 'rapid3.pad';

/** העדפת הלוח (פתוח / גודל) נשמרת במכשיר; כשאין גישה לאחסון - ברירת מחדל */
function loadPadPreference() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PAD_PREFERENCE_KEY) || 'null');
    return { open: Boolean(saved?.open), size: saved?.size === 'half' ? 'half' : 'large' };
  } catch {
    return { open: false, size: 'large' };
  }
}

function savePadPreference(preference) {
  try {
    window.localStorage.setItem(PAD_PREFERENCE_KEY, JSON.stringify(preference));
  } catch {
    // אחסון חסום (גלישה פרטית) - ההעדפה תישמר רק עד סגירת המסך
  }
}

/** טופס סוג חדש: הבודק כותב בדיוק איך הסוג יופיע בתסקיר */
function NewTypeForm({ spoken, onConfirm, onPickExisting, onCancel }) {
  const [description, setDescription] = useState(spoken);
  const [swl, setSwl] = useState('');
  return (
    <form className="bg-amber-900/50 border border-amber-400 rounded-xl p-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (description.trim()) onConfirm(description.trim(), swl); }}>
      <div className="flex items-center gap-2 text-sm"><HelpCircle size={18} className="text-amber-300 shrink-0" />"{spoken}" לא מתאים לאף סוג קיים. להוסיף סוג חדש?</div>
      <label className="block text-xs text-amber-100">כתוב בדיוק כפי שיופיע בתסקיר
        <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-base text-white outline-none focus:border-amber-300" autoFocus />
      </label>
      <label className="block text-xs text-amber-100">עומס עבודה בטוח (טון) - לא חובה
        <input value={swl} onChange={(e) => setSwl(e.target.value)} type="number" step="0.05" inputMode="decimal" className="mt-1 w-28 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-base text-white outline-none focus:border-amber-300" dir="ltr" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={!description.trim()} className="flex-1 bg-amber-600 disabled:bg-gray-600 rounded-lg py-2 font-bold flex items-center justify-center gap-1"><Plus size={16} /> הוסף סוג חדש</button>
        <button type="button" onClick={onPickExisting} className="bg-gray-700 rounded-lg px-3 py-2 text-sm">חפש קיים</button>
        <button type="button" onClick={onCancel} className="bg-gray-700 rounded-lg px-3 py-2 text-sm">בטל</button>
      </div>
    </form>
  );
}

function ContextChip({ icon, label, value, hint, placeholder, onClick }) {
  return (
    <button onClick={onClick} className={`w-full text-right rounded-xl px-3 py-2 border ${value ? 'bg-gray-700 border-gray-500' : 'bg-gray-800 border-dashed border-amber-500'}`}>
      <div className="text-[11px] text-gray-400 flex items-center gap-1">{icon}{label}{hint ? <span className="text-gray-500"> · {hint}</span> : null}</div>
      <div className={`font-semibold ${value ? 'text-white' : 'text-amber-300 text-sm'}`}>{value || placeholder}</div>
    </button>
  );
}

/** גיליון בחירה עם חיפוש; מציג עד 80 תוצאות כדי להישאר מהיר גם עם מאות תבניות */
function PickerSheet({ title, options, onPick, onAdd, addLabel, onClose }) {
  const [query, setQuery] = useState('');
  const words = query.trim().split(/\s+/).filter(Boolean);
  const filtered = words.length ? options.filter((o) => words.every((w) => o.label.includes(w))) : options;
  return (
    <div className="fixed inset-0 z-10 bg-black/60 flex items-end" onClick={onClose}>
      <div className="bg-gray-800 w-full max-h-[85vh] rounded-t-2xl p-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-2">
          <div className="font-bold">{title}</div>
          <button onClick={onClose} aria-label="סגור"><X /></button>
        </div>
        <div className="flex items-center gap-2 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 mb-2">
          <Search size={16} className="text-gray-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש" className="flex-1 bg-transparent outline-none" />
        </div>
        <ul className="overflow-y-auto divide-y divide-gray-700">
          {query.trim() && !options.some((o) => o.label === query.trim()) && (
            <li><button onClick={() => onAdd(query.trim())} className="w-full text-right py-3 text-sky-300 flex items-center gap-2"><Plus size={16} /> {addLabel}: "{query.trim()}"</button></li>
          )}
          {filtered.slice(0, 80).map((o) => (
            <li key={o.id}>
              <button onClick={() => onPick(o.id)} className="w-full text-right py-2.5">
                <div>{o.label}</div>
                {o.hint && <div className="text-xs text-gray-400">{o.hint}</div>}
              </button>
            </li>
          ))}
          {filtered.length > 80 && <li className="text-gray-500 text-xs py-2 text-center">ועוד {filtered.length - 80} - צמצם בחיפוש</li>}
          {filtered.length === 0 && <li className="text-gray-500 text-sm py-3 text-center">לא נמצא</li>}
        </ul>
      </div>
    </div>
  );
}

function Counter({ label, value, className = '' }) {
  return (
    <div>
      <div className={`text-lg font-bold leading-none ${className}`}>{value}</div>
      <div className="text-[10px] text-gray-400">{label}</div>
    </div>
  );
}
