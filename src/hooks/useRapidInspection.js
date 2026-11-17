import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyTranscript, applyManualResult, applyManualNewItem, selectType, selectLocation, updateCatalogEntry, createInitialState, getCounts, itemsOfType,
} from '../utils/rapidInspectionEngine';
import { beep, speak, unlockAudio } from '../utils/audioFeedback';
import useSpeechRecognition from './useSpeechRecognition';

/**
 * Hook שמחבר בין זיהוי הדיבור, מנוע המצב והמשוב הקולי (גרסה 2: סוג + מיקום דביקים).
 *
 * הערה: הסשן נטען פעם אחת בעת ההרכבה. לסשן אחר יש להרכיב מחדש (key={sessionId}).
 *
 * @param {Object} options
 * @param {Object} options.session - { items, catalog, locations }
 * @param {Object} [options.initialState] - מצב שמור להמשך סשן (במקום לבנות מהסשן)
 * @param {(item: Object) => void} [options.onItemChange] - נקרא בכל שינוי בפריט
 * @param {(state: Object) => void} [options.onStateChange] - נקרא אחרי כל שינוי מצב (לשמירה מקומית)
 * @param {Array} [options.defects] - מילון ליקויים מותאם
 */
export default function useRapidInspection({ session, initialState, onItemChange, onStateChange, defects }) {
  const [state, setState] = useState(() => initialState || createInitialState(session, { defects }));
  const [lastMessage, setLastMessage] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);

  // המצב העדכני לאירועים אסינכרוניים; מתעדכן רק בתוך commit
  const stateRef = useRef(state);

  const onItemChangeRef = useRef(onItemChange);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onItemChangeRef.current = onItemChange;
    onStateChangeRef.current = onStateChange;
  }, [onItemChange, onStateChange]);

  const processTranscriptRef = useRef(null);
  const { isSupported, isListening, interimText, error, start, stop, pause, resume } = useSpeechRecognition({
    onResult: (transcript, confidence) => processTranscriptRef.current?.(transcript, confidence),
  });

  const playFeedback = useCallback(async (feedback) => {
    if (!feedback) return;
    if (feedback.message) setLastMessage(feedback.message);
    if (feedback.beep) beep(feedback.beep);
    if (feedback.control === 'pause') stop();
    if (feedback.control === 'resume') start();
    if (feedback.speak) {
      setIsSpeaking(true);
      pause();
      try {
        await speak(feedback.speak);
      } finally {
        setIsSpeaking(false);
        resume();
      }
    }
  }, [start, stop, pause, resume]);

  const commit = useCallback((result) => {
    const stateBefore = stateRef.current;
    stateRef.current = result.state;
    setState(result.state);
    if (result.updatedItem) onItemChangeRef.current?.(result.updatedItem);
    if (result.state !== stateBefore) onStateChangeRef.current?.(result.state);
    playFeedback(result.feedback);
  }, [playFeedback]);

  const processTranscript = useCallback((transcript, confidence = 1) => {
    if (!transcript) return;
    try {
      commit(applyTranscript(stateRef.current, transcript, confidence));
    } catch (err) {
      console.error('Rapid inspection error:', err);
      setLastMessage(`שגיאה בעיבוד: ${err.message}`);
      beep('error');
    }
  }, [commit]);

  useEffect(() => {
    processTranscriptRef.current = processTranscript;
  }, [processTranscript]);

  const setManualResult = useCallback((id, status) => commit(applyManualResult(stateRef.current, id, status)), [commit]);
  const addManualItem = useCallback((serial, status) => commit(applyManualNewItem(stateRef.current, serial, status)), [commit]);
  const chooseType = useCallback((catalogId) => commit(selectType(stateRef.current, catalogId)), [commit]);
  const chooseLocation = useCallback((name) => commit(selectLocation(stateRef.current, name)), [commit]);
  const editCatalogEntry = useCallback((id, patch) => commit(updateCatalogEntry(stateRef.current, id, patch)), [commit]);

  const undo = useCallback(() => processTranscript('בטל'), [processTranscript]);
  const answerYes = useCallback(() => processTranscript('כן'), [processTranscript]);
  const answerNo = useCallback(() => processTranscript('לא'), [processTranscript]);

  const startListening = useCallback(() => {
    unlockAudio();
    start();
  }, [start]);

  const counts = useMemo(() => getCounts(state), [state]);
  const currentItem = state.currentId ? state.items[state.currentId] : null;
  const activeType = state.activeTypeId ? state.catalogById[state.activeTypeId] : null;
  const activeTypeItems = useMemo(() => (state.activeTypeId ? itemsOfType(state, state.activeTypeId) : []), [state]);
  const orderedItems = useMemo(() => state.order.map((id) => state.items[id]), [state]);

  return {
    state,
    counts,
    currentItem,
    activeType,
    activeLocation: state.activeLocation,
    activeTypeItems,
    orderedItems,
    catalog: state.catalog,
    locations: state.locations,
    lastMessage,
    isSpeaking,
    pendingQuestion: state.pendingQuestion,
    reviewQueue: state.reviewQueue,
    moved: state.moved,
    log: state.log,
    speech: { isSupported, isListening, interimText, error, start: startListening, stop },
    processTranscript,
    setManualResult,
    addManualItem,
    chooseType,
    chooseLocation,
    editCatalogEntry,
    undo,
    answerYes,
    answerNo,
  };
}
