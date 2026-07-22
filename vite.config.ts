import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: '/', // Hỗ trợ đường dẫn tương đối khi deploy lên GitHub Pages
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
        },
        '/uploads': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
        }
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // Khi chạy ở local, bỏ qua theo dõi thư mục server để tránh lặp reload khi database local (JSON) thay đổi.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/backend/db.sqlite3'],
      },
    },
  };
});
