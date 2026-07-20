import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { CheckCircle2, Download, FileSpreadsheet, Link2, LoaderCircle, UploadCloud } from 'lucide-react';
import type { Candidate } from './types';

type ImportRow = Record<string, unknown>;
type Props = { idToken?: string | null; googleAccessToken?: string | null; canImport: boolean; sessionId?: string; onImported: (items: Candidate[]) => void };

const columns = [
  ['code', 'Mã FT'], ['name', 'Họ và tên'], ['school', 'Trường học'], ['className', 'Lớp'], ['city', 'Tỉnh/Thành phố'],
  ['contests', 'Cuộc thi'], ['achievement', 'Kết quả/Thành tích'], ['birthDate', 'Ngày sinh'], ['email', 'Email'], ['parent', 'Phụ huynh'],
  ['phone', 'Số điện thoại'], ['identity', 'CCCD/Định danh'], ['address', 'Địa chỉ'],
] as const;
const aliases: Record<string, string[]> = {
  code: ['ma ft', 'ma thi sinh', 'sbd', 'student code', 'code'], name: ['ho va ten', 'ho ten', 'thi sinh', 'full name', 'name'],
  school: ['truong hoc', 'truong', 'school'], className: ['lop', 'class'], city: ['tinh thanh pho', 'tinh/thanh pho', 'dia phuong', 'city'],
  contests: ['cuoc thi', 'mon thi', 'contest', 'ky thi'], achievement: ['ket qua/thanh tich', 'ket qua', 'thanh tich', 'xep hang', 'result', 'achievement'],
  birthDate: ['ngay sinh', 'ngay/thang/nam sinh', 'birth date', 'birthday'], email: ['email'], parent: ['phu huynh', 'ho ten phu huynh', 'parent'], phone: ['so dien thoai', 'sdt', 'dien thoai', 'phone'],
  identity: ['cccd/dinh danh', 'cccd', 'cmnd', 'dinh danh', 'identity'], address: ['dia chi', 'address'],
};
const normalise = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('vi-VN').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim();
const text = (value: unknown) => String(value ?? '').trim();

function mapRows(rawRows: ImportRow[]): Candidate[] {
  return rawRows.map((row, index) => {
    const entries = Object.entries(row).map(([key, value]) => [normalise(key), text(value)] as const);
    const get = (field: string) => entries.find(([key]) => aliases[field].includes(key))?.[1] || '';
    const name = get('name');
    const code = get('code') || `IMPORT-${Date.now()}-${index + 1}`;
    return { code, name, school: get('school'), className: get('className'), city: get('city'), contests: get('contests'), achievement: get('achievement'), email: get('email'), parent: get('parent'), phone: get('phone'), identity: get('identity'), address: get('address'), birthDate: get('birthDate'), updated: '' };
  }).filter(row => row.name);
}
function rowsFromSheet(sheet: XLSX.WorkSheet): ImportRow[] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const headerIndex = grid.findIndex(row => row.some(cell => aliases.name.includes(normalise(cell)) || aliases.code.includes(normalise(cell))));
  if (headerIndex < 0) return [];
  const headers = grid[headerIndex].map(text);
  return grid.slice(headerIndex + 1).filter(row => row.some(cell => text(cell))).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

export default function ImportData({ idToken, googleAccessToken, canImport, sessionId, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [rows, setRows] = useState<Candidate[]>([]);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const sample = useMemo(() => rows.slice(0, 5), [rows]);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken || ''}`, 'X-Google-OAuth-Token': googleAccessToken || '' };

  const setParsedRows = (rawRows: ImportRow[], sourceName: string) => {
    const parsed = mapRows(rawRows);
    setRows(parsed); setSource(sourceName);
    setMessage(parsed.length ? `Đã nhận diện ${parsed.length} thí sinh. Kiểm tra mẫu xem trước rồi nhập dữ liệu.` : 'Không nhận diện được cột “Họ và tên” hoặc “Mã FT”. Hãy dùng file mẫu.');
  };
  const readFile = async (file: File) => {
    setLoading(true); setMessage('');
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
      const rawRows = book.SheetNames.flatMap(name => rowsFromSheet(book.Sheets[name]));
      setParsedRows(rawRows, file.name);
    } catch { setMessage('Không thể đọc tệp. Vui lòng dùng định dạng .xlsx hoặc .csv hợp lệ.'); }
    finally { setLoading(false); }
  };
  const loadSheet = async () => {
    if (!sourceUrl.trim()) return setMessage('Hãy dán liên kết Google Sheets có quyền xem.');
    setLoading(true); setMessage('');
    try {
      const response = await fetch('/api/examination/import/google-sheet', { method: 'POST', headers, body: JSON.stringify({ url: sourceUrl.trim() }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Không thể đọc Google Sheets.');
      setParsedRows(body.rows || [], body.title || 'Google Sheets');
    } catch (error: any) { setMessage(error.message || 'Không thể đọc Google Sheets.'); }
    finally { setLoading(false); }
  };
  const importRows = async () => {
    if (!rows.length) return;
    setLoading(true); setMessage('');
    try {
      const response = await fetch('/api/examination/import/candidates', { method: 'POST', headers, body: JSON.stringify({ records: rows, source, sessionId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Không thể nhập dữ liệu.');
      onImported(body.items || []);
      setMessage(`Đã nhập ${body.created} mới và cập nhật ${body.updated} hồ sơ từ ${source}.`);
    } catch (error: any) { setMessage(error.message || 'Không thể nhập dữ liệu.'); }
    finally { setLoading(false); }
  };
  const downloadTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const data = [columns.map(([, label]) => label), ['FT26-0100', 'Nguyễn Minh Anh', 'THCS Cầu Giấy', '8A1', 'Hà Nội', 'IMO', 'Đạt giải Khuyến khích', '2012-05-18', 'minhanh@example.com', 'Nguyễn Thu Hà', '0988 123 456', '001212345678', 'Cầu Giấy, Hà Nội']];
    const sheet = XLSX.utils.aoa_to_sheet(data); sheet['!cols'] = columns.map(([, label]) => ({ wch: Math.max(label.length + 4, 18) }));
    XLSX.utils.book_append_sheet(workbook, sheet, 'Danh sách thí sinh');
    XLSX.writeFile(workbook, 'Mau_nhap_thi_sinh_khao_thi.xlsx');
  };

  return <>
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-3xl font-extrabold text-[#101827]">Nhập dữ liệu</h1><p className="mt-1 text-sm text-slate-600">Đọc danh sách thí sinh và kết quả từ Excel/CSV hoặc liên kết Google Sheets.{sessionId ? ' Hồ sơ nhập tại đây sẽ được liên kết trực tiếp với kỳ thi đang chọn.' : ''}</p></div><button onClick={downloadTemplate} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#001e40]"><Download className="h-4 w-4"/>Tải file mẫu</button></div>
    {!canImport && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Chỉ quản lý hoặc quản trị viên mới có thể nhập dữ liệu.</div>}
    <div className="grid gap-5 lg:grid-cols-2"><section className="ft-surface"><div className="flex items-center gap-3"><FileSpreadsheet className="h-6 w-6 text-[#003366]"/><div><h2 className="font-bold text-[#001e40]">Tệp Excel hoặc CSV</h2><p className="text-sm text-slate-500">Dùng file mẫu để giữ đúng tên cột.</p></div></div><input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={event => event.target.files?.[0] && readFile(event.target.files[0])}/><button disabled={!canImport || loading} onClick={() => inputRef.current?.click()} className="mt-5 ft-primary disabled:opacity-50"><UploadCloud className="h-4 w-4"/>Chọn tệp dữ liệu</button></section><section className="ft-surface"><div className="flex items-center gap-3"><Link2 className="h-6 w-6 text-[#003366]"/><div><h2 className="font-bold text-[#001e40]">Nguồn Google Sheets trực tiếp</h2><p className="text-sm text-slate-500">Dán link chia sẻ; tài khoản dịch vụ cần có quyền xem tệp.</p></div></div><div className="mt-5 flex gap-2"><input value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"/><button disabled={!canImport || loading} onClick={loadSheet} className="rounded-lg border border-[#003366] px-4 text-sm font-bold text-[#003366] disabled:opacity-50">Đọc nguồn</button></div></section></div>
    {loading && <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-slate-600"><LoaderCircle className="h-4 w-4 animate-spin"/>Đang xử lý dữ liệu…</div>}
    {message && <div className="mt-5 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-[#001e40]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0"/>{message}</div>}
    {rows.length > 0 && <section className="mt-5 ft-surface overflow-hidden"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-[#001e40]">Xem trước dữ liệu</h2><p className="mt-1 text-sm text-slate-500">Nguồn: {source} · {rows.length} hồ sơ hợp lệ</p></div><button disabled={!canImport || loading} onClick={importRows} className="ft-primary disabled:opacity-50">Nhập {rows.length} hồ sơ</button></div><div className="overflow-x-auto"><table className="ft-table min-w-[800px]"><thead><tr><th>Mã FT</th><th>Họ và tên</th><th>Trường học</th><th>Cuộc thi</th><th>Kết quả</th></tr></thead><tbody>{sample.map(row => <tr key={row.code}><td>{row.code}</td><td><b>{row.name}</b></td><td>{row.school || '—'}</td><td>{row.contests || '—'}</td><td>{row.achievement || '—'}</td></tr>)}</tbody></table></div></section>}
  </>;
}