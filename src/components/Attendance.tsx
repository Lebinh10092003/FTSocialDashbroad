import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Clock, Coffee, Globe, Laptop, Loader2, MapPin, Moon, Plus, RefreshCw, Save, Trash2, TriangleAlert, UserCheck, X } from 'lucide-react';

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
};

type TimesheetData = {
  serverTime: string;
  scope: string;
  month: string;
  entries: TimesheetEntry[];
  summary: { workDays: number; totalMinutes: number; dayOffCount: number; onlineDays: number };
  yesterdayFilled: boolean;
};

type PrefillData = {
  targetDate: string;
  autoFill: boolean;
  shifts: { start: string; end: string; workMode: string; notes: string }[];
  yesterdayMissing: boolean;
  yesterdayDate: string;
  defaultWorkMode: string;
  existing: TimesheetEntry[];
};

type ShiftRow = { start: string; end: string; workMode: 'direct' | 'online'; notes: string };

type AttendanceProps = { onBackToWorkspace: () => void; idToken: string; userName: string };

/* ------------------------------------------------------------------ */
/*  In-memory cache                                                    */
/* ------------------------------------------------------------------ */
const CACHE_TTL = 2 * 60 * 1000;
let cache: { owner: string; month: string; savedAt: number; data: TimesheetData } | null = null;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const formatDuration = (mins: number) => `${Math.floor(mins / 60)}g ${String(mins % 60).padStart(2, '0')}p`;
const formatDate = (v: string) => new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(`${v}T00:00:00`));
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

  // Popup state
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupDate, setPopupDate] = useState('');
  const [isDayOff, setIsDayOff] = useState(false);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [prefill, setPrefill] = useState<PrefillData | null>(null);
  const [saving, setSaving] = useState(false);
  const [popupError, setPopupError] = useState('');

  /* ---------- Data loading ---------- */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/attendance/timesheet?month=${month}`, { headers: { Authorization: `Bearer ${idToken}` } });
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
  }, [month, idToken]);

  useEffect(() => {
    const reusable = cache?.owner === idToken && cache.month === month && Date.now() - cache.savedAt < CACHE_TTL;
    if (reusable) setData(cache!.data);
    void load(Boolean(reusable));
  }, [month, idToken, load]);

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

  /* ---------- Open popup ---------- */
  const openPopup = async (dateOverride?: string) => {
    setPopupError('');
    const targetDate = dateOverride || new Date().toISOString().slice(0, 10);
    setPopupDate(targetDate);
    setPopupOpen(true);
    setIsDayOff(false);
    setShifts([]);
    setPrefill(null);

    try {
      const res = await fetch(`/api/attendance/timesheet/prefill?date=${targetDate}`, { headers: { Authorization: `Bearer ${idToken}` } });
      const body: PrefillData = await res.json();
      setPrefill(body);

      if (body.existing.length > 0) {
        // Edit mode — load existing
        const first = body.existing[0];
        if (first.isDayOff) {
          setIsDayOff(true);
          setShifts([]);
        } else {
          setIsDayOff(false);
          setShifts(body.existing.map(e => ({ start: e.shiftStart, end: e.shiftEnd, workMode: e.workMode, notes: e.notes })));
        }
      } else if (body.autoFill && body.shifts.length > 0) {
        // Auto-fill suggested
        setShifts(body.shifts.map(s => ({ start: s.start, end: s.end, workMode: s.workMode as 'direct' | 'online', notes: '' })));
      } else {
        // New entry — single blank shift with defaults
        const mode = (body.defaultWorkMode || 'direct') as 'direct' | 'online';
        setShifts([{ start: '08:00', end: '12:00', workMode: mode, notes: '' }]);
      }
    } catch {
      // Fallback — single blank shift
      setShifts([{ start: '08:00', end: '12:00', workMode: 'direct', notes: '' }]);
    }
  };

  /* ---------- Save ---------- */
  const saveTimesheet = async () => {
    setSaving(true);
    setPopupError('');
    try {
      const payload: any = { workDate: popupDate, isDayOff };
      if (!isDayOff) {
        payload.shifts = shifts.map(s => ({ start: s.start, end: s.end, workMode: s.workMode, notes: s.notes }));
      }
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

        {/* Summary cards + Records table */}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Records */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-emerald-600">Lịch sử</p>
                <h2 className="mt-1 text-xl font-extrabold">Công ca trong tháng</h2>
              </div>
              <label className="relative"><span className="sr-only">Chọn tháng</span><input type="month" value={month} onChange={e => setMonth(e.target.value)} className="ft-input" /></label>
            </div>

            <div className="mt-5 overflow-x-auto rounded-xl border">
              <table className="ft-table min-w-[700px]">
                <thead><tr><th>Ngày</th><th>Ca</th><th>Bắt đầu</th><th>Kết thúc</th><th>Thời lượng</th><th>Hình thức</th><th>Ghi chú</th><th></th></tr></thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="px-5 py-14 text-center text-slate-400">Đang tải...</td></tr>
                  ) : grouped.length === 0 ? (
                    <tr><td colSpan={8} className="px-5 py-14 text-center text-slate-400">Chưa có dữ liệu công trong tháng này.</td></tr>
                  ) : grouped.map(([dateStr, entries]) => (
                    entries.map((entry, idx) => (
                      <tr key={entry.id} className="hover:bg-blue-50/50">
                        {idx === 0 && <td rowSpan={entries.length} className="whitespace-nowrap font-bold align-top">{formatDate(dateStr)}</td>}
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
                            <td className="tabular-nums">{formatDuration(entry.workedMinutes)}</td>
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
                          <td rowSpan={entries.length} className="align-top">
                            <button type="button" onClick={() => void openPopup(dateStr)} className="text-xs font-bold text-blue-600 hover:underline">Sửa</button>
                          </td>
                        )}
                      </tr>
                    ))
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-emerald-600">Tổng quan</p>
              <h2 className="mt-1 text-xl font-extrabold">Tháng {month}</h2>
              <div className="mt-5 space-y-4">
                <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><CalendarDays className="h-5 w-5" /></div><div><p className="text-2xl font-extrabold">{summary?.workDays ?? 0}</p><p className="text-xs text-slate-500">Ngày có công</p></div></div>
                <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-100 text-blue-700"><Clock className="h-5 w-5" /></div><div><p className="text-2xl font-extrabold">{formatDuration(summary?.totalMinutes ?? 0)}</p><p className="text-xs text-slate-500">Tổng giờ làm</p></div></div>
                <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-700"><Moon className="h-5 w-5" /></div><div><p className="text-2xl font-extrabold">{summary?.dayOffCount ?? 0}</p><p className="text-xs text-slate-500">Ngày nghỉ</p></div></div>
                <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-100 text-violet-700"><Laptop className="h-5 w-5" /></div><div><p className="text-2xl font-extrabold">{summary?.onlineDays ?? 0}</p><p className="text-xs text-slate-500">Ngày online</p></div></div>
              </div>
            </div>

            <div className="rounded-2xl border bg-emerald-50 p-5">
              <div className="flex gap-3"><Coffee className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /><div><h3 className="text-sm font-extrabold">Hướng dẫn</h3><p className="mt-1 text-xs leading-5 text-slate-600">Ca mặc định: Sáng 8:00–12:00, Chiều 13:30–17:30. Ngoài giờ hành chính hoặc cuối tuần sẽ mặc định Online. Có thể thêm nhiều ca và chỉnh sửa tự do.</p></div></div>
            </div>
          </aside>
        </div>
      </main>

      {/* ---------- Popup ---------- */}
      {popupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border bg-white shadow-2xl">
            {/* Popup header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <p className="text-xs font-bold uppercase text-emerald-600">{prefill?.existing.length ? 'Chỉnh sửa' : 'Thêm mới'}</p>
                <h2 className="mt-0.5 text-lg font-extrabold">Công ca ngày {popupDate}</h2>
              </div>
              <button type="button" onClick={() => setPopupOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
              {/* Yesterday warning */}
              {prefill?.yesterdayMissing && (
                <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>Bạn chưa khai báo công ca ngày {prefill.yesterdayDate}. <button type="button" onClick={() => { setPopupOpen(false); void openPopup(prefill!.yesterdayDate); }} className="font-bold text-amber-900 underline">Khai báo ngay</button></span>
                </div>
              )}

              {/* Date picker */}
              <label className="block"><span className="mb-1 block text-sm font-bold">Ngày</span><input type="date" className="ft-input" value={popupDate} onChange={e => { setPopupDate(e.target.value); void openPopup(e.target.value); }} /></label>

              {/* Day off checkbox */}
              <label className="mt-4 flex items-center gap-2 text-sm font-bold">
                <input type="checkbox" checked={isDayOff} onChange={e => setIsDayOff(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                Nghỉ làm ngày này
              </label>

              {/* Shift rows */}
              {!isDayOff && (
                <div className="mt-5 space-y-3">
                  <p className="text-xs font-bold uppercase text-slate-500">Các ca làm việc</p>
                  {shifts.map((shift, idx) => (
                    <div key={idx} className="rounded-xl border bg-slate-50 p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-extrabold">Ca {idx + 1}</span>
                        {shifts.length > 1 && <button type="button" onClick={() => removeShift(idx)} className="text-rose-500 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <label><span className="mb-1 block text-xs font-bold text-slate-500">Bắt đầu</span><input type="time" className="ft-input" value={shift.start} onChange={e => updateShift(idx, 'start', e.target.value)} /></label>
                        <label><span className="mb-1 block text-xs font-bold text-slate-500">Kết thúc</span><input type="time" className="ft-input" value={shift.end} onChange={e => updateShift(idx, 'end', e.target.value)} /></label>
                      </div>
                      <div className="mt-3">
                        <span className="mb-1 block text-xs font-bold text-slate-500">Hình thức</span>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => updateShift(idx, 'workMode', 'direct')} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-bold transition ${shift.workMode === 'direct' ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200'}`}><MapPin className="h-3.5 w-3.5" />Trực tiếp</button>
                          <button type="button" onClick={() => updateShift(idx, 'workMode', 'online')} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-bold transition ${shift.workMode === 'online' ? 'border-blue-300 bg-blue-100 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200'}`}><Globe className="h-3.5 w-3.5" />Online</button>
                        </div>
                      </div>
                      <label className="mt-3 block"><span className="mb-1 block text-xs font-bold text-slate-500">Ghi chú</span><input type="text" className="ft-input" value={shift.notes} onChange={e => updateShift(idx, 'notes', e.target.value)} placeholder="Tùy chọn" maxLength={500} /></label>
                    </div>
                  ))}

                  {shifts.length < 10 && (
                    <button type="button" onClick={addShift} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-3 text-sm font-bold text-slate-500 transition hover:border-emerald-400 hover:text-emerald-700"><Plus className="h-4 w-4" />Thêm ca</button>
                  )}
                </div>
              )}

              {popupError && <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{popupError}</div>}
            </div>

            {/* Popup footer */}
            <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
              <button type="button" onClick={() => setPopupOpen(false)} className="ft-btn ft-btn-secondary">Hủy</button>
              <button type="button" onClick={() => void saveTimesheet()} disabled={saving || (!isDayOff && shifts.length === 0)} className="ft-btn ft-btn-primary">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {notice && <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white shadow-2xl" role="status"><UserCheck className="h-4 w-4 text-emerald-300" />{notice}</div>}
    </div>
  );
}
