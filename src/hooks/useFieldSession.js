import { useCallback, useEffect, useRef, useState } from 'react';
import { applyTranscript, addEntry, setLocation, setType, setEntryStatus, removeEntry, undo } from '../utils/fieldSession';
import { beep, speak, unlockAudio } from '../utils/audioFeedback';
import useSpeechRecognition from './useSpeechRecognition';

/**
 * Hook שמחבר זיהוי דיבור -> מנוע השטח -> משוב קולי.
 * המצב עצמו מוחזק ב-App (כדי שמסך הסיכום ישתמש באותו מצב); ה-hook מקבל אותו ומדווח על כל שינוי.
 *
 * @param {Object} params
 * @param {Object} params.state - מצב הבדיקה (fieldSession)
 * @param {(state: Object) => void} params.onChange - נקרא אחרי כל שינוי (לשמירה ולעדכון App)
 * @param {boolean} [params.speakContext=true] - הקראת שם המיקום/הסוג אחרי מעבר
 */
export default function useFieldSession({ state, onChange, speakContext = true }) {
  const [lastMessage, setLastMessage] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);

  // המצב העדכני לאירועי זיהוי אסינכרוניים
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const processRef = useRef(null);
  const { isSupported, isListening, interimText, error, start, stop, pause, resume } = useSpeechRecognition({
    onResult: (transcript, confidence) => processRef.current?.(transcript, confidence),
  });

  const playFeedback = useCallback(async (feedback) => {
    if (!feedback) return;
    if (feedback.message !== undefined) setLastMessage(feedback.message);
    if (feedback.beep) beep(feedback.beep);
    if (feedback.control === 'pause') stop();
    if (feedback.control === 'resume') start();
    const text = feedback.beep === 'context' && !speakContext ? null : feedback.speak;
    if (text) {
      setIsSpeaking(true);
      pause();
      try {
        await speak(text);
      } finally {
        setIsSpeaking(false);
        resume();
      }
    }
  }, [start, stop, pause, resume, speakContext]);

  const commit = useCallback((result) => {
    if (result.state !== stateRef.current) {
      stateRef.current = result.state;
      onChangeRef.current?.(result.state);
    }
    playFeedback(result.feedback);
  }, [playFeedback]);

  const process = useCallback((transcript, confidence = 1) => {
    if (!transcript) return;
    try {
      commit(applyTranscript(stateRef.current, transcript, confidence));
    } catch (err) {
      console.error('Field session error:', err);
      setLastMessage(`שגיאה: ${err.message}`);
      beep('error');
    }
  }, [commit]);

  useEffect(() => {
    processRef.current = process;
  }, [process]);

  return {
    lastMessage,
    isSpeaking,
    speech: {
      isSupported, isListening, interimText, error,
      start: () => { unlockAudio(); start(); },
      stop,
    },
    process,
    apply: commit,   // החלת תוצאה של פעולת מנוע כלשהי (בחירת סוג, סוג חדש...) עם משוב
    addManual: (serial, status = 'ok') => commit(addEntry(stateRef.current, { serial, status })),
    changeLocation: (name) => commit(setLocation(stateRef.current, name)),
    changeType: (name) => commit(setType(stateRef.current, name)),
    setStatus: (id, status) => commit(setEntryStatus(stateRef.current, id, status)),
    remove: (id) => commit(removeEntry(stateRef.current, id)),
    undo: () => commit(undo(stateRef.current)),
  };
}
