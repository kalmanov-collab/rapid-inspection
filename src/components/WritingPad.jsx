import React, { useMemo, useRef } from 'react';
import { X, Mic, MicOff, Check, Undo2, Delete, Eraser, Maximize2, Minimize2 } from 'lucide-react';
import { parseWrittenList } from '../utils/writtenList';

/**
 * לוח כתיבה: שדה גדול (חצי מסך או 3/4 מסך) שבו כותבים בעט מספרים מופרדים בפסיק.
 * המרת כתב היד לטקסט נעשית על ידי המכשיר (Samsung "S Pen לטקסט" / כתיבה בעט של Gboard) -
 * האפליקציה מקבלת טקסט רגיל, ולכן הלוח עובד גם במקלדת.
 *
 * הלוח שייך למיקום ולסוג הפעילים: החלפת מיקום / סוג רושמת את מה שנכתב ופותחת לוח ריק (ראו fieldSession).
 *
 * @param {Object} props
 * @param {string} props.text - תוכן הלוח (state.draft)
 * @param {(text: string) => void} props.onText
 * @param {() => void} props.onCommit - רישום המספרים שבלוח
 * @param {() => void} props.onUndo
 * @param {() => void} props.onClose
 * @param {boolean} props.ready - יש מיקום וסוג פעילים
 * @param {'half'|'large'} props.size
 * @param {(size: string) => void} props.onSize
 * @param {Object} props.speech - { isSupported, isListening, start, stop } להמשך פקודות קוליות (מיקום / סוג)
 * @param {number} props.hereCount - כמה פריטים כבר נרשמו במיקום ובסוג האלה
 */
export default function WritingPad({ text, onText, onCommit, onUndo, onClose, ready, size, onSize, speech, hereCount }) {
  const textareaRef = useRef(null);
  const parsed = useMemo(() => parseWrittenList(text), [text]);

  /** הוספה בסוף הטקסט (כפתורי העזר) - בלי להעביר פוקוס, כדי שלא תיפתח מקלדת */
  const append = (suffix) => onText(`${text.replace(/[\s,]+$/, '')}${suffix}`);
  const appendComma = () => { if (text.trim()) append(', '); };
  const appendReject = () => { if (text.trim()) append(' פסול, '); };
  const removeLast = () => {
    const tokens = text.split(/[,،;\n]+/).map((t) => t.trim()).filter(Boolean);
    tokens.pop();
    onText(tokens.length ? `${tokens.join(', ')}, ` : '');
  };

  return (
    <section className="bg-gray-800 border-t-2 border-sky-500 flex flex-col shrink-0" style={{ height: size === 'half' ? '50vh' : '75vh' }} dir="rtl" aria-label="לוח כתיבה">
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-gray-700">
        <div className="font-bold text-sky-300 flex-1">לוח כתיבה <span className="text-xs text-gray-400 font-normal">· נרשמו כאן {hereCount}</span></div>
        <button onClick={speech.isListening ? speech.stop : speech.start} disabled={!speech.isSupported} className={`p-2 rounded-lg ${speech.isListening ? 'bg-red-600' : 'bg-gray-700'} disabled:opacity-40`} aria-label={speech.isListening ? 'עצור האזנה' : 'התחל האזנה'}>
          {speech.isListening ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <button onClick={() => onSize(size === 'half' ? 'large' : 'half')} className="p-2 rounded-lg bg-gray-700" aria-label={size === 'half' ? 'הגדל לוח' : 'הקטן לוח'}>
          {size === 'half' ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
        </button>
        <button onClick={onClose} className="p-2 rounded-lg bg-gray-700" aria-label="סגור לוח כתיבה"><X size={18} /></button>
      </div>

      {/* שדה הכתיבה - dir=rtl: הרשימה נקראת מימין לשמאל, כל מספר נשאר שלם ו"פסול" מופיע מיד אחרי המספר שלו.
          (ב-dir=ltr מספרים שבאים אחרי מילה עברית מתהפכים בתצוגה) */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => onText(e.target.value)}
        disabled={!ready}
        placeholder={ready ? '2345/3, 2346/3 פסול, 2347/3' : 'קבע מיקום וסוג כדי לכתוב'}
        dir="rtl"
        handwriting="true"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        className="flex-1 min-h-0 w-full resize-none bg-gray-900 text-white text-3xl leading-[1.9] font-mono px-4 py-3 outline-none focus:bg-black placeholder:text-gray-600 disabled:opacity-50"
        aria-label="מספרים מופרדים בפסיק"
      />

      {/* מה זוהה בלוח - לפני הרישום */}
      {parsed.items.length > 0 && (
        <div className="px-3 py-1.5 border-t border-gray-700 max-h-24 overflow-y-auto flex flex-wrap gap-1.5" aria-label="זוהו בלוח">
          {parsed.items.map((item, index) => (
            <span
              key={`${index}-${item.raw}`}
              dir="ltr"
              className={`px-2 py-0.5 rounded-md text-sm font-mono border ${!item.valid ? 'bg-amber-200 text-amber-900 border-amber-500' : item.status === 'fail' ? 'bg-red-100 text-red-800 border-red-400' : 'bg-emerald-100 text-emerald-800 border-emerald-400'}`}
              title={item.valid ? '' : 'לא זוהה כמספר'}
            >
              {item.valid ? item.serial : `${item.raw} ?`}{item.valid && item.status === 'fail' ? ' ✗' : ''}
            </span>
          ))}
        </div>
      )}

      <div className="px-3 py-2 border-t border-gray-700 flex gap-2">
        <button onClick={appendComma} disabled={!ready} className="w-11 shrink-0 bg-gray-700 disabled:opacity-40 rounded-lg text-2xl font-bold" aria-label="פסיק">,</button>
        <button onClick={appendReject} disabled={!ready || !text.trim()} className="px-3 bg-red-700 disabled:opacity-40 rounded-lg font-bold">פסול</button>
        <button onClick={removeLast} disabled={!text.trim()} className="px-3 bg-gray-700 disabled:opacity-40 rounded-lg" aria-label="מחק מספר אחרון"><Delete size={20} /></button>
        <button onClick={() => { if (window.confirm('למחוק את כל מה שנכתב בלוח?')) onText(''); }} disabled={!text.trim()} className="px-3 bg-gray-700 disabled:opacity-40 rounded-lg" aria-label="נקה לוח"><Eraser size={20} /></button>
        <button onClick={onUndo} className="px-3 bg-gray-700 rounded-lg" aria-label="בטל פעולה אחרונה"><Undo2 size={20} /></button>
        <button onClick={onCommit} disabled={!ready || parsed.validCount === 0} className="flex-1 min-w-0 whitespace-nowrap bg-emerald-600 disabled:bg-gray-600 rounded-lg py-3 font-bold text-lg flex items-center justify-center gap-1">
          <Check size={20} /> רשום {parsed.validCount || ''}
          {parsed.failCount > 0 && <span className="hidden sm:inline text-sm font-normal">({parsed.failCount} פסולים)</span>}
        </button>
      </div>
      {parsed.invalidCount > 0 && <div className="px-3 pb-2 -mt-1 text-xs text-amber-300">{parsed.invalidCount} לא זוהו כמספר (מסומנים ב-?) - יישארו בלוח לתיקון</div>}
    </section>
  );
}
