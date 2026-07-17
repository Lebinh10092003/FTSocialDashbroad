import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/routes';
import { uploadErrorHandler, uploadRouter } from './server/uploadRoutes';
import { SyncEngine } from './server/sync';
import { adminDb } from './server/firebase';
import net from 'net';

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

        const results = await SyncEngine.syncAllChannels(googleTokenToUse, undefined, undefined, `auto-${dayStr}`);
        console.log(`[AutoSync] Hoàn tất đồng bộ tự động hàng ngày:`, JSON.stringify(results));
      }
    } catch (error: any) {
      console.error('[AutoSync] Lỗi trong quá trình tự động đồng bộ hàng ngày:', error.message);
    }
  }, 60000); // Kiểm tra mỗi phút
}

function isPortAvailable(port: number, host: string = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, host);
  });
}

async function findAvailablePort(startPort: number, host: string = '0.0.0.0'): Promise<number> {
  let port = startPort;
  while (!(await isPortAvailable(port, host))) {
    console.log(`[PortCheck] Cổng ${port} đã bị chiếm. Đang kiểm tra cổng ${port + 1}...`);
    port++;
  }
  return port;
}

async function startServer() {
  const app = express();
  const parsedPort = Number.parseInt(process.env.PORT || '3000', 10);
  const requestedPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
  const PORT = await findAvailablePort(requestedPort, '0.0.0.0');

  // Allow the deployed GitHub Pages origin (or another explicitly configured
  // frontend origin) to call this API. Local development remains permissive
  // when CORS_ORIGIN is not configured.
  const configuredOrigins = (process.env.CORS_ORIGIN || process.env.APP_URL || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const allowAllOrigins = configuredOrigins.length === 0 || configuredOrigins.includes('*');
  app.set('trust proxy', 1);

  // CORS headers must be applied before body parsers so upload errors also return usable responses.
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

  // Email images are sent as Base64. A 3MB image expands to roughly 4MB in JSON,
  // therefore this endpoint needs a larger, isolated body limit.
  app.use('/api/upload', express.json({ limit: '5mb' }), uploadRouter, uploadErrorHandler);

  // Keep the remaining API payload limit conservative.
  app.use('/api', express.json({ limit: '1mb' }), apiRouter);

  // Serve uploaded email builder images statically
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

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
