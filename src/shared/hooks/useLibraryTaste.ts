import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibraryTasteReport } from '../types/libraryTaste';

type Action = 'analyze' | 'cancel' | 'auto';

export function useLibraryTaste(active: boolean) {
  const [report, setReport] = useState<LibraryTasteReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const actionVersion = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const api = window.electronAPI;
    if (!active || !api?.getLibraryTaste) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const requestedVersion = actionVersion.current;
      try {
        const value = await api.getLibraryTaste!();
        if (!disposed && requestedVersion === actionVersion.current) {
          setReport(value);
          setError('');
        }
      } catch {
        if (!disposed && requestedVersion === actionVersion.current)
          setError('Не удалось загрузить профиль Last.fm.');
      } finally {
        if (!disposed) timer = setTimeout(() => void refresh(), 2000);
      }
    };
    setBusy(false);
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (generation.current === current) generation.current++;
    };
  }, [active, revision]);

  useEffect(() => {
    if (!active) return;
    const changed = () => {
      actionVersion.current++;
      setRevision((value) => value + 1);
    };
    window.addEventListener('soso:taste-policy-changed', changed);
    return () => window.removeEventListener('soso:taste-policy-changed', changed);
  }, [active]);

  const run = useCallback(
    async (action: Action, enabled?: boolean) => {
      const current = generation.current;
      const api = window.electronAPI;
      if (!api || !active) return;
      actionVersion.current++;
      setBusy(true);
      setError('');
      try {
        const value =
          action === 'auto'
            ? await api.setLibraryTasteAutoAnalyze!(Boolean(enabled))
            : action === 'cancel'
              ? await api.cancelLibraryTaste!()
              : await api.analyzeLibraryTaste!();
        if (current === generation.current) setReport(value);
      } catch {
        if (current === generation.current)
          setError('Не удалось выполнить действие Last.fm. Повторите попытку.');
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [active],
  );

  return { report, error, busy, run, retry: () => setRevision((value) => value + 1) };
}
