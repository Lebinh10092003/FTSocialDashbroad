import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CheckCircle2, Download, FileSpreadsheet, Link2, LoaderCircle,
  UploadCloud, RefreshCw, Clock, AlertCircle, Zap, CalendarCheck,
  Trash2, Pencil, Plus,
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
  const [message, setMessage] = useState('');
  const sample = useMemo(() => rows.slice(0, 5), [rows]);

  // States mới cho việc quản lý đa nguồn Google Sheets
  const [sheets, setSheets] = useState<SheetSource[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [syncingSheetId, setSyncingSheetId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');
  const [newSheetUrl, setNewSheetUrl] = useState('');
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken || ''}`,
    'X-Google-OAuth-Token': googleAccessToken || '',
  };

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
    setLoading(true); setMessage('');
    try {
      const res = await fetch('/api/examination/sync/google-sheet', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ url: sourceUrl.trim() }),
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

  // Quản lý CRUD cho sheets nguồn
  const handleAddSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSheetName.trim() || !newSheetUrl.trim()) return;
    setLoading(true);
    setMessage('');
    try {
      const url = `/api/examination/sheets${editingSheetId ? `/${editingSheetId}` : ''}`;
      const method = editingSheetId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: authHeaders,
        body: JSON.stringify({ name: newSheetName.trim(), url: newSheetUrl.trim() }),
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

  const handleSyncAll = async () => {
    if (!canImport) return;
    setSyncingSheetId('all');
    setMessage('');
    setSheets(prev => prev.map(s => ({ ...s, status: 'running' })));
    try {
      const res = await fetch('/api/examination/sync/google-sheet', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Đồng bộ thất bại.');
      
      setMessage(`✅ ${body.message}`);
      await loadSheets();
      onImported(body.candidates || []);
    } catch (err: any) {
      const errMsg = err.message || 'Lỗi không xác định.';
      setMessage(`❌ Lỗi đồng bộ tất cả nguồn: ${errMsg}`);
      await loadSheets();
    } finally {
      setSyncingSheetId(null);
    }
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

      {/* ── Quản lý các nguồn Google Sheets ──────────────────── */}
      <section className="mb-5 rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-indigo-900 flex items-center gap-2">
              <Zap className="h-5 w-5 text-indigo-600 animate-pulse" />
              Danh sách nguồn Google Sheets đang đồng bộ
            </h2>
            <p className="mt-1 text-xs text-indigo-700">
              Cấu hình các sheet đăng ký thi của từng kỳ thi và đồng bộ tự động hàng ngày lúc 7:00 sáng.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={loadSheets} disabled={loadingSheets || syncingSheetId !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-[#001e40] hover:bg-slate-50 disabled:opacity-50 transition-colors">
              <RefreshCw className={`h-3.5 w-3.5 ${loadingSheets ? 'animate-spin' : ''}`} />
              Tải lại danh sách
            </button>
            {canImport && (
              <>
                <button onClick={handleSyncAll} disabled={loadingSheets || syncingSheetId !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 transition-colors">
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingSheetId === 'all' ? 'animate-spin' : ''}`} />
                  Đồng bộ tất cả
                </button>
                <button onClick={() => { setEditingSheetId(null); setNewSheetName(''); setNewSheetUrl(''); setShowAddModal(true); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 transition-colors shadow-sm">
                  <Plus className="h-4 w-4" />
                  Thêm nguồn mới
                </button>
              </>
            )}
          </div>
        </div>

        {/* Danh sách các sheet */}
        {loadingSheets && sheets.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <LoaderCircle className="h-8 w-8 animate-spin text-indigo-600" />
          </div>
        ) : sheets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
            Chưa có nguồn Google Sheets nào. Nhấn "Thêm nguồn mới" để bắt đầu.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-slate-500 font-semibold">
                <tr>
                  <th className="px-4 py-3 text-left">Tên nguồn</th>
                  <th className="px-4 py-3 text-left">Đường dẫn Google Sheets</th>
                  <th className="px-4 py-3 text-center">Trạng thái đồng bộ</th>
                  <th className="px-4 py-3 text-left">Chi tiết đồng bộ gần nhất</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {sheets.map(sheet => {
                  const statusInfo = {
                    success: { text: 'Thành công', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> },
                    failed: { text: 'Thất bại', color: 'bg-rose-50 text-rose-700 border-rose-200', icon: <AlertCircle className="h-3.5 w-3.5 text-rose-500" /> },
                    running: { text: 'Đang chạy', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: <LoaderCircle className="h-3.5 w-3.5 animate-spin text-blue-500" /> },
                    idle: { text: 'Chờ đồng bộ', color: 'bg-slate-50 text-slate-600 border-slate-200', icon: <Clock className="h-3.5 w-3.5 text-slate-400" /> }
                  }[sheet.status || 'idle'];

                  return (
                    <tr key={sheet.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 font-bold text-slate-900 max-w-[200px] truncate">{sheet.name}</td>
                      <td className="px-4 py-3 text-slate-600 max-w-[320px] truncate">
                        <a href={sheet.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
                          {sheet.url}
                          <Download className="h-3 w-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${statusInfo.color}`}>
                          {statusInfo.icon}
                          {statusInfo.text}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {sheet.status === 'success' && (
                          <div>
                            <div>Thời gian: {sheet.lastSyncTime}</div>
                            <div className="font-semibold text-slate-700">
                              +Mới: {sheet.created ?? 0} · ~Cập nhật: {sheet.updated ?? 0} · Tổng: {sheet.total ?? 0}
                            </div>
                          </div>
                        )}
                        {sheet.status === 'failed' && (
                          <div className="text-rose-600 font-medium max-w-[240px] truncate" title={sheet.error}>
                            Lỗi: {sheet.error}
                          </div>
                        )}
                        {sheet.status === 'running' && <div className="text-blue-600 animate-pulse">Đang cập nhật dữ liệu...</div>}
                        {sheet.status === 'idle' && <div>Chưa thực hiện đồng bộ</div>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button disabled={syncingSheetId !== null} onClick={() => handleSyncSheet(sheet)}
                            className="rounded p-1.5 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 transition-colors" title="Đồng bộ riêng nguồn này">
                            <RefreshCw className={`h-4 w-4 ${syncingSheetId === sheet.id ? 'animate-spin' : ''}`} />
                          </button>
                          {canImport && (
                            <>
                              <button disabled={syncingSheetId !== null} onClick={() => handleEditSheet(sheet)}
                                className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition-colors" title="Chỉnh sửa">
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button disabled={syncingSheetId !== null} onClick={() => handleDeleteSheet(sheet.id)}
                                className="rounded p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors" title="Xóa">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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