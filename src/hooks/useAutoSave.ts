import { useRef, useState, useCallback, useEffect } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useAutoSave(
  saveFn: (html: string) => Promise<void> | void,
  delay = 2000,
  onError?: (err: unknown) => void,
  onSuccess?: () => void,
) {
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHtml = useRef<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const isMounted = useRef(true);
  // Tracks whether the most recently completed save succeeded (true) or failed (false).
  // Allows flush() to return a synchronous result without relying on React state timing.
  const lastSaveOkRef = useRef<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const doSave = useCallback((html: string): Promise<void> => {
    if (isMounted.current) setSaveStatus('saving');
    const run = (async () => {
      try {
        await saveFnRef.current(html);
        if (pendingHtml.current === html) pendingHtml.current = null;
        lastSaveOkRef.current = true;
        if (!isMounted.current) return;
        onSuccessRef.current?.();
        setSaveStatus('saved');
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => {
          savedTimer.current = null;
          if (isMounted.current) setSaveStatus(s => (s === 'saved' ? 'idle' : s));
        }, 1500);
      } catch (err) {
        lastSaveOkRef.current = false;
        onErrorRef.current?.(err);
        if (isMounted.current) setSaveStatus('error');
      }
    })();
    const finalPromise = run.finally(() => {
      if (inFlight.current === finalPromise) inFlight.current = null;
    });
    inFlight.current = finalPromise;
    return finalPromise;
  }, []);

  const scheduleAutoSave = useCallback((html: string) => {
    pendingHtml.current = html;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void doSave(html); }, delay);
  }, [doSave, delay]);

  // flush() awaits any in-flight save then drains the latest pendingHtml. This
  // prevents a race where flush fires a second concurrent PATCH while an earlier
  // save is still in flight (last-write-wins on the server, doubles network).
  // Returns { ok: boolean } so callers can decide whether to exit edit mode.
  const flush = useCallback(async (): Promise<{ ok: boolean }> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inFlight.current) await inFlight.current;
    if (pendingHtml.current !== null) await doSave(pendingHtml.current);
    return { ok: lastSaveOkRef.current };
  }, [doSave]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      // Flush pending content on unmount so navigating away mid-edit doesn't
      // silently lose the user's work. We can't await this from the cleanup
      // (cleanup is sync), but firing the save preserves the keystrokes.
      // The latest saveFn closure is already in saveFnRef.current.
      if (pendingHtml.current !== null) {
        const html = pendingHtml.current;
        pendingHtml.current = null;
        // Best-effort fire-and-forget — errors are routed through onError.
        Promise.resolve(saveFnRef.current(html)).catch(err => onErrorRef.current?.(err));
      }
    };
  }, []);

  return { scheduleAutoSave, flush, saveStatus };
}
