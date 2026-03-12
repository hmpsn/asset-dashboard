import { useState, useCallback, useRef } from 'react';

type ToastType = 'success' | 'error';

interface Toast {
  message: string;
  type: ToastType;
}

const DEFAULT_DURATION = 5000;

/**
 * Centralized toast hook with auto-dismiss.
 * Replaces the duplicated `setToast(...); setTimeout(() => setToast(null), N)` pattern.
 */
export function useToast(duration = DEFAULT_DURATION) {
  const [toast, setToastState] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setToast = useCallback((t: Toast | null) => {
    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setToastState(t);

    // Auto-dismiss if setting a new toast
    if (t) {
      timerRef.current = setTimeout(() => {
        setToastState(null);
        timerRef.current = null;
      }, duration);
    }
  }, [duration]);

  const clearToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToastState(null);
  }, []);

  return { toast, setToast, clearToast };
}
