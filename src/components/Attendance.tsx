import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Clock, Coffee, Edit3, FileText, Globe, Laptop, Loader2, MapPin, Moon, Plus, RefreshCw, Save, Trash2, TriangleAlert, UserCheck, X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type TimesheetEntry = {
  id: number;
  workDate: string;
  shiftNumber: number;
  shiftStart: string;
  shiftEnd: string;
  crossesMidnight: boolean;
  workMode: 'direct' | 'online';
  isDayOff: boolean;
  notes: string;
  workedMinutes: number;
  employee?: { email: string; name: string; department: string };
};

type EditLog = {
  id: number;
  workDate: string;
  editedBy: string;
  editedByName: string;
  note: string;
  oldData: any;
  newData: any;
  createdAt: string;
};

type TimesheetData = {
  serverTime: string;
  scope: string;
  month: string;
  isPrivileged: boolean;
  entries: TimesheetEntry[];
  summary: { totalMinutes: number; onlineMinutes: number; offlineMinutes: number };
  editLogs: EditLog[];
};

type PrefillData = {
  targetDate: string;
  autoFill: boolean;
  shifts: { start: string; end: string; workMode: string; notes: string }[];
  yesterdayWarning: boolean;
  yesterdayDate: string;
  defaultWorkMode: string;
  existing: TimesheetEntry[];
  canEdit: boolean;
  isPrivileged: boolean;
  editLogs: EditLog[];
};

type ShiftRow = { start: string; end: string; workMode: 'direct' | 'online'; notes: string };
type AttendanceProps = { onBackToWorkspace: () => void; idToken: string; userName: string };

/* ------------------------------------------------------------------ */
/*  In-memory cache                                                    */
/* ------------------------------------------------------------------ */
const CACHE_TTL = 5 * 60 * 1000;
let cache: { owner: string; month: string; savedAt: number; data: TimesheetData } | null = null;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const fmtHours = (mins: number) => (mins / 60).toFixed(2).replace(/\.?0+$/, '') || '0';
const formatDate = (v: string) => { const [y, m, d] = v.split('-'); return `${d}/${m}/${y}`; };
const modeLabel = (m: string) => m === 'online' ? 'Online' : 'Trực tiếp';


/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function Attendance({ onBackToWorkspace, idToken, userName }: AttendanceProps) {
  const initialMonth = currentMonth();
  const cached = cache?.owner === idToken && cache.month === initialMonth && Date.now() - cache.savedAt < CACHE_TTL ? cache : null;

  const [data, setData] = useState<TimesheetData | null>(cached?.data ?? null);
  const [month, setMonth] = useState(initialMonth);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Popup
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupDate, setPopupDate] = useState('');
  const [isDayOff, setIsDayOff] = useState(false);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [prefill, setPrefill] = useState<PrefillData | null>(null);
  const [saving, setSaving] = useState(false);
  const [popupError, setPopupError] = useState('');
  const [editNote, setEditNote] = useState('');
  const [isEdit, setIsEdit] = useState(false);


  /* ---------- Data loading ---------- */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const scope = data?.isPrivileged ? '&scope=all' : '';
      const res = await fetch(`/api/attendance/timesheet?month=${month}${scope}`, { headers: { Authorization: `Bearer ${idToken}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Không thể tải dữ liệu.');
      setData(body);
      cache = { owner: idToken, month, savedAt: Date.now(), data: body };
      setError('');
    } catch (e: any) {
      setError(e.message || 'Không thể tải dữ liệu.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [month, idToken, data?.isPrivileged]);

  useEffect(() => {
    const reusable = cache?.owner === idToken && cache.month === month && Date.now() - cache.savedAt < CACHE_TTL;
    if (reusable) setData(cache!.data);
    void load(Boolean(reusable));
  }, [month, idToken]);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(t); }, [notice]);

  /* ---------- Group entries by date ---------- */
  const grouped = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, TimesheetEntry[]>();
    for (const e of data.entries) {
      const list = map.get(e.workDate) || [];
      list.push(e);
      map.set(e.workDate, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  /* ---------- Can user edit a date ---------- */
  const canEditDate = useCallback((dateStr: string) => {
    if (data?.isPrivileged) return true;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    return dateStr === today || dateStr === yesterday;
  }, [data?.isPrivileged]);

  /* ---------- Open popup ---------- */
  const openPopup = async (dateOverride?: string) => {
    setPopupError('');
    setEditNote('');
    const targetDate = dateOverride || new Date().toISOString().slice(0, 10);

    // Quick permission check before opening
    if (!canEditDate(targetDate)) {
      setNotice('Bạn không có quyền chỉnh sửa ngày này. Hãy liên hệ kế toán nếu muốn chỉnh sửa giờ làm.');
      return;
    }

    setPopupDate(targetDate);
    setPopupOpen(true);
    setIsDayOff(false);
    setShifts([]);
    setPrefill(null);
    setIsEdit(false);

    try {
      const res = await fetch(`/api/attendance/timesheet/prefill?date=${targetDate}`, { headers: { Authorization: `Bearer ${idToken}` } });
      const body: PrefillData = await res.json();
      setPrefill(body);

      if (!body.canEdit) {
        setPopupError('Bạn không có quyền chỉnh sửa ngày này. Hãy liên hệ kế toán nếu muốn chỉnh sửa giờ làm.');
        return;
      }

      if (body.existing.length > 0) {
        setIsEdit(true);
        const first = body.existing[0];
        if (first.isDayOff) {
          setIsDayOff(true);
          setShifts([]);
        } else {
          setIsDayOff(false);
          setShifts(body.existing.map(e => ({ start: e.shiftStart, end: e.shiftEnd, workMode: e.workMode, notes: e.notes })));
        }
      } else if (body.shifts.length > 0) {
        setShifts(body.shifts.map(s => ({ start: s.start, end: s.end, workMode: s.workMode as 'direct' | 'online', notes: '' })));
      } else {
        const mode = (body.defaultWorkMode || 'direct') as 'direct' | 'online';
        setShifts([{ start: '08:00', end: '12:00', workMode: mode, notes: '' }]);
      }
    } catch {
      setShifts([{ start: '08:00', end: '12:00', workMode: 'direct', notes: '' }]);
    }
  };

  /* ---------- Save ---------- */
  const saveTimesheet = async () => {
    if (isEdit && !editNote.trim()) {
      setPopupError('Vui lòng nhập ghi chú chỉnh sửa khi cập nhật công ca đã có.');
      return;
    }
    setSaving(true);
    setPopupError('');
    try {
      const payload: any = { workDate: popupDate, isDayOff };
      if (!isDayOff) {
        payload.shifts = shifts.map(s => ({ start: s.start, end: s.end, workMode: s.workMode, notes: s.notes }));
      }
      if (isEdit) payload.editNote = editNote;
      const res = await fetch('/api/attendance/timesheet/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Không thể lưu.');
      setNotice(body.message || 'Đã lưu công ca.');
      setPopupOpen(false);
      await load(true);
    } catch (e: any) {
      setPopupError(e.message || 'Không thể lưu.');
    } finally {
      setSaving(false);
    }
  };

  /* ---------- Shift row helpers ---------- */
  const updateShift = (idx: number, field: keyof ShiftRow, value: string) => {
    setShifts(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };
  const removeShift = (idx: number) => setShifts(prev => prev.filter((_, i) => i !== idx));
  const addShift = () => {
    const mode = (prefill?.defaultWorkMode || 'direct') as 'direct' | 'online';
    setShifts(prev => [...prev, { start: '13:30', end: '17:30', workMode: mode, notes: '' }]);
  };

  const summary = data?.summary;

  return (
    <div className="workspace-module-canvas min-h-dvh bg-slate-50 font-sans text-slate-900">
      {/* Header */}
      <header className="border-b bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <button type="button" onClick={onBackToWorkspace} className="ft-btn ft-btn-secondary"><ArrowLeft className="h-4 w-4" />Workspace</button>
          <div className="flex items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-700 text-white"><UserCheck className="h-5 w-5" /></div><span className="text-sm font-extrabold">Công ca</span></div>
          <div className="hidden text-right sm:block"><p className="text-xs font-bold text-slate-500">{new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date())}</p></div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        {/* Title row */}
        <section className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase text-emerald-600">Xin chào, {userName}</p>
            <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Bảng công cá nhân</h1>
            <p className="mt-1 text-sm text-slate-500">Tự khai báo giờ làm hàng ngày — sáng 8:00–12:00, chiều 13:30–17:30.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void load()} disabled={loading} className="ft-btn ft-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Làm mới</button>
            <button type="button" onClick={() => void openPopup()} className="ft-btn ft-btn-primary"><Plus className="h-4 w-4" />Thêm công ca</button>
          </div>
        </section>

        {error && <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" /><span>{error}</span></div>}

        {/* Main grid: Records + Sidebar */}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Records table */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-emerald-600">Lịch sử</p>
                <h2 className="mt-1 text-xl font-extrabold">Công ca trong tháng</h2>
              </div>
              <label className="relative"><span className="sr-only">Chọn tháng</span><input type="month" value={month} onChange={e => setMonth(e.target.value)} className="ft-input" /></label>
            </div>

            <div className="mt-5 overflow-x-auto rounded-xl border">
              <table className="ft-table min-w-[750px]">
                <thead><tr><th>Ngày</th><th>Ca</th><th>Bắt đầu</th><th>Kết thúc</th><th>Thời lượng</th><th>Hình thức</th><th>Ghi chú</th><th></th></tr></thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="px-5 py-14 text-center text-slate-400">Đang tải...</td></tr>
                  ) : grouped.length === 0 ? (
                    <tr><td colSpan={8} className="px-5 py-14 text-center text-slate-400">Chưa có dữ liệu công trong tháng này.</td></tr>
                  ) : grouped.map(([dateStr, entries]) => {
                    const dayTotal = entries.reduce((sum, e) => sum + (e.isDayOff ? 0 : e.workedMinutes), 0);
                    const hasDayOff = entries.some(e => e.isDayOff);
                    const rowCount = entries.length + (entries.length > 1 || !hasDayOff ? 1 : 0);
                    return (
                      <React.Fragment key={dateStr}>
                        {entries.map((entry, idx) => (
                          <tr key={entry.id} className="hover:bg-blue-50/50">
                            {idx === 0 && <td rowSpan={rowCount} className="whitespace-nowrap font-bold align-top">{formatDate(dateStr)}{entry.employee && <span className="mt-0.5 block text-xs font-normal text-slate-400">{entry.employee.name}</span>}</td>}
                            {entry.isDayOff ? (
                              <>
                                <td colSpan={5}><span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800"><Moon className="h-3.5 w-3.5" />Nghỉ làm</span></td>
                                <td className="text-xs text-slate-400">—</td>
                              </>
                            ) : (
                              <>
                                <td className="font-bold">Ca {entry.shiftNumber}</td>
                                <td className="tabular-nums">{entry.shiftStart}</td>
                                <td className="tabular-nums">{entry.shiftEnd}{entry.crossesMidnight && <span className="ml-1 text-xs text-amber-600" title="Qua nửa đêm">+1</span>}</td>
                                <td className="tabular-nums">{fmtHours(entry.workedMinutes)}h</td>
                                <td>
                                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${entry.workMode === 'online' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                    {entry.workMode === 'online' ? <Globe className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                                    {modeLabel(entry.workMode)}
                                  </span>
                                </td>
                                <td className="max-w-[180px] truncate text-xs text-slate-500" title={entry.notes}>{entry.notes || '—'}</td>
                              </>
                            )}
                            {idx === 0 && (
                              <td rowSpan={rowCount} className="align-top">
                                {canEditDate(dateStr) ? (
                                  <button type="button" onClick={() => void openPopup(dateStr)} className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline"><Edit3 className="h-3.5 w-3.5" />Sửa</button>
                                ) : (
                                  <span className="text-xs text-slate-300" title="Liên hệ kế toán để chỉnh sửa">—</span>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                        {!hasDayOff && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={3} className="text-right text-xs font-bold text-slate-500">Tổng ngày:</td>
                            <td className="tabular-nums text-xs font-extrabold text-slate-700">{fmtHours(dayTotal)}h</td>
                            <td colSpan={3}></td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Edit logs */}
            {data?.editLogs && data.editLogs.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-bold text-slate-500 hover:text-slate-700"><FileText className="mr-1 inline h-3.5 w-3.5" />Nhật ký chỉnh sửa ({data.editLogs.length})</summary>
                <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
                  {data.editLogs.map(log => (
                    <div key={log.id} className="rounded-lg border bg-slate-50 px-3 py-2 text-xs">
                      <span className="font-bold text-slate-700">{log.editedByName}</span>
                      <span className="text-slate-400"> · {formatDate(log.workDate)} · {new Date(log.createdAt).toLocaleString('vi-VN')}</span>
                      <p className="mt-0.5 text-slate-600">{log.note}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            {/* Guidance */}
            <div className="rounded-2xl border bg-emerald-50 p-5">
              <div className="flex gap-3"><Coffee className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /><div><h3 className="text-sm font-extrabold">Hướng dẫn</h3><p className="mt-1 text-xs leading-5 text-slate-600">Ca mặc định: Sáng 8:00–12:00, Chiều 13:30–17:30. Ngoài giờ hành chính hoặc cuối tuần sẽ mặc định Online. Bạn chỉ có thể chỉnh sửa công ca của hôm nay và hôm qua. Liên hệ kế toán để chỉnh sửa ngày trước đó.</p></div></div>
            </div>

            {/* Summary */}
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm font-bold uppercase text-emerald-600">Tổng quan</p>
              <h2 className="mt-1 text-2xl font-extrabold">Tháng {(() => { const [y, m] = month.split('-'); return `${m}/${y}`; })()}</h2>
              <div className="mt-5 space-y-5">
                <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><Clock className="h-6 w-6" /></div><div><p className="text-3xl font-extrabold">{fmtHours(summary?.totalMinutes ?? 0)}<span className="ml-1 text-base font-bold text-slate-400">giờ</span></p><p className="text-sm text-slate-500">Tổng giờ làm</p></div></div>
                <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-blue-100 text-blue-700"><MapPin className="h-6 w-6" /></div><div><p className="text-3xl font-extrabold">{fmtHours(summary?.offlineMinutes ?? 0)}<span className="ml-1 text-base font-bold text-slate-400">giờ</span></p><p className="text-sm text-slate-500">Trực tiếp</p></div></div>
                <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-violet-100 text-violet-700"><Laptop className="h-6 w-6" /></div><div><p className="text-3xl font-extrabold">{fmtHours(summary?.onlineMinutes ?? 0)}<span className="ml-1 text-base font-bold text-slate-400">giờ</span></p><p className="text-sm text-slate-500">Online</p></div></div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* ---------- Popup ---------- */}
      {popupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setPopupOpen(false); }}>
          <div className="w-full max-w-3xl rounded-2xl border bg-white shadow-2xl">
            {/* Popup header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <p className="text-xs font-bold uppercase text-emerald-600">{isEdit ? 'Chỉnh sửa' : 'Thêm mới'}</p>
                <h2 className="mt-0.5 text-lg font-extrabold">Công ca ngày {popupDate}</h2>
              </div>
              <button type="button" onClick={() => setPopupOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
              {/* Cannot edit message */}
              {prefill && !prefill.canEdit ? (
                <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
                  <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>Bạn không có quyền chỉnh sửa ngày này. Hãy liên hệ kế toán nếu muốn chỉnh sửa giờ làm.</span>
                </div>
              ) : (
                <>
                  {/* Date picker */}
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block"><span className="mb-1 block text-sm font-bold">Ngày</span><input type="date" className="ft-input" value={popupDate} onChange={e => { setPopupDate(e.target.value); void openPopup(e.target.value); }} /></label>
                    <div className="flex items-end pb-0.5">
                      <label className="flex items-center gap-2 text-sm font-bold">
                        <input type="checkbox" checked={isDayOff} onChange={e => setIsDayOff(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                        <Moon className="h-4 w-4 text-amber-600" /> Nghỉ làm ngày này
                      </label>
                    </div>
                  </div>

                  {/* Shift rows */}
                  {!isDayOff && (
                    <div className="mt-5 space-y-3">
                      <p className="text-xs font-bold uppercase text-slate-500">Các ca làm việc</p>
                      {shifts.map((shift, idx) => (
                        <div key={idx} className="grid grid-cols-[1fr_1fr_auto] items-start gap-3 rounded-xl border bg-slate-50 px-4 py-3">
                          {/* Row 1: times + mode + delete */}
                          <div className="grid grid-cols-2 gap-3">
                            <label><span className="mb-1 block text-xs font-bold text-slate-500">Bắt đầu</span><input type="time" className="ft-input" value={shift.start} onChange={e => updateShift(idx, 'start', e.target.value)} /></label>
                            <label><span className="mb-1 block text-xs font-bold text-slate-500">Kết thúc</span><input type="time" className="ft-input" value={shift.end} onChange={e => updateShift(idx, 'end', e.target.value)} /></label>
                          </div>
                          <div>
                            <span className="mb-1 block text-xs font-bold text-slate-500">Hình thức</span>
                            <div className="grid grid-cols-2 gap-1.5">
                              <button type="button" onClick={() => updateShift(idx, 'workMode', 'direct')} className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-bold transition ${shift.workMode === 'direct' ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-slate-200 bg-white text-slate-500 hover:border-emerald-200'}`}><MapPin className="h-3 w-3" />Trực tiếp</button>
                              <button type="button" onClick={() => updateShift(idx, 'workMode', 'online')} className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-bold transition ${shift.workMode === 'online' ? 'border-blue-300 bg-blue-100 text-blue-800' : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200'}`}><Globe className="h-3 w-3" />Online</button>
                            </div>
                          </div>
                          <div className="flex items-end pb-1">
                            {shifts.length > 1 && <button type="button" onClick={() => removeShift(idx)} className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>}
                          </div>
                          {/* Row 2: notes spanning full width */}
                          <div className="col-span-3">
                            <input type="text" className="ft-input text-xs" value={shift.notes} onChange={e => updateShift(idx, 'notes', e.target.value)} placeholder="Ghi chú ca (tùy chọn)" maxLength={500} />
                          </div>
                        </div>
                      ))}

                      {shifts.length < 10 && (
                        <button type="button" onClick={addShift} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-2.5 text-sm font-bold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-700"><Plus className="h-4 w-4" />Thêm ca</button>
                      )}
                    </div>
                  )}

                  {/* Edit note (required for edits) */}
                  {isEdit && (
                    <div className="mt-5">
                      <label><span className="mb-1 block text-sm font-bold text-amber-800">Ghi chú chỉnh sửa <span className="text-rose-500">*</span></span>
                      <textarea className="ft-input min-h-16" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Lý do chỉnh sửa công ca..." maxLength={1000} /></label>
                    </div>
                  )}

                  {/* Existing edit logs for this date */}
                  {prefill?.editLogs && prefill.editLogs.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-bold text-slate-500"><FileText className="mr-1 inline h-3.5 w-3.5" />Lịch sử chỉnh sửa ngày này</p>
                      <div className="mt-1.5 max-h-28 space-y-1 overflow-y-auto">
                        {prefill.editLogs.map(log => (
                          <div key={log.id} className="rounded-lg border bg-slate-50 px-3 py-1.5 text-xs">
                            <span className="font-bold">{log.editedByName}</span>
                            <span className="text-slate-400"> · {new Date(log.createdAt).toLocaleString('vi-VN')}</span>
                            <p className="text-slate-600">{log.note}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {popupError && <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{popupError}</div>}
            </div>

            {/* Popup footer */}
            <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
              <button type="button" onClick={() => setPopupOpen(false)} className="ft-btn ft-btn-secondary">Hủy</button>
              {(!prefill || prefill.canEdit) && (
                <button type="button" onClick={() => void saveTimesheet()} disabled={saving || (!isDayOff && shifts.length === 0)} className="ft-btn ft-btn-primary">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Đang lưu...' : 'Lưu'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {notice && <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white shadow-2xl" role="status"><UserCheck className="h-4 w-4 text-emerald-300" />{notice}</div>}
    </div>
  );
}
