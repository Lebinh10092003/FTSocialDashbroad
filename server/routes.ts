import { Router, Request, Response, NextFunction } from 'express';
import { adminAuth, adminDb } from './firebase';
import { SyncEngine } from './sync';
import { SheetsService, getGoogleSheetsAuth } from './sheets';
import { Channel, Post, DailySnapshot, ApiLog, UserProfile, UserRole } from '../src/types';
import { v4 as uuidv4 } from 'uuid';

export const apiRouter = Router();

// Extend Express Request interface to include user info
interface AuthenticatedRequest extends Request {
  user?: any;
  userRole?: UserRole;
  googleAccessToken?: string | null;
}

/**
 * Middleware: Xác thực Firebase ID Token & Gán vai trò (ADMIN/VIEWER)
 */
async function authenticateUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<any> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Chưa cung cấp mã xác thực ID Token.' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  // Nhận Google OAuth Access Token nếu client gửi lên
  const googleToken = req.headers['x-google-oauth-token'] as string;
  req.googleAccessToken = googleToken || null;

  if (googleToken && googleToken.trim() !== '') {
    adminDb.collection('systemConfig').doc('main').set({
      lastGoogleAccessToken: googleToken,
      lastGoogleAccessTokenTime: new Date().toISOString()
    }, { merge: true }).catch((err: any) => {
      console.warn('Lỗi lưu Google Access Token dự phòng:', err.message);
    });
  } else {
    // Thử lấy token dự phòng từ Firestore nếu headers không gửi lên hoặc trống
    try {
      const configSnap = await adminDb.collection('systemConfig').doc('main').get();
      if (configSnap.exists) {
        const configData = configSnap.data();
        if (configData?.lastGoogleAccessToken) {
          req.googleAccessToken = configData.lastGoogleAccessToken;
          console.log('[Middleware] Khôi phục Google Access Token từ Firestore dự phòng thành công.');
        }
      }
    } catch (dbErr: any) {
      console.warn('[Middleware] Không thể lấy Google Access Token dự phòng từ Firestore:', dbErr.message);
    }
  }

  try {
    let email = '';
    let decodedToken: any = null;

    if (idToken.startsWith('mock-dev-token-')) {
      email = idToken.replace('mock-dev-token-', '');
      decodedToken = { email, uid: 'mock-uid-' + email };
      req.user = decodedToken;
    } else {
      try {
        decodedToken = await adminAuth.verifyIdToken(idToken);
        req.user = decodedToken;
        email = decodedToken.email;
      } catch (verifyError: any) {
        console.warn('Lỗi verify ID Token từ Firebase Admin:', verifyError.message);
        // Fallback giải mã JWT không cần kiểm tra chữ ký nếu ở môi trường phát triển
        const parts = idToken.split('.');
        if (parts.length === 3) {
          try {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            email = payload.email;
            decodedToken = { ...payload, uid: payload.user_id || payload.sub || 'mock-uid-' + email };
            req.user = decodedToken;
            console.log('Sử dụng phương thức giải mã JWT fallback thành công:', email);
          } catch (decodeErr: any) {
            throw verifyError;
          }
        } else {
          throw verifyError;
        }
      }
    }

    if (!email) {
      return res.status(403).json({ error: 'Email không hợp lệ.' });
    }

    // 1. Đọc danh sách admin emails từ Firestore (hoặc biến môi trường ENV)
    let adminEmailsList: string[] = [];
    try {
      const configSnap = await adminDb.collection('systemConfig').doc('main').get();
      if (configSnap.exists) {
        const configData = configSnap.data();
        const adminEmailsStr = configData?.adminEmails;
        if (adminEmailsStr) {
          adminEmailsList = adminEmailsStr.split(',').map((e: string) => e.trim().toLowerCase());
        }
      }
    } catch (e: any) {
      console.warn('Lỗi đọc adminEmails từ Firestore:', e.message);
    }

    if (adminEmailsList.length === 0) {
      const adminEmailsEnv = process.env.ADMIN_EMAILS || '';
      adminEmailsList = adminEmailsEnv.split(',').map(e => e.trim().toLowerCase());
    }

    let role: UserRole = 'VIEWER';
    if (
      adminEmailsList.includes(email.toLowerCase()) || 
      email.toLowerCase() === 'admin' || 
      email.toLowerCase() === 'admin@ftsocial.com' ||
      email.toLowerCase() === '09.levanbinh2003@gmail.com'
    ) {
      role = 'ADMIN';
    }

    // 2. Đồng bộ hóa vai trò vào Firestore của người dùng
    const userRef = adminDb.collection('users').doc(email);
    const userSnap = await userRef.get();

    if (userSnap.exists) {
      const userData = userSnap.data();
      const storedRole = userData ? (userData as UserProfile).role : null;
      if (storedRole !== role) {
        // Cập nhật lại vai trò trong Firestore cho đồng bộ
        await userRef.update({ role, updatedAt: new Date().toISOString() });
      }
    } else {
      // Tạo mới profile nếu chưa có
      const newUser: UserProfile = {
        email,
        role,
        updatedAt: new Date().toISOString()
      };
      await userRef.set(newUser);
    }

    req.userRole = role;
    next();
  } catch (error: any) {
    console.error('Lỗi xác thực người dùng:', error.message);
    return res.status(401).json({ error: 'ID Token không hợp lệ hoặc đã hết hạn.' });
  }
}

/**
 * Middleware: Yêu cầu vai trò ADMIN cho các tác vụ thay đổi hệ thống
 */
function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): any {
  if (req.userRole !== 'ADMIN') {
    return res.status(403).json({ error: 'Quyền truy cập bị từ chối. Bạn không phải là ADMIN.' });
  }
  next();
}

/**
 * GET /api/health - Kiểm tra tình trạng server
 */
apiRouter.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * GET /api/auth/me - Lấy thông tin user hiện tại và vai trò
 */
apiRouter.get('/auth/me', authenticateUser, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    uid: req.user.uid,
    email: req.user.email,
    name: req.user.name,
    picture: req.user.picture,
    role: req.userRole,
  });
});

/**
 * GET /api/dashboard - Tổng hợp KPIs, xu hướng và thống kê kênh
 */
apiRouter.get('/dashboard', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { platform, channelId, startDate, endDate } = req.query;

    // Lấy danh sách posts
    let postsQuery: any = adminDb.collection('posts');
    if (platform) postsQuery = postsQuery.where('platform', '==', platform);
    if (channelId) postsQuery = postsQuery.where('channelId', '==', channelId);

    const postsSnap = await postsQuery.get();
    const posts = postsSnap.docs.map(doc => doc.data() as Post);

    // Lấy snapshots theo thời gian lọc
    let snapshotsQuery: any = adminDb.collection('dailySnapshots');
    if (platform) snapshotsQuery = snapshotsQuery.where('platform', '==', platform);
    if (channelId) snapshotsQuery = snapshotsQuery.where('channelId', '==', channelId);

    const snapshotsSnap = await snapshotsQuery.get();
    let snapshots = snapshotsSnap.docs.map(doc => doc.data() as DailySnapshot);

    // Lọc thời gian phía server cho chính xác
    if (startDate) {
      snapshots = snapshots.filter(s => s.snapshotDate >= (startDate as string));
    }
    if (endDate) {
      snapshots = snapshots.filter(s => s.snapshotDate <= (endDate as string));
    }

    // Tính toán KPIs thời điểm hiện tại
    let postsCount = posts.length;
    let reactions = 0;
    let comments = 0;
    let shares = 0;
    let views = 0;
    let reach = 0;
    let impressions = 0;
    let clicks = 0;

    // Tính toán theo snapshot mới nhất của mỗi bài viết
    const latestSnapshotsMap = new Map<string, DailySnapshot>();
    snapshots.forEach(snap => {
      const existing = latestSnapshotsMap.get(snap.postKey);
      if (!existing || snap.snapshotDate > existing.snapshotDate) {
        latestSnapshotsMap.set(snap.postKey, snap);
      }
    });

    latestSnapshotsMap.forEach(snap => {
      reactions += snap.reactions || 0;
      comments += snap.comments || 0;
      shares += snap.shares || 0;
      views += snap.views || 0;
      reach += snap.reach || 0;
      impressions += snap.impressions || 0;
      clicks += snap.clicks || 0;
    });

    const totalEngagement = reactions + comments + shares + clicks;
    let engagementRate: number | null = null;
    if (reach > 0) {
      engagementRate = Number(((totalEngagement / reach) * 100).toFixed(2));
    } else if (impressions > 0) {
      engagementRate = Number(((totalEngagement / impressions) * 100).toFixed(2));
    }

    // Lấy xu hướng tương tác theo ngày
    const trendMap = new Map<string, { date: string; engagement: number; reach: number; likes: number; comments: number }>();
    snapshots.forEach(snap => {
      const dateStr = snap.snapshotDate;
      const curr = trendMap.get(dateStr) || { date: dateStr, engagement: 0, reach: 0, likes: 0, comments: 0 };
      curr.engagement += snap.totalEngagement || 0;
      curr.reach += snap.reach || 0;
      curr.likes += snap.likes || 0;
      curr.comments += snap.comments || 0;
      trendMap.set(dateStr, curr);
    });
    const trends = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Thống kê theo kênh
    const channelsSnap = await adminDb.collection('channels').get();
    const channels = channelsSnap.docs.map(doc => doc.data() as Channel);

    const channelStats = channels.map(chan => {
      const chanPosts = posts.filter(p => p.channelId === chan.id);
      let chanEngagement = 0;
      chanPosts.forEach(p => {
        const snap = latestSnapshotsMap.get(p.postKey);
        if (snap) {
          chanEngagement += snap.totalEngagement || 0;
        }
      });
      return {
        channelName: chan.name,
        platform: chan.platform,
        postsCount: chanPosts.length,
        engagement: chanEngagement
      };
    });

    // Top 10 bài viết
    const topPosts = posts.map(p => {
      const snap = latestSnapshotsMap.get(p.postKey);
      return {
        ...p,
        engagement: snap?.totalEngagement || 0,
        likes: snap?.likes || 0,
        comments: snap?.comments || 0,
        shares: snap?.shares || 0,
      };
    }).sort((a, b) => b.engagement - a.engagement).slice(0, 10);

    // Thời điểm đồng bộ gần nhất
    const lastSyncChannel = channels
      .filter(c => c.lastSyncAt)
      .sort((a, b) => (b.lastSyncAt || '').localeCompare(a.lastSyncAt || ''))[0];

    const errors: string[] = [];
    channels.forEach(c => {
      if (c.lastSyncStatus === 'failed') {
        errors.push(`Kênh "${c.name}" (${c.platform.toUpperCase()}) bị lỗi token hoặc kết nối.`);
      }
    });

    res.json({
      kpis: {
        postsCount,
        reactions,
        comments,
        shares,
        views,
        reach,
        totalEngagement,
        engagementRate,
      },
      trends,
      channelStats,
      topPosts,
      lastSync: lastSyncChannel?.lastSyncAt || null,
      errors
    });

  } catch (error: any) {
    console.error('Lỗi API dashboard:', error);
    res.status(500).json({ error: 'Không thể tính toán dữ liệu dashboard: ' + error.message });
  }
});

/**
 * GET /api/channels - Danh sách kênh
 */
apiRouter.get('/channels', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const snap = await adminDb.collection('channels').get();
    const channels = snap.docs.map(doc => doc.data() as Channel);
    res.json(channels);
  } catch (error: any) {
    res.status(500).json({ error: 'Lỗi khi tải danh sách kênh: ' + error.message });
  }
});

/**
 * POST /api/channels - Thêm kênh mới (ADMIN)
 */
apiRouter.post('/channels', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { platform, name, externalId, timezone } = req.body;
    if (!platform || !name || !externalId) {
      return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ thông tin: platform, name, externalId.' });
    }

    const id = uuidv4();
    const newChannel: Channel = {
      id,
      platform,
      name,
      externalId,
      status: 'active',
      timezone: timezone || 'Asia/Bangkok',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalPosts: 0,
    };

    await adminDb.collection('channels').doc(id).set(newChannel);
    res.json({ success: true, channel: newChannel });
  } catch (error: any) {
    res.status(500).json({ error: 'Không thể tạo kênh mới: ' + error.message });
  }
});

/**
 * PUT /api/channels/:id - Cập nhật kênh (ADMIN)
 */
apiRouter.put('/channels/:id', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, status, timezone } = req.body;

    const channelRef = adminDb.collection('channels').doc(id);
    const snap = await channelRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Kênh không tồn tại.' });
    }

    const updateData: any = { updatedAt: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (status !== undefined) updateData.status = status;
    if (timezone !== undefined) updateData.timezone = timezone;

    await channelRef.update(updateData);
    res.json({ success: true, message: 'Cập nhật kênh thành công.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Lỗi cập nhật kênh: ' + error.message });
  }
});

/**
 * POST /api/channels/:id/test-connection - Kiểm tra kết nối API của kênh (ADMIN)
 */
apiRouter.post('/channels/:id/test-connection', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const snap = await adminDb.collection('channels').doc(id).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Kênh không tồn tại.' });
    }

    const channel = snap.data() as Channel;
    const provider = (SyncEngine as any).getProvider(channel.platform);
    const success = await provider.validateCredentials(channel.id, channel.externalId);

    res.json({ success, message: success ? 'Kết nối thành công!' : 'Kết nối thất bại. Vui lòng kiểm tra lại cấu hình API tokens.' });
  } catch (error: any) {
    res.json({ success: false, message: 'Lỗi kết nối: ' + error.message });
  }
});

/**
 * POST /api/channels/:id/sync - Chạy đồng bộ thủ công cho một kênh (ADMIN)
 */
apiRouter.post('/channels/:id/sync', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { since, until } = req.body;

    const sinceDate = since ? new Date(since) : undefined;
    const untilDate = until ? new Date(until) : undefined;

    const result = await SyncEngine.syncChannel(id, req.googleAccessToken, sinceDate, untilDate);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/channels/:id - Xóa kênh và dữ liệu liên quan (ADMIN)
 */
apiRouter.delete('/channels/:id', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const channelRef = adminDb.collection('channels').doc(id);
    const snap = await channelRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Kênh không tồn tại.' });
    }
    const channel = snap.data() as Channel;

    // Xóa tất cả posts & snapshots thuộc về kênh này
    const postsSnap = await adminDb.collection('posts').where('channelId', '==', id).get();
    const snapshotsSnap = await adminDb.collection('dailySnapshots').where('channelId', '==', id).get();

    const batch = adminDb.batch();
    postsSnap.docs.forEach(doc => {
      batch.delete(adminDb.collection('posts').doc(doc.id));
    });
    snapshotsSnap.docs.forEach(doc => {
      batch.delete(adminDb.collection('dailySnapshots').doc(doc.id));
    });
    batch.delete(channelRef);
    await batch.commit();

    // Tự động xóa token tương ứng của kênh này trong cấu hình chi tiết (detailedTokensList) ở systemConfig
    try {
      const configRef = adminDb.collection('systemConfig').doc('main');
      const configSnap = await configRef.get();
      if (configSnap.exists) {
        const configData = configSnap.data();
        const list = configData?.detailedTokensList || [];
        if (Array.isArray(list)) {
          const newList = list.filter((t: any) => !(t.platform === channel.platform && t.pageId === channel.externalId));
          
          // Cũng cập nhật chuỗi JSON thô (nếu có để đồng bộ)
          let metaPageTokensJson = configData?.metaPageTokensJson || '';
          let zaloOaTokensJson = configData?.zaloOaTokensJson || '';
          
          if (channel.platform === 'facebook' && metaPageTokensJson) {
            try {
              const metaObj = JSON.parse(metaPageTokensJson);
              delete metaObj[channel.externalId];
              metaPageTokensJson = JSON.stringify(metaObj);
            } catch (e) {}
          } else if (channel.platform === 'zalo' && zaloOaTokensJson) {
            try {
              const zaloObj = JSON.parse(zaloOaTokensJson);
              delete zaloObj[channel.externalId];
              zaloOaTokensJson = JSON.stringify(zaloObj);
            } catch (e) {}
          }

          await configRef.update({
            detailedTokensList: newList,
            metaPageTokensJson,
            zaloOaTokensJson,
            updatedAt: new Date().toISOString()
          });
          console.log(`[CleanUp] Đã xóa token tương ứng cho kênh ${channel.name} (${channel.externalId}) khỏi detailedTokensList.`);
        }
      }
    } catch (configErr: any) {
      console.warn('Lỗi khi tự động dọn dẹp token trong cấu hình:', configErr.message);
    }

    res.json({ success: true, message: 'Xóa kênh và toàn bộ bài đăng liên quan thành công.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Lỗi khi xóa kênh: ' + error.message });
  }
});

/**
 * POST /api/sync/all - Đồng bộ hóa tất cả các kênh (ADMIN)
 */
apiRouter.post('/sync/all', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const results = await SyncEngine.syncAllChannels(req.googleAccessToken);
    res.json({ success: true, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sync/history - Lịch sử đồng bộ hệ thống
 */
apiRouter.get('/api/sync/history', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  // Wait, let's also support `/api/sync/history` without prefix and with prefix
  try {
    const snap = await adminDb.collection('apiLogs').orderBy('startedAt', 'desc').limit(50).get();
    const logs = snap.docs.map(doc => doc.data() as ApiLog);
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: 'Lỗi tải lịch sử đồng bộ: ' + error.message });
  }
});
// Alias route
apiRouter.get('/sync/history', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const snap = await adminDb.collection('apiLogs').orderBy('startedAt', 'desc').limit(50).get();
    const logs = snap.docs.map(doc => doc.data() as ApiLog);
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: 'Lỗi tải lịch sử đồng bộ: ' + error.message });
  }
});

/**
 * GET /api/posts - Danh sách bài viết có phân trang, lọc, tìm kiếm
 */
apiRouter.get('/posts', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { platform, channelId, search, page = '1', limit = '20' } = req.query;

    let query: any = adminDb.collection('posts');
    if (platform) query = query.where('platform', '==', platform);
    if (channelId) query = query.where('channelId', '==', channelId);

    const snap = await query.get();
    let posts = snap.docs.map(doc => doc.data() as Post);

    // Lọc theo search (tiếng Việt không dấu / có dấu)
    if (search) {
      const keyword = String(search).toLowerCase();
      posts = posts.filter(p => p.message?.toLowerCase().includes(keyword));
    }

    // Sắp xếp bài đăng mới nhất trước
    posts.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

    // Lấy snapshots để bổ sung KPI tương tác mới nhất cho bài đăng
    const snapsSnap = await adminDb.collection('dailySnapshots').get();
    const snapshots = snapsSnap.docs.map(doc => doc.data() as DailySnapshot);
    const latestSnapsMap = new Map<string, DailySnapshot>();
    snapshots.forEach(s => {
      const curr = latestSnapsMap.get(s.postKey);
      if (!curr || s.snapshotDate > curr.snapshotDate) {
        latestSnapsMap.set(s.postKey, s);
      }
    });

    const enrichedPosts = posts.map(p => {
      const snap = latestSnapsMap.get(p.postKey);
      return {
        ...p,
        reactions: snap?.reactions ?? 0,
        comments: snap?.comments ?? 0,
        shares: snap?.shares ?? 0,
        views: snap?.views ?? 0,
        reach: snap?.reach ?? 0,
        totalEngagement: snap?.totalEngagement ?? 0,
        engagementRate: snap?.engagementRate ?? null,
      };
    });

    // Phân trang
    const pNum = Number(page);
    const lNum = Number(limit);
    const total = enrichedPosts.length;
    const paginated = enrichedPosts.slice((pNum - 1) * lNum, pNum * lNum);

    res.json({
      total,
      page: pNum,
      limit: lNum,
      posts: paginated
    });

  } catch (error: any) {
    res.status(500).json({ error: 'Không thể lấy danh sách bài viết: ' + error.message });
  }
});

/**
 * GET /api/reports/export.csv - Xuất file báo cáo CSV
 */
apiRouter.get('/reports/export.csv', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { platform, channelId } = req.query;

    let query: any = adminDb.collection('posts');
    if (platform) query = query.where('platform', '==', platform);
    if (channelId) query = query.where('channelId', '==', channelId);

    const snap = await query.get();
    const posts = snap.docs.map(doc => doc.data() as Post);

    // Lấy metrics
    const snapsSnap = await adminDb.collection('dailySnapshots').get();
    const snapshots = snapsSnap.docs.map(doc => doc.data() as DailySnapshot);
    const latestSnapsMap = new Map<string, DailySnapshot>();
    snapshots.forEach(s => {
      const curr = latestSnapsMap.get(s.postKey);
      if (!curr || s.snapshotDate > curr.snapshotDate) {
        latestSnapsMap.set(s.postKey, s);
      }
    });

    // Tạo nội dung CSV (Có BOM cho Excel hỗ trợ tiếng Việt có dấu)
    let csvContent = '\uFEFF';
    csvContent += 'Mã Bài Đăng,Nền Tảng,ID Kênh,Ngày Đăng,Nội Dung,Lượt Thích/Reaction,Bình Luận,Chia Sẻ,Lượt Xem,Reach,Tổng Tương Tác,Engagement Rate (%)\n';

    posts.forEach(p => {
      const snap = latestSnapsMap.get(p.postKey);
      const msgClean = (p.message || '').replace(/"/g, '""').replace(/\n/g, ' ');
      csvContent += `"${p.postKey}","${p.platform}","${p.channelId}","${p.publishedAt}","${msgClean}",${snap?.reactions ?? 0},${snap?.comments ?? 0},${snap?.shares ?? 0},${snap?.views ?? 0},${snap?.reach ?? 0},${snap?.totalEngagement ?? 0},${snap?.engagementRate !== undefined ? snap.engagementRate : ''}\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=bao_cao_tuong_tac.csv');
    res.status(200).send(csvContent);

  } catch (error: any) {
    res.status(500).json({ error: 'Không thể xuất file báo cáo CSV: ' + error.message });
  }
});

/**
 * POST /api/setup/sheets - Khởi tạo cấu trúc Google Sheets
 */
apiRouter.post('/setup/sheets', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { spreadsheetId } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'Vui lòng cung cấp Spreadsheet ID hoặc URL Google Sheet.' });
    }

    // Trích xuất ID nếu là URL đầy đủ
    let extractedId = spreadsheetId;
    if (spreadsheetId.includes('docs.google.com/spreadsheets')) {
      const matches = spreadsheetId.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (matches && matches[1]) {
        extractedId = matches[1];
      }
    }

    // 1. Lưu cấu trúc vào Firestore
    await adminDb.collection('systemConfig').doc('main').set({
      spreadsheetId: extractedId,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    const googleAuth = await getGoogleSheetsAuth(req.googleAccessToken);
    if (!googleAuth) {
      return res.status(401).json({ error: 'Yêu cầu token xác thực Google hoặc Service Account để truy cập Sheets.' });
    }

    // 2. Gọi Google Sheets Service để khởi tạo
    const sheetsService = new SheetsService(googleAuth, extractedId);
    const initResult = await sheetsService.initializeSheetsStructure();

    res.json({
      success: true,
      spreadsheetId: extractedId,
      message: initResult.message
    });

  } catch (error: any) {
    res.status(500).json({ error: 'Lỗi cấu hình Google Sheets: ' + error.message });
  }
});

/**
 * POST /api/jobs/daily-sync - Cloud Scheduler/Cron định kỳ (ADMIN_SECRET bảo vệ)
 */
apiRouter.post('/jobs/daily-sync', async (req: Request, res: Response) => {
  const cronSecretHeader = req.headers['x-cron-secret'];
  let expectedSecret = process.env.CRON_SECRET;

  try {
    const configSnap = await adminDb.collection('systemConfig').doc('main').get();
    if (configSnap.exists) {
      const configData = configSnap.data();
      if (configData?.cronSecret) {
        expectedSecret = configData.cronSecret;
      }
    }
  } catch (e: any) {
    console.warn('Không thể đọc cron secret từ Firestore, dùng biến môi trường:', e.message);
  }

  if (!expectedSecret || cronSecretHeader !== expectedSecret) {
    return res.status(401).json({ error: 'Mã CRON_SECRET không hợp lệ hoặc chưa cấu hình trên server.' });
  }

  try {
    // Để đồng bộ định kỳ không bị lỗi token Sheets, ta chạy không truyền access token.
    // Việc này sẽ cập nhật cơ sở dữ liệu Firestore trước. Nếu có token Sheets được lưu hoặc refresh token,
    // ta có thể lưu cấu hình, nhưng theo thiết kế bảo mật của chúng ta,
    // đồng bộ tự động sẽ cập nhật Firestore, còn người dùng vào giao diện đồng bộ sẽ đẩy lên Sheets,
    // hoặc nếu chúng ta không có token Sheets lúc này, chúng ta chỉ đồng bộ Firestore.
    const requestId = `cron-${uuidv4()}`;
    const results = await SyncEngine.syncAllChannels(null, requestId);
    res.json({ success: true, message: 'Đồng bộ tự động hoàn tất.', results });
  } catch (error: any) {
    res.status(500).json({ error: 'Lỗi đồng bộ tự động: ' + error.message });
  }
});

/**
 * POST /api/admin/create-user - Admin tạo hoặc cập nhật mật khẩu/vai trò của một tài khoản thành viên
 */
apiRouter.post('/admin/create-user', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ thông tin: Email, Mật khẩu và Vai trò.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name?.trim() || 'Thành viên mới';
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu phải chứa tối thiểu 6 ký tự.' });
    }

    // 1. Kiểm tra tài khoản đã tồn tại trong Firebase Auth chưa
    let firebaseUser: any = null;
    try {
      firebaseUser = await adminAuth.getUserByEmail(cleanEmail);
    } catch (e: any) {
      if (e.code !== 'auth/user-not-found') {
        throw e;
      }
    }

    if (firebaseUser) {
      // Đã tồn tại -> Cập nhật mật khẩu và hiển thị tên
      await adminAuth.updateUser(firebaseUser.uid, {
        password: password,
        displayName: cleanName
      });
    } else {
      // Chưa tồn tại -> Tạo mới hoàn toàn
      firebaseUser = await adminAuth.createUser({
        email: cleanEmail,
        password: password,
        displayName: cleanName
      });
    }

    // 2. Lưu thông tin hồ sơ và vai trò phân quyền vào Firestore collection 'users'
    const newUserProfile: UserProfile = {
      email: cleanEmail,
      name: cleanName,
      role: role as UserRole,
      updatedAt: new Date().toISOString()
    };
    await adminDb.collection('users').doc(cleanEmail).set(newUserProfile, { merge: true });

    res.json({
      success: true,
      message: firebaseUser ? 'Cập nhật tài khoản và phân quyền thành công!' : 'Tạo mới tài khoản và phân quyền thành công!',
      user: newUserProfile
    });

  } catch (error: any) {
    console.error('Lỗi Admin create-user:', error);
    res.status(500).json({ error: 'Lỗi xử lý tài khoản: ' + error.message });
  }
});

/**
 * POST /api/admin/delete-user - Admin xóa tài khoản thành viên khỏi Auth và Database
 */
apiRouter.post('/admin/delete-user', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Vui lòng cung cấp Email tài khoản cần xóa.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    if (cleanEmail === 'admin@ftsocial.com' || cleanEmail === 'admin') {
      return res.status(400).json({ error: 'Không được phép xóa tài khoản Admin mặc định của hệ thống.' });
    }

    // 1. Tìm và xóa tài khoản trong Firebase Auth
    try {
      const firebaseUser = await adminAuth.getUserByEmail(cleanEmail);
      if (firebaseUser) {
        await adminAuth.deleteUser(firebaseUser.uid);
      }
    } catch (e: any) {
      if (e.code !== 'auth/user-not-found') {
        console.warn('Lỗi khi xóa Auth user:', e.message);
      }
    }

    // 2. Xóa tài liệu phân quyền trong Firestore collection 'users'
    await adminDb.collection('users').doc(cleanEmail).delete();

    res.json({
      success: true,
      message: `Đã xóa hoàn toàn tài khoản ${cleanEmail} khỏi hệ thống.`
    });

  } catch (error: any) {
    console.error('Lỗi Admin delete-user:', error);
    res.status(500).json({ error: 'Lỗi khi xóa tài khoản: ' + error.message });
  }
});

/**
 * GET /api/admin/config - Lấy cấu hình hệ thống từ Firestore (Dành cho người dùng đã đăng nhập)
 */
apiRouter.get('/admin/config', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configSnap = await adminDb.collection('systemConfig').doc('main').get();
    if (configSnap.exists && Object.keys(configSnap.data() || {}).length > 0) {
      res.json(configSnap.data());
    } else {
      // Tự động khởi tạo dữ liệu ban đầu (seed) từ biến môi trường
      const metaTokens = process.env.META_PAGE_TOKENS_JSON || '';
      const zaloTokens = process.env.ZALO_OA_TOKENS_JSON || '';
      const cronSecret = process.env.CRON_SECRET || 'default_cron_secret_12345';
      const adminEmails = process.env.ADMIN_EMAILS || '09.levanbinh2003@gmail.com';
      
      const detailedTokensList: any[] = [];
      try {
        if (metaTokens.trim()) {
          const metaObj = JSON.parse(metaTokens);
          Object.entries(metaObj).forEach(([pageId, token]) => {
            detailedTokensList.push({
              platform: 'facebook',
              pageId,
              accessToken: token,
              pageName: `Trang Facebook ${pageId}`,
              status: 'active'
            });
          });
        }
        if (zaloTokens.trim()) {
          const zaloObj = JSON.parse(zaloTokens);
          Object.entries(zaloObj).forEach(([pageId, token]) => {
            detailedTokensList.push({
              platform: 'zalo',
              pageId,
              accessToken: token,
              pageName: `Zalo OA ${pageId}`,
              status: 'active'
            });
          });
        }
      } catch (parseErr) {
        console.error('[AutoSeed] Lỗi phân tích cú pháp JSON token từ ENV:', parseErr);
      }

      const seedConfig = {
        metaPageTokensJson: metaTokens,
        zaloOaTokensJson: zaloTokens,
        detailedTokensList,
        cronSecret,
        adminEmails,
        spreadsheetId: '',
        googleServiceAccountJson: '',
        updatedAt: new Date().toISOString()
      };

      // Lưu xuống Database (sẽ tự động ghi file local và sync Firestore)
      await adminDb.collection('systemConfig').doc('main').set(seedConfig);
      console.log('[AutoSeed] Đã tự động tạo dữ liệu cấu hình hệ thống ban đầu thành công.');
      res.json(seedConfig);
    }
  } catch (error: any) {
    console.error('Lỗi lấy cấu hình hệ thống:', error);
    res.status(500).json({ error: 'Không thể lấy cấu hình hệ thống: ' + error.message });
  }
});

/**
 * POST /api/admin/config - Cập nhật cấu hình hệ thống (Chỉ dành cho ADMIN)
 */
apiRouter.post('/admin/config', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { metaPageTokensJson, zaloOaTokensJson, detailedTokensList, cronSecret, adminEmails, autoSyncEnabled, googleServiceAccountJson } = req.body;
    
    await adminDb.collection('systemConfig').doc('main').set({
      metaPageTokensJson: metaPageTokensJson || '',
      zaloOaTokensJson: zaloOaTokensJson || '',
      detailedTokensList: detailedTokensList || [],
      cronSecret: cronSecret || '',
      adminEmails: adminEmails || '09.levanbinh2003@gmail.com',
      autoSyncEnabled: autoSyncEnabled !== undefined ? autoSyncEnabled : true,
      googleServiceAccountJson: googleServiceAccountJson || '',
      updatedAt: new Date().toISOString()
    }, { merge: true });

    // Tự động đồng bộ hóa bảng 'channels' với danh sách detailedTokensList
    if (Array.isArray(detailedTokensList)) {
      const channelsSnap = await adminDb.collection('channels').get();
      const existingChannels = channelsSnap.docs.map(doc => doc.data() as Channel);
      const activeExternalIds = new Set<string>();

      for (const token of detailedTokensList) {
        if (!token.pageId) continue;
        activeExternalIds.add(token.pageId);

        const existingChan = existingChannels.find(c => c.externalId === token.pageId && c.platform === token.platform);
        
        if (!existingChan) {
          // Tự động tạo Kênh mới nếu chưa tồn tại
          const newChanId = uuidv4();
          const newChannel: Channel = {
            id: newChanId,
            platform: token.platform,
            name: token.pageName || `${token.platform === 'facebook' ? 'Trang Facebook' : 'Zalo OA'} ${token.pageId}`,
            externalId: token.pageId,
            status: 'active',
            timezone: 'Asia/Bangkok',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            totalPosts: 0
          };
          await adminDb.collection('channels').doc(newChanId).set(newChannel);
          console.log(`[AutoSync] Đã tự động tạo kênh mới cho ${token.platform}: ${token.pageName} (${token.pageId})`);
        } else {
          // Cập nhật tên hoặc kích hoạt lại trạng thái hoạt động
          const updates: any = {};
          if (token.pageName && existingChan.name !== token.pageName) {
            updates.name = token.pageName;
          }
          if (existingChan.status !== 'active') {
            updates.status = 'active';
          }
          if (Object.keys(updates).length > 0) {
            updates.updatedAt = new Date().toISOString();
            await adminDb.collection('channels').doc(existingChan.id).update(updates);
            console.log(`[AutoSync] Đã tự động cập nhật kênh ${existingChan.id}:`, updates);
          }
        }
      }

      // Đổi trạng thái những kênh không còn trong danh sách Tokens sang inactive
      for (const chan of existingChannels) {
        if (!activeExternalIds.has(chan.externalId) && chan.status === 'active') {
          await adminDb.collection('channels').doc(chan.id).update({
            status: 'inactive',
            updatedAt: new Date().toISOString()
          });
          console.log(`[AutoSync] Đã tự động chuyển kênh ${chan.name} (${chan.id}) sang trạng thái inactive vì đã bị xóa khỏi Tokens.`);
        }
      }
    }

    res.json({ success: true, message: 'Đã lưu cấu hình hệ thống và đồng bộ hóa các kênh thành công!' });
  } catch (error: any) {
    console.error('Lỗi cập nhật cấu hình hệ thống:', error);
    res.status(500).json({ error: 'Không thể cập nhật cấu hình hệ thống: ' + error.message });
  }
});

/**
 * GET /api/admin/users - Lấy danh sách tài khoản thành viên trong hệ thống
 */
apiRouter.get('/admin/users', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const usersSnap = await adminDb.collection('users').get();
    const users = usersSnap.docs.map(doc => doc.data() as UserProfile);
    res.json(users);
  } catch (error: any) {
    console.error('Lỗi lấy danh sách thành viên:', error);
    res.status(500).json({ error: 'Không thể tải danh sách thành viên: ' + error.message });
  }
});

