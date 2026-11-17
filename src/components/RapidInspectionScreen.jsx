import React, { useMemo, useState } from 'react';
import { X, Mic, MicOff, Undo2, Check, Ban, HelpCircle, AlertTriangle, Volume2, ListChecks, Tag, MapPin, Plus, Search, Settings } from 'lucide-react';
import useRapidInspection from '../hooks/useRapidInspection';
import { STATUS_LABELS } from '../utils/rapidInspectionEngine';

const STATUS_STYLES = {
  pending: 'bg-gray-100 text-gray-700 border-gray-300',
  ok: 'bg-emerald-100 text-emerald-800 border-emerald-400',
  fail: 'bg-red-100 text-red-800 border-red-400',
  notFound: 'bg-amber-100 text-amber-800 border-amber-400',
};

/**
 * מסך בדיקה מהירה של אביזרי הרמה (גרסה 2) - מסך מלא, מותאם לטלפון, נשלט בקול.
 * הבודק מחזיק סוג אביזר ומיקום פעילים ואומר רק מספרים.
 *
 * @param {Object} props
 * @param {Object} props.session - { clientName, siteName, items, catalog, locations }
 * @param {Object} [props.initialState] - מצב שמור להמשך סשן
 * @param {(item: Object) => void} [props.onItemChange]
 * @param {(state: Object) => void} [props.onStateChange] - לשמירה מקומית אחרי כל שינוי
 * @param {(state: Object) => void} [props.onFinish]
 * @param {Function} props.onClose
 * @param {Function} [props.onOpenCatalog] - פתיחת עורך הקטלוג (כינויים / עומס)
 * @param {Array} [props.defects]
 */
export default function RapidInspectionScreen({ session, initialState, onItemChange, onStateChange, onFinish, onClose, onOpenCatalog, defects }) {
  const rapid = useRapidInspection({ session, initialState, onItemChange, onStateChange, defects });
  const [manualSerial, setManualSerial] = useState('');
  const [listTab, setListTab] = useState('recent');
  const [picker, setPicker] = useState(null); // 'type' | 'location' | null

  const { counts, currentItem, pendingQuestion, speech, lastMessage, isSpeaking, activeType, activeLocation } = rapid;
  const inspectedCount = counts.ok + counts.fail + counts.notFound;
  const progressPercent = counts.total ? Math.round((inspectedCount / counts.total) * 100) : 0;

  const handleManual = (status) => {
    const serial = manualSerial.trim();
    if (serial) {
      // מספר שהוקלד: ספרות בלבד = סיומת בסוג הפעיל; אחרת מספר מלא (קיים או חדש)
      const isSuffix = /^\d{1,5}$/.test(serial);
      const existing = rapid.activeTypeItems.find((item) =>
        isSuffix ? item.serial.replace(/\D/g, '').endsWith(serial) : item.serial.toUpperCase() === serial.toUpperCase(),
      );
      if (existing) rapid.setManualResult(existing.id, status);
      else if (isSuffix) rapid.processTranscript(serial);   // יפתח את שאלת "מספר מלא?"
      else rapid.addManualItem(serial, status);
    } else if (currentItem) {
      rapid.setManualResult(currentItem.id, status);
    }
    setManualSerial('');
  };

  const listItems = useMemo(() => {
    switch (listTab) {
      case 'type': return rapid.activeTypeItems.filter((i) => i.status === 'pending');
      case 'review': return rapid.reviewQueue.map((id) => rapid.state.items[id]);
      case 'moved': return rapid.moved.map((id) => rapid.state.items[id]);
      case 'new': return rapid.orderedItems.filter((i) => i.isNew);
      default: return recentItems(rapid.log, rapid.state.items);
    }
  }, [listTab, rapid.activeTypeItems, rapid.reviewQueue, rapid.moved, rapid.orderedItems, rapid.log, rapid.state.items]);

  return (
    <div className="fixed inset-0 z-[90] bg-gray-900 text-white flex flex-col print:hidden" dir="rtl">
      {/* כותרת ומונים */}
      <header className="px-4 pt-3 pb-2 bg-gray-800 border-b border-gray-700">
        <div className="flex justify-between items-center">
          <div>
            <div className="font-bold text-lg leading-tight">בדיקה מהירה</div>
            <div className="text-xs text-gray-300">{session.clientName}{session.siteName ? ` · ${session.siteName}` : ''}</div>
          </div>
          <div className="flex items-center gap-1">
            {onOpenCatalog && <button onClick={() => onOpenCatalog(rapid.state)} className="p-2 text-gray-300 hover:text-white" aria-label="קטלוג"><Settings size={22} /></button>}
            <button onClick={onClose} className="p-2 text-gray-300 hover:text-white" aria-label="סגור"><X size={24} /></button>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1.5 text-center text-sm">
          <Counter label="נבדקו" value={`${inspectedCount}/${counts.total}`} />
          <Counter label="תקינים" value={counts.ok} className="text-emerald-300" />
          <Counter label="פסולים" value={counts.fail} className="text-red-300" />
          <Counter label="חדשים" value={counts.new} className="text-sky-300" />
          <Counter label="נותרו" value={counts.pending} className="text-amber-300" />
        </div>
        <div className="mt-2 h-1.5 bg-gray-700 rounded overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
      </header>

      {/* הקשר פעיל: סוג + מיקום */}
      <div className="px-3 py-2 bg-gray-800 border-b border-gray-700 grid grid-cols-2 gap-2">
        <ContextChip icon={<Tag size={16} />} label="סוג" value={activeType ? `${activeType.description}${activeType.swl ? ` · ${activeType.swl} טון` : ''}` : null} placeholder="אמור סוג או בחר" onClick={() => setPicker('type')} />
        <ContextChip icon={<MapPin size={16} />} label="מיקום" value={activeLocation} placeholder="אמור מקום או בחר" onClick={() => setPicker('location')} />
      </div>

      <main className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* מצב המיקרופון והטקסט המזוהה */}
        <div className="flex items-center gap-2 text-sm min-h-[1.5rem]">
          {isSpeaking ? <Volume2 size={18} className="text-blue-300 animate-pulse" /> : speech.isListening ? <Mic size={18} className="text-emerald-400 animate-pulse" /> : <MicOff size={18} className="text-gray-500" />}
          <span className="text-gray-300 truncate">
            {speech.error || speech.interimText || lastMessage || (speech.isListening ? 'מקשיב...' : 'לחץ על המיקרופון כדי להתחיל')}
          </span>
        </div>

        {/* שאלה פתוחה */}
        {pendingQuestion && <QuestionBanner question={pendingQuestion} rapid={rapid} />}

        {/* כרטיס הפריט הנוכחי */}
        <div className={`rounded-2xl border-2 p-4 ${currentItem ? STATUS_STYLES[currentItem.status] : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
          {currentItem ? (
            <>
              <div className="flex justify-between items-start gap-2">
                <div className="text-4xl font-black tracking-wider break-all" dir="ltr">{currentItem.serial}</div>
                <div className="text-xl font-bold whitespace-nowrap">{STATUS_LABELS[currentItem.status]}{currentItem.isNew ? ' · חדש' : ''}</div>
              </div>
              <div className="mt-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
                <span>{currentItem.description}</span>
                {currentItem.swl !== '' && <span>{currentItem.swl} טון</span>}
                {currentItem.location && <span className="flex items-center gap-1"><MapPin size={12} />{currentItem.location}</span>}
                {currentItem.prevLocation && currentItem.prevLocation !== currentItem.location && <span className="font-semibold">הועבר מ-{currentItem.prevLocation}</span>}
              </div>
              {currentItem.defects.length > 0 && <div className="mt-2 text-sm font-semibold">{currentItem.status === 'ok' ? 'הערה לליקויים' : 'ליקויים'}: {currentItem.defects.map((d) => d.label).join(', ')}</div>}
              {currentItem.note && <div className="mt-1 text-sm">הערה: {currentItem.note}</div>}
              {currentItem.confidence !== null && currentItem.confidence < 0.75 && (
                <div className="mt-2 text-xs flex items-center gap-1"><AlertTriangle size={14} /> זיהוי בביטחון נמוך - לבדיקה חוזרת</div>
              )}
            </>
          ) : (
            <div className="text-center py-5">{activeType ? 'אמור 4 ספרות אחרונות של הפריט' : 'אמור סוג אביזר כדי להתחיל'}</div>
          )}
        </div>

        {/* קלט ידני */}
        <div className="bg-gray-800 rounded-xl p-3 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={manualSerial}
              onChange={(e) => setManualSerial(e.target.value)}
              placeholder={currentItem ? `מספר (ריק = ${currentItem.serial})` : '4 ספרות או מספר מלא'}
              className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-lg text-center outline-none focus:border-blue-400"
              dir="ltr"
            />
            <button onClick={rapid.undo} className="bg-gray-600 px-3 rounded-lg" aria-label="בטל אחרון"><Undo2 /></button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => handleManual('ok')} disabled={!activeType && !currentItem} className="bg-emerald-600 disabled:bg-gray-600 py-3 rounded-lg font-bold flex justify-center items-center gap-1"><Check size={18} /> תקין</button>
            <button onClick={() => handleManual('fail')} disabled={!activeType && !currentItem} className="bg-red-600 disabled:bg-gray-600 py-3 rounded-lg font-bold flex justify-center items-center gap-1"><Ban size={18} /> פסול</button>
            <button onClick={() => handleManual('notFound')} disabled={!activeType && !currentItem} className="bg-amber-600 disabled:bg-gray-600 py-3 rounded-lg font-bold">לא נמצא</button>
          </div>
        </div>

        {/* רשימות */}
        <div className="bg-gray-800 rounded-xl p-3">
          <div className="flex gap-1.5 text-xs mb-2 flex-wrap">
            <Tab active={listTab === 'recent'} onClick={() => setListTab('recent')}>אחרונים</Tab>
            <Tab active={listTab === 'type'} onClick={() => setListTab('type')}>ממתינים בסוג ({rapid.activeTypeItems.filter((i) => i.status === 'pending').length})</Tab>
            <Tab active={listTab === 'new'} onClick={() => setListTab('new')}>חדשים ({counts.new})</Tab>
            <Tab active={listTab === 'moved'} onClick={() => setListTab('moved')}>מעברים ({counts.moved})</Tab>
            <Tab active={listTab === 'review'} onClick={() => setListTab('review')}>לבדיקה חוזרת ({rapid.reviewQueue.length})</Tab>
          </div>
          <ul className="divide-y divide-gray-700 max-h-64 overflow-y-auto">
            {listItems.length === 0 && <li className="text-gray-500 text-sm py-2 text-center">אין פריטים</li>}
            {listItems.map((item) => (
              <li key={item.id} className="flex justify-between items-center py-1.5 text-sm gap-2">
                <span className="font-mono text-base whitespace-nowrap" dir="ltr">{item.serial}</span>
                <span className="text-gray-400 flex-1 truncate">
                  {listTab === 'moved' ? `${item.prevLocation} ← ${item.location}` : item.location}
                  {item.defects.length ? ' · ' + item.defects.map((d) => d.label).join(', ') : ''}
                </span>
                <span className={`px-2 py-0.5 rounded border text-xs whitespace-nowrap ${STATUS_STYLES[item.status]}`}>{STATUS_LABELS[item.status]}{item.isNew ? ' · חדש' : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      </main>

      <footer className="p-3 bg-gray-800 border-t border-gray-700 flex gap-2">
        <button
          onClick={speech.isListening ? speech.stop : speech.start}
          disabled={!speech.isSupported}
          className={`flex-1 py-4 rounded-xl font-bold text-lg flex justify-center items-center gap-2 ${speech.isListening ? 'bg-red-600' : 'bg-emerald-600'} disabled:bg-gray-600`}
        >
          {speech.isListening ? <><MicOff /> עצור האזנה</> : <><Mic /> התחל האזנה</>}
        </button>
        {onFinish && (
          <button onClick={() => onFinish(rapid.state)} className="px-4 rounded-xl bg-blue-600 font-bold flex items-center gap-1"><ListChecks size={18} /> סיום</button>
        )}
      </footer>

      {picker === 'type' && (
        <PickerSheet
          title="בחר סוג אביזר"
          options={rapid.catalog.map((e) => ({ id: e.id, label: `${e.description}${e.swl ? ` · ${e.swl} טון` : ''}`, hint: e.aliases?.[0] }))}
          onPick={(id) => { rapid.chooseType(id); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'location' && (
        <PickerSheet
          title="בחר מיקום / קבוצה"
          options={rapid.locations.map((name) => ({ id: name, label: name }))}
          allowNew
          onPick={(name) => { rapid.chooseLocation(name); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** שאלה פתוחה עם כפתורי תשובה לפי סוג השאלה */
function QuestionBanner({ question, rapid }) {
  const items = rapid.state.items;
  let text;
  let buttons;

  switch (question.type) {
    case 'disambiguate':
      text = `יש ${question.candidates.length} פריטים שמסתיימים ב-${question.digits} - אמור את הספרה שלפני, או בחר:`;
      buttons = question.candidates.map((id) => (
        <button key={id} onClick={() => rapid.processTranscript(items[id].serial)} className="bg-blue-600 px-3 py-2 rounded-lg font-mono" dir="ltr">{items[id].serial}</button>
      ));
      break;
    case 'crossType':
      text = `${items[question.id].serial} קיים כ"${items[question.id].description}" - להעביר לסוג הפעיל?`;
      buttons = <><YesNo rapid={rapid} /><span className="text-xs text-gray-300">"לא" = פריט חדש</span></>;
      break;
    case 'needFullSerial':
      text = `${question.parsed.digits || ''} לא ברשימה - אמור או הקלד את המספר המלא:`;
      buttons = <FullSerialInput onSubmit={(serial) => rapid.processTranscript(`חדש ${serial}`)} onCancel={rapid.answerNo} />;
      break;
    case 'chooseType':
      text = 'איזה סוג?';
      buttons = question.candidates.map((e) => (
        <button key={e.id} onClick={() => rapid.chooseType(e.id)} className="bg-blue-600 px-3 py-2 rounded-lg text-sm">{e.description}{e.swl ? ` · ${e.swl} טון` : ''}</button>
      ));
      break;
    case 'chooseLocation':
      text = 'איזה מיקום?';
      buttons = question.candidates.map((name) => (
        <button key={name} onClick={() => rapid.chooseLocation(name)} className="bg-blue-600 px-3 py-2 rounded-lg text-sm">{name}</button>
      ));
      break;
    case 'newLocation':
      text = `מיקום חדש "${question.name}"?`;
      buttons = <YesNo rapid={rapid} />;
      break;
    default:
      return null;
  }

  return (
    <div className="bg-blue-900/60 border border-blue-400 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm"><HelpCircle className="text-blue-300 shrink-0" size={18} />{text}</div>
      <div className="flex flex-wrap gap-2 items-center">{buttons}</div>
    </div>
  );
}

function YesNo({ rapid }) {
  return (
    <>
      <button onClick={rapid.answerYes} className="bg-emerald-600 px-4 py-2 rounded-lg font-bold">כן</button>
      <button onClick={rapid.answerNo} className="bg-gray-600 px-4 py-2 rounded-lg font-bold">לא</button>
    </>
  );
}

function FullSerialInput({ onSubmit, onCancel }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="flex gap-2 w-full"
      onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}
    >
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="K500158 / 07-2/1045" className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white outline-none focus:border-blue-400" dir="ltr" autoFocus />
      <button type="submit" className="bg-sky-600 px-3 rounded-lg font-bold flex items-center gap-1"><Plus size={16} /> חדש</button>
      <button type="button" onClick={onCancel} className="bg-gray-600 px-3 rounded-lg">בטל</button>
    </form>
  );
}

/** צ'יפ הקשר (סוג / מיקום) בראש המסך */
function ContextChip({ icon, label, value, placeholder, onClick }) {
  return (
    <button onClick={onClick} className={`text-right rounded-xl px-3 py-2 border ${value ? 'bg-gray-700 border-gray-500' : 'bg-gray-800 border-dashed border-gray-600'}`}>
      <div className="text-[11px] text-gray-400 flex items-center gap-1">{icon}{label}</div>
      <div className={`text-sm font-semibold truncate ${value ? 'text-white' : 'text-gray-500'}`}>{value || placeholder}</div>
    </button>
  );
}

/** גיליון בחירה עם חיפוש (סוגים / מיקומים) */
function PickerSheet({ title, options, onPick, onClose, allowNew = false }) {
  const [query, setQuery] = useState('');
  const filtered = options.filter((o) => !query || o.label.includes(query) || o.hint?.includes(query));
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-end" onClick={onClose}>
      <div className="bg-gray-800 w-full max-h-[80vh] rounded-t-2xl p-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-2">
          <div className="font-bold">{title}</div>
          <button onClick={onClose} aria-label="סגור"><X /></button>
        </div>
        <div className="flex items-center gap-2 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 mb-2">
          <Search size={16} className="text-gray-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש" className="flex-1 bg-transparent outline-none" autoFocus />
        </div>
        <ul className="overflow-y-auto divide-y divide-gray-700">
          {allowNew && query.trim() && !options.some((o) => o.label === query.trim()) && (
            <li><button onClick={() => onPick(query.trim())} className="w-full text-right py-3 text-sky-300 flex items-center gap-2"><Plus size={16} /> הוסף "{query.trim()}"</button></li>
          )}
          {filtered.map((o) => (
            <li key={o.id}>
              <button onClick={() => onPick(o.id)} className="w-full text-right py-3">
                <div>{o.label}</div>
                {o.hint && <div className="text-xs text-gray-400">{o.hint}</div>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && !allowNew && <li className="text-gray-500 text-sm py-3 text-center">לא נמצא</li>}
        </ul>
      </div>
    </div>
  );
}

/** הפריטים האחרונים שנבדקו, ללא כפילויות */
function recentItems(log, items, limit = 8) {
  const seen = new Set();
  const result = [];
  for (const entry of log) {
    if (entry.kind !== 'inspection' || seen.has(entry.id) || !items[entry.id]) continue;
    seen.add(entry.id);
    result.push(items[entry.id]);
    if (result.length >= limit) break;
  }
  return result;
}

function Counter({ label, value, className = '' }) {
  return (
    <div className="bg-gray-900 rounded-lg py-1">
      <div className={`text-lg font-bold ${className}`}>{value}</div>
      <div className="text-[11px] text-gray-400">{label}</div>
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-1 rounded-full ${active ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}>{children}</button>
  );
}
