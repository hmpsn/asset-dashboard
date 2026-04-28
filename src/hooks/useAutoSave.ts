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

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHtml = useRef<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const isMounted = useRef(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const doSave = useCallback((html: string): Promise<void> => {
    if (isMounted.current) setSaveStatus('saving');
    const run = (async () => {
      try {
        await saveFnRef.current(html);
        if (pendingHtml.current === html) pendingHtml.current = null;
        if (!isMounted.current) return;
        setSaveStatus('saved');
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => {
          savedTimer.current = null;
          if (isMounted.current) setSaveStatus(s => (s === 'saved' ? 'idle' : s));
        }, 1500);
      } catch (err) {
        onErrorRef.current?.(err);
        if (isMounted.current) setSaveStatus('idle');
      }
    })();
    inFlight.current = run.finally(() => {
      if (inFlight.current === run) inFlight.current = null;
    });
    return inFlight.current;
  }, []);

  const scheduleAutoSave = useCallback((html: string) => {
    pendingHtml.current = html;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void doSave(html); }, delay);
  }, [doSave, delay]);

  // flush() awaits any in-flight save then drains the latest pendingHtml. This
  // prevents a race where flush fires a second concurrent PATCH while an earlier
  // save is still in flight (last-write-wins on the server, doubles network).
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inFlight.current) await inFlight.current;
    if (pendingHtml.current !== null) await doSave(pendingHtml.current);
  }, [doSave]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  return { scheduleAutoSave, flush, saveStatus };
}
