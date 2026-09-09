import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Clock, Edit3, FileText, Globe, Laptop, Loader2, MapPin, Moon, Plus, RefreshCw, Save, Search, Trash2, TriangleAlert, UserCheck, Users, X } from 'lucide-react';

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
  employeeEmail: string;
  employeeName: string;
  workDate: string;
  editedBy: string;
  editedByName: string;
  note: string;
  oldData: any;
  newData: any;
  createdAt: string;
};

type Employee = { email: string; name: string; department: string };

type TimesheetData = {
  serverTime: string;
  scope: string;
  month: string;
  isPrivileged: boolean;
  entries: TimesheetEntry[];
  summary: { totalMinutes: number; onlineMinutes: number; offlineMinutes: number };
  editLogs: EditLog[];
  employees: Employee[];
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
type AttendanceProps = { onBackToWorkspace: () => void; idToken: string; userName: string; userEmail?: string };

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
const fmtDate = (v: string) => { const [y, m, d] = v.split('-'); return `${d}/${m}/${y}`; };
const fmtMonthLabel = (v: string) => { const [y, m] = v.split('-'); return `${m}/${y}`; };
const modeLabel = (m: string) => m === 'online' ? 'Online' : 'Trực tiếp';

/** Format edit log old/new data into readable text */
const formatLogShifts = (data: any) => {
  if (!data?.shifts?.length) return 'Trống';
  const shifts = data.shifts as { shift: number; start: string; end: string; mode: string; dayOff: boolean; notes: string }[];
  if (shifts[0]?.dayOff) return 'Nghỉ';
  return shifts.map(s => `${s.mode === 'online' ? 'Online' : 'Trực tiếp'}: ${s.start} - ${s.end}`).join(', ');
};
const WEEKDAYS_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const weekdayName = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return WEEKDAYS_VI[d.getDay()]; };
const isWeekend = (iso: string) => { const d = new Date(`${iso}T00:00:00`).getDay(); return d === 0 || d === 6; };

/** Get all dates in a month as YYYY-MM-DD strings */
const monthDates = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

/** Format shift entries for display */
const formatShifts = (entries: TimesheetEntry[]) => {
  if (!entries.length) return '';
  if (entries[0].isDayOff) return 'Nghỉ';
  return entries
    .map(e => `${modeLabel(e.workMode)}: ${e.shiftStart} - ${e.shiftEnd}`)
    .join('\n');
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function Attendance({ onBackToWorkspace, idToken, userName, userEmail }: AttendanceProps) {
  const initialMonth = currentMonth();
  const cached = cache?.owner === idToken && cache.month === initialMonth && Date.now() - cache.savedAt < CACHE_TTL ? cache : null;

  const [data, setData] = useState<TimesheetData | null>(cached?.data ?? null);
  const [month, setMonth] = useState(initialMonth);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Employee sidebar (privileged)
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [empSearch, setEmpSearch] = useState('');

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

  /* ---------- Filtered employees ---------- */
  const filteredEmployees = useMemo(() => {
    if (!data?.employees?.length) return [];
    const q = empSearch.toLowerCase().trim();
    if (!q) return data.employees;
    return data.employees.filter(e => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q));
  }, [data?.employees, empSearch]);

  /* ---------- Entries for selected view ---------- */
  const viewEntries = useMemo(() => {
    if (!data) return [];
    if (data.scope === 'mine') return data.entries;
    const target = selectedEmployee || userEmail || '';
    if (!target) return data.entries;
    return data.entries.filter(e => e.employee?.email === target);
  }, [data, selectedEmployee, userEmail]);

  /* ---------- Map entries by date ---------- */
  const entriesByDate = useMemo(() => {
    const map = new Map<string, TimesheetEntry[]>();
    for (const e of viewEntries) {
      const list = map.get(e.workDate) || [];
      list.push(e);
      map.set(e.workDate, list);
    }
    return map;
  }, [viewEntries]);

  /* ---------- Summary ---------- */
  const summary = useMemo(() => {
    const total = viewEntries.reduce((s, e) => s + (e.isDayOff ? 0 : e.workedMinutes), 0);
    const online = viewEntries.reduce((s, e) => s + (e.workMode === 'online' && !e.isDayOff ? e.workedMinutes : 0), 0);
    const offline = viewEntries.reduce((s, e) => s + (e.workMode === 'direct' && !e.isDayOff ? e.workedMinutes : 0), 0);
    return { totalMinutes: total, onlineMinutes: online, offlineMinutes: offline };
  }, [viewEntries]);

  /* ---------- All dates in the month ---------- */
  const allDates = useMemo(() => monthDates(month), [month]);

  /* ---------- Edit logs for selected person ---------- */
  const viewEditLogs = useMemo(() => {
    if (!data?.editLogs?.length) return [];
    if (data.scope === 'mine') return data.editLogs;
    const target = selectedEmployee || userEmail || '';
    if (!target) return data.editLogs;
    return data.editLogs.filter(log => log.employeeEmail === target);
  }, [data, selectedEmployee, userEmail]);

  /* ---------- Missing weekday dates (for warning) ---------- */
  const missingWeekdays = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return allDates.filter(d => {
      if (d >= today) return false; // don't warn about future/today
      if (isWeekend(d)) return false;
      return !entriesByDate.has(d);
    });
  }, [allDates, entriesByDate]);

  /* ---------- Open popup ---------- */
  const openPopup = async (dateOverride?: string) => {
    setPopupError('');
    setEditNote('');
    const targetDate = dateOverride || new Date().toISOString().slice(0, 10);
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

  /* ---------- Quick mark day off ---------- */
  const quickDayOff = async (dateStr: string) => {
    try {
      const existing = entriesByDate.get(dateStr);
      const payload: any = { workDate: dateStr, isDayOff: true };
      if (existing?.length) payload.editNote = 'Xác nhận nghỉ làm';
      await fetch('/api/attendance/timesheet/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(payload),
      });
      setNotice(`Đã ghi nhận nghỉ làm ngày ${fmtDate(dateStr)}`);
      await load(true);
    } catch { /* ignore */ }
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

  const isPrivileged = data?.isPrivileged ?? false;
  const selectedEmpName = data?.employees?.find(e => e.email === selectedEmployee)?.name;

  return (
    <div className="workspace-module-canvas flex min-h-dvh bg-slate-50 font-sans text-slate-900">
      {/* Employee sidebar (privileged only) */}
      {isPrivileged && (
        <aside className="hidden w-72 shrink-0 flex-col border-r bg-white lg:flex">
          <div className="border-b px-4 py-4">
            <button type="button" onClick={onBackToWorkspace} className="ft-btn ft-btn-secondary w-full justify-center"><ArrowLeft className="h-4 w-4" />Workspace</button>
          </div>
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-extrabold text-emerald-700"><Users className="h-4 w-4" />Nhân viên</div>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="text" value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="Tìm theo họ tên..." className="ft-input pl-8 text-sm" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <button type="button" onClick={() => setSelectedEmployee('')} className={`flex w-full items-center gap-2 border-b px-4 py-2.5 text-left text-sm transition ${!selectedEmployee ? 'bg-emerald-50 font-bold text-emerald-800' : 'text-slate-600 hover:bg-slate-50'}`}>
              <UserCheck className="h-4 w-4 shrink-0" />Bảng công của tôi
            </button>
            {filteredEmployees.map(emp => (
              <button key={emp.email} type="button" onClick={() => setSelectedEmployee(emp.email)} className={`flex w-full flex-col border-b px-4 py-2 text-left transition ${selectedEmployee === emp.email ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                <span className={`text-sm ${selectedEmployee === emp.email ? 'font-bold text-emerald-800' : 'font-medium text-slate-700'}`}>{emp.name}</span>
                {emp.department && <span className="text-[11px] text-slate-400">{emp.department}</span>}
              </button>
            ))}
            {filteredEmployees.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">Không tìm thấy.</p>}
          </div>
        </aside>
      )}

      <div className="flex min-h-dvh flex-1 flex-col">
        {/* Header */}
        <header className="border-b bg-white/90 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-5 sm:px-8">
            {!isPrivileged && <button type="button" onClick={onBackToWorkspace} className="ft-btn ft-btn-secondary"><ArrowLeft className="h-4 w-4" />Workspace</button>}
            <div className="flex items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-700 text-white"><UserCheck className="h-5 w-5" /></div><span className="text-sm font-extrabold">Công ca{selectedEmpName ? ` — ${selectedEmpName}` : ''}</span></div>
            <div className="hidden text-right sm:block"><p className="text-xs font-bold text-slate-500">{new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date())}</p></div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-8 sm:px-8 sm:py-10">
          {/* Title row */}
          <section className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase text-emerald-600">Xin chào, {userName}</p>
              <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Bảng công cá nhân</h1>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void load()} disabled={loading} className="ft-btn ft-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Làm mới</button>
              <button type="button" onClick={() => void openPopup()} className="ft-btn ft-btn-primary"><Plus className="h-4 w-4" />Thêm công ca</button>
            </div>
          </section>

          {error && <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" /><span>{error}</span></div>}

          {/* Missing weekday warnings (no buttons) */}
          {missingWeekdays.length > 0 && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div>
                  <p className="text-sm font-bold text-amber-900">Các ngày chưa có công ca trong tháng:</p>
                  <p className="mt-1 text-sm text-amber-800">{missingWeekdays.map(d => fmtDate(d)).join(', ')}</p>
                </div>
              </div>
            </div>
          )}

          {/* Summary — top */}
          <div className="mb-6 rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase text-emerald-600">Tổng quan{selectedEmpName ? ` — ${selectedEmpName}` : ''}</p>
                <h2 className="mt-1 text-2xl font-extrabold">Tháng {fmtMonthLabel(month)}</h2>
              </div>
              <label className="relative"><span className="sr-only">Chọn tháng</span><input type="month" value={month} onChange={e => setMonth(e.target.value)} className="ft-input" /></label>
            </div>
            <div className="mt-5 flex flex-wrap gap-8">
              <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><Clock className="h-6 w-6" /></div><div><p className="text-3xl font-extrabold">{fmtHours(summary.totalMinutes)}<span className="ml-1 text-base font-bold text-slate-400">giờ</span></p><p className="text-sm text-slate-500">Tổng giờ làm</p></div></div>
              <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-blue-100 text-blue-700"><MapPin className="h-6 w-6" /></div><div><p className="text-3xl font-extrabold">{fmtHours(summary.offlineMinutes)}<span className="ml-1 text-base font-bold text-slate-400">giờ</span></p><p className="text-sm text-slate-500">Trực tiếp</p></div></div>
              <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-violet-100 text-violet-700"><Laptop className="h-6 w-6" /></div><div><p className="text-3xl font-extrabold">{fmtHours(summary.onlineMinutes)}<span className="ml-1 text-base font-bold text-slate-400">giờ</span></p><p className="text-sm text-slate-500">Online</p></div></div>
            </div>
          </div>

          {/* Edit logs — below summary */}
          {viewEditLogs.length > 0 && (
            <div className="mb-6 rounded-2xl border bg-white p-5 shadow-sm">
              <p className="flex items-center gap-2 text-sm font-bold text-slate-700"><FileText className="h-4 w-4 text-slate-400" />Nhật ký chỉnh sửa ({viewEditLogs.length})</p>
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                {viewEditLogs.map(log => (
                  <div key={log.id} className="rounded-lg border bg-slate-50 px-3 py-2 text-xs">
                    <p className="text-slate-700">
                      <span className="font-bold">{log.editedByName}</span>
                      {' thay đổi lịch làm việc ngày '}
                      <span className="font-bold">{fmtDate(log.workDate)}</span>
                      {log.oldData?.shifts ? <> từ <span className="font-medium text-rose-600">{formatLogShifts(log.oldData)}</span></> : ''}
                      {log.newData?.shifts ? <> thành <span className="font-medium text-emerald-700">{formatLogShifts(log.newData)}</span></> : ''}
                    </p>
                    {log.note && <p className="mt-0.5 text-slate-500 italic">Ghi chú: {log.note}</p>}
                    <p className="mt-0.5 text-slate-400">{new Date(log.createdAt).toLocaleString('vi-VN')}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Monthly grid table */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-emerald-600">Bảng công{selectedEmpName ? ` — ${selectedEmpName}` : ''}</p>
                <h2 className="mt-1 text-xl font-extrabold">Tháng {fmtMonthLabel(month)}</h2>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto rounded-xl border">
              <table className="ft-table min-w-[800px]">
                <thead><tr><th className="w-16">Thứ</th><th className="w-24">Ngày</th><th>Công ca</th><th className="w-20">Giờ</th><th className="w-10"></th><th className="w-10"></th></tr></thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="px-5 py-14 text-center text-slate-400">Đang tải...</td></tr>
                  ) : allDates.map(dateStr => {
                    const entries = entriesByDate.get(dateStr) || [];
                    const weekend = isWeekend(dateStr);
                    const hasDayOff = entries.some(e => e.isDayOff);
                    const hasEntries = entries.length > 0;
                    const dayMinutes = entries.reduce((s, e) => s + (e.isDayOff ? 0 : e.workedMinutes), 0);
                    const today = new Date().toISOString().slice(0, 10);
                    const isPast = dateStr < today;

                    return (
                      <tr key={dateStr} className={`${weekend ? 'bg-slate-50' : ''} ${!hasEntries && isPast && !weekend ? 'bg-amber-50/40' : ''} hover:bg-blue-50/50`}>
                        <td className={`font-bold ${weekend ? 'text-rose-500' : ''}`}>{weekdayName(dateStr)}</td>
                        <td className="tabular-nums">{fmtDate(dateStr)}</td>
                        <td className="whitespace-pre-wrap text-xs leading-5">
                          {hasDayOff ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800"><Moon className="h-3 w-3" />Nghỉ</span>
                          ) : hasEntries ? (
                            entries.map((e, i) => (
                              <div key={i} className="flex items-center gap-1">
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${e.workMode === 'online' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                                <span className="text-slate-700">{modeLabel(e.workMode)}: {e.shiftStart} - {e.shiftEnd}</span>
                              </div>
                            ))
                          ) : weekend ? (
                            <span className="text-xs text-slate-300">Nghỉ</span>
                          ) : isPast ? (
                            <span className="text-xs text-amber-500">Chưa có</span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="tabular-nums text-xs font-bold">{dayMinutes > 0 ? `${fmtHours(dayMinutes)}h` : ''}</td>
                        <td>
                          <button type="button" onClick={() => void openPopup(dateStr)} className="rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="Chỉnh sửa"><Edit3 className="h-3.5 w-3.5" /></button>
                        </td>
                        <td>
                          {!hasDayOff ? (
                            <button type="button" onClick={() => void quickDayOff(dateStr)} className="rounded p-1 text-slate-300 hover:bg-amber-50 hover:text-amber-600" title="Xác nhận nghỉ"><Moon className="h-3.5 w-3.5" /></button>
                          ) : (
                            <Check className="h-3.5 w-3.5 text-amber-500" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>{/* end flex-1 wrapper */}

      {/* ---------- Popup ---------- */}
      {popupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setPopupOpen(false); }}>
          <div className="w-full max-w-3xl rounded-2xl border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <p className="text-xs font-bold uppercase text-emerald-600">{isEdit ? 'Chỉnh sửa' : 'Thêm mới'}</p>
                <h2 className="mt-0.5 text-lg font-extrabold">Công ca ngày {fmtDate(popupDate)}</h2>
              </div>
              <button type="button" onClick={() => setPopupOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
              {/* Date picker + day off */}
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

              {/* Edit note */}
              {isEdit && (
                <div className="mt-5">
                  <label><span className="mb-1 block text-sm font-bold text-amber-800">Ghi chú chỉnh sửa <span className="text-rose-500">*</span></span>
                  <textarea className="ft-input min-h-16" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Lý do chỉnh sửa công ca..." maxLength={1000} /></label>
                </div>
              )}

              {/* Edit logs for this date */}
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

              {popupError && <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{popupError}</div>}
            </div>

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
