import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, Coffee, LogIn, LogOut, RefreshCw, Timer, TriangleAlert, UserCheck } from 'lucide-react';

type Shift = { code: string; name: string; start: string; end: string; expectedMinutes: number };
type AttendanceRecord = {
  id: number;
  employee: { email: string; name: string; employeeCode: string; department: string };
  workDate: string;
  shiftCode: string;
  shiftName: string;
  scheduledStart: string;
  scheduledEnd: string;
  expectedMinutes: number;
  clockIn: string;
  clockOut: string | null;
  workedMinutes: number;
  status: 'WORKING' | 'COMPLETE' | 'LATE' | 'INCOMPLETE';
  note: string;
};
type AttendanceData = {
  serverTime: string;
  month: string;
  shifts: Shift[];
  current: AttendanceRecord | null;
  records: AttendanceRecord[];
  summary: { workDays: number; totalMinutes: number; completedShifts: number; lateShifts: number };
};
type AttendanceProps = { onBackToWorkspace: () => void; idToken: string; userName: string };

const statusLabels = {
  WORKING: { label: 'Đang trong ca', className: 'bg-emerald-100 text-emerald-800' },
  COMPLETE: { label: 'Đủ công', className: 'bg-blue-100 text-blue-800' },
  LATE: { label: 'Vào muộn', className: 'bg-amber-100 text-amber-800' },
  INCOMPLETE: { label: 'Thiếu giờ', className: 'bg-rose-100 text-rose-800' },
};

const formatTime = (value: string | null) => value ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const formatDate = (value: string) => new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(`${value}T00:00:00`));
const formatDuration = (minutes: number) => `${Math.floor(minutes / 60)}g ${String(minutes % 60).padStart(2, '0')}p`;
const currentMonth = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; };

export default function Attendance({ onBackToWorkspace, idToken, userName }: AttendanceProps) {
  const [data, setData] = useState<AttendanceData | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [selectedShift, setSelectedShift] = useState('OFFICE');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(new Date());

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`/api/attendance/records?month=${month}`, { headers: { Authorization: `Bearer ${idToken}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Không thể tải dữ liệu chấm công.');
      setData(body);
      setError('');
    } catch (loadError: any) {
      setError(loadError.message || 'Không thể tải dữ liệu chấm công.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [month, idToken]);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3000); return () => window.clearTimeout(timer); }, [notice]);

  const clock = async (action: 'IN' | 'OUT') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/attendance/clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ action, shiftCode: selectedShift, note }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Không thể ghi nhận chấm công.');
      setNotice(body.message || 'Đã ghi nhận chấm công.');
      if (action === 'IN') setNote('');
      await load(true);
    } catch (clockError: any) {
      setError(clockError.message || 'Không thể ghi nhận chấm công.');
    } finally {
      setBusy(false);
    }
  };

  const current = data?.current || null;
  const liveElapsed = useMemo(() => current ? Math.max(0, Math.floor((now.getTime() - new Date(current.clockIn).getTime()) / 60000)) : 0, [current, now]);
  const greeting = now.getHours() < 12 ? 'Chào buổi sáng' : now.getHours() < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const selected = data?.shifts.find(shift => shift.code === selectedShift);

  return (
    <div className="min-h-dvh bg-[#f3f5f1] font-sans text-[#17231c]">
      <header className="border-b border-[#17231c]/10 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <button type="button" onClick={onBackToWorkspace} className="inline-flex items-center gap-2 text-sm font-bold transition hover:text-[#287153]"><ArrowLeft className="h-4 w-4" />Workspace</button>
          <div className="flex items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#1d4f3b] text-white"><UserCheck className="h-5 w-5" /></div><span className="text-sm font-extrabold">Công ca</span></div>
          <div className="hidden text-right sm:block"><p className="text-xs font-bold text-[#66756d]">{new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(now)}</p><p className="text-sm font-extrabold tabular-nums">{now.toLocaleTimeString('vi-VN')}</p></div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <section className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-[#287153]">{greeting}, {userName}</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-[-0.035em] sm:text-4xl">Ngày làm việc của bạn</h1>
            <p className="mt-2 text-sm text-[#66756d]">Chọn ca và ghi nhận giờ vào — ra ngay tại đây.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 border border-[#17231c]/15 bg-white px-3.5 py-2.5 text-xs font-bold text-[#53645b] shadow-sm transition hover:border-[#287153]/40 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Làm mới</button>
        </section>

        {error && <div className="mb-5 flex items-start gap-3 border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" /><span>{error}</span></div>}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(330px,.85fr)]">
          <section className="overflow-hidden bg-[#173f30] text-white shadow-[0_24px_70px_rgba(23,63,48,.2)]">
            <div className="border-b border-white/10 px-6 py-5 sm:px-8">
              <div className="flex items-center justify-between gap-4">
                <div><p className="text-xs font-extrabold uppercase tracking-[.16em] text-[#9ed9b9]">Máy chấm công</p><h2 className="mt-1 text-xl font-extrabold">{current ? current.shiftName : selected?.name || 'Chọn ca làm việc'}</h2></div>
                <span className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold ${current ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/10 text-white/70'}`}><span className={`h-2 w-2 rounded-full ${current ? 'animate-pulse bg-emerald-400' : 'bg-white/40'}`} />{current ? 'Đang làm việc' : 'Chưa vào ca'}</span>
              </div>
            </div>

            <div className="px-6 py-8 text-center sm:px-8 sm:py-10">
              <p className="text-6xl font-extrabold leading-none tracking-[-0.06em] tabular-nums sm:text-7xl">{now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</p>
              <p className="mt-3 text-sm font-semibold capitalize text-white/55">{new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)}</p>

              {current ? (
                <div className="mx-auto mt-8 grid max-w-lg grid-cols-3 divide-x divide-white/10 border border-white/10 bg-white/[0.05] py-4">
                  <div><p className="text-[10px] font-bold uppercase tracking-wider text-white/45">Giờ vào</p><p className="mt-1 text-lg font-extrabold">{formatTime(current.clockIn)}</p></div>
                  <div><p className="text-[10px] font-bold uppercase tracking-wider text-white/45">Đã trong ca</p><p className="mt-1 text-lg font-extrabold">{formatDuration(liveElapsed)}</p></div>
                  <div><p className="text-[10px] font-bold uppercase tracking-wider text-white/45">Giờ dự kiến</p><p className="mt-1 text-lg font-extrabold">{current.scheduledEnd}</p></div>
                </div>
              ) : (
                <div className="mx-auto mt-8 grid max-w-xl gap-2 sm:grid-cols-2">
                  {(data?.shifts || []).map(shift => <button key={shift.code} type="button" onClick={() => setSelectedShift(shift.code)} className={`flex items-center justify-between border px-4 py-3 text-left transition ${selectedShift === shift.code ? 'border-[#8bd6ad] bg-[#8bd6ad] text-[#173f30]' : 'border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.09]'}`}><span><b className="block text-sm">{shift.name}</b><span className={`text-xs ${selectedShift === shift.code ? 'text-[#173f30]/65' : 'text-white/50'}`}>{shift.start} — {shift.end}</span></span>{selectedShift === shift.code && <CheckCircle2 className="h-5 w-5" />}</button>)}
                </div>
              )}

              {!current && <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} rows={2} placeholder="Ghi chú cho ca làm việc (tùy chọn)" className="mx-auto mt-4 block w-full max-w-xl resize-none border border-white/15 bg-white/[0.06] px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#8bd6ad]" />}

              <button type="button" onClick={() => void clock(current ? 'OUT' : 'IN')} disabled={busy || loading || (!current && !selected)} className={`mx-auto mt-6 inline-flex min-h-16 w-full max-w-xl items-center justify-center gap-3 px-6 text-base font-extrabold shadow-xl transition active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50 ${current ? 'bg-[#f3a261] text-[#3b2418] hover:bg-[#ffb47b]' : 'bg-[#8bd6ad] text-[#173f30] hover:bg-[#a1e5c0]'}`}>
                {busy ? <RefreshCw className="h-5 w-5 animate-spin" /> : current ? <LogOut className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
                {busy ? 'Đang ghi nhận...' : current ? 'Bấm để ra ca' : 'Bấm để vào ca'}
              </button>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="border border-[#17231c]/10 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div><p className="text-xs font-extrabold uppercase tracking-[.14em] text-[#287153]">Tổng quan</p><h2 className="mt-1 text-xl font-extrabold">Công tháng này</h2></div>
                <label className="relative"><span className="sr-only">Chọn tháng</span><input type="month" value={month} onChange={event => setMonth(event.target.value)} className="border border-[#17231c]/15 bg-[#f7f8f6] px-3 py-2 text-xs font-bold outline-none focus:border-[#287153]" /></label>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden border border-[#17231c]/10 bg-[#17231c]/10">
                <div className="bg-white p-4"><CalendarDays className="h-5 w-5 text-[#287153]" /><p className="mt-4 text-2xl font-extrabold">{data?.summary.workDays || 0}</p><p className="mt-1 text-xs font-semibold text-[#66756d]">Ngày có công</p></div>
                <div className="bg-white p-4"><Timer className="h-5 w-5 text-[#287153]" /><p className="mt-4 text-2xl font-extrabold">{formatDuration(data?.summary.totalMinutes || 0)}</p><p className="mt-1 text-xs font-semibold text-[#66756d]">Giờ đã hoàn tất</p></div>
                <div className="bg-white p-4"><CheckCircle2 className="h-5 w-5 text-blue-600" /><p className="mt-4 text-2xl font-extrabold">{data?.summary.completedShifts || 0}</p><p className="mt-1 text-xs font-semibold text-[#66756d]">Ca đã chốt</p></div>
                <div className="bg-white p-4"><Clock3 className="h-5 w-5 text-amber-600" /><p className="mt-4 text-2xl font-extrabold">{data?.summary.lateShifts || 0}</p><p className="mt-1 text-xs font-semibold text-[#66756d]">Lượt vào muộn</p></div>
              </div>
            </section>

            <section className="border border-[#17231c]/10 bg-[#e7eee8] p-5 sm:p-6">
              <div className="flex gap-3"><Coffee className="mt-0.5 h-5 w-5 shrink-0 text-[#287153]" /><div><h3 className="text-sm font-extrabold">Quy tắc tính công</h3><p className="mt-1 text-xs leading-5 text-[#596b61]">Ca hành chính được tính 8 giờ và tự loại trừ thời gian nghỉ trưa 12:00–13:30. Giờ vào muộn hơn 15 phút sẽ được đánh dấu để đối chiếu.</p></div></div>
            </section>
          </aside>
        </div>

        <section className="mt-6 overflow-hidden border border-[#17231c]/10 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#17231c]/10 px-5 py-4 sm:px-6">
            <div><p className="text-xs font-extrabold uppercase tracking-[.14em] text-[#287153]">Lịch sử</p><h2 className="mt-1 text-lg font-extrabold">Bảng công cá nhân</h2></div>
            <p className="text-xs font-semibold text-[#78857e]">Tối đa 500 bản ghi trong tháng</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-[#f7f8f6] text-left text-[11px] font-extrabold uppercase tracking-wider text-[#66756d]"><tr><th className="px-5 py-3">Ngày</th><th className="px-5 py-3">Ca làm việc</th><th className="px-5 py-3">Giờ vào</th><th className="px-5 py-3">Giờ ra</th><th className="px-5 py-3">Thời lượng</th><th className="px-5 py-3">Trạng thái</th><th className="px-5 py-3">Ghi chú</th></tr></thead>
              <tbody className="divide-y divide-[#17231c]/8">
                {loading ? <tr><td colSpan={7} className="px-5 py-14 text-center text-[#78857e]">Đang tải bảng công...</td></tr> : data?.records.length ? data.records.map(record => {
                  const status = statusLabels[record.status];
                  return <tr key={record.id} className="hover:bg-[#f8faf7]"><td className="whitespace-nowrap px-5 py-4 font-bold">{formatDate(record.workDate)}</td><td className="px-5 py-4"><b className="block">{record.shiftName}</b><span className="text-xs text-[#78857e]">{record.scheduledStart}–{record.scheduledEnd}</span></td><td className="px-5 py-4 font-bold tabular-nums text-[#287153]">{formatTime(record.clockIn)}</td><td className="px-5 py-4 font-bold tabular-nums">{formatTime(record.clockOut)}</td><td className="px-5 py-4 tabular-nums">{record.clockOut ? formatDuration(record.workedMinutes) : 'Đang tính'}</td><td className="px-5 py-4"><span className={`inline-flex px-2.5 py-1 text-xs font-bold ${status.className}`}>{status.label}</span></td><td className="max-w-[220px] truncate px-5 py-4 text-xs text-[#66756d]" title={record.note}>{record.note || '—'}</td></tr>;
                }) : <tr><td colSpan={7} className="px-5 py-14 text-center text-[#78857e]">Chưa có dữ liệu công trong tháng này.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {notice && <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 bg-[#173f30] px-4 py-3 text-sm font-bold text-white shadow-2xl" role="status"><CheckCircle2 className="h-4 w-4 text-[#8bd6ad]" />{notice}</div>}
    </div>
  );
}
