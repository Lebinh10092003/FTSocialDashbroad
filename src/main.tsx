import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Tự động cấu hình fetch interceptor toàn cục để trỏ API về URL backend bên ngoài (như Render/Vercel)
// khi chạy ứng dụng tĩnh trên GitHub Pages.
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  let url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
  const apiBase = ((import.meta as any).env?.VITE_API_URL as string) || '';
  
  if (apiBase) {
    if (url.startsWith('/api/')) {
      url = `${apiBase.replace(/\/$/, '')}${url}`;
    } else if (url.startsWith(window.location.origin + '/api/')) {
      url = url.replace(window.location.origin + '/api/', apiBase.replace(/\/$/, '') + '/api/');
    }
  }

  if (typeof input === 'string') {
    return originalFetch(url, init);
  } else if (input instanceof URL) {
    return originalFetch(new URL(url), init);
  } else {
    const newRequest = new Request(url, input as any);
    return originalFetch(newRequest, init);
  }
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
