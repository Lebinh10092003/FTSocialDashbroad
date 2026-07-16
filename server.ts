import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/routes';
import { SyncEngine } from './server/sync';
import { adminDb } from './server/firebase';

function setupAutoSyncScheduler() {
  let lastCronRunDay = '';

  console.log('[AutoSync] Đã thiết lập lịch đồng bộ tự động hàng ngày lúc 7:00 AM (giờ Việt Nam/Bangkok).');

  setInterval(async () => {
    try {
      const tzOffset = 7 * 60 * 60 * 1000; // Asia/Bangkok (UTC+7)
      const bkkTime = new Date(Date.now() + tzOffset);
      const hours = bkkTime.getUTCHours();
      const minutes = bkkTime.getUTCMinutes();
      const dayStr = bkkTime.toISOString().split('T')[0]; // yyyy-MM-dd

      // Kiểm tra nếu đúng 7h00 sáng (giờ Việt Nam) và chưa chạy trong ngày hôm nay
      if (hours === 7 && minutes === 0 && lastCronRunDay !== dayStr) {
        lastCronRunDay = dayStr;
        console.log(`[AutoSync] Kích hoạt đồng bộ tự động hàng ngày lúc 7:00 AM (giờ Việt Nam) ngày ${dayStr}...`);
        
        let googleTokenToUse: string | null = null;
        try {
          const configSnap = await adminDb.collection('systemConfig').doc('main').get();
          if (configSnap.exists) {
            const configData = configSnap.data();
            // Nếu có thiết lập tắt tự động đồng bộ thì dừng lại
            if (configData?.autoSyncEnabled === false) {
              console.log('[AutoSync] Tự động đồng bộ đang bị tắt trong cấu hình hệ thống.');
              return;
            }
            googleTokenToUse = configData?.lastGoogleAccessToken || null;
            console.log('[AutoSync] Lấy Google Access Token dự phòng:', googleTokenToUse ? 'Thành công' : 'Không có token');
          }
        } catch (dbErr: any) {
          console.error('[AutoSync] Không thể lấy cấu hình từ Firestore:', dbErr.message);
        }

        const results = await SyncEngine.syncAllChannels(googleTokenToUse, `auto-${dayStr}`);
        console.log(`[AutoSync] Hoàn tất đồng bộ tự động hàng ngày:`, JSON.stringify(results));
      }
    } catch (error: any) {
      console.error('[AutoSync] Lỗi trong quá trình tự động đồng bộ hàng ngày:', error.message);
    }
  }, 60000); // Kiểm tra mỗi phút
}

async function startServer() {
  const app = express();
  const parsedPort = Number.parseInt(process.env.PORT || '3000', 10);
  const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;

  // Allow the deployed GitHub Pages origin (or another explicitly configured
  // frontend origin) to call this API. Local development remains permissive
  // when CORS_ORIGIN is not configured.
  const configuredOrigins = (process.env.CORS_ORIGIN || process.env.APP_URL || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const allowAllOrigins = configuredOrigins.length === 0 || configuredOrigins.includes('*');
  app.set('trust proxy', 1);

  // Middleware for parsing JSON requests
  app.use(express.json());

  // CORS headers
  app.use((req, res, next) => {
    const requestOrigin = req.headers.origin;
    if (allowAllOrigins) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (requestOrigin && configuredOrigins.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Google-OAuth-Token, X-CRON-SECRET, X-Requested-With',
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Mount API routes BEFORE Vite middleware
  app.use('/api', apiRouter);

  // Khởi động scheduler
  setupAutoSyncScheduler();

  // Vite middleware for development vs static asset serving for production
  if (process.env.NODE_ENV !== 'production') {
    console.log('Khởi chạy server ở chế độ PHÁT TRIỂN (Vite mode)...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log('Khởi chạy server ở chế độ PRODUCTION...');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Lỗi khởi động server:', error);
});
