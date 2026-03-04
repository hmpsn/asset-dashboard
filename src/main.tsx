import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// Auto-inject auth token into all /api/ requests
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
