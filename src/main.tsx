import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Tự động cấu hình fetch interceptor toàn cục để trỏ API về URL backend bên ngoài (như Render/Vercel)
// khi chạy ứng dụng tĩnh trên GitHub Pages.
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  let url = '';
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof Request) {
    url = input.url;
  } else if (input instanceof URL) {
    url = input.toString();
  }

  // Chỉ can thiệp nếu là request gọi API hệ thống (/api/...)
  const isApiCall = url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/');
  const apiBase = ((import.meta as any).env?.VITE_API_URL as string) || '';

  if (isApiCall && apiBase) {
    let targetUrl = url;
    if (url.startsWith('/api/')) {
      targetUrl = `${apiBase.replace(/\/$/, '')}${url}`;
    } else {
      targetUrl = url.replace(window.location.origin + '/api/', apiBase.replace(/\/$/, '') + '/api/');
    }

    if (typeof input === 'string') {
      return originalFetch(targetUrl, init);
    } else if (input instanceof URL) {
      return originalFetch(new URL(targetUrl), init);
    } else {
      // Nếu input là Request, tạo một Request mới an toàn bằng cách trích xuất RequestInit để tránh TypeError trên trình duyệt
      const headers = new Headers(input.headers);
      const requestInit: RequestInit = {
        method: input.method,
        headers: headers,
        credentials: input.credentials,
        mode: input.mode,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        integrity: input.integrity,
        keepalive: input.keepalive,
        signal: input.signal
      };
      
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(input.method) && input.body !== null) {
        try {
          requestInit.body = await input.clone().blob();
        } catch (e) {
          // Bỏ qua lỗi clone body
        }
      }
      return originalFetch(new Request(targetUrl, requestInit));
    }
  }

  // Đối với các request khác (Firebase Auth, Vite HMR,...) sử dụng fetch gốc không can thiệp
  return originalFetch(input, init);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
