import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Send } from 'lucide-react';

export type SystemEvent = string | { content: string; time?: string };
type LogNote = { id: string; time: string; actor: string; content: string; system?: boolean };
type Props = { entityKey: string; title?: string; systemEvents?: SystemEvent[]; actor?: string | null; canWrite: boolean; idToken?: string | null };

const storageKey = (entityKey: string) => `ft-examination-lognotes:${entityKey}`;
const labels: Record<string, string> = {
  province: 'Tỉnh/Thành phố', ward: 'Phường/Xã', school: 'Trường', level: 'Cấp học', representative: 'Đại diện', phone: 'Số điện thoại', email: 'Email',
  contests: 'Các cuộc thi đã tham gia', studentCounts: 'Số học sinh cộng tác', name: 'Tên lớp', sessionId: 'Kỳ tổ chức', subject: 'Nội dung ôn tập',
  teacher: 'Giáo viên', teacherEmail: 'Email giáo viên', start: 'Ngày bắt đầu', end: 'Ngày kết thúc', mode: 'Hình thức', scheduleSlots: 'Lịch học', note: 'Ghi chú',
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'chưa có thông tin';
  if (Array.isArray(value)) {
    if (!value.length) return 'chưa có thông tin';
    return value.map(item => {
      if (item && typeof item === 'object' && 'session' in item && 'count' in item) return `${String(item.session)}: ${String(item.count)} học sinh`;
      if (item && typeof item === 'object' && 'day' in item && 'start' in item) return `${String(item.day)} ${String(item.start)}–${String((item as { end?: unknown }).end || '')}`.trim();
      return displayValue(item);
    }).join(', ');
  }
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${labels[key] || key}: ${displayValue(item)}`).join(', ');
  return String(value).trim() || 'chưa có thông tin';
}

export function formatChangeLog(title: string, before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined, fieldLabels: Record<string, string> = labels): string {
  const previous = before || {}, next = after || {};
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(key => key !== 'id');
  const lines = keys.flatMap(key => {
    if (JSON.stringify(previous[key]) === JSON.stringify(next[key])) return [];
    const oldValue = displayValue(previous[key]), newValue = displayValue(next[key]), label = fieldLabels[key] || labels[key] || key;
    if (oldValue === 'chưa có thông tin') return [`Đã bổ sung ${label}: ${newValue}.`];
    if (newValue === 'chưa có thông tin') return [`Đã xóa ${label} (trước đó: ${oldValue}).`];
    return [`Đã đổi ${label} từ “${oldValue}” thành “${newValue}”.`];
  });
  return lines.length ? `${title.replace(/[.:\s]+$/, '')}.\n${lines.join('\n')}` : `${title.replace(/[.:\s]+$/, '')}.`;
}

function humanizeLegacyContent(content: string): string {
  const marker = '. Thông tin sau: ';
  const beforeMarker = '. Thông tin trước: ';
  if (!content.includes(beforeMarker) || !content.includes(marker)) return content;
  try {
    const [title, rest] = content.split(beforeMarker, 2);
    const [beforeRaw, afterRaw] = rest.split(marker, 2);
    const before = JSON.parse(beforeRaw.trim());
    const afterText = afterRaw.trim();
    const after = JSON.parse(afterText.endsWith('.') ? afterText.slice(0, -1) : afterText);
    return formatChangeLog(title, before, after);
  } catch {
    return content;
  }
}

export function appendLogNote(entityKey: string, content: string, actor = 'Hệ thống FT Workspace', system = false, idToken?: string | null) {
  const key = storageKey(entityKey);
  let current: LogNote[] = [];
  try { current = JSON.parse(localStorage.getItem(key) || '[]'); } catch { current = []; }
  const readableContent = humanizeLegacyContent(content);
  const next = [{ id: `${Date.now()}-${Math.random()}`, time: new Date().toLocaleString('vi-VN'), actor, content: readableContent, system }, ...current];
  localStorage.setItem(key, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('ft-examination-lognote', { detail: entityKey }));
  fetch(`/api/examination/lognotes/${encodeURIComponent(entityKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ content: readableContent, actor, system }),
  }).catch(error => console.warn('Không thể lưu lognote:', error));
}

export default function LogNotes({ entityKey, title = 'Lognote & lịch sử thay đổi', systemEvents = [], actor, canWrite, idToken }: Props) {
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState<LogNote[]>(() => { try { return JSON.parse(localStorage.getItem(storageKey(entityKey)) || '[]'); } catch { return []; } });
  useEffect(() => {
    const load = () => fetch(`/api/examination/lognotes/${encodeURIComponent(entityKey)}`, { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} })
      .then(response => response.ok ? response.json() : []).then(data => { if (Array.isArray(data)) { setNotes(current => { if (!data.length && current.length) return current; localStorage.setItem(storageKey(entityKey), JSON.stringify(data)); return data; }); } }).catch(() => {});
    load();
    const refresh = (event: Event) => { if ((event as CustomEvent<string>).detail !== entityKey) return; try { setNotes(JSON.parse(localStorage.getItem(storageKey(entityKey)) || '[]')); } catch { setNotes([]); } };
    window.addEventListener('ft-examination-lognote', refresh); window.addEventListener('ft-examination-audit-refresh', load);
    return () => { window.removeEventListener('ft-examination-lognote', refresh); window.removeEventListener('ft-examination-audit-refresh', load); };
  }, [entityKey, idToken]);
  const systemNotes = useMemo<LogNote[]>(() => systemEvents.flatMap((event, index) => typeof event === 'string' || !event.time ? [] : [{ id: `system-${index}`, time: event.time, actor: 'Hệ thống FT Workspace', content: event.content, system: true }]), [systemEvents]);
  const entries = [...notes, ...systemNotes];
  const add = () => { const content = draft.trim(); if (!content || !canWrite) return; appendLogNote(entityKey, content, actor || 'Nhân viên FT Workspace', false, idToken); setDraft(''); };
  return <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white"><header className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-5 py-4"><h2 className="flex items-center gap-2 text-lg font-extrabold text-[#001e40]"><ClipboardList className="h-5 w-5"/>{title}</h2><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-500 shadow-sm">{entries.length} mục</span></header>{canWrite && <div className="border-b bg-white p-5"><div className="flex gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#001e40] text-xs font-bold text-white">{(actor || 'NV').slice(0,2).toUpperCase()}</div><div className="flex-1"><textarea value={draft} onChange={event => setDraft(event.target.value)} className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" placeholder="Ghi lại thông tin cần lưu vết..."/><div className="mt-2 flex justify-end"><button onClick={add} disabled={!draft.trim()} className="ft-primary disabled:opacity-50"><Send className="h-4 w-4"/>Thêm lognote</button></div></div></div></div>}<div className="max-h-[440px] overflow-y-auto p-5"><div className="relative ml-2 border-l border-slate-200 pl-6">{entries.map(note => <article key={note.id} className="relative pb-5 last:pb-0"><span className={`absolute -left-[31px] top-1 grid h-4 w-4 place-items-center rounded-full border-4 border-white ${note.system ? 'bg-blue-500' : 'bg-[#aa3000]'}`}/><div className={`rounded-lg border p-4 ${note.system ? 'border-blue-100 bg-blue-50/40' : 'border-slate-200 bg-white shadow-sm'}`}><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><b className={note.system ? 'text-sm text-blue-800' : 'text-sm text-[#001e40]'}>{note.actor}</b><span className="text-xs font-medium text-slate-500">· {note.time}</span>{note.system && <span className="ml-auto text-xs text-blue-600">Tự động từ hệ thống</span>}</div><p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{humanizeLegacyContent(note.content)}</p></div></article>)}{!entries.length && <div className="py-5 text-sm text-slate-500">Chưa có lognote.</div>}</div></div></section>;
}