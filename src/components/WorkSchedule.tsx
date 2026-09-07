import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDot, ClipboardCheck, ExternalLink, FileSpreadsheet, LayoutDashboard, Link2, ListChecks, Plus, Search, Settings2, Trash2, UserCheck, X } from "lucide-react";
import AccountMenu from "./AccountMenu";
import { appDialog } from "./AppDialog";

type WorkStatus = "todo" | "doing" | "completed" | "reviewed";
type Priority = "low" | "medium" | "high";
type View = "board" | "week" | "sheet";
type Person = { email: string; name: string };
type WorkTask = {
  id: number;
  title: string;
  displayTitle: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  status: WorkStatus;
  displayStatus: WorkStatus;
  priority: Priority;
  label: string;
  dailyOrder: number;
  trainingSessionId?: number | null;
  creator: Person;
  executor: Person;
  supporters: Person[];
  managers: Person[];
  viewerRelation: "executor" | "supporter" | "manager" | "creator";
  needsRevision: boolean;
  revisionCount: number;
  revisionOfId: number | null;
  reviewPercent: number | null;
  reviewNote: string;
  canEdit: boolean;
  canDelete: boolean;
  canReview: boolean;
};
type WorkDraft = {
  id?: number;
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  status: Exclude<WorkStatus, "reviewed">;
  priority: Priority;
  label: string;
  executorEmail: string;
  supporterEmails: string[];
  managerEmails: string[];
  canEdit: boolean;
  canDelete: boolean;
  canReview: boolean;
  reviewPercent: number | null;
  reviewNote: string;
};
type Props = {
  idToken: string;
  onBackToWorkspace: () => void;
  onAccountClick: () => void;
  onLogout: () => void;
  userName: string;
  userEmail: string;
  userRole: string;
  photoURL?: string | null;
};

const SHEET_TEMPLATE = "https://docs.google.com/spreadsheets/d/1kG9wttvkyU7N2T_zHBGz7bTJ65dk-1-ZAMjoXnq_X3U/edit?usp=sharing";
const statuses: Array<{
  id: WorkStatus;
  label: string;
  dot: string;
  column: string;
}> = [
  {
    id: "todo",
    label: "Cần làm",
    dot: "bg-slate-400",
    column: "border-slate-200 bg-slate-100/80",
  },
  {
    id: "doing",
    label: "Đang thực hiện",
    dot: "bg-blue-600",
    column: "border-blue-200 bg-blue-50/80",
  },
  {
    id: "completed",
    label: "Đã hoàn thành",
    dot: "bg-emerald-600",
    column: "border-emerald-200 bg-emerald-50/80",
  },
  {
    id: "reviewed",
    label: "Đã review",
    dot: "bg-violet-600",
    column: "border-violet-200 bg-violet-50/80",
  },
];
const priorities: Record<Priority, { label: string; className: string }> = {
  high: { label: "Ưu tiên cao", className: "bg-rose-50 text-rose-700" },
  medium: { label: "Ưu tiên vừa", className: "bg-amber-50 text-amber-700" },
  low: { label: "Ưu tiên thấp", className: "bg-slate-100 text-slate-600" },
};
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const fromIso = (value: string) => new Date(`${value}T00:00:00`);
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
const addMonths = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth() + amount, 1);
const monthCalendarDays = (date: Date) => {
  const first = new Date(date.getFullYear(), date.getMonth(), 1),
    last = new Date(date.getFullYear(), date.getMonth() + 1, 0),
    start = mondayOf(first),
    lastDay = last.getDay() || 7,
    end = addDays(last, 7 - lastDay),
    count = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return Array.from({ length: count }, (_, index) => addDays(start, index));
};
const weekNumber = (value: string) => {
  const date = fromIso(value);
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};
const prettyDate = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(fromIso(value));
const shortDate = (value: string) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(fromIso(value));
const fullDate = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(fromIso(value));
const weekday = (value: string) => new Intl.DateTimeFormat("vi-VN", { weekday: "long" }).format(fromIso(value)).replace(/^./, (letter) => letter.toUpperCase());
const selfAssessment: Record<WorkStatus, string> = {
  todo: "Cần làm",
  doing: "Đang thực hiện",
  completed: "Hoàn thành",
  reviewed: "Hoàn thành",
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((item) => item[0])
    .join("")
    .toUpperCase();
const authHeaders = (token: string, json = false): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  ...(json ? { "Content-Type": "application/json" } : {}),
});
const draftFromTask = (task: WorkTask): WorkDraft => ({
  id: task.id,
  title: task.title,
  description: task.description,
  date: task.date,
  startTime: task.startTime,
  endTime: task.endTime,
  status: task.status === "reviewed" ? "completed" : task.status,
  priority: task.priority,
  label: task.label,
  executorEmail: task.executor.email,
  supporterEmails: task.supporters.map((item) => item.email),
  managerEmails: task.managers.map((item) => item.email),
  canEdit: task.canEdit && task.status !== "reviewed",
  canDelete: task.canDelete,
  canReview: task.canReview,
  reviewPercent: task.reviewPercent,
  reviewNote: task.reviewNote,
});
const blankDraft = (userEmail: string, date: string): WorkDraft => ({
  title: "",
  description: "",
  date,
  startTime: "",
  endTime: "",
  status: "todo",
  priority: "medium",
  label: "Công việc",
  executorEmail: userEmail,
  supporterEmails: [],
  managerEmails: [],
  canEdit: true,
  canDelete: true,
  canReview: false,
  reviewPercent: null,
  reviewNote: "",
});

function PeoplePicker({ label, staff, selected, onChange, multiple = true, disabled = false }: { label: string; staff: Person[]; selected: string[]; onChange: (emails: string[]) => void; multiple?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedPeople = staff.filter((person) => selected.includes(person.email));
  const matches = staff.filter((person) => `${person.name} ${person.email}`.toLocaleLowerCase("vi-VN").includes(query.trim().toLocaleLowerCase("vi-VN")));
  const toggle = (person: Person) => {
    if (selected.includes(person.email)) {
      onChange(selected.filter((email) => email !== person.email));
      return;
    }
    onChange(multiple ? [...selected, person.email] : [person.email]);
    if (!multiple) setOpen(false);
  };
  return (
    <div className="relative">
      <span className="ws-label">{label}</span>
      <button type="button" disabled={disabled} onClick={() => setOpen((value) => !value)} className="ws-input flex min-h-12 items-center justify-between gap-3 text-left disabled:bg-slate-50" aria-expanded={open}>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {selectedPeople.length ? (
            selectedPeople.map((person) => (
              <span key={person.email} className="inline-flex max-w-full items-center gap-2 rounded-lg bg-blue-50 px-2.5 py-1.5 text-sm font-semibold text-blue-900">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-100 text-[9px] font-extrabold text-blue-700">{initials(person.name)}</span>
                <span className="truncate">{person.name}</span>
              </span>
            ))
          ) : (
            <span className="text-sm text-slate-400">{multiple ? "Chọn một hoặc nhiều nhân sự" : "Chọn người thực hiện"}</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && !disabled && (
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <label className="relative block border-b border-slate-100 p-2">
            <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên hoặc email..." className="w-full rounded-lg bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-200" />
          </label>
          <div className="max-h-60 overflow-y-auto p-2">
            {matches.map((person) => (
              <button key={person.email} type="button" onClick={() => toggle(person)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50 ${selected.includes(person.email) ? "bg-blue-50" : ""}`}>
                <input type={multiple ? "checkbox" : "radio"} readOnly checked={selected.includes(person.email)} tabIndex={-1} />
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-100 text-[10px] font-extrabold text-blue-700">{initials(person.name)}</span>
                <span className="min-w-0">
                  <b className="block truncate text-sm text-slate-800">{person.name}</b>
                  <span className="block truncate text-xs text-slate-400">{person.email}</span>
                </span>
              </button>
            ))}
            {!matches.length && <p className="px-3 py-5 text-center text-sm text-slate-400">Không tìm thấy nhân sự.</p>}
          </div>
          {multiple && (
            <div className="flex justify-end border-t border-slate-100 p-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white">
                Xong
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, selected, onSelect, onOpen, onDelete, onDragStart }: { task: WorkTask; selected: boolean; onSelect: () => void; onOpen: () => void; onDelete: () => void; onDragStart: () => void }) {
  const time = task.startTime || task.endTime ? `${task.startTime || "—"}${task.endTime ? `–${task.endTime}` : ""}` : "Cả ngày";
  return (
    <article draggable={task.canEdit && task.status !== "reviewed" && !task.canReview} onDragStart={onDragStart} onClick={onOpen} className={`group cursor-pointer rounded-2xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${selected ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={selected} onChange={onSelect} onClick={(event) => event.stopPropagation()} aria-label={`Chọn ${task.displayTitle}`} />
          <span className={`rounded-md px-2 py-1 text-[11px] font-bold ${priorities[task.priority].className}`}>{priorities[task.priority].label}</span>
        </div>
        {task.canDelete && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label="Xóa lịch"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <h3 className="text-sm font-bold leading-5 text-slate-900">
        <span className="mr-1.5 text-blue-600">{task.dailyOrder}.</span>
        {task.displayTitle}
      </h3>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{task.description || "Không có mô tả."}</p>
      <div className="mt-3 text-xs font-semibold text-slate-500">
        <span>
          {shortDate(task.date)} · {time}
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
        <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500">
          <UserCheck className="h-3.5 w-3.5" />
          {task.executor.name}
          {task.supporters.length > 0 && <span>· +{task.supporters.length} hỗ trợ</span>}
        </div>
        <span title={task.executor.name} className="grid h-7 w-7 place-items-center rounded-full bg-[#0055da] text-[10px] font-extrabold text-white">
          {initials(task.executor.name)}
        </span>
      </div>
      {task.reviewPercent !== null && (
        <div className="mt-3 rounded-lg bg-violet-50 px-2.5 py-2 text-[11px] font-bold text-violet-700">
          Lãnh đạo đánh giá: {task.reviewPercent}%{task.reviewNote ? ` · ${task.reviewNote}` : ""}
        </div>
      )}
    </article>
  );
}

export default function WorkSchedule({ idToken, onBackToWorkspace, onAccountClick, onLogout, userName, userEmail, userRole, photoURL }: Props) {
  const [view, setView] = useState<View>("board"),
    [tasks, setTasks] = useState<WorkTask[]>([]),
    [staff, setStaff] = useState<Person[]>([{ email: userEmail, name: userName }]),
    [selectedDate, setSelectedDate] = useState(iso(new Date())),
    [weekStart, setWeekStart] = useState(mondayOf(new Date())),
    [calendarPeriod, setCalendarPeriod] = useState<"week" | "month">("week"),
    [calendarLayout, setCalendarLayout] = useState<"calendar" | "table">("table"),
    [editing, setEditing] = useState<WorkDraft | null>(null),
    [selectedIds, setSelectedIds] = useState<number[]>([]),
    [draggedId, setDraggedId] = useState<number | null>(null),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const sheetKey = `ft-work-schedule-sheet:${userEmail}`;
  const [sheetUrl, setSheetUrl] = useState(() => localStorage.getItem(sheetKey) || SHEET_TEMPLATE),
    [sheetNotice, setSheetNotice] = useState("");
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(mondayOf(weekStart), index)), [weekStart]);
  const visibleCalendarDays = useMemo(() => (calendarPeriod === "week" ? weekDays : monthCalendarDays(weekStart)), [calendarPeriod, weekDays, weekStart]);
  const requestJson = async (url: string, options: RequestInit = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...authHeaders(idToken, !!options.body),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Không thể xử lý lịch làm việc.");
    return data;
  };
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [items, people] = await Promise.all([requestJson("/api/work-schedule/items"), requestJson("/api/auth/assignable-staff")]);
      setTasks(Array.isArray(items.items) ? items.items : []);
      setStaff(Array.isArray(people) ? people : []);
    } catch (cause: any) {
      setError(cause.message || "Không thể tải lịch làm việc.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [idToken]);
  const filtered = useMemo(
    () =>
      tasks.filter((task) => {
        const haystack = `${task.displayTitle} ${task.description} ${task.label} ${task.executor.name}`.toLocaleLowerCase("vi-VN");
        return haystack.includes(query.trim().toLocaleLowerCase("vi-VN"));
      }),
    [query, tasks],
  );
  const dailyTasks = filtered.filter((task) => task.date === selectedDate),
    completedCount = dailyTasks.filter((task) => task.status === "completed" || task.status === "reviewed").length,
    completionPercent = dailyTasks.length ? Math.round((completedCount / dailyTasks.length) * 100) : 0,
    selectedTasks = tasks.filter((task) => selectedIds.includes(task.id)),
    canBulkReview = selectedTasks.length > 0 && selectedTasks.every((task) => task.canReview),
    canBulkDelete = selectedTasks.length > 0 && selectedTasks.every((task) => task.canDelete);

  const saveTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    try {
      const data = await requestJson(editing.id ? `/api/work-schedule/items/${editing.id}` : "/api/work-schedule/items", {
        method: editing.id ? "PATCH" : "POST",
        body: JSON.stringify(editing),
      });
      setTasks((rows) => (editing.id ? rows.map((item) => (item.id === data.item.id ? data.item : item)) : [...rows, data.item]));
      setEditing(null);
    } catch (cause: any) {
      void appDialog.alert(cause.message, {
        title: "Không thể lưu công việc",
        tone: "danger",
      });
    }
  };
  const deleteTasks = async (ids: number[]) => {
    const confirmed = await appDialog.confirm(`Bạn có chắc muốn xóa ${ids.length > 1 ? `${ids.length} lịch đã chọn` : "lịch này"}? Dữ liệu đã xóa không thể khôi phục.`, { title: "Xóa lịch làm việc", confirmText: "Xóa lịch", tone: "danger" });
    if (!confirmed) return;
    try {
      if (ids.length === 1)
        await requestJson(`/api/work-schedule/items/${ids[0]}`, {
          method: "DELETE",
        });
      else
        await requestJson("/api/work-schedule/items/batch", {
          method: "POST",
          body: JSON.stringify({ ids, action: "delete" }),
        });
      setTasks((rows) => rows.filter((item) => !ids.includes(item.id)));
      setSelectedIds([]);
      setEditing(null);
    } catch (cause: any) {
      void appDialog.alert(cause.message, {
        title: "Không thể xóa lịch",
        tone: "danger",
      });
    }
  };
  const batchStatus = async (nextStatus: "todo" | "doing" | "completed") => {
    try {
      await requestJson("/api/work-schedule/items/batch", {
        method: "POST",
        body: JSON.stringify({
          ids: selectedIds,
          action: "status",
          status: nextStatus,
        }),
      });
      setSelectedIds([]);
      await load();
    } catch (cause: any) {
      void appDialog.alert(cause.message, {
        title: "Không thể cập nhật hàng loạt",
        tone: "danger",
      });
    }
  };
  const review = async (action: "request_revision" | "confirm", draft = editing) => {
    if (!draft?.id || draft.reviewPercent === null) {
      void appDialog.alert("Vui lòng nhập mức độ hoàn thành từ 0 đến 100%.", {
        title: "Thiếu đánh giá",
        tone: "warning",
      });
      return;
    }
    try {
      await requestJson(`/api/work-schedule/items/${draft.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          action,
          reviewPercent: draft.reviewPercent,
          reviewNote: draft.reviewNote,
        }),
      });
      setEditing(null);
      await load();
    } catch (cause: any) {
      void appDialog.alert(cause.message, {
        title: "Không thể review công việc",
        tone: "danger",
      });
    }
  };
  const batchReview = async (action: "request_revision" | "confirm") => {
    const value = await appDialog.prompt("Nhập mức độ hoàn thành áp dụng cho các công việc đã chọn (0–100).", {
      title: action === "confirm" ? "Xác nhận hoàn thành hàng loạt" : "Yêu cầu bổ sung hàng loạt",
      inputType: "number",
      placeholder: "100",
    });
    if (value === null) return;
    try {
      await requestJson("/api/work-schedule/items/batch", {
        method: "POST",
        body: JSON.stringify({
          ids: selectedIds,
          action,
          reviewPercent: Number(value),
        }),
      });
      setSelectedIds([]);
      await load();
    } catch (cause: any) {
      void appDialog.alert(cause.message, {
        title: "Không thể review hàng loạt",
        tone: "danger",
      });
    }
  };
  const moveTask = async (patch: { status?: WorkStatus; date?: string }) => {
    const task = tasks.find((item) => item.id === draggedId);
    setDraggedId(null);
    if (!task || !task.canEdit || task.status === "reviewed" || task.canReview) return;
    const previousTasks = tasks,
      targetDate = patch.date || task.date,
      nextOrder = Math.max(0, ...tasks.filter((item) => item.executor.email === task.executor.email && item.date === targetDate && item.id !== task.id).map((item) => item.dailyOrder)) + 1;
    setTasks((rows) =>
      rows.map((item) =>
        item.id === task.id
          ? {
              ...item,
              date: targetDate,
              dailyOrder: patch.date && patch.date !== task.date ? nextOrder : item.dailyOrder,
              status: patch.status && patch.status !== "reviewed" ? patch.status : item.status,
              displayStatus: patch.status || item.displayStatus,
            }
          : item,
      ),
    );
    const draft = {
      ...draftFromTask(task),
      ...patch,
      status: (patch.status === "reviewed" ? task.status : patch.status || task.status) as Exclude<WorkStatus, "reviewed">,
    };
    try {
      await requestJson(`/api/work-schedule/items/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      await load();
    } catch (cause: any) {
      setTasks(previousTasks);
      void appDialog.alert(cause.message, {
        title: "Không thể di chuyển lịch",
        tone: "danger",
      });
    }
  };
  const navItems: Array<{ id: View; label: string; icon: React.ElementType }> = [
    { id: "board", label: "Công việc theo ngày", icon: LayoutDashboard },
    { id: "week", label: "Lịch tuần / tháng", icon: CalendarDays },
    { id: "sheet", label: "Liên kết Google Sheets", icon: FileSpreadsheet },
  ];

  return (
    <div className="ws-shell min-h-dvh bg-[#f5f7fb] text-slate-900">
      <aside className="ws-sidebar">
        <div className="border-b border-white/15 p-5">
          <div className="rounded-2xl bg-white p-3 shadow-lg">
            <img src="/logo.png" alt="FermatTech" className="h-7 object-contain" />
          </div>
          <div className="mt-5 flex items-center gap-3 px-1">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/15">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <b className="block text-sm">Lịch làm việc</b>
              <span className="text-[11px] text-blue-100">Cá nhân & đội nhóm</span>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" onClick={() => setView(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm font-semibold transition ${view === item.id ? "bg-white text-[#0055da] shadow-sm" : "text-blue-50 hover:bg-white/10"}`}>
                <Icon className="h-4.5 w-4.5" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="p-3">
          <button type="button" onClick={onBackToWorkspace} className="mb-3 flex w-full items-center gap-3 rounded-xl border border-white/15 px-3.5 py-3 text-sm font-semibold text-blue-50 hover:bg-white/10">
            <ArrowLeft className="h-4 w-4" />
            Về Workspace
          </button>
          <AccountMenu userName={userName} photoURL={photoURL} userRole={userRole} isGuest={false} onAccountClick={onAccountClick} onLogout={onLogout} variant="sidebar" />
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-600">Không gian làm việc</p>
              <h1 className="text-xl font-extrabold tracking-tight text-[#001e40]">{navItems.find((item) => item.id === view)?.label}</h1>
            </div>
            <div className="flex items-center gap-2">
              <label className="relative hidden md:block">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm công việc..." className="w-56 rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-400" />
              </label>
              <button type="button" onClick={() => setEditing(blankDraft(userEmail, selectedDate))} className="inline-flex items-center gap-2 rounded-xl bg-[#0055da] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-200">
                <Plus className="h-4 w-4" />
                Công việc mới
              </button>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-[1680px] p-4 sm:p-6 lg:p-8">
          {error && (
            <div className="mb-5 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              <span>{error}</span>
              <button type="button" onClick={() => void load()} className="rounded-lg bg-white px-3 py-1.5">
                Thử lại
              </button>
            </div>
          )}
          {view !== "sheet" && view !== "week" && (
            <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="ws-stat">
                <span className="ws-stat-icon bg-blue-50 text-blue-700">
                  <ListChecks />
                </span>
                <div>
                  <span>Công việc trong ngày</span>
                  <b>{dailyTasks.length}</b>
                </div>
              </div>
              <div className="ws-stat">
                <span className="ws-stat-icon bg-sky-50 text-sky-700">
                  <CircleDot />
                </span>
                <div>
                  <span>Đang thực hiện</span>
                  <b>{dailyTasks.filter((item) => item.status === "doing").length}</b>
                </div>
              </div>
              <div className="ws-stat">
                <span className="ws-stat-icon bg-emerald-50 text-emerald-700">
                  <CheckCircle2 />
                </span>
                <div>
                  <span>Đã làm xong</span>
                  <b>{completedCount}</b>
                </div>
              </div>
              <div className="ws-stat">
                <span className="ws-stat-icon bg-violet-50 text-violet-700">
                  <ClipboardCheck />
                </span>
                <div>
                  <span>Tiến độ chung</span>
                  <b>
                    {completedCount}/{dailyTasks.length} đầu việc
                  </b>
                  <small className="text-[11px] font-semibold text-violet-600">{completionPercent}%</small>
                </div>
              </div>
            </section>
          )}
          {selectedIds.length > 0 && view !== "sheet" && (
            <div className="sticky top-[76px] z-20 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-white p-3 shadow-lg">
              <b className="mr-2 text-sm text-blue-800">Đã chọn {selectedIds.length}</b>
              <button onClick={() => void batchStatus("todo")} className="ws-bulk-btn">
                Cần làm
              </button>
              <button onClick={() => void batchStatus("doing")} className="ws-bulk-btn text-blue-700">
                Đang thực hiện
              </button>
              <button onClick={() => void batchStatus("completed")} className="ws-bulk-btn text-emerald-700">
                Hoàn thành
              </button>
              {canBulkReview && (
                <>
                  <button onClick={() => void batchReview("request_revision")} className="ws-bulk-btn text-amber-700">
                    Yêu cầu bổ sung
                  </button>
                  <button onClick={() => void batchReview("confirm")} className="ws-bulk-btn text-violet-700">
                    Xác nhận hoàn thành
                  </button>
                </>
              )}
              {canBulkDelete && (
                <button onClick={() => void deleteTasks(selectedIds)} className="ws-bulk-btn text-rose-700">
                  <Trash2 className="h-3.5 w-3.5" />
                  Xóa
                </button>
              )}
              <button onClick={() => setSelectedIds([])} className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {loading ? <div className="grid min-h-[420px] place-items-center text-sm font-semibold text-slate-500">Đang tải lịch làm việc...</div> : view === "board" ? <BoardView tasks={dailyTasks} selectedDate={selectedDate} setSelectedDate={setSelectedDate} userEmail={userEmail} selectedIds={selectedIds} setSelectedIds={setSelectedIds} setEditing={setEditing} deleteTasks={deleteTasks} setDraggedId={setDraggedId} moveTask={moveTask} /> : view === "week" ? <WeekView tasks={filtered} visibleDays={visibleCalendarDays} anchor={weekStart} setAnchor={setWeekStart} period={calendarPeriod} setPeriod={setCalendarPeriod} layout={calendarLayout} setLayout={setCalendarLayout} setSelectedDate={setSelectedDate} setView={setView} setEditing={setEditing} setDraggedId={setDraggedId} moveTask={moveTask} /> : <SheetView sheetUrl={sheetUrl} setSheetUrl={setSheetUrl} sheetKey={sheetKey} notice={sheetNotice} setNotice={setSheetNotice} />}
        </div>
      </main>
      {editing && <TaskDialog draft={editing} setDraft={setEditing} staff={staff} userEmail={userEmail} saveTask={saveTask} deleteTasks={deleteTasks} review={review} />}
    </div>
  );
}

function BoardView({ tasks, selectedDate, setSelectedDate, userEmail, selectedIds, setSelectedIds, setEditing, deleteTasks, setDraggedId, moveTask }: any) {
  const allSelected = tasks.length > 0 && tasks.every((task) => selectedIds.includes(task.id));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-[#001e40]">Công việc {prettyDate(selectedDate)}</h2>
          <p className="mt-1 text-sm text-slate-500">Kéo thẻ để đổi trạng thái. Công việc hoàn thành cần quản lý review.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!tasks.length} onClick={() => setSelectedIds(allSelected ? [] : tasks.map((task) => task.id))} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-40">
            {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
          </button>
          <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1">
            <button onClick={() => setSelectedDate(iso(addDays(fromIso(selectedDate), -1)))} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Ngày trước">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => setSelectedDate(iso(new Date()))} className="px-3 text-xs font-bold">
              Hôm nay
            </button>
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="rounded-lg border-0 px-2 py-1 text-xs font-bold outline-none" />
            <button onClick={() => setSelectedDate(iso(addDays(fromIso(selectedDate), 1)))} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Ngày sau">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="ws-board">
        {statuses.map((column) => (
          <section key={column.id} onDragOver={(event) => event.preventDefault()} onDrop={() => void moveTask({ status: column.id })} className={`min-w-[280px] rounded-2xl border p-3 ${column.column}`}>
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <i className={`h-2.5 w-2.5 rounded-full ${column.dot}`} />
                <h3 className="text-sm font-extrabold">{column.label}</h3>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500">{tasks.filter((task) => task.displayStatus === column.id).length}</span>
              </div>
              {column.id !== "reviewed" && (
                <button
                  onClick={() =>
                    setEditing({
                      ...blankDraft(userEmail, selectedDate),
                      status: column.id,
                    })
                  }
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-blue-600"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="space-y-3">
              {tasks
                .filter((task) => task.displayStatus === column.id)
                .map((task) => (
                  <TaskCard key={task.id} task={task} selected={selectedIds.includes(task.id)} onSelect={() => setSelectedIds((ids) => (ids.includes(task.id) ? ids.filter((id) => id !== task.id) : [...ids, task.id]))} onOpen={() => setEditing(draftFromTask(task))} onDelete={() => void deleteTasks([task.id])} onDragStart={() => setDraggedId(task.id)} />
                ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
function WeekView({ tasks, visibleDays, anchor, setAnchor, period, setPeriod, layout, setLayout, setSelectedDate, setView, setEditing, setDraggedId, moveTask }: any) {
  const today = iso(new Date());
  const currentMonth = anchor.getMonth();
  const [dragTargetDate, setDragTargetDate] = useState<string | null>(null);
  const go = (amount: number) => setAnchor(period === "week" ? addDays(anchor, amount * 7) : addMonths(anchor, amount));
  const heading = period === "week" ? `LỊCH CÔNG TÁC TUẦN ${weekNumber(iso(visibleDays[0]))} NĂM ${visibleDays[0].getFullYear()}` : `LỊCH CÔNG TÁC THÁNG ${anchor.getMonth() + 1} NĂM ${anchor.getFullYear()}`;
  const dateRange = period === "week" ? `Từ ${fullDate(iso(visibleDays[0]))} đến ${fullDate(iso(visibleDays[visibleDays.length - 1]))}` : "";
  const rowsFor = (day: Date) => tasks.filter((task: WorkTask) => task.date === iso(day)).sort((a: WorkTask, b: WorkTask) => a.dailyOrder - b.dailyOrder);
  const taskButton = (task: WorkTask) => (
    <button key={task.id} draggable={task.canEdit && task.status !== "reviewed"} onDragStart={() => setDraggedId(task.id)} onDragEnd={() => setDragTargetDate(null)} onClick={() => setEditing(draftFromTask(task))} className={`w-full rounded-lg border-l-4 p-2.5 text-left text-xs shadow-sm transition duration-150 active:cursor-grabbing ${task.canEdit ? "cursor-grab" : "cursor-pointer"} ${task.displayStatus === "reviewed" ? "border-violet-500 bg-violet-50" : task.displayStatus === "completed" ? "border-emerald-500 bg-emerald-50" : task.displayStatus === "doing" ? "border-blue-500 bg-blue-50" : "border-slate-400 bg-slate-50"}`}>
      <span className="font-bold text-slate-500">
        {task.dailyOrder}. {task.startTime || "Cả ngày"}
      </span>
      <b className="mt-1 block leading-5">{task.displayTitle}</b>
    </button>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-[#001e40]">{heading}</h2>
          {dateRange && <p className="mt-1 text-sm font-semibold text-slate-500">{dateRange}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-xl border bg-white p-1">
            <button onClick={() => setPeriod("week")} className={`rounded-lg px-3 py-2 text-xs font-bold ${period === "week" ? "bg-blue-600 text-white" : "text-slate-600"}`}>
              Tuần
            </button>
            <button onClick={() => setPeriod("month")} className={`rounded-lg px-3 py-2 text-xs font-bold ${period === "month" ? "bg-blue-600 text-white" : "text-slate-600"}`}>
              Tháng
            </button>
          </div>
          <div className="flex rounded-xl border bg-white p-1">
            <button onClick={() => setLayout("calendar")} className={`rounded-lg px-3 py-2 text-xs font-bold ${layout === "calendar" ? "bg-slate-800 text-white" : "text-slate-600"}`}>
              Lịch
            </button>
            <button onClick={() => setLayout("table")} className={`rounded-lg px-3 py-2 text-xs font-bold ${layout === "table" ? "bg-slate-800 text-white" : "text-slate-600"}`}>
              Bảng
            </button>
          </div>
          <div className="flex overflow-hidden rounded-xl bg-blue-600 text-white shadow-md shadow-blue-200">
            <button onClick={() => go(-1)} className="p-2.5 transition hover:bg-blue-700" aria-label={period === "week" ? "Tuần trước" : "Tháng trước"}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="w-px bg-white/25" />
            <button onClick={() => go(1)} className="p-2.5 transition hover:bg-blue-700" aria-label={period === "week" ? "Tuần sau" : "Tháng sau"}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      {layout === "calendar" ? (
        <section className="overflow-x-auto rounded-2xl border bg-white">
          <div className="grid min-w-[980px] grid-cols-7 border-b bg-slate-50">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="p-2 text-center text-xs font-extrabold uppercase text-slate-500">
                {new Intl.DateTimeFormat("vi-VN", { weekday: "short" }).format(addDays(mondayOf(new Date()), index))}
              </div>
            ))}
          </div>
          <div className="grid min-w-[980px] grid-cols-7">
            {visibleDays.map((day: Date) => {
              const dayIso = iso(day),
                rows = rowsFor(day),
                muted = period === "month" && day.getMonth() !== currentMonth;
              return (
                <div
                  key={dayIso}
                  onDragEnter={() => setDragTargetDate(dayIso)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    setDragTargetDate(null);
                    void moveTask({ date: dayIso });
                  }}
                  className={`${period === "week" ? "min-h-[520px]" : "min-h-[170px]"} border-b border-r p-2 transition-colors ${dragTargetDate === dayIso ? "bg-blue-100 ring-2 ring-inset ring-blue-400" : muted ? "bg-slate-50/80" : "bg-white"}`}
                >
                  <button
                    onClick={() => {
                      setSelectedDate(dayIso);
                      setView("board");
                    }}
                    className={`mb-2 grid h-8 w-8 place-items-center rounded-full text-sm font-extrabold ${dayIso === today ? "bg-blue-600 text-white" : muted ? "text-slate-400" : "text-slate-700"}`}
                  >
                    {day.getDate()}
                  </button>
                  <div className="space-y-2">{rows.map(taskButton)}</div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <ScheduleTable days={visibleDays} rowsFor={rowsFor} setEditing={setEditing} setDraggedId={setDraggedId} moveTask={moveTask} />
      )}
    </>
  );
}

function ScheduleTable({ days, rowsFor, setEditing, setDraggedId, moveTask }: any) {
  return (
    <section className="overflow-x-auto rounded-2xl border border-slate-300 bg-white shadow-sm">
      <table className="min-w-[980px] w-full border-collapse text-sm">
        <thead className="bg-emerald-50 text-[#001e40]">
          <tr>
            <th className="w-24 border-b border-r border-slate-300 px-3 py-3 text-left">Thứ</th>
            <th className="w-32 border-b border-r border-slate-300 px-3 py-3 text-left">Ngày</th>
            <th className="w-20 border-b border-r border-slate-300 px-3 py-3 text-center">Tuần</th>
            <th className="border-b border-r border-slate-300 px-3 py-3 text-left">Nội dung công việc</th>
            <th className="w-48 border-b border-r border-slate-300 px-3 py-3 text-left">Tự đánh giá</th>
            <th className="w-64 border-b border-slate-300 px-3 py-3 text-left">Lãnh đạo đánh giá</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day: Date) => {
            const dayIso = iso(day),
              tasks = rowsFor(day);
            return (
              <tr key={dayIso} onDragOver={(event) => event.preventDefault()} onDrop={() => void moveTask({ date: dayIso })} className="align-top hover:bg-blue-50/30">
                <td className="border-b border-r border-slate-200 px-3 py-3 font-bold">{weekday(dayIso)}</td>
                <td className="border-b border-r border-slate-200 px-3 py-3">{fullDate(dayIso)}</td>
                <td className="border-b border-r border-slate-200 px-3 py-3 text-center font-semibold">{weekNumber(dayIso)}</td>
                <td className="border-b border-r border-slate-200 px-3 py-3">
                  {tasks.length ? (
                    <ol className="space-y-2">
                      {tasks.map((task: WorkTask) => (
                        <li key={task.id}>
                          <button draggable={task.canEdit && task.status !== "reviewed"} onDragStart={() => setDraggedId(task.id)} onClick={() => setEditing(draftFromTask(task))} className="text-left font-semibold leading-5 text-slate-800 hover:text-blue-700">
                            <span className="mr-1 text-blue-600">{task.dailyOrder}.</span>
                            {task.displayTitle}
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="border-b border-r border-slate-200 px-3 py-3">
                  {tasks.map((task: WorkTask) => (
                    <div key={task.id} className="mb-2 last:mb-0">
                      <b>{task.dailyOrder}.</b> {selfAssessment[task.status]}
                    </div>
                  ))}
                </td>
                <td className="border-b border-slate-200 px-3 py-3">
                  {tasks.map((task: WorkTask) => (
                    <div key={task.id} className="mb-2 last:mb-0">
                      <b>{task.dailyOrder}.</b>{" "}
                      {task.reviewPercent === null ? (
                        <span className="text-slate-300">Chưa đánh giá</span>
                      ) : (
                        <span>
                          {task.reviewPercent}%{task.reviewNote ? ` · ${task.reviewNote}` : ""}
                        </span>
                      )}
                    </div>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
function SheetView({ sheetUrl, setSheetUrl, sheetKey, notice, setNotice }: any) {
  return (
    <section className="mx-auto max-w-4xl">
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="bg-gradient-to-br from-[#0055da] to-[#003a98] p-8 text-white">
          <FileSpreadsheet className="h-8 w-8" />
          <h2 className="mt-5 text-2xl font-extrabold">Liên kết lịch công tác Google Sheets</h2>
          <p className="mt-2 text-sm text-blue-100">Lưu đường dẫn bảng tính riêng của tài khoản để mở nhanh.</p>
        </div>
        <div className="p-8">
          <label className="text-sm font-bold">Đường dẫn Google Sheets</label>
          <div className="mt-2 flex gap-2">
            <div className="relative flex-1">
              <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} className="ws-input pl-10" />
            </div>
            <button
              onClick={() => {
                if (!sheetUrl.includes("docs.google.com/spreadsheets/")) {
                  setNotice("Vui lòng nhập đúng đường dẫn Google Sheets.");
                  return;
                }
                localStorage.setItem(sheetKey, sheetUrl);
                setNotice("Đã lưu liên kết.");
              }}
              className="rounded-xl bg-blue-600 px-5 text-sm font-bold text-white"
            >
              Lưu
            </button>
          </div>
          {notice && <p className="mt-3 text-sm font-semibold text-emerald-700">{notice}</p>}
          <div className="mt-5 flex gap-3">
            <button onClick={() => window.open(sheetUrl, "_blank", "noopener,noreferrer")} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold">
              <ExternalLink className="h-4 w-4" />
              Mở bảng tính
            </button>
            <button onClick={() => setSheetUrl(SHEET_TEMPLATE)} className="inline-flex items-center gap-2 px-4 text-sm font-bold text-blue-700">
              <Settings2 className="h-4 w-4" />
              Dùng mẫu FT
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function TaskDialog({ draft, setDraft, staff, userEmail, saveTask, deleteTasks, review }: any) {
  const lockedPeople = !draft.canEdit || (!!draft.id && draft.canReview);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setDraft(null);
      }}
    >
      <form onSubmit={saveTask} className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">{draft.canReview ? "Review kết quả công việc" : "Chi tiết lịch làm việc"}</p>
            <h2 className="mt-1 text-xl font-extrabold text-[#001e40]">{draft.id ? draft.title : "Thêm công việc mới"}</h2>
          </div>
          <div className="flex items-center gap-1">
            {draft.id && draft.canDelete && (
              <button type="button" onClick={() => void deleteTasks([draft.id])} className="rounded-xl p-2 text-rose-500 hover:bg-rose-50" aria-label="Xóa lịch">
                <Trash2 className="h-5 w-5" />
              </button>
            )}
            <button type="button" onClick={() => setDraft(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="space-y-5 p-6">
          <label className="block">
            <span className="ws-label">Tên công việc *</span>
            <input required disabled={!draft.canEdit} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="ws-input disabled:bg-slate-50" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label>
              <span className="ws-label">Ngày thực hiện *</span>
              <input disabled={!draft.canEdit} type="date" required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="ws-input disabled:bg-slate-50" />
            </label>
            <label>
              <span className="ws-label">Bắt đầu (không bắt buộc)</span>
              <input disabled={!draft.canEdit} type="time" value={draft.startTime} onChange={(event) => setDraft({ ...draft, startTime: event.target.value })} className="ws-input disabled:bg-slate-50" />
            </label>
            <label>
              <span className="ws-label">Kết thúc (không bắt buộc)</span>
              <input disabled={!draft.canEdit} type="time" value={draft.endTime} onChange={(event) => setDraft({ ...draft, endTime: event.target.value })} className="ws-input disabled:bg-slate-50" />
            </label>
            <label>
              <span className="ws-label">Trạng thái</span>
              <select disabled={!draft.canEdit || draft.canReview} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} className="ws-input disabled:bg-slate-50">
                <option value="todo">Cần làm</option>
                <option value="doing">Đang thực hiện</option>
                <option value="completed">Đã hoàn thành</option>
              </select>
            </label>
            <label>
              <span className="ws-label">Mức ưu tiên</span>
              <select disabled={!draft.canEdit} value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })} className="ws-input disabled:bg-slate-50">
                {Object.entries(priorities).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="space-y-4">
            <PeoplePicker label="Người thực hiện * (chọn 1)" staff={staff} selected={[draft.executorEmail]} onChange={(emails) => setDraft({ ...draft, executorEmail: emails[0] || userEmail })} multiple={false} disabled={lockedPeople} />
            <PeoplePicker label="Người hỗ trợ/theo dõi (chọn nhiều)" staff={staff.filter((item) => item.email !== draft.executorEmail)} selected={draft.supporterEmails} onChange={(emails) => setDraft({ ...draft, supporterEmails: emails })} disabled={lockedPeople} />
            <PeoplePicker label="Người quản lý (chọn nhiều)" staff={staff.filter((item) => item.email !== draft.executorEmail)} selected={draft.managerEmails} onChange={(emails) => setDraft({ ...draft, managerEmails: emails })} disabled={lockedPeople} />
          </div>
          <label className="block">
            <span className="ws-label">Mô tả</span>
            <textarea disabled={!draft.canEdit} rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="ws-input resize-y disabled:bg-slate-50" />
          </label>
          {draft.canReview && (
            <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <h3 className="font-extrabold text-violet-900">Đánh giá của người quản lý</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
                <label>
                  <span className="ws-label">Mức hoàn thành (%) *</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="100"
                    value={draft.reviewPercent ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        reviewPercent: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                    className="ws-input"
                  />
                </label>
                <label>
                  <span className="ws-label">Nhận xét / nội dung cần bổ sung</span>
                  <textarea rows={2} value={draft.reviewNote} onChange={(event) => setDraft({ ...draft, reviewNote: event.target.value })} className="ws-input resize-none" />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => void review("request_revision")} className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white">
                  Yêu cầu làm lại, bổ sung
                </button>
                <button type="button" onClick={() => void review("confirm")} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white">
                  Xác nhận hoàn thành
                </button>
              </div>
            </section>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button type="button" onClick={() => setDraft(null)} className="rounded-xl border px-4 py-2.5 text-sm font-bold text-slate-600">
            Đóng
          </button>
          {draft.canEdit && !draft.canReview && (
            <button type="submit" className="rounded-xl bg-[#0055da] px-5 py-2.5 text-sm font-bold text-white">
              {draft.id ? "Lưu thay đổi" : "Thêm công việc"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
