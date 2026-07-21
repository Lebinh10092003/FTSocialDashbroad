import { adminDb } from './firebase';

const EXAMINATION_COLLECTIONS = {
  competitions: 'examinationCompetitions',
  sessions: 'examinationSessions',
  candidates: 'examinationCandidates',
} as const;

// ---- Utility helpers --------------------------------------------------------

function txt(value: unknown) {
  return String(value ?? '').trim();
}

function normalise(value: unknown) {
  return txt(value)
    .toLocaleLowerCase('vi-VN')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}

function contestCodes(value: unknown): string[] {
  return txt(value)
    .split(/[,;]/)
    .map(c => c.trim().toUpperCase())
    .filter(Boolean);
}

function mergeContestCodes(...values: unknown[]): string {
  return [...new Set(values.flatMap(v => contestCodes(v)))].join(', ');
}

const CANDIDATE_IDENTITY_FIELDS = ['name', 'birthDate', 'identity', 'email'] as const;

function sameCandidate(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  // Ưu tiên so khớp bằng CCCD (nếu cả hai có)
  const idA = normalise(a.identity);
  const idB = normalise(b.identity);
  if (idA && idB) return idA === idB;
  // Fallback: so khớp tất cả identity fields cùng lúc
  return CANDIDATE_IDENTITY_FIELDS.every(field => {
    const l = normalise(a[field]);
    const r = normalise(b[field]);
    return l !== '' && l === r;
  });
}

function nextCode(existing: Array<Record<string, unknown>>, offset: number): string {
  const used = new Set(existing.map(c => txt(c.code).toUpperCase()));
  const yr = new Date().getFullYear().toString().slice(-2);
  let seq = offset + 1;
  let candidate = `FT${yr}-${String(seq).padStart(4, '0')}`;
  while (used.has(candidate)) {
    seq += 1;
    candidate = `FT${yr}-${String(seq).padStart(4, '0')}`;
  }
  return candidate;
}

// ---- CSV parser (handles quoted fields containing commas and newlines) ------

function parseCSV(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQ = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const nx = raw[i + 1];

    if (inQ) {
      if (ch === '"') {
        if (nx === '"') { cell += '"'; i++; }
        else inQ = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQ = true;
      } else if (ch === ',') {
        row.push(cell.trim());
        cell = '';
      } else if (ch === '\r' || ch === '\n') {
        row.push(cell.trim());
        cell = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
        if (ch === '\r' && nx === '\n') i++;
      } else {
        cell += ch;
      }
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim());
    if (row.some(c => c !== '')) rows.push(row);
  }
  return rows;
}

// ---- Column index resolver --------------------------------------------------

/**
 * Các tiêu đề cột thực tế trong Google Sheets khảo thí FT:
 * [0]  Dấu thời gian
 * [1]  STT
 * [2]  Họ và tên thí sinh
 * [3]  Số tiền đã nộp
 * [4]  Tình trạng xuất hóa đơn (đã xuất/chưa xuất) - Hà điền
 * [5]  ĐĂNG KÝ THI (Nếu đăng ký 2/3 kỳ thi...)
 * [6]  Học sinh lớp
 * [7]  Ngày/tháng/năm sinh (cú pháp...)
 * [8]  Khối thi
 * [9]  Trường (cú pháp...)
 * [10] Số CCCD
 * [11] Địa chỉ nhà riêng
 * [12] Xã/Phường
 * [13] Tỉnh/ Thành phố
 * [14] Địa chỉ (đầy đủ)
 * [15] Email thí sinh/phụ huynh
 * [16] Tình trạng gửi email xác nhận
 * [17] Số điện thoại người giám hộ
 * [18] Sau khi chuyển khoản... (nộp phí)
 * [19] Ghi chú
 * [20] Cột 1
 */
function resolveColumnIndices(header: string[]): Record<string, number> {
  const n = (h: string) => normalise(h);
  const idx: Record<string, number> = {};

  header.forEach((h, i) => {
    const nh = n(h);
    if (idx.timestamp === undefined && (nh.includes('thoigian') || nh.includes('timestamp'))) idx.timestamp = i;
    else if (idx.stt === undefined && (nh === 'stt' || nh.match(/^s[oô]tt/))) idx.stt = i;
    else if (idx.name === undefined && (nh.includes('hovantenthisinh') || nh.includes('hovaten') || nh.includes('thisinh') || nh.includes('ten'))) idx.name = i;
    else if (idx.amount === undefined && (nh.includes('tien') || nh.includes('sotiendanop') || nh.includes('lephi'))) idx.amount = i;
    else if (idx.invoice === undefined && (nh.includes('hoadon') || nh.includes('hoadien'))) idx.invoice = i;
    else if (idx.contests === undefined && (nh.includes('kythidangky') || nh.includes('dangkythi') || nh.includes('monthi') || nh.includes('dangthi') || nh.includes('contest') || nh.includes('kythi'))) idx.contests = i;
    else if (idx.className === undefined && (nh.includes('hocsinhlop') || nh.includes('lop') && !nh.includes('khoi'))) idx.className = i;
    else if (idx.dob === undefined && (nh.includes('ngaythangnamsinh') || nh.includes('namsinh') || nh.includes('ngaysinh') || nh.includes('dob') || nh.includes('birthday'))) idx.dob = i;
    else if (idx.grade === undefined && (nh.includes('khoithi') || nh.includes('khoi'))) idx.grade = i;
    else if (idx.school === undefined && (nh.includes('truong') && !nh.includes('email'))) idx.school = i;
    else if (idx.cccd === undefined && (nh.includes('cccd') || nh.includes('canchuan') || nh.includes('dinhdanh') || nh.includes('identity') || nh.includes('cmnd'))) idx.cccd = i;
    else if (idx.streetAddress === undefined && (nh.includes('diachinh arial') || nh === 'diachinharieng' || nh.includes('diachi') && nh.length < 15)) idx.streetAddress = i;
    else if (idx.ward === undefined && (nh.includes('xa') || nh.includes('phuong'))) idx.ward = i;
    else if (idx.city === undefined && (nh.includes('tinhthanhpho') || nh.includes('tinh') || nh.includes('thanhpho') || nh.includes('city'))) idx.city = i;
    else if (idx.fullAddress === undefined && (nh === 'diachi' || nh.includes('diachidaydu') || nh.includes('address'))) idx.fullAddress = i;
    else if (idx.email === undefined && nh.includes('email')) idx.email = i;
    else if (idx.emailStatus === undefined && (nh.includes('tinhtranggui') || nh.includes('guiemail'))) idx.emailStatus = i;
    else if (idx.phone === undefined && (nh.includes('dienthoai') || nh.includes('sdt') || nh.includes('phone') || nh.includes('giamho'))) idx.phone = i;
    else if (idx.paymentStatus === undefined && (nh.includes('chuyenkhoan') || nh.includes('noplephi') || nh.includes('tinhtrangnop') || nh.includes('thanhtoan'))) idx.paymentStatus = i;
    else if (idx.note === undefined && (nh.includes('ghichu') || nh.includes('suco') || nh.includes('note'))) idx.note = i;
  });

  // Phát hiện định dạng A-M: nếu số lượng cột <= 15 hoặc cột Kỳ thi đăng ký khớp cột M (chỉ số 12)
  const isAMFormat = header.length <= 15 || idx.contests === 12;

  if (isAMFormat) {
    if (idx.timestamp === undefined) idx.timestamp = 0;
    if (idx.name === undefined) idx.name = 1;
    if (idx.dob === undefined) idx.dob = 2;
    if (idx.className === undefined) idx.className = 3;
    if (idx.school === undefined) idx.school = 4;
    if (idx.city === undefined) idx.city = 5;
    if (idx.phone === undefined) idx.phone = 6;
    if (idx.email === undefined) idx.email = 7;
    if (idx.cccd === undefined) idx.cccd = 8;
    if (idx.fullAddress === undefined) idx.fullAddress = 9;
    if (idx.paymentStatus === undefined) idx.paymentStatus = 10;
    if (idx.note === undefined) idx.note = 11;
    if (idx.contests === undefined) idx.contests = 12;
  } else {
    // Vị trí tuyệt đối mặc định của định dạng cũ
    if (idx.timestamp === undefined) idx.timestamp = 0;
    if (idx.stt === undefined) idx.stt = 1;
    if (idx.name === undefined) idx.name = 2;
    if (idx.amount === undefined) idx.amount = 3;
    if (idx.invoice === undefined) idx.invoice = 4;
    if (idx.contests === undefined) idx.contests = 5;
    if (idx.className === undefined) idx.className = 6;
    if (idx.dob === undefined) idx.dob = 7;
    if (idx.grade === undefined) idx.grade = 8;
    if (idx.school === undefined) idx.school = 9;
    if (idx.cccd === undefined) idx.cccd = 10;
    if (idx.streetAddress === undefined) idx.streetAddress = 11;
    if (idx.ward === undefined) idx.ward = 12;
    if (idx.city === undefined) idx.city = 13;
    if (idx.fullAddress === undefined) idx.fullAddress = 14;
    if (idx.email === undefined) idx.email = 15;
    if (idx.emailStatus === undefined) idx.emailStatus = 16;
    if (idx.phone === undefined) idx.phone = 17;
    if (idx.paymentStatus === undefined) idx.paymentStatus = 18;
    if (idx.note === undefined) idx.note = 19;
  }

  return idx;
}

// ---- Date parser DD/MM/YYYY or D/M/YYYY → YYYY-MM-DD -----------------------

function parseDOB(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, '').replace(/[^0-9/\-.]/g, '');
  const parts = cleaned.split(/[/\-.]/);
  if (parts.length !== 3) return '';

  let day = '', month = '', year = '';
  if (parts[2].length === 4) {
    // D/M/YYYY or DD/MM/YYYY
    day = parts[0].padStart(2, '0');
    month = parts[1].padStart(2, '0');
    year = parts[2];
  } else if (parts[0].length === 4) {
    // YYYY-MM-DD
    year = parts[0];
    month = parts[1].padStart(2, '0');
    day = parts[2].padStart(2, '0');
  } else {
    return '';
  }

  const d = Number(day), m = Number(month), y = Number(year);
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1990 || y > 2025) return '';
  return `${year}-${month}-${day}`;
}

// ---- Sync session totals ----------------------------------------------------

async function syncSessionCandidateTotals() {
  const [sessionSnap, candidateSnap] = await Promise.all([
    adminDb.collection(EXAMINATION_COLLECTIONS.sessions).get(),
    adminDb.collection(EXAMINATION_COLLECTIONS.candidates).get(),
  ]);
  const totals = new Map<string, number>();
  const sessionsByCode = new Map<string, string[]>();

  sessionSnap.docs.forEach(doc => {
    const code = txt(doc.data().code).toUpperCase();
    if (code) sessionsByCode.set(code, [...(sessionsByCode.get(code) ?? []), doc.id]);
  });

  candidateSnap.docs.forEach(doc => {
    const data = doc.data();
    const sessionIds: string[] = Array.isArray(data.sessionIds)
      ? data.sessionIds.filter(Boolean).map(String)
      : [];
    const linked = sessionIds.length
      ? sessionIds
      : contestCodes(data.contests).flatMap(code => sessionsByCode.get(code) ?? []);
    linked.forEach(id => totals.set(id, (totals.get(id) ?? 0) + 1));
  });

  const batch = adminDb.batch();
  sessionSnap.docs.forEach(doc => {
    batch.set(
      adminDb.collection(EXAMINATION_COLLECTIONS.sessions).doc(doc.id),
      { candidates: totals.get(doc.id) ?? 0 },
      { merge: true },
    );
  });
  await batch.commit();
}

// ---- Public API -------------------------------------------------------------

export interface SyncResult {
  success: boolean;
  message: string;
  created: number;
  updated: number;
  total: number;
  timestamp: string;
  headers?: string[];
}

const DEFAULT_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1kqztN_iCeZ9uR1mO7gz9j1TcUt8ZmCdpEv0TagTf4VA/edit?usp=sharing';

function getGoogleSheetCsvUrls(spreadsheetUrl: string): string[] {
  const urls: string[] = [];

  if (spreadsheetUrl.includes('/d/e/')) {
    let pubUrl = spreadsheetUrl;
    if (pubUrl.endsWith('/pubhtml') || pubUrl.endsWith('/pub')) {
      pubUrl = pubUrl.replace(/\/pub(html)?$/, '/pub?output=csv');
    } else if (!pubUrl.includes('output=csv')) {
      pubUrl = pubUrl.split('?')[0] + '/pub?output=csv';
    }
    urls.push(pubUrl);
  }

  const idMatch =
    spreadsheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) ??
    spreadsheetUrl.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  const sheetId = idMatch?.[1] ?? '';

  if (sheetId && sheetId !== 'e') {
    const gidMatch = spreadsheetUrl.match(/[?&#]gid=([0-9]+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';

    urls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`);
    urls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${gidParam ? `&gid=${gidMatch[1]}` : ''}`);
    urls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv${gidParam ? `&gid=${gidMatch[1]}` : ''}`);
  }

  if (urls.length === 0 && (spreadsheetUrl.startsWith('http://') || spreadsheetUrl.startsWith('https://'))) {
    urls.push(spreadsheetUrl);
  }

  return urls;
}

async function syncSingleSheet(
  spreadsheetUrl: string,
  tsVN: string,
  sheetDocId?: string
): Promise<SyncResult> {
  const updateState = async (data: Record<string, any>) => {
    if (sheetDocId) {
      await adminDb.collection('examinationSheets').doc(sheetDocId).set(
        { ...data, lastSyncTime: tsVN, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    }
  };

  try {
    const candidateUrls = getGoogleSheetCsvUrls(spreadsheetUrl);
    if (candidateUrls.length === 0) throw new Error('Đường dẫn Google Sheets không hợp lệ.');

    let raw = '';
    let lastError: Error | null = null;

    for (const csvUrl of candidateUrls) {
      console.log(`[ExamSync] ⬇ Tải CSV cho sheet nguồn: ${csvUrl}`);
      try {
        const res = await fetch(csvUrl, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });

        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `HTTP ${res.status} – Sheet chưa mở quyền truy cập công khai. Vui lòng vào Google Sheet -> Nhấp nút "Chia sẻ" (Share) -> Đổi quyền thành "Bất kỳ ai có đường link" (Anyone with the link can view) hoặc chọn Tệp > Chia sẻ > Xuất bản lên web (Publish to web).`
          );
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} – ${res.statusText}`);
        }

        const text = await res.text();
        const trimmed = text.trim();

        if (
          res.url.includes('accounts.google.com') ||
          res.url.includes('ServiceLogin') ||
          trimmed.startsWith('<!DOCTYPE html') ||
          trimmed.startsWith('<html')
        ) {
          throw new Error(
            `HTTP 401 – Sheet yêu cầu đăng nhập Google (Chưa mở quyền công khai). Vui lòng vào Google Sheet -> Nhấp nút "Chia sẻ" (Share) -> Đổi quyền thành "Bất kỳ ai có đường link" (Anyone with the link can view).`
          );
        }

        if (!trimmed) {
          throw new Error('Google Sheets trả về nội dung trống.');
        }

        raw = text;
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        if (err.message.includes('401') || err.message.includes('403') || err.message.includes('Chia sẻ')) {
          break;
        }
      }
    }

    if (!raw && lastError) throw lastError;

    const grid = parseCSV(raw);
    if (grid.length < 2) throw new Error('Không tìm thấy dữ liệu trong tệp (cần ít nhất 1 dòng tiêu đề + 1 dòng dữ liệu).');

    const headerRow = grid[0];
    const col = resolveColumnIndices(headerRow);
    console.log('[ExamSync] 📋 Bản đồ cột:', col);

    const incoming: Array<Record<string, unknown>> = [];

    for (let ri = 1; ri < grid.length; ri++) {
      const row = grid[ri];
      const name = txt(row[col.name]);
      if (!name) continue;

      const rawDob = txt(row[col.dob]);
      const birthDate = parseDOB(rawDob);

      const rawContests = txt(row[col.contests]);
      const contests = contestCodes(rawContests).join(', ');

      const identity = txt(row[col.cccd]).replace(/\D/g, '');

      const street = txt(row[col.streetAddress]);
      const ward   = txt(row[col.ward]);
      const city   = txt(row[col.city]);
      const full   = txt(row[col.fullAddress]);
      const address = full || [street, ward, city].filter(Boolean).join(', ');

      const amount  = txt(row[col.amount]);
      const invoice = txt(row[col.invoice]);
      const paymentStatus = txt(row[col.paymentStatus]);
      const note    = txt(row[col.note]);

      const achievementParts: string[] = [];
      if (amount) achievementParts.push(`Lệ phí: ${amount}`);
      if (paymentStatus && paymentStatus !== '—') achievementParts.push(paymentStatus);
      if (invoice && invoice !== 'x') achievementParts.push(`HĐ: ${invoice}`);
      const achievement = achievementParts.join(' | ') || 'Đã nộp phí';

      const email = txt(row[col.email]);
      const phone = txt(row[col.phone]).replace(/[^\d+]/g, '');

      const candidate: Record<string, unknown> = {
        name,
        birthDate,
        identity,
        email,
        phone,
        school: txt(row[col.school]),
        className: txt(row[col.className]),
        grade: txt(row[col.grade]),
        city,
        address,
        contests,
        achievement,
        paymentStatus: paymentStatus || 'Đã nộp phí',
        invoice,
        note,
        parent: phone ? `SĐT: ${txt(row[col.phone])}` : '',
        registeredAt: txt(row[col.timestamp]),
        importSource: 'Google Sheets Auto Sync',
        importedAt: tsVN,
      };

      for (const k of Object.keys(candidate)) {
        if (!candidate[k] && candidate[k] !== 0) delete candidate[k];
      }
      candidate.name = name;

      incoming.push(candidate);
    }

    if (incoming.length === 0) {
      await updateState({ status: 'success', created: 0, updated: 0, total: 0, error: null });
      return { success: true, message: 'Không có hồ sơ hợp lệ nào trong tệp.', created: 0, updated: 0, total: 0, timestamp: tsVN };
    }

    const col_ = adminDb.collection(EXAMINATION_COLLECTIONS.candidates);
    const existingSnap = await col_.get();
    const existing: Array<Record<string, unknown>> = existingSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const BATCH_LIMIT = 400;
    let batch = adminDb.batch();
    let opsInBatch = 0;
    let created = 0;
    let updated = 0;

    for (let i = 0; i < incoming.length; i++) {
      const cand = incoming[i];
      const matched = existing.find(e => sameCandidate(e, cand));

      let id: string;
      let merged: Record<string, unknown>;

      if (matched) {
        id = String(matched.id);
        merged = {
          ...matched,
          ...Object.fromEntries(Object.entries(cand).filter(([, v]) => v !== undefined && v !== '')),
          id,
          code: matched.code ?? nextCode(existing, i),
          contests: mergeContestCodes(matched.contests, cand.contests),
          updatedAt: new Date().toISOString(),
          importedAt: tsVN,
        };
        updated++;
      } else {
        const code = nextCode(existing, i);
        id = code;
        merged = { ...cand, id, code, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        existing.push(merged);
        created++;
      }

      merged.sortKey = `${String(merged.name).toLowerCase()}_${String(merged.identity || merged.id)}`;

      batch.set(col_.doc(id), merged, { merge: true });
      opsInBatch++;

      if (opsInBatch >= BATCH_LIMIT) {
        await batch.commit();
        batch = adminDb.batch();
        opsInBatch = 0;
      }
    }
    if (opsInBatch > 0) await batch.commit();

    await syncSessionCandidateTotals();

    await updateState({
      status: 'success',
      created,
      updated,
      total: incoming.length,
      error: null
    });

    return {
      success: true,
      message: `Đồng bộ thành công – Thêm mới: ${created}, Cập nhật: ${updated}, Tổng: ${incoming.length}`,
      created,
      updated,
      total: incoming.length,
      timestamp: tsVN,
    };

  } catch (err: any) {
    const msg = err.message || 'Lỗi không xác định';
    console.error('[ExamSync] ❌ Lỗi khi đồng bộ sheet:', msg);
    await updateState({ status: 'failed', error: msg });
    return { success: false, message: `Lỗi: ${msg}`, created: 0, updated: 0, total: 0, timestamp: tsVN };
  }
}

export async function syncExaminationFromGoogleSheet(
  spreadsheetUrl?: string,
): Promise<SyncResult> {
  const tsVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  console.log(`[ExamSync] ▶ Bắt đầu đồng bộ lúc ${tsVN}`);

  const updateGlobalState = (data: Record<string, unknown>) =>
    adminDb.collection('systemConfig').doc('examination_sync_state').set(
      { ...data, updatedAt: new Date().toISOString() },
      { merge: true },
    );

  // 1. Nếu có URL cụ thể, đồng bộ duy nhất URL đó (thích hợp cho đồng bộ thủ công nhanh từ client)
  if (spreadsheetUrl) {
    const result = await syncSingleSheet(spreadsheetUrl, tsVN);
    await updateGlobalState({
      status: result.success ? 'success' : 'failed',
      lastSyncDate: tsVN.split(' ')[0],
      lastSyncTime: tsVN,
      lastSheetUrl: spreadsheetUrl,
      created: result.created,
      updated: result.updated,
      total: result.total,
      message: result.message,
      error: result.success ? null : result.message,
    });
    return result;
  }

  // 2. Nếu không có URL, tiến hành tải toàn bộ danh sách sheet cấu hình và đồng bộ tất cả
  try {
    const sheetsSnap = await adminDb.collection('examinationSheets').get();
    let sheets = sheetsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

    if (sheets.length === 0) {
      // Seed default sheet
      const defaultSheet = {
        name: 'Google Sheets Khảo thí FT (Mặc định)',
        url: DEFAULT_SHEET_URL,
        status: 'idle',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const docRef = await adminDb.collection('examinationSheets').add(defaultSheet);
      sheets = [{ id: docRef.id, ...defaultSheet }];
    }

    let totalCreated = 0;
    let totalUpdated = 0;
    let totalCandidates = 0;
    let successCount = 0;
    let errorMessages: string[] = [];

    for (const sheet of sheets) {
      console.log(`[ExamSync] 🔄 Đồng bộ sheet: ${sheet.name} (${sheet.url})`);
      await adminDb.collection('examinationSheets').doc(sheet.id).update({
        status: 'running',
        updatedAt: new Date().toISOString()
      });

      const res = await syncSingleSheet(sheet.url, tsVN, sheet.id);
      if (res.success) {
        totalCreated += res.created;
        totalUpdated += res.updated;
        totalCandidates += res.total;
        successCount++;
      } else {
        errorMessages.push(`${sheet.name}: ${res.message}`);
      }
    }

    const statusText = `Đã đồng bộ ${successCount}/${sheets.length} nguồn dữ liệu. (Tổng thêm mới: ${totalCreated}, Cập nhật: ${totalUpdated})`;
    const status = errorMessages.length === sheets.length ? 'failed' : 'success';

    await updateGlobalState({
      status,
      lastSyncDate: tsVN.split(' ')[0],
      lastSyncTime: tsVN,
      created: totalCreated,
      updated: totalUpdated,
      total: totalCandidates,
      message: statusText,
      error: errorMessages.length > 0 ? errorMessages.join('; ') : undefined,
    });

    return {
      success: status === 'success',
      message: statusText,
      created: totalCreated,
      updated: totalUpdated,
      total: totalCandidates,
      timestamp: tsVN
    };

  } catch (err: any) {
    const msg = err.message || 'Lỗi không xác định';
    console.error('[ExamSync] ❌ Lỗi tổng hợp:', msg);
    await updateGlobalState({ status: 'failed', error: msg, lastSyncTime: tsVN });
    return { success: false, message: `Lỗi: ${msg}`, created: 0, updated: 0, total: 0, timestamp: tsVN };
  }
}
