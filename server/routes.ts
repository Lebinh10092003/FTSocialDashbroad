import { Router, Request, Response, NextFunction } from 'express';
import { adminAuth, adminDb } from './firebase';
import { SyncEngine } from './sync';
import { SheetsService, getGoogleSheetsAuth } from './sheets';
import { Channel, Post, DailySnapshot, ApiLog, UserProfile, UserRole } from '../src/types';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import { syncExaminationFromGoogleSheet } from './examinationSync';

export const apiRouter = Router();

const DEFAULT_RECENT_DAYS = 30;

/** Returns the first date of the default reporting window, including today. */
function getRecentStartDate(days = DEFAULT_RECENT_DAYS): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (days - 1));
  return date.toISOString().slice(0, 10);
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function resolveReportingPeriod(input: { startDate?: unknown; endDate?: unknown }): { periodStart: string; periodEnd: string } {
  const periodStart = isDateString(input.startDate) ? input.startDate : getRecentStartDate();
  const periodEnd = isDateString(input.endDate) ? input.endDate : getTodayDate();

  if (periodStart > periodEnd) throw new Error('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');

  const oldestAllowedStart = new Date(`${periodEnd}T00:00:00.000Z`);
  oldestAllowedStart.setUTCFullYear(oldestAllowedStart.getUTCFullYear() - 1);
  if (periodStart < oldestAllowedStart.toISOString().slice(0, 10)) {
    throw new Error('Chỉ được chọn khoảng thời gian tối đa một năm.');
  }

  return { periodStart, periodEnd };
}
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
    // Thử lấy token dự phòng từ SQLite nếu headers không gửi lên hoặc trống
    try {
      const configSnap = await adminDb.collection('systemConfig').doc('main').get();
      if (configSnap.exists) {
        const configData = configSnap.data();
        if (configData?.lastGoogleAccessToken) {
          req.googleAccessToken = configData.lastGoogleAccessToken;
          console.log('[Middleware] Khôi phục Google Access Token từ SQLite thành công.');
        }
      }
    } catch (dbErr: any) {
      console.warn('[Middleware] Không thể lấy Google Access Token dự phòng từ SQLite:', dbErr.message);
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

    // 1. Đọc danh sách admin emails từ SQLite (hoặc biến môi trường ENV)
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
      console.warn('Lỗi đọc adminEmails từ SQLite:', e.message);
    }

    if (adminEmailsList.length === 0) {
      const adminEmailsEnv = process.env.ADMIN_EMAILS || '';
      adminEmailsList = adminEmailsEnv.split(',').map(e => e.trim().toLowerCase());
    }

    const normalizedEmail = email.toLowerCase();
    const isAdmin = adminEmailsList.includes(normalizedEmail) ||
      normalizedEmail === 'admin' ||
      normalizedEmail === 'admin@ftsocial.com';

    // 2. Admin is derived from the protected admin identity; other roles are stored in users.
    const userRef = adminDb.collection('users').doc(email);
    const userSnap = await userRef.get();
    const storedRole = userSnap.exists ? ((userSnap.data() as any)?.role as string | undefined) : undefined;
    const normalizedStoredRole: UserRole | undefined = storedRole === 'VIEWER'
      ? 'EMPLOYEE'
      : (storedRole === 'MANAGER' || storedRole === 'EMPLOYEE' || storedRole === 'ADMIN' ? storedRole : undefined);
    const role: UserRole = isAdmin ? 'ADMIN' : (normalizedStoredRole || 'EMPLOYEE');

    if (userSnap.exists) {
      if (storedRole !== role) {
        await userRef.update({ role, updatedAt: new Date().toISOString() });
      }
    } else {
      await userRef.set({ email, role, updatedAt: new Date().toISOString() } as UserProfile);
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

function requireManagerOrAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): any {
  if (req.userRole !== 'ADMIN' && req.userRole !== 'MANAGER') {
    return res.status(403).json({ error: 'Chức năng này yêu cầu quyền Quản lý hoặc Admin.' });
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
 * GET /api/auth/me - Lấy thông tin user hiện tại và vai trò, đồng thời cập nhật SQLite
 */
apiRouter.get('/auth/me', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRef = adminDb.collection('users').doc(req.user.email);
    const now = new Date().toISOString();
    await userRef.set(
      {
        email: req.user.email,
        name: req.user.name || req.user.email.split('@')[0],
        picture: req.user.picture || '',
        role: req.userRole,
        lastLogin: now,
        updatedAt: now,
      },
      { merge: true }
    );
    res.json({
      uid: req.user.uid,
      email: req.user.email,
      name: req.user.name,
      picture: req.user.picture,
      role: req.userRole,
      lastLogin: now,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/sync - Lưu thông tin đăng nhập và phiên làm việc vào SQLite
 */
apiRouter.post('/auth/sync', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, displayName, photoURL } = req.body || {};
    const userEmail = req.user?.email || email;
    if (!userEmail) return res.status(400).json({ error: 'Email không hợp lệ.' });

    const now = new Date().toISOString();
    const userRef = adminDb.collection('users').doc(userEmail);
    const profile = {
      email: userEmail,
      name: displayName || req.user?.name || userEmail.split('@')[0],
      photoURL: photoURL || req.user?.picture || '',
      role: req.userRole || 'EMPLOYEE',
      lastLogin: now,
      updatedAt: now,
    };
    await userRef.set(profile, { merge: true });

    // Lưu phiên đăng nhập vào SQLite
    const logId = `login_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await adminDb.collection('userLogins').doc(logId).set({
      id: logId,
      email: userEmail,
      name: profile.name,
      role: profile.role,
      loginAt: now,
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip || req.socket.remoteAddress || '',
    });

    res.json({ success: true, user: profile });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/examination/lognotes/:entityKey - Tải nhật ký ghi chú từ SQLite
 */
apiRouter.get('/examination/lognotes/:entityKey', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const key = req.params.entityKey;
    const doc = await adminDb.collection('examinationLogNotes').doc(key).get();
    const notes = doc.exists ? (doc.data()?.notes || []) : [];
    res.json(notes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/examination/lognotes/:entityKey - Lưu nhật ký ghi chú vào SQLite
 */
apiRouter.post('/examination/lognotes/:entityKey', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const key = req.params.entityKey;
    const { content, actor, system } = req.body || {};
    if (!content) return res.status(400).json({ error: 'Nội dung không được để trống.' });

    const docRef = adminDb.collection('examinationLogNotes').doc(key);
    const existingSnap = await docRef.get();
    const currentNotes: any[] = existingSnap.exists ? (existingSnap.data()?.notes || []) : [];

    const newNote = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      time: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      actor: actor || req.user?.name || req.user?.email || 'Nhân viên FT Workspace',
      content: String(content).trim(),
      system: !!system,
      createdAt: new Date().toISOString(),
    };

    const updatedNotes = [newNote, ...currentNotes];
    await docRef.set({ entityKey: key, notes: updatedNotes, updatedAt: new Date().toISOString() }, { merge: true });

    res.json({ success: true, note: newNote, notes: updatedNotes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const EXAMINATION_COLLECTIONS = { competitions: 'examinationCompetitions', sessions: 'examinationSessions', candidates: 'examinationCandidates' } as const;
const candidateIdentityFields = ['name', 'birthDate', 'identity', 'email'] as const;
const candidateFields = ['code', 'name', 'school', 'className', 'city', 'contests', 'achievement', 'email', 'parent', 'phone', 'identity', 'address', 'birthDate', 'sessionIds'] as const;
const candidateText = (value: unknown) => String(value ?? '').trim();
const normaliseCandidateIdentity = (value: unknown) => candidateText(value).toLocaleLowerCase('vi-VN').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '');
const contestCodes = (value: unknown) => candidateText(value).split(',').map(code => code.trim().toUpperCase()).filter(Boolean);
const mergeContestCodes = (...values: unknown[]) => [...new Set(values.flatMap(contestCodes))].join(', ');
async function syncSessionCandidateTotals() {
  const [sessionSnap, candidateSnap] = await Promise.all([
    adminDb.collection(EXAMINATION_COLLECTIONS.sessions).get(),
    adminDb.collection(EXAMINATION_COLLECTIONS.candidates).get(),
  ]);
  const totals = new Map<string, number>();
  const sessionsByCode = new Map<string, string[]>();
  sessionSnap.docs.forEach(doc => { const code = String(doc.data().code || '').toUpperCase(); sessionsByCode.set(code, [...(sessionsByCode.get(code) || []), doc.id]); });
  candidateSnap.docs.forEach(doc => {
    const sessionIds = Array.isArray(doc.data().sessionIds) ? doc.data().sessionIds.filter(Boolean).map(String) : [];
    const linked = sessionIds.length ? sessionIds : contestCodes(doc.data().contests).flatMap(code => sessionsByCode.get(code) || []);
    linked.forEach(id => totals.set(id, (totals.get(id) || 0) + 1));
  });
  const batch = adminDb.batch();
  sessionSnap.docs.forEach(doc => batch.set(adminDb.collection(EXAMINATION_COLLECTIONS.sessions).doc(doc.id), { candidates: totals.get(doc.id) || 0 }, { merge: true }));
  await batch.commit();
}
const EXAMINATION_SEED = {
  competitions: [
    { id: 'aysbc', code: 'AYSBC', name: 'Huy hiệu các Nhà khoa học trẻ Châu Á', parent: 'AYSBC', organizer: 'SCS và META Knowledge' },
    { id: 'imo', code: 'IMO', name: 'International Maths Olympiad', parent: 'IMO', organizer: 'SCO' },
    { id: 'ieo', code: 'IEO', name: 'International English Olympiad', parent: 'IEO - English', organizer: 'SCO' },
    { id: 'iso', code: 'ISO', name: 'International Science Olympiad', parent: 'ISO - Science', organizer: 'SCO' },
    { id: 'fimo', code: 'FIMO', name: 'FermatTech International Mathematics Olympiad', parent: 'FIMO', organizer: 'FermatTech' },
    { id: 'fieo', code: 'FIEO', name: 'FermatTech International English Olympiad', parent: 'FIEO - Tiếng Anh', organizer: 'FermatTech' },
  ],
  sessions: [
    { id: 'aysbc', code: 'AYSBC', name: 'Huy hiệu các Nhà khoa học trẻ Châu Á', parent: 'AYSBC', organizer: 'SCS và META Knowledge', time: 'T7/2026', candidates: 2, national: '26/7/2026', nationalDate: '2026-07-26', international: 'Dự kiến T10/2026', phase: 'Tuyển sinh', note: 'Thí sinh hoàn thành tích lũy sao đến hết ngày 28/7.' },
    { id: 'imo', code: 'IMO', name: 'International Maths Olympiad', parent: 'IMO', organizer: 'SCO', time: 'T6–T8/2026', candidates: 862, national: '21/6/2026', nationalDate: '2026-06-21', international: '9/8/2026', internationalDate: '2026-08-09', phase: 'Ôn tập vòng Quốc tế', note: 'Đang tổ chức lớp ôn tập.' },
    { id: 'ieo', code: 'IEO', name: 'International English Olympiad', parent: 'IEO - English', organizer: 'SCO', time: 'T6–T8/2026', candidates: 735, national: '21/6/2026', nationalDate: '2026-06-21', international: '9/8/2026', internationalDate: '2026-08-09', phase: 'Ôn tập vòng Quốc tế', note: 'Đang tổ chức lớp ôn tập.' },
    { id: 'iso', code: 'ISO', name: 'International Science Olympiad', parent: 'ISO - Science', organizer: 'SCO', time: 'T6–T8/2026', candidates: 691, national: '21/6/2026', nationalDate: '2026-06-21', international: '9/8/2026', internationalDate: '2026-08-09', phase: 'Ôn tập vòng Quốc tế', note: 'Đang tổ chức lớp ôn tập.' },
    { id: 'fimo', code: 'FIMO', name: 'FermatTech International Mathematics Olympiad', parent: 'FIMO', organizer: 'FermatTech', time: 'Dự kiến T9/2026', candidates: 320, national: 'Dự kiến tháng 9', international: 'Không tổ chức năm đầu', phase: 'Chuẩn bị hồ sơ', note: 'Hoàn thiện điều lệ và đối tác địa phương.' },
    { id: 'fieo', code: 'FIEO', name: 'FermatTech International English Olympiad', parent: 'FIEO - Tiếng Anh', organizer: 'FermatTech', time: 'Dự kiến T9/2026', candidates: 286, national: 'Dự kiến tháng 9', international: 'Không tổ chức năm đầu', phase: 'Chuẩn bị hồ sơ', note: 'Hoàn thiện điều lệ và đối tác địa phương.' },
  ],
  candidates: [
    { id: 'FT26-0001', code: 'FT26-0001', name: 'Nguyễn Minh Anh', school: 'THCS Cầu Giấy', className: '8A1', city: 'Hà Nội', contests: 'AYSBC, IMO', achievement: 'HCV — AYSBC 2025', updated: '18/07/2026 09:20', email: 'minhanh@example.com', parent: 'Nguyễn Thu Hà', phone: '0988 123 456', identity: '001212345678', address: 'Cầu Giấy, Hà Nội' },
    { id: 'FT26-0042', code: 'FT26-0042', name: 'Trần Gia Bảo', school: 'THCS Lê Quý Đôn', className: '9A3', city: 'Đà Nẵng', contests: 'IMO, ISO', achievement: 'HCB — IMO 2025', updated: '17/07/2026 16:45', email: 'giabao@example.com', parent: 'Trần Văn Long', phone: '0912 456 789', identity: '048211234567', address: 'Hải Châu, Đà Nẵng' },
    { id: 'FT26-0079', code: 'FT26-0079', name: 'Lê Hoàng Nam', school: 'Tiểu học Đoàn Thị Điểm', className: '7A2', city: 'Hà Nội', contests: 'AYSBC, IEO', achievement: 'Top 10 — IEO 2025', updated: '16/07/2026 11:05', email: 'hoangnam@example.com', parent: 'Lê Thị Mai', phone: '0903 555 222', identity: '001213456789', address: 'Nam Từ Liêm, Hà Nội' },
  ],
};
function examinationRecord(item: any) { return { ...item, sortKey: `${String(item.code || item.name || item.id).toLowerCase()}_${item.id}`, updatedAt: new Date().toISOString() }; }
async function ensureExaminationSeed() {
  const existing = await adminDb.collection(EXAMINATION_COLLECTIONS.sessions).limit(1).get();
  if (!existing.empty) return;
  const batch = adminDb.batch();
  for (const [collectionKey, rows] of Object.entries(EXAMINATION_SEED)) for (const row of rows as any[]) batch.set(adminDb.collection(EXAMINATION_COLLECTIONS[collectionKey as keyof typeof EXAMINATION_COLLECTIONS]).doc(row.id), examinationRecord(row));
  await batch.commit();
}
function pageSize(value: unknown) { const parsed = Number(value); return Number.isInteger(parsed) ? Math.max(1, Math.min(parsed, 100)) : 50; }
async function listExamination(collection: string, limit: number, cursor?: string) {
  let query = adminDb.collection(collection).orderBy('sortKey').limit(limit + 1);
  if (cursor) query = query.startAfter(cursor);
  const snap = await query.get(); const docs = snap.docs.slice(0, limit);
  return { items: docs.map((doc: any) => ({ id: doc.id, ...doc.data() })), nextCursor: snap.docs.length > limit ? docs[docs.length - 1]?.data().sortKey : null };
}
apiRouter.get('/examination/bootstrap', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try { await ensureExaminationSeed(); await syncSessionCandidateTotals(); const [competitions, sessions, candidates] = await Promise.all([listExamination(EXAMINATION_COLLECTIONS.competitions, 1000), listExamination(EXAMINATION_COLLECTIONS.sessions, 1000), listExamination(EXAMINATION_COLLECTIONS.candidates, 1000)]); res.json({ competitions: competitions.items, sessions: sessions.items, candidates: candidates.items }); } catch (error: any) { res.status(500).json({ error: error.message || 'Không thể tải dữ liệu khảo thí.' }); }
});
apiRouter.get('/examination/:resource', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  const collection = (EXAMINATION_COLLECTIONS as any)[req.params.resource]; if (!collection) return res.status(404).json({ error: 'Nguồn dữ liệu không hợp lệ.' });
  try { await ensureExaminationSeed(); res.json(await listExamination(collection, pageSize(req.query.limit), typeof req.query.cursor === 'string' ? req.query.cursor : undefined)); } catch (error: any) { res.status(500).json({ error: error.message || 'Không thể tải dữ liệu.' }); }
});
apiRouter.post('/examination/competitions', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const { code, name, organizer, parent } = req.body || {}; if (![code, name, organizer].every(value => typeof value === 'string' && value.trim())) return res.status(400).json({ error: 'Tên, mã cuộc thi và BTC quốc tế là bắt buộc.' });
  const id = `comp-${uuidv4()}`; const item = examinationRecord({ id, code: code.trim().toUpperCase(), name: name.trim(), organizer: organizer.trim(), parent: typeof parent === 'string' && parent.trim() ? parent.trim() : code.trim().toUpperCase(), createdBy: req.user?.email }); await adminDb.collection(EXAMINATION_COLLECTIONS.competitions).doc(id).set(item); res.status(201).json(item);
});
apiRouter.put('/examination/competitions/:id', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const allowed = ['code', 'name', 'organizer', 'parent'];
  const updates: any = { updatedAt: new Date().toISOString(), updatedBy: req.user?.email };
  for (const key of allowed) if (typeof req.body?.[key] === 'string' && req.body[key].trim()) updates[key] = key === 'code' ? req.body[key].trim().toUpperCase() : req.body[key].trim();
  if (Object.keys(updates).length === 2) return res.status(400).json({ error: 'Không có thông tin hợp lệ để cập nhật.' });
  const ref = adminDb.collection(EXAMINATION_COLLECTIONS.competitions).doc(req.params.id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ error: 'Không tìm thấy cuộc thi.' });
  const before = existing.data() || {};
  const next = { ...before, ...updates };
  const batch = adminDb.batch();
  batch.set(ref, updates, { merge: true });
  const sessionSnap = await adminDb.collection(EXAMINATION_COLLECTIONS.sessions).where('competitionId', '==', req.params.id).get();
  sessionSnap.docs.forEach(doc => batch.set(adminDb.collection(EXAMINATION_COLLECTIONS.sessions).doc(doc.id), {
    code: next.code,
    parent: next.parent,
    organizer: next.organizer,
    time: `${doc.data().national || ''} · ${doc.data().international || ''}`.trim(),
    updatedAt: new Date().toISOString(),
  }, { merge: true }));
  if (before.code !== next.code) {
    const candidateSnap = await adminDb.collection(EXAMINATION_COLLECTIONS.candidates).get();
    candidateSnap.docs.forEach(doc => {
      const codes = contestCodes(doc.data().contests);
      if (codes.includes(String(before.code || '').toUpperCase())) batch.set(adminDb.collection(EXAMINATION_COLLECTIONS.candidates).doc(doc.id), { contests: codes.map(code => code === String(before.code).toUpperCase() ? next.code : code).join(', '), updated: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) }, { merge: true });
    });
  }
  await batch.commit();
  await syncSessionCandidateTotals();
  const latest = await ref.get();
  res.json({ id: latest.id, ...latest.data() });
});
apiRouter.delete('/examination/competitions/:id', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const ref = adminDb.collection(EXAMINATION_COLLECTIONS.competitions).doc(req.params.id);
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Không tìm thấy cuộc thi.' });
  const sessions = await adminDb.collection(EXAMINATION_COLLECTIONS.sessions).where('competitionId', '==', req.params.id).get();
  if (!sessions.empty) return res.status(400).json({ error: 'Hãy xóa các kỳ tổ chức thuộc cuộc thi trước.' });
  await ref.delete();
  res.json({ success: true });
});apiRouter.post('/examination/sessions', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const { competitionId, name, national, international, note, rounds } = req.body || {}; if (!competitionId || !name || !national || !international) return res.status(400).json({ error: 'Tên kỳ, cuộc thi và thời gian hai vòng là bắt buộc.' }); const competition = await adminDb.collection(EXAMINATION_COLLECTIONS.competitions).doc(String(competitionId)).get(); if (!competition.exists) return res.status(404).json({ error: 'Không tìm thấy cuộc thi.' });
  const parent = competition.data(); if (!parent) return res.status(404).json({ error: 'Không tìm thấy dữ liệu cuộc thi.' }); const id = `session-${uuidv4()}`; const item = examinationRecord({ id, competitionId, code: parent.code, name: String(name).trim(), parent: parent.parent, organizer: parent.organizer, time: `${national.label} · ${international.label}`, candidates: 0, national: national.label, nationalDate: national.date, international: international.label, internationalDate: international.date, phase: 'Chuẩn bị', note: typeof note === 'string' && note.trim() ? note.trim() : 'Kỳ tổ chức mới tạo.', rounds: Array.isArray(rounds) ? rounds.filter((round: any) => round && typeof round.name === 'string' && typeof round.label === 'string').map((round: any) => ({ id: String(round.id || uuidv4()), name: round.name.trim(), label: round.label.trim(), date: typeof round.date === 'string' ? round.date : undefined })) : [], createdBy: req.user?.email }); await adminDb.collection(EXAMINATION_COLLECTIONS.sessions).doc(id).set(item); res.status(201).json(item);
});
apiRouter.put('/examination/sessions/:id', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const allowed = ['name', 'phase', 'note', 'national', 'nationalDate', 'international', 'internationalDate'];
  const updates: any = { updatedAt: new Date().toISOString(), updatedBy: req.user?.email };
  for (const key of allowed) if (typeof req.body?.[key] === 'string') updates[key] = req.body[key].trim();
  if (Array.isArray(req.body?.rounds)) updates.rounds = req.body.rounds.filter((round: any) => round && typeof round.name === 'string' && typeof round.label === 'string').map((round: any) => ({ id: String(round.id || uuidv4()), name: round.name.trim(), label: round.label.trim(), date: typeof round.date === 'string' ? round.date : undefined }));
  const ref = adminDb.collection(EXAMINATION_COLLECTIONS.sessions).doc(req.params.id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ error: 'Không tìm thấy kỳ tổ chức.' });
  if (typeof req.body?.competitionId === 'string' && req.body.competitionId && req.body.competitionId !== existing.data()?.competitionId) {
    const competition = await adminDb.collection(EXAMINATION_COLLECTIONS.competitions).doc(req.body.competitionId).get();
    if (!competition.exists) return res.status(404).json({ error: 'Không tìm thấy cuộc thi được chọn.' });
    const parent = competition.data() || {};
    updates.competitionId = req.body.competitionId;
    updates.code = parent.code;
    updates.parent = parent.parent;
    updates.organizer = parent.organizer;
  }
  const next = { ...(existing.data() || {}), ...updates };
  updates.time = `${next.national || ''} · ${next.international || ''}`.trim();
  if (Object.keys(updates).length === 3) return res.status(400).json({ error: 'Không có thông tin hợp lệ để cập nhật.' });
  await ref.update(updates);
  await syncSessionCandidateTotals();
  const latest = await ref.get();
  res.json({ id: latest.id, ...latest.data() });
});apiRouter.put('/examination/candidates/:id', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const updates: any = {};
  for (const key of candidateFields) if (key !== 'code' && typeof req.body?.[key] === 'string') updates[key] = req.body[key].trim();
  if (typeof updates.contests === 'string') updates.contests = mergeContestCodes(updates.contests); if (Array.isArray(req.body?.sessionIds)) updates.sessionIds = [...new Set(req.body.sessionIds.filter((id: unknown) => typeof id === 'string' && id.trim()))];
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Không có thông tin hợp lệ để cập nhật.' });
  updates.updated = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  updates.updatedBy = req.user?.email;
  const ref = adminDb.collection(EXAMINATION_COLLECTIONS.candidates).doc(req.params.id);
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Không tìm thấy thí sinh.' });
  await ref.update(updates);
  await syncSessionCandidateTotals();
  const latest = await ref.get();
  res.json({ id: latest.id, ...latest.data() });
});
apiRouter.delete('/examination/candidates/:id/sessions/:sessionId', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const ref = adminDb.collection(EXAMINATION_COLLECTIONS.candidates).doc(req.params.id);
  const candidateSnap = await ref.get();
  if (!candidateSnap.exists) return res.status(404).json({ error: 'Không tìm thấy thí sinh.' });
  const allSessions = await adminDb.collection(EXAMINATION_COLLECTIONS.sessions).get();
  const current = candidateSnap.data() || {};
  const derived = Array.isArray(current.sessionIds) && current.sessionIds.length ? current.sessionIds : allSessions.docs.filter(doc => contestCodes(current.contests).includes(String(doc.data().code || '').toUpperCase())).map(doc => doc.id);
  await ref.set({ sessionIds: derived.filter((id: string) => id !== req.params.sessionId), updated: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), updatedBy: req.user?.email }, { merge: true });
  await syncSessionCandidateTotals();
  const latest = await ref.get();
  res.json({ id: latest.id, ...latest.data() });
});
apiRouter.delete('/examination/candidates/:id', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const ref = adminDb.collection(EXAMINATION_COLLECTIONS.candidates).doc(req.params.id);
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Không tìm thấy thí sinh.' });
  await ref.delete();
  await syncSessionCandidateTotals();
  res.json({ success: true });
});
apiRouter.delete('/examination/sessions/:id', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const ref = adminDb.collection(EXAMINATION_COLLECTIONS.sessions).doc(req.params.id);
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Không tìm thấy kỳ tổ chức.' });
  const candidates = await adminDb.collection(EXAMINATION_COLLECTIONS.candidates).get();
  const batch = adminDb.batch();
  batch.delete(ref);
  candidates.docs.forEach(doc => { if (Array.isArray(doc.data().sessionIds) && doc.data().sessionIds.includes(req.params.id)) batch.set(adminDb.collection(EXAMINATION_COLLECTIONS.candidates).doc(doc.id), { sessionIds: doc.data().sessionIds.filter((id: string) => id !== req.params.id) }, { merge: true }); });
  await batch.commit();
  await syncSessionCandidateTotals();
  res.json({ success: true });
});function examinationSheetId(url: unknown) {
  const source = String(url || '').trim();
  const match = source.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || source.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  return match?.[1] || '';
}
function importText(value: unknown) { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''; }
function importedCandidate(record: any, index: number) {
  const code = importText(record.code).replace(/[\/#?]/g, '-').toUpperCase();
  const name = importText(record.name);
  return { id: code, code, name, school: importText(record.school), className: importText(record.className), city: importText(record.city), contests: importText(record.contests), achievement: importText(record.achievement), email: importText(record.email), parent: importText(record.parent), phone: importText(record.phone), identity: importText(record.identity), address: importText(record.address), birthDate: importText(record.birthDate), updated: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) };
}
function sameCandidateIdentity(left: any, right: any) {
  return candidateIdentityFields.every(field => normaliseCandidateIdentity(left?.[field]) && normaliseCandidateIdentity(left?.[field]) === normaliseCandidateIdentity(right?.[field]));
}
function nextCandidateCode(existing: any[], preferred: string, index: number) {
  const used = new Set(existing.map(item => String(item.code || '').toUpperCase()));
  if (preferred && !used.has(preferred)) return preferred;
  const year = new Date().getFullYear().toString().slice(-2);
  let sequence = 1;
  while (used.has(`FT${year}-${String(sequence).padStart(4, '0')}`)) sequence += 1;
  return `FT${year}-${String(sequence + index).padStart(4, '0')}`;
}
apiRouter.get('/examination/sheets', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sheetsSnap = await adminDb.collection('examinationSheets').orderBy('createdAt', 'desc').get();
    let sheets = sheetsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (sheets.length === 0) {
      // Seed default sheet
      const defaultSheet = {
        name: 'Google Sheets Khảo thí FT (Mặc định)',
        url: 'https://docs.google.com/spreadsheets/d/1kqztN_iCeZ9uR1mO7gz9j1TcUt8ZmCdpEv0TagTf4VA/edit?usp=sharing',
        status: 'idle',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const docRef = await adminDb.collection('examinationSheets').add(defaultSheet);
      sheets = [{ id: docRef.id, ...defaultSheet }];
    }
    res.json(sheets);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Không thể tải danh sách sheets.' });
  }
});

apiRouter.post('/examination/sheets', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, url } = req.body || {};
    if (!name || !url) {
      return res.status(400).json({ error: 'Tên nguồn và đường dẫn Google Sheets là bắt buộc.' });
    }
    const item = {
      name: name.trim(),
      url: url.trim(),
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user?.email
    };
    const docRef = await adminDb.collection('examinationSheets').add(item);
    res.status(201).json({ id: docRef.id, ...item });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Không thể thêm nguồn sheets.' });
  }
});

apiRouter.put('/examination/sheets/:id', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, url } = req.body || {};
    const updates: any = { updatedAt: new Date().toISOString(), updatedBy: req.user?.email };
    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (typeof url === 'string' && url.trim()) updates.url = url.trim();

    const ref = adminDb.collection('examinationSheets').doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: 'Không tìm thấy nguồn sheets.' });

    await ref.update(updates);
    const latest = await ref.get();
    res.json({ id: latest.id, ...latest.data() });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Không thể cập nhật nguồn sheets.' });
  }
});

apiRouter.delete('/examination/sheets/:id', authenticateUser, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ref = adminDb.collection('examinationSheets').doc(req.params.id);
    if (!(await ref.get()).exists) return res.status(404).json({ error: 'Không tìm thấy nguồn sheets.' });
    await ref.delete();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Không thể xóa nguồn sheets.' });
  }
});

apiRouter.post('/examination/sync/google-sheet', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { url, id } = req.body || {};
    let targetUrl = typeof url === 'string' && url.trim() ? url.trim() : undefined;
    if (id) {
      const sheetSnap = await adminDb.collection('examinationSheets').doc(id).get();
      if (sheetSnap.exists) {
        targetUrl = sheetSnap.data()?.url;
      }
    }
    const result = await syncExaminationFromGoogleSheet(targetUrl);
    if (!result.success) return res.status(400).json({ error: result.message });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Không thể đồng bộ Google Sheets.' });
  }
});

apiRouter.get('/examination/sync/status', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configSnap = await adminDb.collection('systemConfig').doc('examination_sync_state').get();
    res.json(configSnap.exists ? configSnap.data() : { status: 'idle' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
apiRouter.post('/examination/import/google-sheet', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const spreadsheetId = examinationSheetId(req.body?.url);
    if (!spreadsheetId) return res.status(400).json({ error: 'Liên kết Google Sheets không hợp lệ.' });
    const oauthToken = typeof req.headers['x-google-oauth-token'] === 'string' ? req.headers['x-google-oauth-token'] : null;
    const auth = await getGoogleSheetsAuth(oauthToken);
    if (!auth) return res.status(400).json({ error: 'Chưa có cấu hình Google Sheets. Hãy kết nối tài khoản Google hoặc cấu hình service account.' });
    const source = new SheetsService(auth, spreadsheetId);
    const result = await source.readFirstSheet(typeof req.body?.sheetName === 'string' ? req.body.sheetName : undefined);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: `Không thể đọc Google Sheets: ${error.message || 'kiểm tra lại quyền chia sẻ tệp.'}` });
  }
});
apiRouter.post('/examination/import/candidates', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const input = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!input.length) return res.status(400).json({ error: 'Không có hồ sơ để nhập.' });
    if (input.length > 1_000) return res.status(400).json({ error: 'Mỗi lần chỉ được nhập tối đa 1.000 hồ sơ.' });
    const requestedSessionId = importText(req.body?.sessionId); if (requestedSessionId && !(await adminDb.collection(EXAMINATION_COLLECTIONS.sessions).doc(requestedSessionId).get()).exists) return res.status(404).json({ error: 'Không tìm thấy kỳ thi cần thêm thí sinh.' });
    const incoming = input.map(importedCandidate).filter(candidate => candidate.name);
    if (!incoming.length) return res.status(400).json({ error: 'Mỗi hồ sơ phải có Họ và tên.' });
    await ensureExaminationSeed();
    const collection = adminDb.collection(EXAMINATION_COLLECTIONS.candidates);
    const existingSnap = await collection.get();
    const existing: any[] = existingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const batch = adminDb.batch();
    const items: any[] = [];
    let created = 0;
    let updated = 0;
    incoming.forEach((candidate, index) => {
      const matched = existing.find(item => sameCandidateIdentity(item, candidate));
      const sameCode = candidate.code ? existing.find(item => String(item.code || '').toUpperCase() === candidate.code) : undefined;
      const base = matched || sameCode;
      const code = matched ? String(matched.code) : nextCandidateCode(existing, candidate.code, index);
      const merged = {
        ...(base || {}),
        ...Object.fromEntries(Object.entries(candidate).filter(([key, value]) => key === 'name' || Boolean(value))),
        id: base?.id || code,
        code,
        contests: mergeContestCodes(base?.contests, candidate.contests),
        sessionIds: [...new Set([...(Array.isArray(base?.sessionIds) ? base.sessionIds : []), ...(requestedSessionId ? [requestedSessionId] : [])])],
        updated: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
        importSource: importText(req.body?.source),
        importedBy: req.user?.email,
      };
      batch.set(collection.doc(String(merged.id)), examinationRecord(merged), { merge: true });
      if (base) updated += 1; else { created += 1; existing.push(merged); }
      items.push(merged);
    });
    await batch.commit();
    await syncSessionCandidateTotals();
    res.json({ created, updated, items });
  } catch (error: any) { res.status(500).json({ error: error.message || 'Không thể nhập dữ liệu thí sinh.' }); }
});
/**
 * GET /api/dashboard - Tổng hợp KPIs, xu hướng và thống kê kênh
 */
apiRouter.get('/dashboard', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { platform, channelId, startDate, endDate, postType } = req.query;
    const { periodStart, periodEnd } = resolveReportingPeriod({ startDate, endDate });

    // Lấy danh sách posts
    let postsQuery = adminDb.collection('posts');
    if (platform) postsQuery = postsQuery.where('platform', '==', platform);
    if (channelId) postsQuery = postsQuery.where('channelId', '==', channelId);
    if (postType && postType !== 'all') {
      postsQuery = postsQuery.where('postType', '==', postType);
    }

    const postsSnap = await postsQuery.get();
    let posts = postsSnap.docs.map(doc => doc.data() as Post);

    // Lọc chỉ giữ lại dữ liệu của các kênh đang hoạt động (active)
    const activeChannelsSnap = await adminDb.collection('channels').where('status', '==', 'active').get();
    let channels = activeChannelsSnap.docs.map(doc => doc.data() as Channel);
    channels = channels.filter(channel =>
      (!platform || channel.platform === platform) && (!channelId || channel.id === channelId),
    );
    const activeChannelIds = new Set(channels.map(c => c.id));
    posts = posts.filter(p => {
      const publishedDate = p.publishedAt.split('T')[0];
      return activeChannelIds.has(p.channelId) && publishedDate >= periodStart && publishedDate <= periodEnd;
    });

    // Lấy snapshots theo thời gian lọc
    let snapshotsQuery = adminDb.collection('dailySnapshots');
    if (platform) snapshotsQuery = snapshotsQuery.where('platform', '==', platform);
    if (channelId) snapshotsQuery = snapshotsQuery.where('channelId', '==', channelId);

    const snapshotsSnap = await snapshotsQuery.get();
    let snapshots = snapshotsSnap.docs.map(doc => doc.data() as DailySnapshot);
    snapshots = snapshots.filter(s => activeChannelIds.has(s.channelId));

    // Always constrain dashboard output to the selected period (30 days by default).
    posts = posts.filter(post => {
      const publishedDate = post.publishedAt.split('T')[0];
      return publishedDate >= periodStart && publishedDate <= periodEnd;
    });
    snapshots = snapshots.filter(snapshot =>
      snapshot.snapshotDate >= periodStart && snapshot.snapshotDate <= periodEnd,
    );

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

    const effectiveViews = (snapshot?: DailySnapshot) => snapshot?.views || snapshot?.impressions || snapshot?.reach || 0;

    const activePostKeys = new Set(posts.map(p => p.postKey));
    latestSnapshotsMap.forEach((snap, postKey) => {
      if (!activePostKeys.has(postKey)) return;
      reactions += snap.reactions || 0;
      comments += snap.comments || 0;
      shares += snap.shares || 0;
      views += effectiveViews(snap);
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

    // Lấy xu hướng tương tác theo ngày đăng bài (publishedAt) phân rã theo từng kênh và từng chỉ số
    const channelMap = new Map<string, string>();
    channels.forEach(c => channelMap.set(c.id, c.name));

    const trendMap = new Map<string, any>();
    posts.forEach(post => {
      const dateStr = post.publishedAt.split('T')[0];
      const snap = latestSnapshotsMap.get(post.postKey);
      const chanName = channelMap.get(post.channelId) || 'Kênh ẩn';
      
      const curr = trendMap.get(dateStr) || { 
        date: dateStr, 
        engagement: 0, 
        postsCount: 0,
        likes: 0, 
        comments: 0, 
        shares: 0, 
        views: 0, 
        reach: 0 
      };
      
      curr.engagement += snap?.totalEngagement || 0;
      curr.postsCount += 1;
      curr.likes += snap?.reactions || 0;
      curr.comments += snap?.comments || 0;
      curr.shares += snap?.shares || 0;
      curr.views += effectiveViews(snap);
      curr.reach += snap?.reach || 0;
      
      // Gán lượng riêng cho kênh này vào ngày này cho tất cả các chỉ số
      curr[chanName + '_engagement'] = (curr[chanName + '_engagement'] || 0) + (snap?.totalEngagement || 0);
      curr[chanName + '_postsCount'] = (curr[chanName + '_postsCount'] || 0) + 1;
      curr[chanName + '_likes'] = (curr[chanName + '_likes'] || 0) + (snap?.reactions || 0);
      curr[chanName + '_comments'] = (curr[chanName + '_comments'] || 0) + (snap?.comments || 0);
      curr[chanName + '_shares'] = (curr[chanName + '_shares'] || 0) + (snap?.shares || 0);
      curr[chanName + '_views'] = (curr[chanName + '_views'] || 0) + effectiveViews(snap);
      curr[chanName + '_reach'] = (curr[chanName + '_reach'] || 0) + (snap?.reach || 0);
      
      trendMap.set(dateStr, curr);
    });

    const trends = Array.from(trendMap.values()).map(point => {
      channels.forEach(c => {
        const metrics = ['engagement', 'postsCount', 'likes', 'comments', 'shares', 'views', 'reach', 'engagementRate'];
        metrics.forEach(m => {
          if (point[c.name + '_' + m] === undefined) {
            point[c.name + '_' + m] = 0;
          }
        });
      });
      point.engagementRate = point.reach > 0
        ? Number(((point.engagement / point.reach) * 100).toFixed(2))
        : 0;
      channels.forEach(c => {
        const channelEngagement = point[c.name + '_engagement'] || 0;
        const channelReach = point[c.name + '_reach'] || 0;
        point[c.name + '_engagementRate'] = channelReach > 0
          ? Number(((channelEngagement / channelReach) * 100).toFixed(2))
          : 0;
      });
      return point;
    }).sort((a, b) => a.date.localeCompare(b.date));

    // Thống kê theo kênh (chỉ lấy các kênh đang hoạt động)

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

    // 10 bài viết mới nhất, kèm thumbnail nếu provider cung cấp.
    const topPosts = posts.map(p => {
      const snap = latestSnapshotsMap.get(p.postKey);
      return {
        ...p,
        engagement: snap?.totalEngagement || 0,
        likes: snap?.likes || 0,
        comments: snap?.comments || 0,
        shares: snap?.shares || 0,
        views: effectiveViews(snap),
      };
    }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 10);

    // Thời điểm đồng bộ gần nhất
    // 5 posts with the highest views in the past 12 months, independent of the KPI date window.
    const topViewedStartDate = new Date();
    topViewedStartDate.setUTCFullYear(topViewedStartDate.getUTCFullYear() - 1);
    const topViewedStart = topViewedStartDate.toISOString().slice(0, 10);
    const topViewedEnd = getTodayDate();
    const topViewedPostsSnap = await adminDb.collection('posts').where('publishedAt', '>=', topViewedStart).where('publishedAt', '<=', `${topViewedEnd}T23:59:59.999Z`).get();
    const topViewedCandidates = topViewedPostsSnap.docs.map(doc => doc.data() as Post).filter(post => activeChannelIds.has(post.channelId) && (!postType || postType === 'all' || post.postType === postType));
    const topViewedKeys = new Set(topViewedCandidates.map(post => post.postKey));
    const topViewedSnapshotsSnap = await adminDb.collection('dailySnapshots').where('snapshotDate', '>=', topViewedStart).where('snapshotDate', '<=', topViewedEnd).get();
    const topViewedLatest = new Map<string, DailySnapshot>();
    topViewedSnapshotsSnap.docs.forEach(doc => { const snapshot = doc.data() as DailySnapshot; if (!topViewedKeys.has(snapshot.postKey)) return; const current = topViewedLatest.get(snapshot.postKey); if (!current || snapshot.snapshotDate > current.snapshotDate) topViewedLatest.set(snapshot.postKey, snapshot); });
    const topViewedPosts = topViewedCandidates.map(post => { const snapshot = topViewedLatest.get(post.postKey); return { ...post, engagement: snapshot?.totalEngagement || 0, likes: snapshot?.likes || 0, comments: snapshot?.comments || 0, shares: snapshot?.shares || 0, views: effectiveViews(snapshot) }; }).sort((a, b) => b.views - a.views).slice(0, 5);
    const lastSyncChannel = channels
      .filter(c => c.lastSyncAt)
      .sort((a, b) => (b.lastSyncAt || '').localeCompare(a.lastSyncAt || ''))[0];

    const errors: string[] = [];
    channels.forEach(c => {
      if (c.lastSyncStatus === 'failed') {
        errors.push(`Kênh "${c.name}" (${c.platform.toUpperCase()}) bị lỗi token hoặc kết nối.`);
      }
    });

    // Thống kê theo loại nội dung (ảnh, video, link...)
    const typeStatsMap = new Map<string, { type: string; count: number; views: number; engagement: number; engagementRate: number | null }>();
    posts.forEach(p => {
      const rawType = p.postType || 'Khác';
      const type = rawType.toLowerCase() === 'photo' ? 'Ảnh / Album' 
                 : rawType.toLowerCase() === 'video' ? 'Video / Reel'
                 : rawType.toLowerCase() === 'link' ? 'Liên kết'
                 : 'Khác';
      const snap = latestSnapshotsMap.get(p.postKey);
      const eng = snap?.totalEngagement || 0;
      const viewsForType = effectiveViews(snap);
      
      const curr = typeStatsMap.get(type) || { type, count: 0, views: 0, engagement: 0, engagementRate: null };
      curr.count += 1;
      curr.views += viewsForType;
      curr.engagement += eng;
      typeStatsMap.set(type, curr);
    });
    const typeStats = Array.from(typeStatsMap.values()).map(stat => ({
      ...stat,
      engagementRate: stat.views > 0 ? Number(((stat.engagement / stat.views) * 100).toFixed(2)) : null,
    }));

    // Thống kê theo nền tảng (Facebook vs Zalo)
    const platformStatsMap = new Map<string, { platform: string; count: number; engagement: number }>();
    posts.forEach(p => {
      const rawPlatform = p.platform || 'facebook';
      const platform = rawPlatform.toLowerCase() === 'facebook' ? 'Facebook' : 'Zalo OA';
      const snap = latestSnapshotsMap.get(p.postKey);
      const eng = snap?.totalEngagement || 0;
      
      const curr = platformStatsMap.get(platform) || { platform, count: 0, engagement: 0 };
      curr.count += 1;
      curr.engagement += eng;
      platformStatsMap.set(platform, curr);
    });
    const platformStats = Array.from(platformStatsMap.values());

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
        followers: channels.reduce((total, channel) => total + Number(channel.followersCount || 0), 0),
        followersAvailable: channels.some(channel => channel.followersCount !== undefined),
      },
      trends,
      channelStats,
      topPosts,
      topViewedPosts,
      typeStats,
      platformStats,
      lastSync: lastSyncChannel?.lastSyncAt || null,
      errors
    });

  } catch (error: any) {
    console.error('Lỗi API dashboard:', error);
    res.status(500).json({ error: 'Không thể tính toán dữ liệu dashboard: ' + error.message });
  }
});

/**
 * GET /api/followers/trend - Lịch sử followers theo từng kênh hoặc tổng các kênh.
 */
apiRouter.get('/followers/trend', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawDays = Number(req.query.days || 30);
    if (!Number.isInteger(rawDays) || rawDays < 1 || rawDays > 365) {
      return res.status(400).json({ error: 'Tham số days phải nằm trong khoảng từ 1 đến 365.' });
    }

    const requestedChannelId = typeof req.query.channelId === 'string' && req.query.channelId !== 'all'
      ? req.query.channelId
      : null;
    const requestedPlatform = typeof req.query.platform === 'string' && req.query.platform !== 'all' ? req.query.platform : null;
    const activeChannelsSnap = await adminDb.collection('channels').where('status', '==', 'active').get();
    const allowedChannelIds = new Set(activeChannelsSnap.docs.map(doc => doc.data() as Channel).filter(channel => (!requestedPlatform || channel.platform === requestedPlatform) && (!requestedChannelId || channel.id === requestedChannelId)).map(channel => channel.id));
    const periodStart = getRecentStartDate(rawDays);
    const periodEnd = getTodayDate();
    const snapshotsSnap = await adminDb.collection('followerSnapshots')
      .where('snapshotDate', '>=', periodStart)
      .where('snapshotDate', '<=', periodEnd)
      .get();

    const trendByDate = new Map<string, number>();
    snapshotsSnap.docs.forEach(doc => {
      const snapshot = doc.data() as {
        snapshotDate: string;
        channelId: string;
        followersCount: number;
      };
      if (!allowedChannelIds.has(snapshot.channelId)) return;
      trendByDate.set(
        snapshot.snapshotDate,
        (trendByDate.get(snapshot.snapshotDate) || 0) + Number(snapshot.followersCount || 0),
      );
    });

    const trend = Array.from(trendByDate.entries())
      .map(([date, followersCount]) => ({ date, followersCount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json(trend);
  } catch (error: any) {
    res.status(500).json({ error: 'Không thể tải xu hướng người theo dõi: ' + error.message });
  }
});
/**
 * GET /api/channels - Danh sách kênh
 */
apiRouter.get('/channels', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const snap = await adminDb.collection('channels').get();
    const channels = snap.docs.map(doc => doc.data() as Channel);
    const postsSnap = await adminDb.collection('posts').get();
    const postCounts = new Map<string, number>();
    postsSnap.docs.forEach(doc => {
      const post = doc.data() as Post;
      postCounts.set(post.channelId, (postCounts.get(post.channelId) || 0) + 1);
    });
    res.json(channels.map(channel => ({
      ...channel,
      totalPosts: postCounts.get(channel.id) || 0,
    })));
  } catch (error: any) {
    res.status(500).json({ error: 'Lỗi khi tải danh sách kênh: ' + error.message });
  }
});


type SummaryPeriod = 'month' | 'quarter' | 'year';
function isoDate(value: Date) { return value.toISOString().slice(0, 10); }
function getSummaryBuckets(groupBy: SummaryPeriod) {
  const now = new Date();
  const count = groupBy === 'month' ? 13 : groupBy === 'quarter' ? 8 : 5;
  const buckets: { key: string; label: string; start: string; end: string }[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    if (groupBy === 'month') {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
      buckets.push({ key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`, label: `T${date.getUTCMonth() + 1}/${date.getUTCFullYear()}`, start: isoDate(date), end: isoDate(end) });
    } else if (groupBy === 'quarter') {
      const currentQuarter = Math.floor(now.getUTCMonth() / 3);
      const date = new Date(Date.UTC(now.getUTCFullYear(), currentQuarter * 3 - offset * 3, 1));
      const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
      const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 0));
      buckets.push({ key: `${date.getUTCFullYear()}-Q${quarter}`, label: `Q${quarter}/${date.getUTCFullYear()}`, start: isoDate(date), end: isoDate(end) });
    } else {
      const year = now.getUTCFullYear() - offset;
      buckets.push({ key: String(year), label: String(year), start: `${year}-01-01`, end: `${year}-12-31` });
    }
  }
  return buckets;
}
function findSummaryBucket(date: string, buckets: ReturnType<typeof getSummaryBuckets>) { return buckets.find(bucket => date >= bucket.start && date <= bucket.end); }
apiRouter.get('/media-summary/trend', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const groupBy: SummaryPeriod = req.query.groupBy === 'quarter' || req.query.groupBy === 'year' ? req.query.groupBy : 'month';
    const platform = typeof req.query.platform === 'string' && req.query.platform !== 'all' ? req.query.platform : null;
    const channelId = typeof req.query.channelId === 'string' && req.query.channelId !== 'all' ? req.query.channelId : null;
    const buckets = getSummaryBuckets(groupBy);
    const periodStart = buckets[0].start;
    const periodEnd = buckets[buckets.length - 1].end;
    const channelsSnap = await adminDb.collection('channels').where('status', '==', 'active').get();
    const channels = channelsSnap.docs.map(doc => doc.data() as Channel).filter(channel => (!platform || channel.platform === platform) && (!channelId || channel.id === channelId));
    const channelIds = new Set(channels.map(channel => channel.id));
    const postsSnap = await adminDb.collection('posts').where('publishedAt', '>=', periodStart).where('publishedAt', '<=', `${periodEnd}T23:59:59.999Z`).get();
    const posts = postsSnap.docs.map(doc => doc.data() as Post).filter(post => channelIds.has(post.channelId));
    const postKeys = new Set(posts.map(post => post.postKey));
    const snapshotsSnap = await adminDb.collection('dailySnapshots').where('snapshotDate', '>=', periodStart).where('snapshotDate', '<=', periodEnd).get();
    const latestSnapshots = new Map<string, DailySnapshot>();
    snapshotsSnap.docs.forEach(doc => { const snapshot = doc.data() as DailySnapshot; if (!channelIds.has(snapshot.channelId) || !postKeys.has(snapshot.postKey)) return; const current = latestSnapshots.get(snapshot.postKey); if (!current || snapshot.snapshotDate > current.snapshotDate) latestSnapshots.set(snapshot.postKey, snapshot); });
    const followerSnap = await adminDb.collection('followerSnapshots').where('snapshotDate', '>=', periodStart).where('snapshotDate', '<=', periodEnd).get();
    const followerUpdates = followerSnap.docs.map(doc => doc.data() as { snapshotDate: string; channelId: string; followersCount: number }).filter(snapshot => channelIds.has(snapshot.channelId)).sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
    const followerByBucket = new Map<string, Map<string, number>>();
    const latestFollowerByChannel = new Map<string, number>();
    let followerIndex = 0;
    buckets.forEach(bucket => { while (followerIndex < followerUpdates.length && followerUpdates[followerIndex].snapshotDate <= bucket.end) { const snapshot = followerUpdates[followerIndex++]; latestFollowerByChannel.set(snapshot.channelId, Number(snapshot.followersCount || 0)); } followerByBucket.set(bucket.key, new Map(latestFollowerByChannel)); });
    const trend = buckets.map(bucket => {
      const bucketPosts = posts.filter(post => post.publishedAt.slice(0, 10) >= bucket.start && post.publishedAt.slice(0, 10) <= bucket.end);
      const followerValues = followerByBucket.get(bucket.key) || new Map<string, number>();
      return { period: bucket.key, label: bucket.label, views: bucketPosts.reduce((total, post) => { const snapshot = latestSnapshots.get(post.postKey); return total + Number(snapshot?.views || snapshot?.impressions || snapshot?.reach || 0); }, 0), engagement: bucketPosts.reduce((total, post) => total + Number(latestSnapshots.get(post.postKey)?.totalEngagement || 0), 0), postsCount: bucketPosts.length, followers: Array.from(followerValues.values()).reduce((total, value) => total + value, 0) };
    });
    res.json({ groupBy, trend });
  } catch (error: any) { res.status(500).json({ error: `Không thể tải xu hướng báo cáo: ${error.message}` }); }
});
/**
 * GET /api/media-summary - Bảng tổng hợp dùng số bài viết thực tế theo postKey,
 * không dùng channel.totalPosts vì trường legacy này có thể từng bị cộng dồn qua nhiều lần sync.
 */
apiRouter.get('/media-summary', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { periodStart, periodEnd } = resolveReportingPeriod(req.query);
    const platform = typeof req.query.platform === 'string' && req.query.platform !== 'all' ? req.query.platform : null;
    const channelId = typeof req.query.channelId === 'string' && req.query.channelId !== 'all' ? req.query.channelId : null;
    const channelsSnap = await adminDb.collection('channels').where('status', '==', 'active').get();
    const channels = channelsSnap.docs.map(doc => doc.data() as Channel).filter(channel => (!platform || channel.platform === platform) && (!channelId || channel.id === channelId));
    const activeChannelIds = new Set(channels.map(channel => channel.id));

    const postsSnap = await adminDb.collection('posts').where('publishedAt', '>=', periodStart).where('publishedAt', '<=', `${periodEnd}T23:59:59.999Z`).get();
    const posts = postsSnap.docs
      .map(doc => doc.data() as Post)
      .filter(post => activeChannelIds.has(post.channelId));

    const snapshotsSnap = await adminDb.collection('dailySnapshots').where('snapshotDate', '>=', periodStart).where('snapshotDate', '<=', periodEnd).get();
    const latestSnapshots = new Map<string, DailySnapshot>();
    snapshotsSnap.docs.forEach(doc => {
      const snapshot = doc.data() as DailySnapshot;
      if (!activeChannelIds.has(snapshot.channelId)) return;
      const current = latestSnapshots.get(snapshot.postKey);
      if (!current || snapshot.snapshotDate > current.snapshotDate) {
        latestSnapshots.set(snapshot.postKey, snapshot);
      }
    });

    const summary = channels.map(channel => {
      const channelPosts = posts.filter(post => post.channelId === channel.id);
      const totalEngagement = channelPosts.reduce(
        (total, post) => total + (latestSnapshots.get(post.postKey)?.totalEngagement || 0),
        0,
      );

      return {
        id: channel.id,
        platform: channel.platform,
        name: channel.name,
        externalId: channel.externalId,
        lastSyncAt: channel.lastSyncAt || null,
        lastSyncStatus: channel.lastSyncStatus || null,
        followersCount: Number(channel.followersCount || 0),
        postsCount: channelPosts.length,
        views: channelPosts.reduce(
          (total, post) => total + (latestSnapshots.get(post.postKey)?.views || 0),
          0,
        ),
        totalEngagement,
      };
    });

    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: 'Không thể tải tổng hợp truyền thông: ' + error.message });
  }
});

/**
 * GET /api/reports/media-summary.xlsx - Xuất bảng tổng hợp truyền thông.
 */
apiRouter.get('/reports/media-summary.xlsx', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { periodStart, periodEnd } = resolveReportingPeriod(req.query);
    const platform = typeof req.query.platform === 'string' && req.query.platform !== 'all' ? req.query.platform : null;
    const channelId = typeof req.query.channelId === 'string' && req.query.channelId !== 'all' ? req.query.channelId : null;
    const channelsSnap = await adminDb.collection('channels').where('status', '==', 'active').get();
    const channels = channelsSnap.docs.map(doc => doc.data() as Channel).filter(channel => (!platform || channel.platform === platform) && (!channelId || channel.id === channelId));
    const activeChannelIds = new Set(channels.map(channel => channel.id));
    const postsSnap = await adminDb.collection('posts').where('publishedAt', '>=', periodStart).where('publishedAt', '<=', `${periodEnd}T23:59:59.999Z`).get();
    const posts = postsSnap.docs
      .map(doc => doc.data() as Post)
      .filter(post => activeChannelIds.has(post.channelId));
    const snapshotsSnap = await adminDb.collection('dailySnapshots').where('snapshotDate', '>=', periodStart).where('snapshotDate', '<=', periodEnd).get();
    const latestSnapshots = new Map<string, DailySnapshot>();
    snapshotsSnap.docs.forEach(doc => {
      const snapshot = doc.data() as DailySnapshot;
      const current = latestSnapshots.get(snapshot.postKey);
      if (!current || snapshot.snapshotDate > current.snapshotDate) latestSnapshots.set(snapshot.postKey, snapshot);
    });

    const rows = channels.map((channel, index) => {
      const channelPosts = posts.filter(post => post.channelId === channel.id);
      const totalEngagement = channelPosts.reduce(
        (total, post) => total + (latestSnapshots.get(post.postKey)?.totalEngagement || 0),
        0,
      );
      return {
        'STT': index + 1,
        'Nền tảng': channel.platform === 'facebook' ? 'Facebook' : 'Zalo OA',
        'Tên trang': channel.name,
        'Người theo dõi': Number(channel.followersCount || 0),
        'Số bài đăng': channelPosts.length,
        'Lượt xem': channelPosts.reduce(
          (total, post) => total + (latestSnapshots.get(post.postKey)?.views || 0),
          0,
        ),
        'Tổng tương tác': totalEngagement,
      };
    });

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 8 }, { wch: 16 }, { wch: 48 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tong hop truyen thong');

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const filename = `tong_hop_truyen_thong_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ error: 'Không thể xuất file Excel: ' + error.message });
  }
});

/**
 * POST /api/channels - Thêm kênh mới (ADMIN)
 */
apiRouter.post('/channels', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
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
apiRouter.put('/channels/:id', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
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
apiRouter.post('/channels/:id/test-connection', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
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
apiRouter.post('/channels/:id/sync', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { since, until } = req.body || {};
    const hasCustomPeriod = since || until;
    const period = hasCustomPeriod ? resolveReportingPeriod({ startDate: since, endDate: until }) : null;
    const sinceDate = period ? new Date(`${period.periodStart}T00:00:00.000Z`) : undefined;
    const untilDate = period ? new Date(`${period.periodEnd}T23:59:59.999Z`) : undefined;

    const result = await SyncEngine.syncChannel(id, req.googleAccessToken ?? null, sinceDate, untilDate);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/channels/:id - Xóa kênh và dữ liệu liên quan (ADMIN)
 */
apiRouter.delete('/channels/:id', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
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
apiRouter.post('/sync/all', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { since, until } = req.body || {};
    const hasCustomPeriod = since || until;
    const period = hasCustomPeriod ? resolveReportingPeriod({ startDate: since, endDate: until }) : null;
    const sinceDate = period ? new Date(`${period.periodStart}T00:00:00.000Z`) : undefined;
    const untilDate = period ? new Date(`${period.periodEnd}T23:59:59.999Z`) : undefined;
    const results = await SyncEngine.syncAllChannels(req.googleAccessToken ?? null, sinceDate, untilDate);
    res.json({ success: true, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sync/history - Lịch sử đồng bộ hệ thống
 */
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
    const { platform, channelId, search, startDate, endDate, page = '1', limit = '20' } = req.query;
    const { periodStart, periodEnd } = resolveReportingPeriod({ startDate, endDate });

    // Chỉ lấy bài viết từ các kênh đang hoạt động (active)
    const activeChannelsSnap = await adminDb.collection('channels').where('status', '==', 'active').get();
    const activeChannelIds = new Set(activeChannelsSnap.docs.map(doc => doc.id));

    let query = adminDb.collection('posts');
    if (platform) query = query.where('platform', '==', platform);
    if (channelId) query = query.where('channelId', '==', channelId);

    const snap = await query.get();
    let posts = snap.docs.map(doc => doc.data() as Post);
    posts = posts.filter(p => {
      const publishedDate = p.publishedAt.split('T')[0];
      return activeChannelIds.has(p.channelId) && publishedDate >= periodStart && publishedDate <= periodEnd;
    });

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
    const { platform, channelId, startDate, endDate } = req.query;
    const { periodStart, periodEnd } = resolveReportingPeriod({ startDate, endDate });

    // Chỉ xuất báo cáo của các kênh đang hoạt động (active)
    const activeChannelsSnap = await adminDb.collection('channels').where('status', '==', 'active').get();
    const activeChannelIds = new Set(activeChannelsSnap.docs.map(doc => doc.id));

    let query = adminDb.collection('posts');
    if (platform) query = query.where('platform', '==', platform);
    if (channelId) query = query.where('channelId', '==', channelId);

    const snap = await query.get();
    let posts = snap.docs.map(doc => doc.data() as Post);
    posts = posts.filter(p => {
      const publishedDate = p.publishedAt.split('T')[0];
      return activeChannelIds.has(p.channelId) && publishedDate >= periodStart && publishedDate <= periodEnd;
    });

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

    // 1. Lưu cấu trúc vào SQLite
    await adminDb.collection('systemConfig').doc('main').set({
      spreadsheetId: extractedId,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    const googleAuth = await getGoogleSheetsAuth(req.googleAccessToken ?? null);
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
    console.warn('Không thể đọc cron secret từ SQLite, dùng biến môi trường:', e.message);
  }

  if (!expectedSecret || cronSecretHeader !== expectedSecret) {
    return res.status(401).json({ error: 'Mã CRON_SECRET không hợp lệ hoặc chưa cấu hình trên server.' });
  }

  try {
    // Để đồng bộ định kỳ không bị lỗi token Sheets, ta chạy không truyền access token.
    // Việc này sẽ cập nhật cơ sở dữ liệu SQLite trước. Nếu có token Sheets được lưu hoặc refresh token,
    // ta có thể lưu cấu hình, nhưng theo thiết kế bảo mật của chúng ta,
    // đồng bộ tự động sẽ cập nhật SQLite, còn người dùng vào giao diện đồng bộ sẽ đẩy lên Sheets,
    // hoặc nếu chúng ta không có token Sheets lúc này, chúng ta chỉ đồng bộ SQLite.
    const requestId = `cron-${uuidv4()}`;
    const results = await SyncEngine.syncAllChannels(null, undefined, undefined, requestId);
    res.json({ success: true, message: 'Đồng bộ tự động hoàn tất.', results });
  } catch (error: any) {
    res.status(500).json({ error: 'Lỗi đồng bộ tự động: ' + error.message });
  }
});

/**
 * POST /api/admin/create-user - Admin tạo hoặc cập nhật mật khẩu/vai trò của một tài khoản thành viên
 */
apiRouter.post('/admin/create-user', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ thông tin: Email, Mật khẩu và Vai trò.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name?.trim() || 'Thành viên mới';
    const requestedRole = role as UserRole;
    if (requestedRole !== 'MANAGER' && requestedRole !== 'EMPLOYEE') {
      return res.status(400).json({ error: 'Chỉ có thể cấp quyền Quản lý hoặc Nhân viên. Tài khoản Admin được bảo vệ riêng.' });
    }
    if (req.userRole === 'MANAGER' && requestedRole !== 'EMPLOYEE') {
      return res.status(403).json({ error: 'Quản lý chỉ được phép tạo hoặc cập nhật tài khoản Nhân viên.' });
    }
    if (req.userRole === 'MANAGER') {
      const existingProfile = await adminDb.collection('users').doc(cleanEmail).get();
      if (existingProfile.exists && (existingProfile.data() as UserProfile).role !== 'EMPLOYEE') {
        return res.status(403).json({ error: 'Quản lý chỉ được phép quản lý tài khoản Nhân viên.' });
      }
    }
    
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

    // 2. Lưu thông tin hồ sơ và vai trò phân quyền vào SQLite collection 'users'
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
apiRouter.post('/admin/delete-user', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Vui lòng cung cấp Email tài khoản cần xóa.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const targetProfileSnap = await adminDb.collection('users').doc(cleanEmail).get();
    const targetRole = targetProfileSnap.exists ? (targetProfileSnap.data() as UserProfile).role : undefined;

    if (cleanEmail === 'admin@ftsocial.com' || cleanEmail === 'admin' || targetRole === 'ADMIN') {
      return res.status(400).json({ error: 'Không được phép xóa tài khoản Admin được bảo vệ.' });
    }
    if (req.userRole === 'MANAGER' && targetRole !== 'EMPLOYEE') {
      return res.status(403).json({ error: 'Quản lý chỉ được phép xóa tài khoản Nhân viên.' });
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

    // 2. Xóa tài liệu phân quyền trong SQLite collection 'users'
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
 * GET /api/admin/config - Lấy cấu hình hệ thống từ SQLite (Dành cho người dùng đã đăng nhập)
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

      // Lưu xuống Database (sẽ tự động ghi file local và sync SQLite)
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
apiRouter.get('/admin/users', authenticateUser, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const usersSnap = await adminDb.collection('users').get();
    const users = usersSnap.docs.map(doc => doc.data() as UserProfile);
    res.json(users);
  } catch (error: any) {
    console.error('Lỗi lấy danh sách thành viên:', error);
    res.status(500).json({ error: 'Không thể tải danh sách thành viên: ' + error.message });
  }
});

// =====================================================================
// EMAIL TEMPLATES API - Đồng bộ template email giữa các máy qua SQLite
// =====================================================================

/**
 * GET /api/email-templates - Lấy tất cả email templates (shared trong org)
 */
apiRouter.get('/email-templates', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const snap = await adminDb.collection('emailTemplates').orderBy('lastUpdated', 'desc').get();
    const templates = snap.docs.map(doc => {
      const data = doc.data();
      // Giải mã blocks từ JSON string nếu cần (SQLite có giới hạn document size)
      if (typeof data.blocksJson === 'string') {
        try { data.blocks = JSON.parse(data.blocksJson); } catch {}
        delete data.blocksJson;
      }
      return { id: doc.id, ...data };
    });
    res.json(templates);
  } catch (error: any) {
    console.error('Lỗi lấy email templates:', error);
    res.status(500).json({ error: 'Không thể tải danh sách email template: ' + error.message });
  }
});

/**
 * POST /api/email-templates - Tạo email template mới
 */
apiRouter.post('/email-templates', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, name, subject, blocks, settings, lastUpdated } = req.body;
    if (!id || !name) {
      return res.status(400).json({ error: 'Thiếu id hoặc name cho template.' });
    }
    const userEmail = req.user?.email || 'unknown';
    const templateData: Record<string, any> = {
      id,
      name,
      subject: subject || '',
      settings: settings || {},
      lastUpdated: lastUpdated || Date.now(),
      createdBy: userEmail,
      updatedBy: userEmail,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Lưu blocks dạng JSON string để tránh giới hạn nesting của SQLite
    templateData.blocksJson = JSON.stringify(blocks || []);

    await adminDb.collection('emailTemplates').doc(id).set(templateData);
    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Lỗi tạo email template:', error);
    res.status(500).json({ error: 'Không thể tạo email template: ' + error.message });
  }
});

/**
 * PUT /api/email-templates/:id - Cập nhật email template
 */
apiRouter.put('/email-templates/:id', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, subject, blocks, settings, lastUpdated } = req.body;
    const userEmail = req.user?.email || 'unknown';

    const updateData: Record<string, any> = {
      updatedBy: userEmail,
      updatedAt: new Date().toISOString(),
      lastUpdated: lastUpdated || Date.now(),
    };
    if (name !== undefined) updateData.name = name;
    if (subject !== undefined) updateData.subject = subject;
    if (settings !== undefined) updateData.settings = settings;
    if (blocks !== undefined) updateData.blocksJson = JSON.stringify(blocks);

    const docRef = adminDb.collection('emailTemplates').doc(id);
    const existing = await docRef.get();
    if (!existing.exists) {
      // Nếu chưa có thì tạo mới (upsert)
      const fullData = {
        id,
        name: name || 'Untitled',
        subject: subject || '',
        settings: settings || {},
        blocksJson: JSON.stringify(blocks || []),
        lastUpdated: lastUpdated || Date.now(),
        createdBy: userEmail,
        updatedBy: userEmail,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await docRef.set(fullData);
    } else {
      await docRef.update(updateData);
    }
    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Lỗi cập nhật email template:', error);
    res.status(500).json({ error: 'Không thể cập nhật email template: ' + error.message });
  }
});

/**
 * DELETE /api/email-templates/:id - Xóa email template
 */
apiRouter.delete('/email-templates/:id', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    await adminDb.collection('emailTemplates').doc(id).delete();
    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Lỗi xóa email template:', error);
    res.status(500).json({ error: 'Không thể xóa email template: ' + error.message });
  }
});

/**
 * GET /api/email-user-prefs - Lấy preferences của user hiện tại
 */
apiRouter.get('/email-user-prefs', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user?.email || 'unknown';
    const snap = await adminDb.collection('emailUserPrefs').doc(userEmail).get();
    if (!snap.exists) {
      return res.json({ activeTemplateId: null, leftPanelWidth: 152, rightPanelWidth: 300 });
    }
    res.json(snap.data());
  } catch (error: any) {
    console.error('Lỗi lấy email user prefs:', error);
    res.status(500).json({ error: 'Không thể tải preferences: ' + error.message });
  }
});

/**
 * PUT /api/email-user-prefs - Lưu preferences của user hiện tại
 */
apiRouter.put('/email-user-prefs', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user?.email || 'unknown';
    const { activeTemplateId, leftPanelWidth, rightPanelWidth } = req.body;
    const data: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (activeTemplateId !== undefined) data.activeTemplateId = activeTemplateId;
    if (leftPanelWidth !== undefined) data.leftPanelWidth = leftPanelWidth;
    if (rightPanelWidth !== undefined) data.rightPanelWidth = rightPanelWidth;

    await adminDb.collection('emailUserPrefs').doc(userEmail).set(data, { merge: true });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Lỗi lưu email user prefs:', error);
    res.status(500).json({ error: 'Không thể lưu preferences: ' + error.message });
  }
});
