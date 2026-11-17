import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook לזיהוי דיבור רציף באמצעות Web Speech API (כרום / אנדרואיד).
 *
 * מטפל במגבלות הידועות של המנוע:
 *  - כרום מפסיק האזנה רציפה מעצמו אחרי זמן מה -> הפעלה מחדש אוטומטית.
 *  - שגיאת no-speech / network זמנית -> הפעלה מחדש עם השהיה קצרה.
 *  - not-allowed (אין הרשאת מיקרופון) -> עצירה סופית ודיווח שגיאה.
 *  - pause()/resume() כדי להשתיק את המיקרופון בזמן שהאפליקציה מדברת (TTS),
 *    אחרת המנוע מזהה את הקול של עצמו.
 *
 * @param {Object} options
 * @param {(transcript: string, confidence: number) => void} options.onResult - נקרא לכל תוצאה סופית
 * @param {string} [options.lang='he-IL']
 */
export default function useSpeechRecognition({ onResult, lang = 'he-IL' }) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);   // כוונת המשתמש (לא מצב המנוע בפועל)
  const pausedRef = useRef(false);         // השתקה זמנית בזמן TTS
  const restartTimerRef = useRef(null);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const SpeechRecognitionImpl =
    typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  const isSupported = Boolean(SpeechRecognitionImpl);

  /** הפעלת המנוע בפועל (בטוח לקריאה חוזרת) */
  const startEngine = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || pausedRef.current || !shouldListenRef.current) return;
    try {
      recognition.start();
    } catch {
      // המנוע כבר פועל - זה תקין
    }
  }, []);

  /** הפעלה מחדש עם השהיה, כדי לא להיכנס ללולאה צפופה במקרה של שגיאות רצופות */
  const scheduleRestart = useCallback((delayMs) => {
    clearTimeout(restartTimerRef.current);
    restartTimerRef.current = setTimeout(startEngine, delayMs);
  }, [startEngine]);

  // יצירת מופע המנוע פעם אחת
  useEffect(() => {
    if (!SpeechRecognitionImpl) return undefined;

    const recognition = new SpeechRecognitionImpl();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          setInterimText('');
          onResultRef.current?.(transcript.trim(), result[0].confidence ?? 1);
        } else {
          interim += transcript;
        }
      }
      if (interim) setInterimText(interim);
    };

    recognition.onerror = (event) => {
      switch (event.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          shouldListenRef.current = false;
          setError('אין הרשאה למיקרופון. יש לאשר גישה למיקרופון בדפדפן.');
          break;
        case 'no-speech':
        case 'aborted':
          // שקט ממושך - המנוע יסגור את עצמו ו-onend יפעיל מחדש
          break;
        case 'network':
          setError('אין חיבור לשירות הזיהוי. בודק שוב...');
          scheduleRestart(2000);
          break;
        default:
          setError(`שגיאת זיהוי דיבור: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText('');
      if (shouldListenRef.current && !pausedRef.current) scheduleRestart(250);
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;
      clearTimeout(restartTimerRef.current);
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // המנוע כבר עצור
      }
      recognitionRef.current = null;
    };
  }, [SpeechRecognitionImpl, lang, scheduleRestart]);

  const start = useCallback(() => {
    if (!isSupported) {
      setError('הדפדפן אינו תומך בזיהוי דיבור. מומלץ Chrome באנדרואיד.');
      return;
    }
    shouldListenRef.current = true;
    pausedRef.current = false;
    startEngine();
  }, [isSupported, startEngine]);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    clearTimeout(restartTimerRef.current);
    try {
      recognitionRef.current?.stop();
    } catch {
      // המנוע כבר עצור
    }
  }, []);

  /** השתקה זמנית (למשל בזמן הקראה קולית) */
  const pause = useCallback(() => {
    pausedRef.current = true;
    clearTimeout(restartTimerRef.current);
    try {
      recognitionRef.current?.abort();
    } catch {
      // המנוע כבר עצור
    }
  }, []);

  /** חזרה מהשתקה */
  const resume = useCallback(() => {
    pausedRef.current = false;
    if (shouldListenRef.current) scheduleRestart(150);
  }, [scheduleRestart]);

  return { isSupported, isListening, interimText, error, start, stop, pause, resume };
}
