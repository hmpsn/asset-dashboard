import { useEffect, useRef, useCallback } from 'react';

/**
 * Cloudflare Turnstile CAPTCHA widget.
 * Only renders when VITE_TURNSTILE_SITE_KEY is set; otherwise renders nothing.
 * Calls onToken(token) when the user completes the challenge.
 */

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

interface TurnstileWidgetProps {
  onToken: (token: string) => void;
  resetTrigger?: number;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        'expired-callback'?: () => void;
        theme?: 'light' | 'dark' | 'auto';
        size?: 'normal' | 'compact';
      }) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

let scriptLoaded = false;
function loadTurnstileScript(): Promise<void> {
  if (scriptLoaded || document.querySelector('script[src*="turnstile"]')) {
    scriptLoaded = true;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => { scriptLoaded = true; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function TurnstileWidget({ onToken, resetTrigger }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  const stableOnToken = useCallback((token: string) => {
    onTokenRef.current(token);
  }, []);

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) return;

    let cancelled = false;

    loadTurnstileScript().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        callback: stableOnToken,
        'expired-callback': () => stableOnToken(''),
        theme: 'dark',
        size: 'normal',
      });
    });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [stableOnToken]);

  // Reset widget when parent increments resetTrigger (e.g. after form submission)
  useEffect(() => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetTrigger]);

  if (!SITE_KEY) return null;

  return <div ref={containerRef} className="flex justify-center my-2" />;
}
