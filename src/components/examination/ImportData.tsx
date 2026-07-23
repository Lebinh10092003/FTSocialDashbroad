import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CheckCircle2, Download, FileSpreadsheet, Link2, LoaderCircle,
  UploadCloud, RefreshCw, Clock, AlertCircle, Zap, CalendarCheck,
  Trash2, Pencil, Plus,
} from 'lucide-react';
import type { Candidate, ExaminationSession } from './types';
import { normaliseBirthDate } from './ui';

type ImportRow = Record<string, unknown>;
type Props = {
  idToken?: string | null;
  googleAccessToken?: string | null;
  canImport: boolean;
  sessionId?: string;
  sessions: ExaminationSession[];
  onImported: (items: Candidate[]) => void;
};

interface SyncState {
  status?: 'success' | 'failed' | 'running' | 'idle';
  lastSyncTime?: string;
  lastSyncDate?: string;
  created?: number;
  updated?: number;
  total?: number;
  error?: string;
}

interface SheetSource {
  id: string;
  name: string;
  url: string;
  status?: 'success' | 'failed' | 'running' | 'idle';
  lastSyncTime?: string;
  created?: number;
  updated?: number;
  total?: number;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  sessionId?: string;
  sheetTab?: string;
  stage?: string;
}

// ─── Cột & alias cho import từ file ──────────────────────────────────────────
// Mẫu chính thức có 2 hàng tiêu đề: nhóm thông tin và tên cột.
const previewGroups = [
  { label: 'HỒ SƠ THÍ SINH', columns: ['STT', 'Mã hồ sơ', 'Họ và tên thí sinh', 'Ngày sinh', 'Số CCCD/Hộ chiếu', 'Quốc tịch', 'Họ tên phụ huynh', 'Số điện thoại liên lạc', 'Email liên lạc', 'Tỉnh/Thành phố cư trú', 'Xã/phường', 'Địa chỉ liên hệ', 'Tên trường', 'Lớp đang học', 'Khối lớp hiện tại'] },
  { label: 'THÔNG TIN ĐĂNG KÝ', columns: ['Môn thi/Lĩnh vực', 'Bảng thi/Category', 'Hình thức đăng ký', 'Tên đội/Nhóm', 'Ngôn ngữ thi', 'Ghi chú chung'] },
  { label: 'VÒNG 1', columns: ['Điều kiện tham gia', 'Số báo danh (SBD)', 'Ngày thi', 'Giờ/Ca thi', 'Hình thức thi', 'Địa điểm/Phòng thi', 'Link thi', 'Tài khoản/Mã truy cập', 'Mật khẩu', 'Trạng thái dự thi', 'Điểm', 'Tỷ lệ điểm', 'Xếp hạng', 'Kết quả/Giải thưởng', 'Ghi chú/Sự cố'] },
  { label: 'VÒNG 2', columns: ['Điều kiện tham gia', 'Số báo danh (SBD)', 'Ngày thi', 'Giờ/Ca thi', 'Hình thức thi', 'Địa điểm/Phòng thi', 'Link thi', 'Tài khoản/Mã truy cập', 'Mật khẩu', 'Trạng thái dự thi', 'Điểm', 'Tỷ lệ điểm', 'Xếp hạng', 'Kết quả/Giải thưởng', 'Ghi chú/Sự cố'] },
  { label: 'VÒNG 3', columns: ['Điều kiện tham gia', 'Số báo danh (SBD)', 'Ngày thi', 'Giờ/Ca thi', 'Hình thức thi', 'Địa điểm/Phòng thi', 'Link thi', 'Tài khoản/Mã truy cập', 'Mật khẩu', 'Trạng thái dự thi', 'Điểm', 'Tỷ lệ điểm', 'Xếp hạng', 'Kết quả/Giải thưởng', 'Ghi chú/Sự cố'] },
  { label: 'TỔNG HỢP', columns: ['Vòng cao nhất đã đạt', 'Kết quả cao nhất', 'Link chứng nhận', 'Ngày cập nhật gần nhất'] },
] as const;

const roundPreviewFields: (keyof Omit<RoundHistory, 'round'>)[] = [
  'eligibility', 'sbd', 'date', 'time', 'mode', 'location', 'link', 'account', 'password', 'attendance', 'score', 'scoreRate', 'rank', 'result', 'note',
];

const aliases: Record<string, string[]> = {
  code: ['ma ft', 'ma ho so', 'ma thi sinh', 'sbd', 'student code', 'code'],
  name: ['ho va ten thi sinh', 'ho va ten', 'ho ten', 'thi sinh', 'full name', 'name'],
  school: ['ten truong', 'truong hoc', 'truong', 'school'],
  className: ['lop dang hoc', 'hoc sinh lop', 'lop', 'class'],
  city: ['tinh thanh pho cu tru', 'tinh thanh pho', 'tinh thanhpho', 'dia phuong', 'city'],
  ward: ['xa phuong', 'phuong xa', 'phuong', 'ward'], nationality: ['quoc tich', 'nationality'], grade: ['khoi lop hien tai', 'khoi lop', 'khoi', 'grade'],
  subject: ['mon thi linh vuc', 'mon thi', 'linh vuc', 'subject'], category: ['bang thi category', 'bang thi', 'category'],
  registrationMethod: ['hinh thuc dang ky', 'registration method'], registrationUnit: ['don vi dang ky', 'registration unit'], teamName: ['ten doi nhom', 'doi nhom', 'team'], examLanguage: ['ngon ngu thi', 'exam language'], generalNote: ['ghi chu chung', 'general note'], certificateLink: ['link chung nhan', 'certificate link'],
  contests: ['cuoc thi dang ky tham gia', 'cuoc thi dang ky', 'cuoc thi', 'contest', 'ky thi', 'dang ky thi'],
  achievement: ['tong hop ket qua cao nhat', 'ket qua cao nhat', 'ket qua giai thuong', 'ket qua thanh tich', 'ket qua', 'thanh tich', 'xep hang', 'result'],
  highestRound: ['tong hop vong cao nhat da dat', 'vong cao nhat da dat', 'highest round'],
  birthDate: ['ngay sinh dd mm yyyy hoac yyyy', 'ngay sinh', 'ngay thang nam sinh', 'birth date', 'birthday'],
  email: ['email lien lac', 'email'], parent: ['ho ten phu huynh', 'phu huynh', 'parent'],
  phone: ['so dien thoai lien lac', 'so dien thoai', 'sdt', 'dien thoai', 'phone', 'so dien thoai nguoi giam ho'],
  identity: ['so cccd ho chieu', 'cccd dinh danh', 'cccd', 'cmnd', 'dinh danh', 'identity', 'so cccd'],
  address: ['dia chi lien he', 'dia chi', 'address'], updated: ['ngay cap nhat gan nhat', 'updated'],
};
const normalise = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('vi-VN')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim();
const text = (value: unknown) => String(value ?? '').trim();
const valueFor = (entries: [string, string][], field: string) => aliases[field]?.map(alias => entries.find(([key]) => key.includes(alias))?.[1] || '').find(Boolean) || '';

type RoundHistory = { round: string; eligibility?: string; sbd?: string; date?: string; time?: string; mode?: string; location?: string; link?: string; account?: string; password?: string; attendance?: string; score?: string; scoreRate?: string; rank?: string; result?: string; note?: string };
function historyFromRow(row: ImportRow): RoundHistory[] {
  const fields: Record<string, string[]> = { eligibility: ['dieu kien tham gia'], sbd: ['so bao danh'], date: ['ngay thi'], time: ['gio ca thi'], mode: ['hinh thuc thi'], location: ['dia diem phong thi'], link: ['link thi'], account: ['tai khoan ma truy cap'], password: ['mat khau', 'password'], attendance: ['trang thai du thi'], score: ['diem'], scoreRate: ['ty le diem'], rank: ['xep hang'], result: ['ket qua giai thuong'], note: ['ghi chu su co'] };
  return [1, 2, 3].map(roundNumber => {
    const prefix = `vong ${roundNumber}`;
    const entries = Object.entries(row).map(([key, value]) => [normalise(key), text(value)] as [string, string]).filter(([key]) => key.startsWith(prefix));
    const item: RoundHistory = { round: `Vòng ${roundNumber}` };
    Object.entries(fields).forEach(([field, names]) => { const value = entries.find(([key]) => names.some(name => key.includes(name)))?.[1] || ''; if (value) item[field as keyof RoundHistory] = value as never; });
    return item;
  }).filter(item => Object.keys(item).length > 1);
}

function mapRows(rawRows: ImportRow[]): (Candidate & { examHistory?: RoundHistory[] })[] {
  return rawRows.map((row, index) => {
    const entries = Object.entries(row).map(([key, value]) => [normalise(key), text(value)] as [string, string]);
    const name = valueFor(entries, 'name');
    const code = valueFor(entries, 'code');
    return { code, name, school: valueFor(entries, 'school'), className: valueFor(entries, 'className'), city: valueFor(entries, 'city'), ward: valueFor(entries, 'ward'), nationality: valueFor(entries, 'nationality'), grade: valueFor(entries, 'grade'), contests: valueFor(entries, 'contests'), subject: valueFor(entries, 'subject'), category: valueFor(entries, 'category'), registrationMethod: valueFor(entries, 'registrationMethod'), registrationUnit: valueFor(entries, 'registrationUnit'), teamName: valueFor(entries, 'teamName'), examLanguage: valueFor(entries, 'examLanguage'), generalNote: valueFor(entries, 'generalNote'), certificateLink: valueFor(entries, 'certificateLink'), achievement: valueFor(entries, 'achievement'), highestRound: valueFor(entries, 'highestRound'), email: valueFor(entries, 'email'), parent: valueFor(entries, 'parent'), phone: valueFor(entries, 'phone'), identity: valueFor(entries, 'identity'), address: valueFor(entries, 'address'), birthDate: normaliseBirthDate(valueFor(entries, 'birthDate')), updated: valueFor(entries, 'updated'), examHistory: historyFromRow(row) };
  }).filter(row => row.name && !['stt', 'họ và tên', 'ho va ten'].includes(normalise(row.name)));
}

function rowsFromSheet(sheet: XLSX.WorkSheet): ImportRow[] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
  const headerScore = (row: unknown[]) => {
    const cells = row.map(normalise).filter(Boolean);
    const matchedFields = Object.entries(aliases).filter(([field, options]) => field !== 'code' && options.some(alias => alias.length > 3 && cells.some(cell => cell.includes(alias))));
    const hasName = matchedFields.some(([field]) => field === 'name');
    const hasProfileField = matchedFields.some(([field]) => ['birthDate', 'school', 'className', 'identity', 'email', 'phone'].includes(field));
    return hasName && hasProfileField ? matchedFields.length : 0;
  };
  const scores = grid.map(row => headerScore(row as unknown[]));
  const bestScore = Math.max(0, ...scores);
  const headerIndex = bestScore >= 4 ? scores.indexOf(bestScore) : -1;
  if (headerIndex < 0) return [];
  const groups = headerIndex > 0 ? grid[headerIndex - 1] as unknown[] : [];
  let currentGroup = '';
  const headers = (grid[headerIndex] as unknown[]).map((header, index) => {
    const group = text(groups[index]); if (group) currentGroup = group;
    const label = text(header); return currentGroup && label ? `${currentGroup}: ${label}` : label;
  });
  return grid.slice(headerIndex + 1)
    .filter(row => (row as unknown[]).some(cell => text(cell)))
    .map(row => Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, (row as unknown[])[index] ?? ''])));
}

const DEFAULT_SYNC_URL =
  'https://docs.google.com/spreadsheets/d/1kqztN_iCeZ9uR1mO7gz9j1TcUt8ZmCdpEv0TagTf4VA/edit?usp=sharing';

export default function ImportData({ idToken, googleAccessToken, canImport, sessionId, sessions, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [targetSessionId, setTargetSessionId] = useState(sessionId || '');
  const [rows, setRows] = useState<Candidate[]>([]);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const sample = useMemo(() => rows.slice(0, 5), [rows]);
  const rowIndexForPreview = (row: Candidate) => rows.indexOf(row) + 1;

  // States mới cho việc quản lý đa nguồn Google Sheets
  const [sheets, setSheets] = useState<SheetSource[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [syncingSheetId, setSyncingSheetId] = useState<string | null>(null);
  const [exportingSheetId, setExportingSheetId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');
  const [newSheetUrl, setNewSheetUrl] = useState('');
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [newSheetSessionId, setNewSheetSessionId] = useState('');
  const [newSheetTab, setNewSheetTab] = useState('');
  const [newSheetStage, setNewSheetStage] = useState('Toàn bộ kỳ tổ chức');

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken || ''}`,
    'X-Google-OAuth-Token': googleAccessToken || '',
  };


  const activeSheetSources = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return sheets.filter(sheet => {
      const linkedSession = sessions.find(item => item.id === sheet.sessionId);
      if (!linkedSession) return false;
      const lastRelevantDate = linkedSession.internationalDate || linkedSession.nationalDate || '';
      return !lastRelevantDate || lastRelevantDate >= today;
    });
  }, [sheets, sessions]);

  // Load danh sách sheet nguồn từ DB
  const loadSheets = useCallback(async () => {
    if (!idToken) return;
    setLoadingSheets(true);
    try {
      const res = await fetch('/api/examination/sheets', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSheets(data);
      }
    } catch (err) {
      console.warn('Lỗi tải danh sách nguồn Google Sheets:', err);
    } finally {
      setLoadingSheets(false);
    }
  }, [idToken]);

  useEffect(() => {
    loadSheets();
  }, [loadSheets]);

  const setParsedRows = (rawRows: ImportRow[], sourceName: string) => {
    const parsed = mapRows(rawRows);
    setRows(parsed);
    setSource(sourceName);
    setMessage(
      parsed.length
        ? `Đã nhận diện ${parsed.length} thí sinh. Kiểm tra mẫu xem trước rồi nhập dữ liệu.`
        : 'Không nhận diện được cột "Họ và tên". Hãy dùng file mẫu hoặc kiểm tra lại cấu trúc file.',
    );
  };

  const readFile = async (file: File) => {
    setLoading(true); setMessage('');
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
      const rawRows = book.SheetNames.flatMap(n => rowsFromSheet(book.Sheets[n]));
      setParsedRows(rawRows, file.name);
    } catch { setMessage('Không thể đọc tệp. Vui lòng dùng định dạng .xlsx hoặc .csv hợp lệ.'); }
    finally { setLoading(false); }
  };

  const loadSheet = async () => {
    if (!sourceUrl.trim()) return setMessage('Hãy dán liên kết Google Sheets có quyền xem.');
    const resolvedSessionId = targetSessionId || sessionId;
    if (!resolvedSessionId) return setMessage('Chọn kỳ tổ chức trước khi đồng bộ dữ liệu.');
    setLoading(true); setMessage('');
    try {
      const res = await fetch('/api/examination/sync/google-sheet', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ url: sourceUrl.trim(), sessionId: resolvedSessionId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Không thể đọc Google Sheets.');
      
      setMessage(`✅ ${body.message}`);
      onImported(body.candidates || []);
    } catch (err: any) { setMessage(`❌ ${err.message || 'Không thể đọc Google Sheets.'}`); }
    finally { setLoading(false); }
  };

  const importRows = async () => {
    if (!rows.length) return;
    const resolvedSessionId = targetSessionId || sessionId;
    if (!resolvedSessionId) return setMessage('Chọn kỳ tổ chức trước khi nhập dữ liệu.');
    setLoading(true); setMessage('');
    try {
      const res = await fetch('/api/examination/import/candidates', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ records: rows, source, sessionId: resolvedSessionId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Không thể nhập dữ liệu.');
      onImported(body.items || []);
      setMessage(`✅ Đã nhập ${body.created} mới và cập nhật ${body.updated} hồ sơ từ ${source}.`);
    } catch (err: any) { setMessage(err.message || 'Không thể nhập dữ liệu.'); }
    finally { setLoading(false); }
  };

  // Quản lý CRUD cho sheets nguồn
  const handleAddSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSheetName.trim() || !newSheetUrl.trim()) return;
    if (!newSheetSessionId) {
      setMessage('Chọn kỳ tổ chức cho tab nguồn trước khi lưu.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const url = `/api/examination/sheets${editingSheetId ? `/${editingSheetId}` : ''}`;
      const method = editingSheetId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: authHeaders,
        body: JSON.stringify({ name: newSheetName.trim(), url: newSheetUrl.trim(), sessionId: newSheetSessionId, sheetTab: newSheetTab.trim(), stage: newSheetStage }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Có lỗi xảy ra.');
      
      await loadSheets();
      setNewSheetName('');
      setNewSheetUrl('');
      setEditingSheetId(null);
      setShowAddModal(false);
      setMessage(editingSheetId ? '✅ Cập nhật nguồn dữ liệu thành công.' : '✅ Thêm nguồn dữ liệu mới thành công.');
    } catch (err: any) {
      setMessage(`❌ Lỗi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEditSheet = (sheet: SheetSource) => {
    setEditingSheetId(sheet.id);
    setNewSheetName(sheet.name);
    setNewSheetUrl(sheet.url);
    setNewSheetSessionId(sheet.sessionId || '');
    setNewSheetTab(sheet.sheetTab || '');
    setNewSheetStage(sheet.stage || 'Toàn bộ kỳ tổ chức');
    setShowAddModal(true);
  };

  const handleDeleteSheet = async (id: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa nguồn Google Sheets này?')) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/examination/sheets/${id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Có lỗi xảy ra.');
      
      await loadSheets();
      setMessage('✅ Xóa nguồn dữ liệu thành công.');
    } catch (err: any) {
      setMessage(`❌ Lỗi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncSheet = async (sheet: SheetSource) => {
    if (!canImport) return;
    setSyncingSheetId(sheet.id);
    setMessage('');
    setSheets(prev =>
      prev.map(s => (s.id === sheet.id ? { ...s, status: 'running' } : s))
    );
    try {
      const res = await fetch('/api/examination/sync/google-sheet', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ id: sheet.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Đồng bộ thất bại.');
      
      setMessage(`✅ Đồng bộ thành công nguồn "${sheet.name}": ${body.message}`);
      await loadSheets();
      onImported(body.candidates || []);
    } catch (err: any) {
      const errMsg = err.message || 'Lỗi không xác định.';
      setMessage(`❌ Lỗi đồng bộ nguồn "${sheet.name}": ${errMsg}`);
      await loadSheets();
    } finally {
      setSyncingSheetId(null);
    }
  };

  const handleExportSheet = async (sheet: SheetSource) => {
    if (!canImport) return;
    setExportingSheetId(sheet.id);
    setMessage('');
    try {
      const res = await fetch(`/api/examination/sheets/${sheet.id}/export`, {
        method: 'POST',
        headers: authHeaders,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Không thể xuất dữ liệu.');
      setMessage(`✅ ${body.message}`);
      await loadSheets();
      onImported([]);
    } catch (err: any) {
      setMessage(`❌ ${err.message || 'Không thể xuất dữ liệu.'}`);
      await loadSheets();
    } finally {
      setExportingSheetId(null);
    }
  };

  const downloadTemplate = () => {
    window.location.assign('/templates/Template_du_lieu_thi_sinh.xlsx');
  };

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-[#101827]">Nhập dữ liệu</h1>
          <p className="mt-1 text-sm text-slate-600">
            Đọc danh sách thí sinh từ Excel/CSV, Google Sheets.
            {sessionId ? ' Hồ sơ sẽ được liên kết với kỳ thi đang chọn.' : ''}
          </p>
        </div>
        <button onClick={downloadTemplate}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#001e40] hover:bg-slate-50 transition-colors">
          <Download className="h-4 w-4" />Tải file mẫu
        </button>
      </div>

      <section className="mb-5 rounded-2xl border border-blue-200 bg-blue-50/60 p-4"><label className="block max-w-xl"><span className="text-sm font-bold text-[#001e40]">Dữ liệu thuộc kỳ tổ chức</span><select value={targetSessionId} onChange={event => setTargetSessionId(event.target.value)} className="mt-2 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm"><option value="">Chọn kỳ tổ chức trước khi nhập</option>{sessions.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name} · {item.time}</option>)}</select><p className="mt-2 text-xs text-slate-600">Hồ sơ trong file sẽ được bổ sung vào lịch sử của thí sinh, đồng thời liên kết với kỳ này.</p></label></section>

      {!canImport && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Chỉ quản lý hoặc quản trị viên mới có thể nhập dữ liệu.
        </div>
      )}

      {/* ── Quản lý các nguồn Google Sheets ──────────────────── */}
      <section className="mb-5 rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-indigo-900"><Link2 className="h-5 w-5 text-indigo-600" />{'Google Sheets của các kỳ đang tổ chức'}</h2>
            <p className="mt-1 text-xs text-indigo-700">{'Mỗi hàng là tab dữ liệu của một kỳ tổ chức. Nhập để đồng bộ Sheet vào hệ thống; Xuất để ghi dữ liệu hệ thống ra Sheet.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={loadSheets} disabled={loadingSheets || syncingSheetId !== null || exportingSheetId !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-[#001e40] hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loadingSheets ? 'animate-spin' : ''}`} />{'Tải lại'}
            </button>
            {canImport && <button onClick={() => { setEditingSheetId(null); setNewSheetName(''); setNewSheetUrl(''); setNewSheetSessionId(targetSessionId || sessionId || ''); setNewSheetTab(''); setNewSheetStage('Toàn bộ kỳ tổ chức'); setShowAddModal(true); }} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700">
              <Plus className="h-4 w-4" />{'Thêm liên kết Sheet'}
            </button>}
          </div>
        </div>

        {loadingSheets && sheets.length === 0 ? <div className="flex justify-center py-8"><LoaderCircle className="h-8 w-8 animate-spin text-indigo-600" /></div> : activeSheetSources.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">{'Chưa có liên kết Sheet cho kỳ đang tổ chức. Các kỳ đã kết thúc được ẩn khỏi bảng này.'}</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-100"><table className="min-w-full divide-y divide-slate-100 text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3 text-left">{'Kỳ tổ chức'}</th><th className="px-4 py-3 text-left">Google Sheet</th><th className="px-4 py-3 text-center">{'Nhập dữ liệu'}</th><th className="px-4 py-3 text-center">{'Xuất dữ liệu'}</th><th className="px-4 py-3 text-right"></th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">
            {activeSheetSources.map(sheet => { const linkedSession=sessions.find(item=>item.id===sheet.sessionId); const busy=syncingSheetId===sheet.id||exportingSheetId===sheet.id; return <tr key={sheet.id} className="hover:bg-slate-50/50"><td className="px-4 py-3"><b className="block text-[#001e40]">{linkedSession?.code} · {linkedSession?.time}</b><span className="mt-1 block text-xs text-slate-500">{linkedSession?.name}{sheet.sheetTab ? ` · ${sheet.sheetTab}` : ''}</span></td><td className="px-4 py-3"><a href={sheet.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[360px] items-center gap-1 truncate font-semibold text-indigo-600 hover:underline"><Link2 className="h-4 w-4 shrink-0" />{'Mở Google Sheet'}</a></td><td className="px-4 py-3 text-center"><button disabled={!canImport||busy} onClick={()=>handleSyncSheet(sheet)} className="inline-flex min-w-[142px] items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${syncingSheetId===sheet.id?'animate-spin':''}`}/>{syncingSheetId===sheet.id?'Đang nhập dữ liệu':'Nhập dữ liệu'}</button></td><td className="px-4 py-3 text-center"><button disabled={!canImport||busy} onClick={()=>handleExportSheet(sheet)} className="inline-flex min-w-[142px] items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"><UploadCloud className={`h-4 w-4 ${exportingSheetId===sheet.id?'animate-pulse':''}`}/>{exportingSheetId===sheet.id?'Đang xuất dữ liệu':'Xuất dữ liệu'}</button></td><td className="px-4 py-3 text-right">{canImport&&<span className="inline-flex gap-1"><button disabled={busy} onClick={()=>handleEditSheet(sheet)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50" title={'Chỉnh sửa'}><Pencil className="h-4 w-4"/></button><button disabled={busy} onClick={()=>handleDeleteSheet(sheet.id)} className="rounded p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50" title={'Xóa'}><Trash2 className="h-4 w-4"/></button></span>}</td></tr>})}
          </tbody></table></div>
        )}
      </section>

      {/* Modal Thêm/Sửa nguồn dữ liệu */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-slate-900">
              {editingSheetId ? 'Chỉnh sửa nguồn Google Sheets' : 'Thêm nguồn Google Sheets mới'}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Cung cấp tên gợi nhớ và liên kết Google Sheets có quyền xem công khai (Anyone with the link).
            </p>
            <form onSubmit={handleAddSheet} className="mt-4 space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-slate-700">Tên nguồn dữ liệu *</span>
                <input required type="text" value={newSheetName} onChange={e => setNewSheetName(e.target.value)}
                  placeholder="Ví dụ: Kỳ thi IMO 2026, Young Food Scientist..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-slate-700">Liên kết Google Sheets *</span>
                <input required type="url" value={newSheetUrl} onChange={e => setNewSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1 block text-sm font-bold text-slate-700">Kỳ tổ chức</span><select value={newSheetSessionId} onChange={event => setNewSheetSessionId(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Chưa gán kỳ</option>{sessions.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label><span className="mb-1 block text-sm font-bold text-slate-700">Phạm vi tab</span><select value={newSheetStage} onChange={event => setNewSheetStage(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option>Toàn bộ kỳ tổ chức</option><option>Bổ sung dữ liệu</option></select></label><label className="sm:col-span-2"><span className="mb-1 block text-sm font-bold text-slate-700">Tên tab / sheet nhỏ</span><input value={newSheetTab} onChange={event => setNewSheetTab(event.target.value)} placeholder="Ví dụ: Dữ liệu thí sinh, Vòng quốc gia" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label></div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                  Hủy
                </button>
                <button type="submit" disabled={loading}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm">
                  {loading ? 'Đang lưu...' : 'Lưu lại'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Import thủ công ───────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Upload file */}
        <section className="ft-surface">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-6 w-6 text-[#003366]" />
            <div>
              <h2 className="font-bold text-[#001e40]">Tệp Excel hoặc CSV</h2>
              <p className="text-sm text-slate-500">Dùng file mẫu để giữ đúng tên cột.</p>
            </div>
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => e.target.files?.[0] && readFile(e.target.files[0])} />
          <button disabled={!canImport || loading} onClick={() => inputRef.current?.click()}
            className="mt-5 ft-primary disabled:opacity-50">
            <UploadCloud className="h-4 w-4" />Chọn tệp dữ liệu
          </button>
        </section>

        {/* Google Sheets URL thủ công */}
        <section className="ft-surface">
          <div className="flex items-center gap-3">
            <Link2 className="h-6 w-6 text-[#003366]" />
            <div>
              <h2 className="font-bold text-[#001e40]">Google Sheets nguồn khác</h2>
              <p className="text-sm text-slate-500">
                Dán link chia sẻ công khai (Anyone with link) · Không cần đăng nhập Google.
              </p>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            <button disabled={!canImport || loading} onClick={loadSheet}
              className="rounded-lg border border-[#003366] px-4 text-sm font-bold text-[#003366] hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap">
              Đồng bộ & Import
            </button>
          </div>
        </section>
      </div>

      {/* Loading */}
      {loading && (
        <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-slate-600">
          <LoaderCircle className="h-4 w-4 animate-spin" />Đang xử lý dữ liệu…
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`mt-5 flex items-start gap-2 rounded-xl border p-4 text-sm ${
          message.startsWith('❌')
            ? 'border-red-100 bg-red-50 text-red-800'
            : 'border-blue-100 bg-blue-50 text-[#001e40]'
        }`}>
          {message.startsWith('❌')
            ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          }
          {message}
        </div>
      )}

      {/* Preview bảng */}
      {rows.length > 0 && (
        <section className="mt-5 ft-surface overflow-hidden">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-[#001e40]">Xem trước dữ liệu</h2>
              <p className="mt-1 text-sm text-slate-500">Nguồn: {source} · {rows.length} hồ sơ hợp lệ</p>
            </div>
            <button disabled={!canImport || loading} onClick={importRows}
              className="ft-primary disabled:opacity-50">
              Nhập {rows.length} hồ sơ
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="ft-table min-w-[8400px]">
              <thead>
                <tr>{previewGroups.map(group => <th key={group.label} colSpan={group.columns.length}>{group.label}</th>)}</tr>
                <tr>{previewGroups.flatMap(group => group.columns).map((label, index) => <th key={`${label}-${index}`}>{label}</th>)}</tr>
              </thead>
              <tbody>
                {sample.map(row => {
                  const round = (number: number) => row.examHistory?.find(item => normalise(item.round) === `vong ${number}`);
                  const values = [
                    String(rowIndexForPreview(row)), row.code || '—', row.name, row.birthDate, row.identity, row.nationality, row.parent, row.phone, row.email, row.city, row.ward, row.address, row.school, row.className, row.grade,
                    row.subject, row.category, row.registrationMethod, row.teamName, row.examLanguage, row.generalNote,
                    ...[1, 2, 3].flatMap(number => roundPreviewFields.map(field => round(number)?.[field] || '—')),
                    row.highestRound, row.achievement, row.certificateLink, row.updated,
                  ];
                  return <tr key={`${row.code || 'new'}-${row.name}`}>
                    {values.map((value, index) => <td key={index}>{index === 2 ? <b>{value || '—'}</b> : value || '—'}</td>)}
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 5 && (
            <p className="mt-3 text-center text-xs text-slate-400">
              Hiển thị 5/{rows.length} hồ sơ đầu tiên
            </p>
          )}
        </section>
      )}
    </>
  );
}