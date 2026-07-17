import 'dotenv/config';
import express from 'express';
import path from 'path';
import net from 'net';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/routes';
import { uploadErrorHandler, uploadRouter } from './server/uploadRoutes';
import { SyncEngine } from './server/sync';
import { adminDb } from './server/firebase';

function setupAutoSyncScheduler() {
  let lastCronRunDay = '';

  console.log('[AutoSync] Đã thiết lập lịch đồng bộ tự động hàng ngày lúc 7:00 AM (giờ Việt Nam/Bangkok).');

  setInterval(async () => {
    try {
      const tzOffset = 7 * 60 * 60 * 1000;
      const bkkTime = new Date(Date.now() + tzOffset);
      const hours = bkkTime.getUTCHours();
      const minutes = bkkTime.getUTCMinutes();
      const dayStr = bkkTime.toISOString().split('T')[0];

      if (hours === 7 && minutes === 0 && lastCronRunDay !== dayStr) {
        lastCronRunDay = dayStr;
        console.log(`[AutoSync] Kích hoạt đồng bộ tự động hàng ngày lúc 7:00 AM (giờ Việt Nam) ngày ${dayStr}...`);

        let googleTokenToUse: string | null = null;
        try {
          const configSnap = await adminDb.collection('systemConfig').doc('main').get();
          if (configSnap.exists) {
            const configData = configSnap.data();
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
        console.log('[AutoSync] Hoàn tất đồng bộ tự động hàng ngày:', JSON.stringify(results));
      }
    } catch (error: any) {
      console.error('[AutoSync] Lỗi trong quá trình tự động đồng bộ hàng ngày:', error.message);
    }
  }, 60000);
}

function isPortAvailable(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

async function findAvailableDevelopmentPort(startPort: number, host = '0.0.0.0'): Promise<number> {
  let port = startPort;
  const maxPort = startPort + 20;

  while (port <= maxPort && !(await isPortAvailable(port, host))) {
    console.log(`[PortCheck] Cổng ${port} đã bị chiếm. Đang kiểm tra cổng ${port + 1}...`);
    port += 1;
  }

  if (port > maxPort) {
    throw new Error(`Không tìm được cổng trống trong khoảng ${startPort}-${maxPort}.`);
  }

  return port;
}

async function startServer() {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';
  const parsedPort = Number.parseInt(process.env.PORT || '3000', 10);
  const requestedPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
  const port = isProduction
    ? requestedPort
    : await findAvailableDevelopmentPort(requestedPort, '0.0.0.0');

  const configuredOrigins = (process.env.CORS_ORIGIN || process.env.APP_URL || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const allowAllOrigins = configuredOrigins.includes('*') || (!isProduction && configuredOrigins.length === 0);

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const requestOrigin = req.headers.origin;

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if (allowAllOrigins) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (requestOrigin && configuredOrigins.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-File-Name, X-Google-OAuth-Token, X-CRON-SECRET, X-Requested-With',
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    next();
  });

  app.use(
    '/api/upload',
    express.raw({ type: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], limit: '3mb' }),
    express.json({ limit: '5mb' }),
    uploadRouter,
    uploadErrorHandler,
  );

  app.use('/api', express.json({ limit: '1mb' }), apiRouter);

  app.use(
    '/uploads',
    express.static(path.join(process.cwd(), 'uploads'), {
      maxAge: '365d',
      immutable: true,
      etag: true,
      setHeaders: res => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    }),
  );

  setupAutoSyncScheduler();

  if (!isProduction) {
    console.log('Khởi chạy server ở chế độ PHÁT TRIỂN (Vite mode)...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log('Khởi chạy server ở chế độ PRODUCTION...');
    const distPath = path.join(process.cwd(), 'dist');

    app.use('/assets', express.static(path.join(distPath, 'assets'), {
      maxAge: '365d',
      immutable: true,
      etag: true,
    }));
    app.use(express.static(distPath, { index: false, maxAge: '1h', etag: true }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0');
    server.once('listening', () => {
      console.log(`Server đang chạy nội bộ tại http://127.0.0.1:${port}`);
      resolve();
    });
    server.once('error', reject);
  });
}

startServer().catch(error => {
  console.error('Lỗi khởi động server:', error);
  process.exit(1);
});
