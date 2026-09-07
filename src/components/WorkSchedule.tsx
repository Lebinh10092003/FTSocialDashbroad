import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight,
  CircleDot, Clock3, ExternalLink, FileSpreadsheet, GripVertical, LayoutDashboard,
  Link2, ListChecks, MessageSquare, MoreHorizontal, Paperclip, Plus, Search,
  Settings2, Star, Users, X,
} from 'lucide-react';
import AccountMenu from './AccountMenu';

type WorkStatus = 'todo' | 'doing' | 'review' | 'done';
type Priority = 'low' | 'medium' | 'high';
type View = 'board' | 'week' | 'team' | 'sheet';

type WorkTask = {
  id: string;
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  status: WorkStatus;
  priority: Priority;
  assignee: string;
  label: string;
  checklistDone: number;
  checklistTotal: number;
  comments: number;
  attachments: number;
  rating?: number;
};

type Props = {
  onBackToWorkspace: () => void;
  onAccountClick: () => void;
  onLogout: () => void;
  userName: string;
  userEmail: string;
  userRole: string;
  photoURL?: string | null;
};

const SHEET_TEMPLATE = 'https://docs.google.com/spreadsheets/d/1kG9wttvkyU7N2T_zHBGz7bTJ65dk-1-ZAMjoXnq_X3U/edit?usp=sharing';
const statusMeta: Record<WorkStatus, { label: string; dot: string; column: string }> = {
  todo: { label: 'Cần làm', dot: 'bg-slate-400', column: 'border-slate-200 bg-slate-100/80' },
  doing: { label: 'Đang thực hiện', dot: 'bg-blue-600', column: 'border-blue-200 bg-blue-50/80' },
  review: { label: 'Chờ phản hồi', dot: 'bg-amber-500', column: 'border-amber-200 bg-amber-50/80' },
  done: { label: 'Đã hoàn thành', dot: 'bg-emerald-600', column: 'border-emerald-200 bg-emerald-50/80' },
};
const priorities: Record<Priority, { label: string; className: string }> = {
  high: { label: 'Ưu tiên cao', className: 'bg-rose-50 text-rose-700' },
  medium: { label: 'Ưu tiên vừa', className: 'bg-amber-50 text-amber-700' },
  low: { label: 'Ưu tiên thấp', className: 'bg-slate-100 text-slate-600' },
};

const iso = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};
const mondayOf = (date: Date) => {
  const next = new Date(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  next.setHours(0, 0, 0, 0);
  return next;
};
const dateLabel = (value: string) => new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(new Date(`${value}T00:00:00`));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(-2).map(item => item[0]).join('').toUpperCase();

const makeSeedTasks = (userName: string): WorkTask[] => {
  const monday = mondayOf(new Date());
  return [
    { id: 'work-1', title: 'Hoàn thiện kế hoạch nội dung tháng 9', description: 'Chốt chủ đề, kênh đăng và người phụ trách.', date: iso(monday), startTime: '09:00', endTime: '10:30', status: 'doing', priority: 'high', assignee: userName, label: 'Truyền thông', checklistDone: 3, checklistTotal: 5, comments: 2, attachments: 1 },
    { id: 'work-2', title: 'Họp giao ban đầu tuần', description: 'Cập nhật tiến độ và các điểm đang vướng.', date: iso(addDays(monday, 1)), startTime: '08:30', endTime: '09:30', status: 'done', priority: 'medium', assignee: userName, label: 'Nội bộ', checklistDone: 4, checklistTotal: 4, comments: 1, attachments: 0, rating: 5 },
    { id: 'work-3', title: 'Rà soát hồ sơ đối tác', description: 'Đối chiếu dữ liệu trước khi gửi phê duyệt.', date: iso(addDays(monday, 2)), startTime: '13:30', endTime: '15:00', status: 'todo', priority: 'high', assignee: 'Minh Anh', label: 'Đối tác', checklistDone: 1, checklistTotal: 4, comments: 3, attachments: 2 },
    { id: 'work-4', title: 'Chuẩn bị tài liệu đào tạo AI', description: 'Tổng hợp ví dụ thực hành cho buổi tập huấn.', date: iso(addDays(monday, 3)), startTime: '10:00', endTime: '12:00', status: 'review', priority: 'medium', assignee: 'Quang Huy', label: 'Đào tạo', checklistDone: 5, checklistTotal: 6, comments: 4, attachments: 3 },
    { id: 'work-5', title: 'Gửi báo cáo tiến độ tuần', description: 'Tóm tắt kết quả và kế hoạch tuần kế tiếp.', date: iso(addDays(monday, 4)), startTime: '15:30', endTime: '16:30', status: 'todo', priority: 'low', assignee: userName, label: 'Báo cáo', checklistDone: 0, checklistTotal: 3, comments: 0, attachments: 0 },
    { id: 'work-6', title: 'Cập nhật dữ liệu khách hàng', description: 'Bổ sung ghi chú sau buổi làm việc.', date: iso(addDays(monday, 2)), startTime: '09:30', endTime: '11:00', status: 'doing', priority: 'medium', assignee: 'Minh Anh', label: 'Kinh doanh', checklistDone: 2, checklistTotal: 3, comments: 1, attachments: 0 },
  ];
};

const blankTask = (userName: string, date = iso(new Date())): WorkTask => ({
  id: '', title: '', description: '', date, startTime: '09:00', endTime: '10:00', status: 'todo',
  priority: 'medium', assignee: userName, label: 'Công việc', checklistDone: 0, checklistTotal: 0, comments: 0, attachments: 0,
});

function TaskCard({ task, onOpen, onDragStart }: { task: WorkTask; onOpen: () => void; onDragStart: () => void }) {
  const progress = task.checklistTotal ? Math.round(task.checklistDone / task.checklistTotal * 100) : 0;
  return (
    <article draggable onDragStart={onDragStart} onClick={onOpen} className="group cursor-grab rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md active:cursor-grabbing">
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className={`rounded-md px-2 py-1 text-[11px] font-bold ${priorities[task.priority].className}`}>{priorities[task.priority].label}</span>
        <div className="flex items-center gap-1 text-slate-300"><GripVertical className="h-4 w-4 opacity-0 transition group-hover:opacity-100"/><MoreHorizontal className="h-4 w-4"/></div>
      </div>
      <h3 className="text-sm font-bold leading-5 text-slate-900">{task.title}</h3>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{task.description}</p>
      <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Clock3 className="h-3.5 w-3.5"/>{dateLabel(task.date)} · {task.startTime}–{task.endTime}</div>
      {task.checklistTotal > 0 && <div className="mt-3"><div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-slate-500"><span>{task.checklistDone}/{task.checklistTotal} đầu việc</span><span>{progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${task.status === 'done' ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${progress}%` }}/></div></div>}
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
        <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-400">{task.comments > 0 && <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5"/>{task.comments}</span>}{task.attachments > 0 && <span className="flex items-center gap-1"><Paperclip className="h-3.5 w-3.5"/>{task.attachments}</span>}</div>
        <span title={task.assignee} className="grid h-7 w-7 place-items-center rounded-full bg-[#0055da] text-[10px] font-extrabold text-white">{initials(task.assignee)}</span>
      </div>
    </article>
  );
}

export default function WorkSchedule({ onBackToWorkspace, onAccountClick, onLogout, userName, userEmail, userRole, photoURL }: Props) {
  const storageKey = `ft-work-schedule:${userEmail}`;
  const sheetKey = `ft-work-schedule-sheet:${userEmail}`;
  const [view, setView] = useState<View>('board');
  const [tasks, setTasks] = useState<WorkTask[]>(() => {
    try { const saved = localStorage.getItem(storageKey); return saved ? JSON.parse(saved) : makeSeedTasks(userName); } catch { return makeSeedTasks(userName); }
  });
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkTask | null>(null);
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState(userName);
  const [sheetUrl, setSheetUrl] = useState(() => localStorage.getItem(sheetKey) || SHEET_TEMPLATE);
  const [sheetNotice, setSheetNotice] = useState('');
  const canManageTeam = userRole === 'ADMIN' || userRole === 'MANAGER';
  const assignees = useMemo(() => Array.from(new Set([userName, ...tasks.map(item => item.assignee)])), [tasks, userName]);
  const visibleTasks = useMemo(() => tasks.filter(task => {
    const matchesPerson = person === 'all' || task.assignee === person;
    const haystack = `${task.title} ${task.description} ${task.label}`.toLocaleLowerCase('vi-VN');
    return matchesPerson && haystack.includes(query.trim().toLocaleLowerCase('vi-VN'));
  }), [tasks, person, query]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(tasks)); }, [storageKey, tasks]);

  const moveTask = (patch: Partial<WorkTask>) => {
    if (!draggedId) return;
    setTasks(rows => rows.map(item => item.id === draggedId ? { ...item, ...patch } : item));
    setDraggedId(null);
  };
  const saveTask = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing?.title.trim()) return;
    const next = { ...editing, title: editing.title.trim(), id: editing.id || `work-${Date.now()}` };
    setTasks(rows => editing.id ? rows.map(item => item.id === editing.id ? next : item) : [next, ...rows]);
    setEditing(null);
  };
  const openNew = (date?: string, assignee?: string) => setEditing(blankTask(assignee || (person !== 'all' ? person : userName), date));
  const completion = tasks.length ? Math.round(tasks.filter(item => item.status === 'done').length / tasks.length * 100) : 0;
  const weekTitle = `${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(weekDays[0])} – ${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(weekDays[6])}`;

  const navItems: Array<{ id: View; label: string; icon: React.ElementType }> = [
    { id: 'board', label: 'Công việc của tôi', icon: LayoutDashboard },
    { id: 'week', label: 'Lịch tuần', icon: CalendarDays },
    ...(canManageTeam ? [{ id: 'team' as View, label: 'Nhân viên dưới quyền', icon: Users }] : []),
    { id: 'sheet', label: 'Liên kết Google Sheets', icon: FileSpreadsheet },
  ];

  return (
    <div className="ws-shell min-h-dvh bg-[#f5f7fb] text-slate-900">
      <aside className="ws-sidebar">
        <div className="border-b border-white/15 p-5"><div className="rounded-2xl bg-white p-3 shadow-lg"><img src="/logo.png" alt="FermatTech" className="h-7 object-contain"/></div><div className="mt-5 flex items-center gap-3 px-1"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white/15"><CalendarDays className="h-5 w-5"/></div><div><b className="block text-sm">Lịch làm việc</b><span className="text-[11px] text-blue-100">Cá nhân & đội nhóm</span></div></div></div>
        <nav className="flex-1 space-y-1 p-3">{navItems.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => { setView(item.id); if (item.id !== 'team') setPerson(userName); }} className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm font-semibold transition ${view === item.id ? 'bg-white text-[#0055da] shadow-sm' : 'text-blue-50 hover:bg-white/10'}`}><Icon className="h-4.5 w-4.5"/>{item.label}</button>; })}</nav>
        <div className="p-3"><button type="button" onClick={onBackToWorkspace} className="mb-3 flex w-full items-center gap-3 rounded-xl border border-white/15 px-3.5 py-3 text-sm font-semibold text-blue-50 hover:bg-white/10"><ArrowLeft className="h-4 w-4"/>Về Workspace</button><AccountMenu userName={userName} photoURL={photoURL} userRole={userRole} isGuest={false} onAccountClick={onAccountClick} onLogout={onLogout} variant="sidebar"/></div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8"><div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-blue-600">Không gian làm việc</p><h1 className="text-xl font-extrabold tracking-tight text-[#001e40]">{navItems.find(item => item.id === view)?.label}</h1></div><div className="flex items-center gap-2"><label className="relative hidden md:block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm công việc..." className="w-56 rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"/></label><button type="button" onClick={() => openNew()} className="inline-flex items-center gap-2 rounded-xl bg-[#0055da] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-200 hover:bg-[#0048ba]"><Plus className="h-4 w-4"/>Công việc mới</button></div></div></header>

        <div className="mx-auto max-w-[1680px] p-4 sm:p-6 lg:p-8">
          {view !== 'sheet' && <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="ws-stat"><span className="ws-stat-icon bg-blue-50 text-blue-700"><ListChecks/></span><div><span>Tổng công việc</span><b>{visibleTasks.length}</b></div></div><div className="ws-stat"><span className="ws-stat-icon bg-sky-50 text-sky-700"><CircleDot/></span><div><span>Đang thực hiện</span><b>{visibleTasks.filter(item => item.status === 'doing').length}</b></div></div><div className="ws-stat"><span className="ws-stat-icon bg-emerald-50 text-emerald-700"><CheckCircle2/></span><div><span>Đã hoàn thành</span><b>{visibleTasks.filter(item => item.status === 'done').length}</b></div></div><div className="ws-stat"><span className="ws-stat-icon bg-violet-50 text-violet-700"><Star/></span><div><span>Tiến độ chung</span><b>{completion}%</b></div></div></section>}

          {view === 'board' && <><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold text-[#001e40]">Bảng công việc tuần này</h2><p className="mt-1 text-sm text-slate-500">Kéo thẻ sang cột khác để cập nhật trạng thái.</p></div><span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600">{weekTitle}</span></div><div className="ws-board">{(Object.keys(statusMeta) as WorkStatus[]).map(status => <section key={status} onDragOver={event => event.preventDefault()} onDrop={() => moveTask({ status })} className={`min-w-[280px] rounded-2xl border p-3 ${statusMeta[status].column}`}><div className="mb-3 flex items-center justify-between px-1"><div className="flex items-center gap-2"><i className={`h-2.5 w-2.5 rounded-full ${statusMeta[status].dot}`}/><h3 className="text-sm font-extrabold text-slate-800">{statusMeta[status].label}</h3><span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500">{visibleTasks.filter(item => item.status === status).length}</span></div><button type="button" onClick={() => setEditing({ ...blankTask(userName), status })} aria-label={`Thêm vào ${statusMeta[status].label}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-blue-600"><Plus className="h-4 w-4"/></button></div><div className="space-y-3">{visibleTasks.filter(item => item.status === status).map(task => <TaskCard key={task.id} task={task} onOpen={() => setEditing(task)} onDragStart={() => setDraggedId(task.id)}/>)}{!visibleTasks.some(item => item.status === status) && <button type="button" onClick={() => setEditing({ ...blankTask(userName), status })} className="w-full rounded-xl border border-dashed border-slate-300 bg-white/50 py-5 text-xs font-semibold text-slate-400 hover:border-blue-300 hover:text-blue-600">+ Thêm công việc</button>}</div></section>)}</div></>}

          {view === 'week' && <><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold text-[#001e40]">Lịch cá nhân</h2><p className="mt-1 text-sm text-slate-500">Kéo công việc sang ngày khác để đổi lịch.</p></div><div className="flex items-center rounded-xl border border-slate-200 bg-white p-1"><button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Tuần trước"><ChevronLeft className="h-4 w-4"/></button><button type="button" onClick={() => setWeekStart(mondayOf(new Date()))} className="px-3 text-xs font-bold text-slate-700">Hôm nay</button><button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Tuần sau"><ChevronRight className="h-4 w-4"/></button></div></div><section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="grid min-w-[980px] grid-cols-7 divide-x divide-slate-200">{weekDays.map((day, index) => { const dayIso = iso(day); const dayTasks = visibleTasks.filter(task => task.date === dayIso).sort((a, b) => a.startTime.localeCompare(b.startTime)); const isToday = dayIso === iso(new Date()); return <div key={dayIso} onDragOver={event => event.preventDefault()} onDrop={() => moveTask({ date: dayIso })} className="min-h-[540px] bg-[linear-gradient(to_bottom,transparent_59px,#eef2f7_60px)] bg-[length:100%_60px]"><div className={`sticky top-0 z-10 border-b p-3 text-center ${isToday ? 'bg-blue-600 text-white' : 'bg-white text-slate-700'}`}><p className="text-[11px] font-bold uppercase">{new Intl.DateTimeFormat('vi-VN', { weekday: 'short' }).format(day)}</p><b className="mt-1 block text-xl">{day.getDate()}</b></div><div className="space-y-2 p-2">{dayTasks.map(task => <button draggable onDragStart={() => setDraggedId(task.id)} onClick={() => setEditing(task)} key={task.id} type="button" className={`w-full cursor-grab rounded-xl border-l-4 p-3 text-left shadow-sm transition hover:shadow-md ${task.status === 'done' ? 'border-emerald-500 bg-emerald-50' : task.status === 'doing' ? 'border-blue-600 bg-blue-50' : task.status === 'review' ? 'border-amber-500 bg-amber-50' : 'border-slate-400 bg-white'}`}><span className="block text-[11px] font-bold text-slate-500">{task.startTime}–{task.endTime}</span><b className="mt-1 block text-xs leading-5 text-slate-800">{task.title}</b><span className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-slate-500"><i className={`h-2 w-2 rounded-full ${statusMeta[task.status].dot}`}/>{statusMeta[task.status].label}</span></button>)}<button type="button" onClick={() => openNew(dayIso)} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 py-2 text-[11px] font-semibold text-slate-400 hover:border-blue-300 hover:text-blue-600"><Plus className="h-3 w-3"/>Thêm</button></div></div>; })}</div></section></>}

          {view === 'team' && <><div className="mb-5"><h2 className="text-lg font-extrabold text-[#001e40]">Lịch đội nhóm</h2><p className="mt-1 text-sm text-slate-500">Theo dõi khối lượng và giao việc cho nhân viên dưới quyền.</p></div><div className="mb-6 grid gap-3 md:grid-cols-3">{assignees.map(name => { const rows = tasks.filter(item => item.assignee === name); const done = rows.filter(item => item.status === 'done').length; return <button type="button" key={name} onClick={() => setPerson(name)} className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition ${person === name ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-200'}`}><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-100 text-xs font-extrabold text-blue-700">{initials(name)}</span><span className="text-xs font-bold text-slate-400">{rows.length} việc</span></div><b className="mt-3 block text-sm text-slate-900">{name}</b><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${rows.length ? done / rows.length * 100 : 0}%` }}/></div><span className="mt-2 block text-[11px] font-semibold text-slate-500">Hoàn thành {rows.length ? Math.round(done / rows.length * 100) : 0}%</span></button>; })}</div><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-extrabold text-[#001e40]">Công việc của {person}</h3><p className="text-xs text-slate-500">Bấm vào công việc để cập nhật, hoặc kéo ở chế độ Kanban.</p></div><button type="button" onClick={() => openNew(undefined, person)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700"><Plus className="h-3.5 w-3.5"/>Giao việc</button></div><div className="divide-y divide-slate-100">{visibleTasks.map(task => <button type="button" onClick={() => setEditing(task)} key={task.id} className="grid w-full gap-3 py-4 text-left hover:bg-slate-50 sm:grid-cols-[1fr_140px_130px]"><div><b className="text-sm text-slate-800">{task.title}</b><p className="mt-1 text-xs text-slate-500">{task.label} · {task.startTime}–{task.endTime}</p></div><span className="text-xs font-semibold text-slate-600">{dateLabel(task.date)}</span><span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-bold ${task.status === 'done' ? 'bg-emerald-50 text-emerald-700' : task.status === 'doing' ? 'bg-blue-50 text-blue-700' : task.status === 'review' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{statusMeta[task.status].label}</span></button>)}</div></section></>}

          {view === 'sheet' && <section className="mx-auto max-w-4xl"><div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="bg-gradient-to-br from-[#0055da] to-[#003a98] p-6 text-white sm:p-8"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15"><FileSpreadsheet className="h-6 w-6"/></span><h2 className="mt-5 text-2xl font-extrabold">Liên kết lịch công tác Google Sheets</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">Mỗi nhân viên có thể gắn lịch cá nhân với một bảng tính riêng. Ở bản giao diện này, hệ thống lưu liên kết để mở nhanh và chuẩn bị cho bước đồng bộ hai chiều.</p></div><div className="p-6 sm:p-8"><label className="text-sm font-bold text-slate-800">Đường dẫn Google Sheets của nhân viên</label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={sheetUrl} onChange={event => setSheetUrl(event.target.value)} className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"/></div><button type="button" onClick={() => { if (!sheetUrl.includes('docs.google.com/spreadsheets/')) { setSheetNotice('Vui lòng nhập đúng đường dẫn Google Sheets.'); return; } localStorage.setItem(sheetKey, sheetUrl); setSheetNotice('Đã lưu liên kết cho tài khoản này.'); }} className="rounded-xl bg-[#0055da] px-5 py-3 text-sm font-bold text-white">Lưu liên kết</button></div>{sheetNotice && <p className={`mt-3 text-sm font-semibold ${sheetNotice.startsWith('Đã') ? 'text-emerald-700' : 'text-rose-700'}`}>{sheetNotice}</p>}<div className="mt-6 grid gap-3 sm:grid-cols-3">{[['1', 'Nhiệm vụ', 'Tên việc, mô tả, người phụ trách'], ['2', 'Thời gian', 'Ngày, giờ bắt đầu và kết thúc'], ['3', 'Kết quả ngày', 'Trạng thái, tiến độ và tự đánh giá']].map(([step, title, text]) => <div key={step} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-100 text-xs font-extrabold text-blue-700">{step}</span><b className="mt-3 block text-sm">{title}</b><p className="mt-1 text-xs leading-5 text-slate-500">{text}</p></div>)}</div><div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={() => window.open(sheetUrl || SHEET_TEMPLATE, '_blank', 'noopener,noreferrer')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700"><ExternalLink className="h-4 w-4"/>Mở bảng tính</button><button type="button" onClick={() => setSheetUrl(SHEET_TEMPLATE)} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-50"><Settings2 className="h-4 w-4"/>Dùng lại mẫu FT</button></div></div></div></section>}
        </div>
      </main>

      {editing && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}><form onSubmit={saveTask} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">Chi tiết công việc</p><h2 className="mt-1 text-xl font-extrabold text-[#001e40]">{editing.id ? 'Cập nhật lịch làm việc' : 'Thêm lịch làm việc mới'}</h2></div><button type="button" onClick={() => setEditing(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5"/></button></div><div className="space-y-5 p-6"><label className="block"><span className="ws-label">Tên công việc *</span><input autoFocus required value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} placeholder="Ví dụ: Chuẩn bị báo cáo tuần" className="ws-input"/></label><label className="block"><span className="ws-label">Mô tả</span><textarea rows={3} value={editing.description} onChange={event => setEditing({ ...editing, description: event.target.value })} className="ws-input resize-none" placeholder="Kết quả cần đạt, tài liệu liên quan..."/></label><div className="grid gap-4 sm:grid-cols-2"><label><span className="ws-label">Trạng thái</span><select value={editing.status} onChange={event => setEditing({ ...editing, status: event.target.value as WorkStatus })} className="ws-input">{Object.entries(statusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label><label><span className="ws-label">Mức ưu tiên</span><select value={editing.priority} onChange={event => setEditing({ ...editing, priority: event.target.value as Priority })} className="ws-input">{Object.entries(priorities).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label><label><span className="ws-label">Ngày thực hiện</span><input type="date" required value={editing.date} onChange={event => setEditing({ ...editing, date: event.target.value })} className="ws-input"/></label><label><span className="ws-label">Người phụ trách</span><select value={editing.assignee} onChange={event => setEditing({ ...editing, assignee: event.target.value })} className="ws-input">{assignees.map(name => <option key={name}>{name}</option>)}</select></label><label><span className="ws-label">Bắt đầu</span><input type="time" value={editing.startTime} onChange={event => setEditing({ ...editing, startTime: event.target.value })} className="ws-input"/></label><label><span className="ws-label">Kết thúc</span><input type="time" value={editing.endTime} onChange={event => setEditing({ ...editing, endTime: event.target.value })} className="ws-input"/></label><label><span className="ws-label">Nhãn công việc</span><input value={editing.label} onChange={event => setEditing({ ...editing, label: event.target.value })} className="ws-input"/></label><label><span className="ws-label">Tự đánh giá trong ngày</span><select value={editing.rating || ''} onChange={event => setEditing({ ...editing, rating: Number(event.target.value) || undefined })} className="ws-input"><option value="">Chưa đánh giá</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}/5</option>)}</select></label></div><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-2 text-sm font-bold text-slate-700"><Check className="h-4 w-4 text-blue-600"/>Tiến độ đầu việc</div><div className="mt-3 grid grid-cols-2 gap-3"><label><span className="ws-label">Đã xong</span><input min={0} type="number" value={editing.checklistDone} onChange={event => setEditing({ ...editing, checklistDone: Number(event.target.value) })} className="ws-input"/></label><label><span className="ws-label">Tổng số</span><input min={0} type="number" value={editing.checklistTotal} onChange={event => setEditing({ ...editing, checklistTotal: Number(event.target.value) })} className="ws-input"/></label></div></div></div><div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4"><button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600">Hủy</button><button type="submit" className="rounded-xl bg-[#0055da] px-5 py-2.5 text-sm font-bold text-white">{editing.id ? 'Lưu thay đổi' : 'Thêm công việc'}</button></div></form></div>}
    </div>
  );
}
