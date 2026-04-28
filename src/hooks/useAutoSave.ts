import { useRef, useState, useCallback, useEffect } from 'react';

type SaveStatus = 'idle' | 'saving' | 'saved';

export function useAutoSave(
  saveFn: (html: string) => Promise<void> | void,
  delay = 2000,
  onError?: (err: unknown) => void,
) {
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const timer = useRef<NodeJS.Timeout | null>(null);
  const pendingHtml = useRef<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const doSave = useCallback(async (html: string) => {
    setSaveStatus('saving');
    try {
      await saveFnRef.current(html);
      if (pendingHtml.current === html) pendingHtml.current = null;
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 1500);
    } catch (err) {
      onErrorRef.current?.(err);
      setSaveStatus('idle');
    }
  }, []);

  const scheduleAutoSave = useCallback((html: string) => {
    pendingHtml.current = html;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { doSave(html); }, delay);
  }, [doSave, delay]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pendingHtml.current !== null) await doSave(pendingHtml.current);
  }, [doSave]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { scheduleAutoSave, flush, saveStatus };
}
