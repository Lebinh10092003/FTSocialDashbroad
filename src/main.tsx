import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const originalFetch = window.fetch.bind(window);
const apiBase = String((import.meta as any).env?.VITE_API_URL || '').trim().replace(/\/$/, '');
const useLocalApiProxy = Boolean((import.meta as any).env?.DEV && apiBase);

window.fetch = async (input, init) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.toString()
        : '';
  const isRelativeApiCall = url.startsWith('/api/');
  const isSameOriginApiCall = url.startsWith(`${window.location.origin}/api/`);

  if (useLocalApiProxy || !apiBase || (!isRelativeApiCall && !isSameOriginApiCall)) {
    return originalFetch(input, init);
  }

  const apiPath = isRelativeApiCall ? url : url.slice(window.location.origin.length);
  const targetUrl = `${apiBase}${apiPath.replace(/^\/api(?=\/|$)/, '')}`;
  if (typeof input === 'string') return originalFetch(targetUrl, init);
  if (input instanceof URL) return originalFetch(new URL(targetUrl), init);

  const requestInit: RequestInit = {
    method: input.method,
    headers: new Headers(input.headers),
    credentials: input.credentials,
    mode: input.mode,
    cache: input.cache,
    redirect: input.redirect,
    referrer: input.referrer,
    integrity: input.integrity,
    keepalive: input.keepalive,
    signal: input.signal,
  };
  if (!['GET', 'HEAD'].includes(input.method) && input.body !== null) {
    requestInit.body = await input.clone().blob();
  }
  return originalFetch(new Request(targetUrl, requestInit));
};

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
