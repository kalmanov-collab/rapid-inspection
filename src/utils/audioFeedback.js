/**
 * משוב קולי למצב בדיקה מהירה: צפצופים קצרים והקראה בעברית.
 * הצפצופים מופקים ב-Web Audio (ללא קבצי שמע), ההקראה ב-speechSynthesis.
 */

let audioContext = null;

/** יצירת AudioContext בעצלות - חובה לקרוא לראשונה מתוך אירוע משתמש (לחיצה) */
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) return null;
  if (!audioContext) audioContext = new AudioContextImpl();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

/** הפעלת האודיו מתוך לחיצת משתמש (נדרש בדפדפנים ניידים) */
export function unlockAudio() {
  getAudioContext();
}

function playTone(frequency, durationMs, startDelayMs = 0, type = 'sine') {
  const context = getAudioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.25;
  oscillator.connect(gain);
  gain.connect(context.destination);
  const startAt = context.currentTime + startDelayMs / 1000;
  oscillator.start(startAt);
  oscillator.stop(startAt + durationMs / 1000);
}

/**
 * צפצוף לפי סוג אירוע. כל סוג נשמע שונה כדי שאפשר לעבוד בלי להסתכל על המסך.
 * @param {'ok'|'fail'|'notFound'|'new'|'ask'|'error'|'undo'} kind
 */
export function beep(kind) {
  switch (kind) {
    case 'ok':
      playTone(880, 120);
      break;
    case 'fail':
      playTone(330, 180);
      playTone(330, 180, 230);
      break;
    case 'notFound':
      playTone(520, 150);
      playTone(390, 150, 180);
      break;
    case 'new':
      playTone(660, 90);
      playTone(880, 90, 110);
      playTone(1100, 140, 220);
      break;
    case 'ask':
      playTone(660, 100);
      playTone(880, 100, 120);
      playTone(660, 100, 240);
      break;
    case 'undo':
      playTone(600, 80);
      playTone(450, 120, 100);
      break;
    case 'error':
    default:
      playTone(200, 300, 0, 'square');
  }
}

/**
 * הקראה בעברית. מחזיר Promise שמסתיים כשההקראה נגמרה (או מיד אם אין תמיכה),
 * כדי שאפשר יהיה להשתיק את המיקרופון בזמן ההקראה ולהחזירו אחריה.
 * @param {string} text
 */
export function speak(text) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis || !text) {
      resolve();
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'he-IL';
    utterance.rate = 1.05;
    const hebrewVoice = synth.getVoices().find((voice) => voice.lang?.startsWith('he'));
    if (hebrewVoice) utterance.voice = hebrewVoice;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    // הגנה מפני מצב שבו onend לא נקרא (באג ידוע באנדרואיד)
    setTimeout(resolve, Math.min(8000, 1500 + text.length * 90));
    synth.speak(utterance);
  });
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
}
