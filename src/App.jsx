import React, { useCallback, useEffect, useState } from 'react';
import HomeScreen from './screens/HomeScreen';
import SiteScreen from './screens/SiteScreen';
import ReviewScreen from './screens/ReviewScreen';
import FieldInspectionScreen from './components/FieldInspectionScreen';
import { parseSummaryWorkbook, todayString } from './services/excelService';
import { loadSaved, saveParsed, saveMeta, saveState, clearSaved } from './services/sessionStore';
import { createFieldState } from './utils/fieldSession';
import { buildTypeCatalog } from './utils/typeCatalog';

/**
 * אפליקציה עצמאית: קובץ ריכוז -> בחירת אתר -> בדיקה קולית בשטח -> סיכום והשוואה -> ייצוא.
 * הכל נשמר במכשיר; אין שרת.
 */
export default function App() {
  const [screen, setScreen] = useState('loading');
  const [parsed, setParsed] = useState(null);
  const [meta, setMeta] = useState(null);     // { fileName, date, startedAt }
  const [state, setState] = useState(null);   // מצב הבדיקה (fieldSession)
  const [error, setError] = useState('');

  useEffect(() => {
    loadSaved()
      .then((saved) => {
        if (saved) {
          setParsed(saved.parsed);
          setMeta(saved.meta);
          setState(saved.state);
        }
      })
      .catch((err) => console.error('Failed to load saved session:', err))
      .finally(() => setScreen('home'));
  }, []);

  const handleFile = useCallback(async (file) => {
    setError('');
    try {
      const nextParsed = parseSummaryWorkbook(await file.arrayBuffer());
      setParsed(nextParsed);
      setMeta({ fileName: file.name, date: todayString(), startedAt: Date.now() });
      setState(null);
      setScreen('site');
    } catch (err) {
      console.error(err);
      setError(`לא ניתן לקרוא את הקובץ: ${err.message}`);
    }
  }, []);

  const startSession = useCallback(async (site, clientName) => {
    try {
      const nextMeta = { ...meta, date: todayString(), startedAt: Date.now() };
      const nextState = createFieldState({
        site,
        clientName,
        knownLocations: parsed.locationsBySite[site] || [],
        catalog: buildTypeCatalog(parsed, site),
        typeMemory: parsed.typeMemory,
      });
      setMeta(nextMeta);
      setState(nextState);
      await Promise.all([saveParsed(parsed), saveMeta(nextMeta), saveState(nextState)]);
      setScreen('field');
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  }, [parsed, meta]);

  const handleStateChange = useCallback((nextState) => {
    setState(nextState);
    saveState(nextState).catch((err) => console.error('Failed to save state:', err));
  }, []);

  const finishSession = useCallback(async () => {
    await clearSaved();
    setParsed(null);
    setMeta(null);
    setState(null);
    setScreen('home');
  }, []);

  if (screen === 'loading') return <div className="min-h-full flex items-center justify-center text-gray-400">טוען...</div>;

  if (screen === 'site' && parsed) {
    return <SiteScreen parsed={parsed} meta={meta} onStart={startSession} onBack={() => setScreen('home')} error={error} />;
  }
  if (screen === 'field' && state) {
    return <FieldInspectionScreen state={state} onChange={handleStateChange} onReview={() => setScreen('review')} onClose={() => setScreen('home')} />;
  }
  if (screen === 'review' && state && parsed) {
    return <ReviewScreen parsed={parsed} state={state} meta={meta} onChange={handleStateChange} onBack={() => setScreen('field')} onFinish={finishSession} />;
  }
  return (
    <HomeScreen
      saved={parsed && state ? { meta, state } : null}
      onFile={handleFile}
      onResume={() => setScreen('field')}
      onExport={() => setScreen('review')}
      onDiscard={finishSession}
      error={error}
    />
  );
}
