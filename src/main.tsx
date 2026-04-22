import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import './index.css';
import App from './App';
import { queryClient } from './lib/queryClient';

// Initialize Sentry for frontend error monitoring (no-op if DSN not set)
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
  });
}

// Auto-inject auth token into all /api/ requests. Load-bearing for every
// call site that uses raw `fetch('/api/...')` instead of the typed helpers
// in src/api/client.ts — including streaming wrappers in src/api/seo.ts
// (bulkGenerateAltText, streamKeywordStrategy) that can't use post()/getText()
// because those consume the full response body. Do not remove without
// updating those wrappers to set x-auth-token themselves.
const _fetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith('/api/')) {
    const token = localStorage.getItem('auth_token');
    if (token) {
      const headers = new Headers(init?.headers);
      if (!headers.has('x-auth-token')) {
        headers.set('x-auth-token', token);
      }
      init = { ...init, headers };
    }
  }
  return _fetch.call(window, input, init);
};

const SentryErrorBoundary = SENTRY_DSN ? Sentry.ErrorBoundary : ({ children }: { children: React.ReactNode }) => <>{children}</>;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SentryErrorBoundary fallback={<div style={{ padding: '2rem', textAlign: 'center' }}><h1>Something went wrong</h1><p>The error has been reported. Please refresh the page.</p></div>}>
        <App />
      </SentryErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
