export function isAbortSignalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

export function throwIfSignalAborted(signal?: AbortSignal, message = 'Operation cancelled'): void {
  if (isAbortSignalAborted(signal)) throw new Error(message);
}

export function composeTimeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export function abortableDelay(ms: number, signal?: AbortSignal, message = 'Operation cancelled'): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isAbortSignalAborted(signal)) {
      reject(new Error(message));
      return;
    }

    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(message));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
