import { useCallback, useMemo, useRef } from 'react';

interface SerializedArtifactSaveOptions<Authority, Update, Result> {
  /** Last authority observed from the canonical read model. */
  authority: Authority | null | undefined;
  /** One conditional write. This primitive never retries a rejected write. */
  save: (authority: Authority, update: Update) => Promise<Result>;
  /** Extract authority only from an accepted server response. */
  getAcceptedAuthority: (result: Result) => Authority | null | undefined;
  onAccepted?: (result: Result, update: Update) => void;
}

export interface PreparedSerializedArtifactSave<Result> {
  (): Promise<Result>;
  /**
   * Explicitly retry the same payload against the exact authority used by the
   * failed request. A newer canonical authority rejects locally; it is never a
   * license to rebase stale content.
   */
  retry: () => Promise<Result>;
}

/** Opaque authority epoch captured when an editor buffer is opened. */
export interface SerializedArtifactAuthorityCapture {
  readonly editorInstance: symbol;
  readonly epoch: number;
}

export type SerializedArtifactSave<Update, Result> = ((update: Update) => Promise<Result>) & {
  /**
   * Capture the current authority epoch when an edit is authored, even if a
   * debounce timer will not enqueue it until later. The returned attempt is
   * one-shot so flush/unmount paths cannot duplicate an accepted write.
   */
  prepare: (update: Update) => PreparedSerializedArtifactSave<Result>;
  /** Capture authority before a delayed editor buffer is authored. */
  captureAuthority: () => SerializedArtifactAuthorityCapture;
  /** Prepare a payload against the authority epoch captured when its editor opened. */
  prepareAt: (
    capture: SerializedArtifactAuthorityCapture,
    update: Update,
  ) => PreparedSerializedArtifactSave<Result>;
};

/**
 * Serializes conditional writes for one mounted artifact editor.
 *
 * Independent debounce timers can otherwise read the same revision and issue
 * concurrent PATCHes. The first succeeds and every sibling request receives an
 * ordinary same-user conflict. This queue advances its private authority only
 * after the server accepts a write; rejections propagate unchanged to the
 * caller so conflict UI can surface them without an automatic retry.
 */
export function useSerializedArtifactSave<Authority, Update, Result>({
  authority,
  save,
  getAcceptedAuthority,
  onAccepted,
}: SerializedArtifactSaveOptions<Authority, Update, Result>) {
  const authorityRef = useRef<Authority | null | undefined>(authority);
  const lastObservedAuthorityRef = useRef<Authority | null | undefined>(authority);
  const authorityEpochRef = useRef(0);
  const inFlightEpochRef = useRef<number | null>(null);
  const authorityObservedDuringFlightRef = useRef<{
    authority: Authority | null | undefined;
  } | null>(null);
  const editorInstanceRef = useRef(Symbol('serialized-artifact-editor'));

  // Synchronize a newly observed canonical token during render, while avoiding
  // regression to the old prop between an accepted response and its rerender.
  // A genuinely external token change invalidates work authored under the old
  // epoch instead of silently rebasing its stale payload onto newer authority.
  if (!Object.is(lastObservedAuthorityRef.current, authority)) {
    lastObservedAuthorityRef.current = authority;
    if (inFlightEpochRef.current !== null) {
      // Defer classifying this observation until the response arrives. If its
      // token matches the accepted response, it was merely the read model
      // catching up with this write; otherwise it is an external invalidation.
      authorityObservedDuringFlightRef.current = { authority };
    } else if (!Object.is(authorityRef.current, authority)) {
      authorityRef.current = authority;
      authorityEpochRef.current += 1;
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;
  const getAcceptedAuthorityRef = useRef(getAcceptedAuthority);
  getAcceptedAuthorityRef.current = getAcceptedAuthority;
  const onAcceptedRef = useRef(onAccepted);
  onAcceptedRef.current = onAccepted;

  const queueTailRef = useRef<Promise<void>>(Promise.resolve());

  const enqueue = useCallback((
    update: Update,
    authoredEpoch: number,
    options: {
      requiredAuthority?: { value: Authority };
      onAttempt?: (authority: Authority) => void;
    } = {},
  ): Promise<Result> => {
    const run = queueTailRef.current.then(async () => {
      if (authoredEpoch !== authorityEpochRef.current) {
        throw new Error('This content changed while your edit was waiting to save. Refresh before trying again.');
      }
      const currentAuthority = authorityRef.current;
      if (currentAuthority === null || currentAuthority === undefined) {
        throw new Error('Cannot save before the artifact authority is available.');
      }
      if (options.requiredAuthority
        && !Object.is(currentAuthority, options.requiredAuthority.value)) {
        throw new Error('This content changed after the failed save. Refresh before trying again.');
      }
      options.onAttempt?.(currentAuthority);

      inFlightEpochRef.current = authoredEpoch;
      const invalidateEpoch = () => {
        const observed = authorityObservedDuringFlightRef.current;
        authorityObservedDuringFlightRef.current = null;
        inFlightEpochRef.current = null;
        if (observed) authorityRef.current = observed.authority;
        if (authoredEpoch === authorityEpochRef.current) {
          authorityEpochRef.current += 1;
        }
      };

      let result: Result;
      try {
        result = await saveRef.current(currentAuthority, update);
      } catch (err) {
        // The token is now uncertain. Cancel already-queued writes from this
        // epoch; a later explicit user action may enqueue against a fresh epoch.
        invalidateEpoch();
        throw err;
      }
      let acceptedAuthority: Authority | null | undefined;
      try {
        acceptedAuthority = getAcceptedAuthorityRef.current(result);
      } catch (err) {
        invalidateEpoch();
        throw err;
      }
      if (acceptedAuthority === null || acceptedAuthority === undefined) {
        invalidateEpoch();
        throw new Error('Accepted save response did not include artifact authority.');
      }

      const observed = authorityObservedDuringFlightRef.current;
      authorityObservedDuringFlightRef.current = null;
      inFlightEpochRef.current = null;
      if (observed && !Object.is(observed.authority, acceptedAuthority)) {
        authorityRef.current = observed.authority;
        if (authoredEpoch === authorityEpochRef.current) {
          authorityEpochRef.current += 1;
        }
        throw new Error('This content changed while your edit was saving. Refresh before trying again.');
      }

      authorityRef.current = acceptedAuthority;
      try {
        onAcceptedRef.current?.(result, update);
      } catch { // catch-ok -- a local UI synchronization callback cannot invalidate a server-accepted save.
      }
      return result;
    });

    // Recover only the private tail so a later, distinct user edit can run.
    // `run` itself remains rejected and is returned unchanged to the caller.
    queueTailRef.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  const saveImmediately = useCallback((update: Update): Promise<Result> => (
    enqueue(update, authorityEpochRef.current)
  ), [enqueue]);

  const prepareForEpoch = useCallback((
    update: Update,
    authoredEpoch: number,
  ): PreparedSerializedArtifactSave<Result> => {
    let attempt: Promise<Result> | null = null;
    let attemptedAuthority: Authority | undefined;
    let hasAttemptedAuthority = false;
    const run = (() => {
      attempt ??= enqueue(update, authoredEpoch, {
        onAttempt: currentAuthority => {
          attemptedAuthority = currentAuthority;
          hasAttemptedAuthority = true;
        },
      });
      return attempt;
    }) as PreparedSerializedArtifactSave<Result>;
    run.retry = () => {
      if (!hasAttemptedAuthority) return run();
      return enqueue(update, authorityEpochRef.current, {
        requiredAuthority: { value: attemptedAuthority as Authority },
      });
    };
    return run;
  }, [enqueue]);

  const prepare = useCallback((update: Update): PreparedSerializedArtifactSave<Result> => (
    prepareForEpoch(update, authorityEpochRef.current)
  ), [prepareForEpoch]);

  const captureAuthority = useCallback((): SerializedArtifactAuthorityCapture => ({
    editorInstance: editorInstanceRef.current,
    epoch: authorityEpochRef.current,
  }), []);

  const prepareAt = useCallback((
    capture: SerializedArtifactAuthorityCapture,
    update: Update,
  ): PreparedSerializedArtifactSave<Result> => {
    if (capture.editorInstance !== editorInstanceRef.current) {
      const rejectForeignCapture = (() => Promise.reject(
        new Error('This editor authority capture is no longer valid. Refresh before trying again.'),
      )) as PreparedSerializedArtifactSave<Result>;
      rejectForeignCapture.retry = rejectForeignCapture;
      return rejectForeignCapture;
    }
    return prepareForEpoch(update, capture.epoch);
  }, [prepareForEpoch]);

  return useMemo<SerializedArtifactSave<Update, Result>>(
    () => Object.assign(saveImmediately, { prepare, captureAuthority, prepareAt }),
    [captureAuthority, prepare, prepareAt, saveImmediately],
  );
}
