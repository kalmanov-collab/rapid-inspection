import React, { useCallback, useEffect, useState } from 'react';
import HomeScreen from './screens/HomeScreen';
import SiteScreen from './screens/SiteScreen';
import ExportScreen from './screens/ExportScreen';
import CatalogScreen from './screens/CatalogScreen';
import RapidInspectionScreen from './components/RapidInspectionScreen';
import { parseSummaryWorkbook, buildSession, todayString } from './services/excelService';
import { loadSaved, saveParsed, saveMeta, saveState, clearSaved } from './services/sessionStore';
import { createInitialState } from './utils/rapidInspectionEngine';

/**
 * אפליקציה עצמאית: קובץ ריכוז -> בחירת אתר -> בדיקה קולית -> ייצוא (ריכוז מעודכן / נבדקו / JSON).
 * הכל נשמר במכשיר; אין שרת.
 */
export default function App() {
  const [screen, setScreen] = useState('loading');
  const [parsed, setParsed] = useState(null);
  const [meta, setMeta] = useState(null);           // { clientName, site, date, fileName, startedAt }
  const [session, setSession] = useState(null);     // { clientName, siteName, catalog, locations, items }
  const [state, setState] = useState(null);         // מצב המנוע (נשמר אחרי כל שינוי)
  const [error, setError] = useState('');

  // טעינת סשן שמור בהפעלה
  useEffect(() => {
    loadSaved()
      .then((saved) => {
        if (saved) {
          setParsed(saved.parsed);
          setMeta(saved.meta);
          setState(saved.state);
        }
        setScreen('home');
      })
      .catch((err) => {
        console.error('Failed to load saved session:', err);
        setScreen('home');
      });
  }, []);

  const handleFile = useCallback(async (file) => {
    setError('');
    try {
      const data = await file.arrayBuffer();
      const nextParsed = parseSummaryWorkbook(data);
      setParsed(nextParsed);
      setMeta({ fileName: file.name, clientName: meta?.clientName || '', site: null, date: todayString(), startedAt: Date.now() });
      setState(null);
      setScreen('site');
    } catch (err) {
      console.error(err);
      setError(`לא ניתן לקרוא את הקובץ: ${err.message}`);
    }
  }, [meta]);

  const startSession = useCallback(async (site, clientName) => {
    try {
      const nextSession = buildSession(parsed, site, { clientName });
      const nextMeta = { ...meta, site, clientName, date: todayString(), startedAt: Date.now() };
      const nextState = createInitialState(nextSession);
      setSession(nextSession);
      setMeta(nextMeta);
      setState(nextState);
      await Promise.all([saveParsed(parsed), saveMeta(nextMeta), saveState(nextState)]);
      setScreen('inspect');
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  }, [parsed, meta]);

  const resumeSession = useCallback(() => {
    if (!parsed || !meta?.site) return;
    const nextSession = session || buildSession(parsed, meta.site, { clientName: meta.clientName });
    if (!session) setSession(nextSession);
    if (!state) setState(createInitialState(nextSession));
    setScreen('inspect');
  }, [parsed, meta, session, state]);

  const handleStateChange = useCallback((nextState) => {
    setState(nextState);
    saveState(nextState).catch((err) => console.error('Failed to save state:', err));
  }, []);

  const finishSession = useCallback(async () => {
    await clearSaved();
    setParsed(null);
    setMeta(null);
    setSession(null);
    setState(null);
    setScreen('home');
  }, []);

  if (screen === 'loading') return <div className="min-h-full flex items-center justify-center text-gray-400">טוען...</div>;

  if (screen === 'site') {
    return <SiteScreen parsed={parsed} meta={meta} onStart={startSession} onBack={() => setScreen('home')} error={error} />;
  }

  if (screen === 'inspect' && session) {
    return (
      <RapidInspectionScreen
        key={`${meta.site}-${meta.startedAt}`}
        session={session}
        initialState={state || undefined}
        onStateChange={handleStateChange}
        onFinish={() => setScreen('export')}
        onClose={() => setScreen('home')}
        onOpenCatalog={() => setScreen('catalog')}
      />
    );
  }

  if (screen === 'catalog' && state) {
    return <CatalogScreen state={state} onChange={handleStateChange} onBack={() => setScreen('inspect')} />;
  }

  if (screen === 'export' && state) {
    return <ExportScreen parsed={parsed} state={state} meta={meta} onBack={() => setScreen('inspect')} onFinish={finishSession} />;
  }

  return (
    <HomeScreen
      saved={parsed && meta?.site ? { meta, state } : null}
      onFile={handleFile}
      onResume={resumeSession}
      onExport={() => setScreen('export')}
      onDiscard={finishSession}
      error={error}
    />
  );
}
