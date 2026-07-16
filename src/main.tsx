import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Tự động chuyển các request /api/... sang backend bên ngoài khi frontend chạy trên GitHub Pages.
// GitHub Pages chỉ phục vụ file tĩnh, vì vậy nếu chưa cấu hình VITE_API_URL thì trả về
// JSON 503 rõ ràng thay vì để GitHub Pages trả HTML 404 gây lỗi "Unexpected token '<'".
const originalFetch = window.fetch.bind(window);
const configuredApiBase = String((import.meta as any).env?.VITE_API_URL || '')
  .trim()
  .replace(/\/$/, '');
const isGitHubPagesHost =
  window.location.hostname === 'github.io' || window.location.hostname.endsWith('.github.io');
const useSameOriginBackend = !configuredApiBase && !isGitHubPagesHost;

function createBackendUnavailableResponse(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error:
        'Backend API chưa được cấu hình. GitHub Pages chỉ chạy frontend tĩnh. Hãy khai báo VITE_API_URL trỏ tới backend Express để sử dụng đồng bộ Facebook, Zalo OA, Google Sheets và quản trị dữ liệu.',
      code: 'BACKEND_NOT_CONFIGURED',
    }),
    {
      status: 503,
      statusText: 'Backend API not configured',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

window.fetch = async (input, init) => {
  let url = '';
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof Request) {
    url = input.url;
  } else if (input instanceof URL) {
    url = input.toString();
  }

  const isRelativeApiCall = url.startsWith('/api/');
  const isSameOriginApiCall = url.startsWith(`${window.location.origin}/api/`);
  const isApiCall = isRelativeApiCall || isSameOriginApiCall;

  // Local development and a production Docker deployment serve the frontend
  // and API from the same Express origin. GitHub Pages is static-only, so it
  // still requires VITE_API_URL to point to the separately deployed backend.
  if (isApiCall && !configuredApiBase && !useSameOriginBackend) {
    return createBackendUnavailableResponse();
  }

  if (isApiCall && configuredApiBase) {
    const apiPath = isRelativeApiCall
      ? url
      : url.slice(window.location.origin.length);
    const targetUrl = `${configuredApiBase}${apiPath}`;

    if (typeof input === 'string') {
      return originalFetch(targetUrl, init);
    }

    if (input instanceof URL) {
      return originalFetch(new URL(targetUrl), init);
    }

    // Giữ nguyên method, headers và body khi chuyển Request sang backend ngoài.
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
      try {
        requestInit.body = await input.clone().blob();
      } catch (error) {
        console.warn('Không thể sao chép body của API request:', error);
      }
    }

    return originalFetch(new Request(targetUrl, requestInit));
  }

  // Firebase Auth, Facebook Graph API và các request ngoài hệ thống giữ nguyên.
  return originalFetch(input, init);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
