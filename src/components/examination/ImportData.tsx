import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CheckCircle2, Download, FileSpreadsheet, Link2, LoaderCircle,
  UploadCloud, RefreshCw, Clock, AlertCircle, Zap, CalendarCheck,
} from 'lucide-react';
import type { Candidate } from './types';

type ImportRow = Record<string, unknown>;
type Props = {
  idToken?: string | null;
  googleAccessToken?: string | null;
  canImport: boolean;
  sessionId?: string;
  onImported: (items: Candidate[]) => void;
};

interface SyncState {
  status?: 'success' | 'failed' | 'running' | 'idle';
  lastSyncTime?: string;
  lastSyncDate?: string;
  created?: number;
  updated?: number;
  total?: number;
  message?: string;
  error?: string;
}

// ─── Cột & alias cho import từ file ──────────────────────────────────────────
const columns = [
  ['code', 'Mã FT'], ['name', 'Họ và tên'], ['school', 'Trường học'], ['className', 'Lớp'],
  ['city', 'Tỉnh/Thành phố'], ['contests', 'Cuộc thi'], ['achievement', 'Kết quả/Thành tích'],
  ['birthDate', 'Ngày sinh'], ['email', 'Email'], ['parent', 'Phụ huynh'],
  ['phone', 'Số điện thoại'], ['identity', 'CCCD/Định danh'], ['address', 'Địa chỉ'],
] as const;

const aliases: Record<string, string[]> = {
  code: ['ma ft', 'ma thi sinh', 'sbd', 'student code', 'code'],
  name: ['ho va ten', 'ho ten', 'thi sinh', 'full name', 'name', 'ho va ten thi sinh'],
  school: ['truong hoc', 'truong', 'school'],
  className: ['lop', 'class', 'hoc sinh lop'],
  city: ['tinh thanh pho', 'tinh/thanh pho', 'dia phuong', 'city', 'tinh/ thanh pho'],
  contests: ['cuoc thi', 'mon thi', 'contest', 'ky thi', 'dang ky thi'],
  achievement: ['ket qua/thanh tich', 'ket qua', 'thanh tich', 'xep hang', 'result'],
  birthDate: ['ngay sinh', 'ngay/thang/nam sinh', 'birth date', 'birthday'],
  email: ['email'],
  parent: ['phu huynh', 'ho ten phu huynh', 'parent'],
  phone: ['so dien thoai', 'sdt', 'dien thoai', 'phone', 'so dien thoai nguoi giam ho'],
  identity: ['cccd/dinh danh', 'cccd', 'cmnd', 'dinh danh', 'identity', 'so cccd'],
  address: ['dia chi', 'address'],
};

const normalise = (v: unknown) =>
  String(v ?? '').trim().toLocaleLowerCase('vi-VN').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim();
const text = (v: unknown) => String(v ?? '').trim();

function mapRows(rawRows: ImportRow[]): Candidate[] {
  return rawRows.map((row, index) => {
    const entries = Object.entries(row).map(([k, v]) => [normalise(k), text(v)] as const);
    const get = (field: string) => entries.find(([k]) => aliases[field]?.some(a => k.includes(a)))?.[1] || '';
    const name = get('name');
    const code = get('code') || `IMPORT-${Date.now()}-${index + 1}`;
    return {
      code, name, school: get('school'), className: get('className'), city: get('city'),
      contests: get('contests'), achievement: get('achievement'), email: get('email'),
      parent: get('parent'), phone: get('phone'), identity: get('identity'),
      address: get('address'), birthDate: get('birthDate'), updated: '',
    };
  }).filter(r => r.name);
}

function rowsFromSheet(sheet: XLSX.WorkSheet): ImportRow[] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const hi = grid.findIndex(row =>
    (row as unknown[]).some(cell => aliases.name.includes(normalise(cell)) || aliases.code.includes(normalise(cell)))
  );
  if (hi < 0) return [];
  const headers = (grid[hi] as unknown[]).map(text);
  return grid.slice(hi + 1)
    .filter(row => (row as unknown[]).some(cell => text(cell)))
    .map(row => Object.fromEntries(headers.map((h, i) => [h, (row as unknown[])[i] ?? ''])));
}

// ─── Hằng số Google Sheets đồng bộ tự động ──────────────────────────────────
const DEFAULT_SYNC_URL =
  'https://docs.google.com/spreadsheets/d/1kqztN_iCeZ9uR1mO7gz9j1TcUt8ZmCdpEv0TagTf4VA/edit?usp=sharing';

export default function ImportData({ idToken, googleAccessToken, canImport, sessionId, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [rows, setRows] = useState<Candidate[]>([]);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [syncState, setSyncState] = useState<SyncState>({});
  const sample = useMemo(() => rows.slice(0, 5), [rows]);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken || ''}`,
    'X-Google-OAuth-Token': googleAccessToken || '',
  };

  // Load trạng thái đồng bộ khi mở tab
  const loadSyncState = useCallback(async () => {
    try {
      const res = await fetch('/api/examination/sync/status', {
        headers: { Authorization: `Bearer ${idToken || ''}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSyncState(data as SyncState);
      }
    } catch { /* ignore */ }
  }, [idToken]);

  useEffect(() => { loadSyncState(); }, [loadSyncState]);

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
    setLoading(true); setMessage('');
    try {
      // Gọi endpoint đồng bộ CSV công khai — không cần OAuth
      const res = await fetch('/api/examination/sync/google-sheet', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ url: sourceUrl.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Không thể đọc Google Sheets.');
      // Sau khi sync, hiển thị kết quả dạng thông báo (không cần preview riêng)
      setSyncState({
        status: 'success',
        lastSyncTime: body.timestamp,
        created: body.created,
        updated: body.updated,
        total: body.total,
        message: body.message,
      });
      setMessage(`✅ ${body.message}`);
      onImported([]);
    } catch (err: any) { setMessage(`❌ ${err.message || 'Không thể đọc Google Sheets.'}`); }
    finally { setLoading(false); }
  };


  const importRows = async () => {
    if (!rows.length) return;
    setLoading(true); setMessage('');
    try {
      const res = await fetch('/api/examination/import/candidates', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ records: rows, source, sessionId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Không thể nhập dữ liệu.');
      onImported(body.items || []);
      setMessage(`✅ Đã nhập ${body.created} mới và cập nhật ${body.updated} hồ sơ từ ${source}.`);
    } catch (err: any) { setMessage(err.message || 'Không thể nhập dữ liệu.'); }
    finally { setLoading(false); }
  };

  // Đồng bộ trực tiếp từ Google Sheets mặc định của hệ thống
  const syncFromDefaultSheet = async () => {
    if (!canImport) return;
    setSyncLoading(true);
    setSyncState(prev => ({ ...prev, status: 'running' }));
    setMessage('');
    try {
      const res = await fetch('/api/examination/sync/google-sheet', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ url: DEFAULT_SYNC_URL }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Đồng bộ thất bại.');
      setSyncState({
        status: 'success',
        lastSyncTime: body.timestamp,
        created: body.created,
        updated: body.updated,
        total: body.total,
        message: body.message,
      });
      setMessage(`✅ ${body.message}`);
      onImported([]); // trigger refresh
    } catch (err: any) {
      const errMsg = err.message || 'Lỗi không xác định.';
      setSyncState(prev => ({ ...prev, status: 'failed', error: errMsg }));
      setMessage(`❌ Lỗi đồng bộ: ${errMsg}`);
    } finally { setSyncLoading(false); }
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const data = [
      columns.map(([, label]) => label),
      ['FT26-0100', 'Nguyễn Minh Anh', 'THCS Cầu Giấy', '8A1', 'Hà Nội', 'IMO', 'Đạt giải Khuyến khích', '2012-05-18', 'minhanh@example.com', 'Nguyễn Thu Hà', '0988 123 456', '001212345678', 'Cầu Giấy, Hà Nội'],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet['!cols'] = columns.map(([, l]) => ({ wch: Math.max(l.length + 4, 18) }));
    XLSX.utils.book_append_sheet(wb, sheet, 'Danh sách thí sinh');
    XLSX.writeFile(wb, 'Mau_nhap_thi_sinh_khao_thi.xlsx');
  };

  const syncStatusColor = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    failed: 'border-red-200 bg-red-50 text-red-800',
    running: 'border-blue-200 bg-blue-50 text-blue-800',
    idle: 'border-slate-200 bg-slate-50 text-slate-600',
  }[syncState.status ?? 'idle'];

  const syncStatusIcon = {
    success: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />,
    failed: <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />,
    running: <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-blue-500" />,
    idle: <Clock className="h-4 w-4 shrink-0 text-slate-400" />,
  }[syncState.status ?? 'idle'];

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-[#101827]">Nhập dữ liệu</h1>
          <p className="mt-1 text-sm text-slate-600">
            Đọc danh sách thí sinh từ Excel/CSV, Google Sheets, hoặc đồng bộ tự động từ nguồn FT.
            {sessionId ? ' Hồ sơ sẽ được liên kết với kỳ thi đang chọn.' : ''}
          </p>
        </div>
        <button onClick={downloadTemplate}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#001e40] hover:bg-slate-50 transition-colors">
          <Download className="h-4 w-4" />Tải file mẫu
        </button>
      </div>

      {!canImport && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Chỉ quản lý hoặc quản trị viên mới có thể nhập dữ liệu.
        </div>
      )}

      {/* ── Đồng bộ tự động từ Google Sheets FT ──────────────────── */}
      <section className="mb-5 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 shadow">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-indigo-900">Đồng bộ tự động từ Google Sheets FT</h2>
              <p className="mt-0.5 text-xs text-indigo-700">
                Nguồn chính thức · Tự động chạy mỗi ngày lúc <strong>7:00 sáng</strong> (giờ VN)
              </p>
              {syncState.lastSyncTime && (
                <p className="mt-1 flex items-center gap-1 text-xs text-indigo-600">
                  <CalendarCheck className="h-3 w-3" />
                  Đồng bộ gần nhất: {syncState.lastSyncTime}
                  {syncState.total !== undefined && ` · ${syncState.total} thí sinh`}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={loadSyncState} disabled={syncLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 transition-colors">
              <RefreshCw className={`h-3.5 w-3.5 ${syncLoading ? 'animate-spin' : ''}`} />
              Kiểm tra
            </button>
            {canImport && (
              <button onClick={syncFromDefaultSheet} disabled={syncLoading || loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm">
                {syncLoading
                  ? <><LoaderCircle className="h-4 w-4 animate-spin" />Đang đồng bộ…</>
                  : <><RefreshCw className="h-4 w-4" />Đồng bộ ngay</>
                }
              </button>
            )}
          </div>
        </div>

        {/* Trạng thái đồng bộ */}
        {(syncState.status || syncState.message || syncState.error) && (
          <div className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${syncStatusColor}`}>
            {syncStatusIcon}
            <div>
              {syncState.status === 'success' && syncState.total !== undefined
                ? <><strong>Thành công</strong> · Thêm mới: {syncState.created ?? 0}, Cập nhật: {syncState.updated ?? 0}, Tổng: {syncState.total}</>
                : syncState.status === 'failed'
                  ? <><strong>Thất bại</strong> · {syncState.error || syncState.message}</>
                  : syncState.status === 'running'
                    ? 'Đang đồng bộ dữ liệu từ Google Sheets…'
                    : 'Chưa có thông tin đồng bộ. Nhấn "Đồng bộ ngay" để bắt đầu.'
              }
            </div>
          </div>
        )}
      </section>

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
            <table className="ft-table min-w-[900px]">
              <thead>
                <tr>
                  <th>Mã FT</th><th>Họ và tên</th><th>Trường học</th>
                  <th>Ngày sinh</th><th>Cuộc thi</th><th>Tỉnh/TP</th>
                </tr>
              </thead>
              <tbody>
                {sample.map(row => (
                  <tr key={row.code}>
                    <td><code className="text-xs">{row.code}</code></td>
                    <td><b>{row.name}</b></td>
                    <td>{row.school || '—'}</td>
                    <td>{row.birthDate || '—'}</td>
                    <td>{row.contests || '—'}</td>
                    <td>{row.city || '—'}</td>
                  </tr>
                ))}
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