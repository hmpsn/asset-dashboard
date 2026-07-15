import { useRef, useState, useCallback, useEffect } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface AutoSaveRun {
  (): Promise<void> | void;
  retry?: () => Promise<void> | void;
}

interface AutoSaveAttempt {
  html: string;
  run: AutoSaveRun;
}

export function useAutoSave(
  saveFn: (html: string) => Promise<void> | void,
  delay = 2000,
  onError?: (err: unknown) => void,
  onSuccess?: () => void,
  prepareSave?: (html: string) => AutoSaveRun,
) {
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const prepareSaveRef = useRef(prepareSave);
  prepareSaveRef.current = prepareSave;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<AutoSaveAttempt | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const isMounted = useRef(true);
  // Tracks whether the most recently completed save succeeded (true) or failed (false).
  // Allows flush() to return a synchronous result without relying on React state timing.
  const lastSaveOkRef = useRef<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const createAttempt = useCallback((html: string): AutoSaveAttempt => {
    try {
      return {
        html,
        run: prepareSaveRef.current?.(html) ?? (() => saveFnRef.current(html)),
      };
    } catch (err) {
      return { html, run: () => Promise.reject(err) };
    }
  }, []);

  const doSave = useCallback((attempt: AutoSaveAttempt): Promise<boolean> => {
    if (isMounted.current) setSaveStatus('saving');
    const run = (async () => {
      try {
        await attempt.run();
        if (pendingSave.current === attempt) pendingSave.current = null;
        lastSaveOkRef.current = true;
        if (!isMounted.current) return true;
        try {
          onSuccessRef.current?.();
        } catch { // catch-ok -- local success feedback cannot invalidate a server-accepted save.
        }
        setSaveStatus('saved');
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => {
          savedTimer.current = null;
          if (isMounted.current) setSaveStatus(s => (s === 'saved' ? 'idle' : s));
        }, 1500);
        return true;
      } catch (err) {
        lastSaveOkRef.current = false;
        try {
          onErrorRef.current?.(err);
        } catch { // catch-ok -- local error feedback cannot change the failed-save result.
        }
        if (isMounted.current) setSaveStatus('error');
        return false;
      }
    })();
    const finalPromise = run.finally(() => {
      if (inFlight.current === finalPromise) inFlight.current = null;
    });
    inFlight.current = finalPromise;
    return finalPromise;
  }, []);

  const scheduleAutoSave = useCallback((html: string) => {
    const attempt = createAttempt(html);
    pendingSave.current = attempt;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (pendingSave.current === attempt) void doSave(attempt);
    }, delay);
  }, [createAttempt, doSave, delay]);

  // flush() awaits any in-flight save then drains the latest pending attempt. This
  // prevents a race where flush fires a second concurrent PATCH while an earlier
  // save is still in flight (last-write-wins on the server, doubles network).
  // Returns { ok: boolean } so callers can decide whether to exit edit mode.
  const flush = useCallback(async (): Promise<{ ok: boolean }> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    // Drain every save that was already started. If any one fails, retain the
    // pending buffer and stop: immediately calling doSave again here would turn
    // Done/Approve into an implicit retry of a rejected conditional write.
    while (inFlight.current) {
      const activeSave = inFlight.current;
      const ok = await activeSave;
      if (!ok) return { ok: false };
    }
    if (pendingSave.current !== null) {
      const ok = await doSave(pendingSave.current);
      if (!ok) return { ok: false };
    }
    return { ok: lastSaveOkRef.current };
  }, [doSave]);

  /**
   * One explicit recovery attempt for the retained failed payload. A prepared
   * serialized save may provide a retry that is pinned to the exact authority
   * used by the rejected request; it must not silently rebase onto newer data.
   */
  const retry = useCallback(async (): Promise<{ ok: boolean }> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    while (inFlight.current) {
      const activeSave = inFlight.current;
      const ok = await activeSave;
      if (ok && pendingSave.current === null) return { ok: true };
    }
    const failedAttempt = pendingSave.current;
    if (!failedAttempt) return { ok: lastSaveOkRef.current };
    const retryAttempt: AutoSaveAttempt = {
      html: failedAttempt.html,
      run: failedAttempt.run.retry
        ? () => failedAttempt.run.retry!()
        : failedAttempt.run,
    };
    pendingSave.current = retryAttempt;
    const ok = await doSave(retryAttempt);
    return { ok };
  }, [doSave]);

  // Resets the internal ok-state to "succeeded" and clears the error status. Callers
  // that perform a save OUTSIDE the hook (e.g. a manual retry that replays a captured
  // payload directly) must call this on success so the hook's lastSaveOkRef no longer
  // reports the prior failure — otherwise the next flush() returns { ok: false } even
  // though there is nothing left to save, and edit-mode exit is silently blocked.
  const resetSaveOk = useCallback(() => {
    lastSaveOkRef.current = true;
    pendingSave.current = null;
    if (isMounted.current) setSaveStatus(s => (s === 'error' ? 'idle' : s));
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      const reportUnmountError = (err: unknown) => {
        try {
          onErrorRef.current?.(err);
        } catch { // catch-ok -- unmount cleanup must not create an unhandled rejection from feedback UI.
        }
      };
      const savePendingAfterUnmount = () => {
        if (pendingSave.current === null) return;
        const attempt = pendingSave.current;
        pendingSave.current = null;
        try {
          // Best-effort first attempt — errors are routed through onError.
          void Promise.resolve(attempt.run()).catch(reportUnmountError);
        } catch (err) {
          reportUnmountError(err);
        }
      };

      // Never duplicate an in-flight payload or invisibly retry a completed
      // failure during unmount. If the active save succeeds, it clears its own
      // payload; only a genuinely newer pending buffer is attempted afterward.
      const activeSave = inFlight.current;
      if (activeSave) {
        void activeSave.then(ok => {
          if (ok) savePendingAfterUnmount();
        });
      } else if (lastSaveOkRef.current) {
        savePendingAfterUnmount();
      }
    };
  }, []);

  return { scheduleAutoSave, flush, retry, saveStatus, resetSaveOk };
}
