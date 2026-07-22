import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Send } from 'lucide-react';

export type SystemEvent = string | { content: string; time?: string };
type LogNote = { id: string; time: string; actor: string; content: string; system?: boolean };
type Props = { entityKey: string; title?: string; systemEvents?: SystemEvent[]; actor?: string | null; canWrite: boolean; idToken?: string | null };

const storageKey = (entityKey: string) => `ft-examination-lognotes:${entityKey}`;

export function appendLogNote(entityKey: string, content: string, actor = 'Hệ thống FT Workspace', system = false, idToken?: string | null) {
  const key = storageKey(entityKey);
  let current: LogNote[] = [];
  try { current = JSON.parse(localStorage.getItem(key) || '[]'); } catch { current = []; }
  const next = [{ id: `${Date.now()}-${Math.random()}`, time: new Date().toLocaleString('vi-VN'), actor, content, system }, ...current];
  localStorage.setItem(key, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('ft-examination-lognote', { detail: entityKey }));

  // Đồng bộ lên SQLite database
  fetch(`/api/examination/lognotes/${encodeURIComponent(entityKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ content, actor, system })
  }).catch(err => console.warn('Lỗi lưu lognote vào SQLite:', err));
}

export default function LogNotes({ entityKey, title = 'Lognote & lịch sử thay đổi', systemEvents = [], actor, canWrite, idToken }: Props) {
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState<LogNote[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey(entityKey)) || '[]'); } catch { return []; }
  });

  useEffect(() => {
    // Tải dữ liệu lognotes từ SQLite backend
    fetch(`/api/examination/lognotes/${encodeURIComponent(entityKey)}`)
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          setNotes(current => {
            // Keep a local entry if the network is unavailable before it can be persisted.
            if (!data.length && current.length) return current;
            localStorage.setItem(storageKey(entityKey), JSON.stringify(data));
            return data;
          });
        }
      })
      .catch(() => {});

    const refresh = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== entityKey) return;
      try { setNotes(JSON.parse(localStorage.getItem(storageKey(entityKey)) || '[]')); } catch { setNotes([]); }
    };
    window.addEventListener('ft-examination-lognote', refresh);
    return () => window.removeEventListener('ft-examination-lognote', refresh);
  }, [entityKey]);

  const systemNotes = useMemo<LogNote[]>(() => {
    // Never generate a timestamp when opening a page. System notes are shown
    // only when their timestamp was supplied by a real persisted event.
    return systemEvents.flatMap((event, index) => {
      if (typeof event === 'string' || !event.time) return [];
      return [{
        id: `system-${index}`,
        time: event.time,
        actor: 'Hệ thống FT Workspace',
        content: event.content,
        system: true
      }];
    });
  }, [systemEvents]);

  const add = () => {
    const content = draft.trim();
    if (!content || !canWrite) return;
    appendLogNote(entityKey, content, actor || 'Nhân viên FT Workspace', false, idToken);
    setDraft('');
  };

  const entries = [...notes, ...systemNotes];
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-[#001e40]">
            <ClipboardList className="h-5 w-5"/>{title}
          </h2>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-500 shadow-sm">{entries.length} mục</span>
      </header>

      {canWrite && (
        <div className="border-b bg-white p-5">
          <div className="flex gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#001e40] text-xs font-bold text-white">
              {(actor || 'NV').slice(0,2).toUpperCase()}
            </div>
            <div className="flex-1">
              <textarea
                value={draft}
                onChange={event => setDraft(event.target.value)}
                className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="Ghi lại thông tin cần lưu vết..."
              />
              <div className="mt-2 flex justify-end">
                <button onClick={add} disabled={!draft.trim()} className="ft-primary disabled:opacity-50">
                  <Send className="h-4 w-4"/>Thêm lognote
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-h-[440px] overflow-y-auto p-5">
        <div className="relative ml-2 border-l border-slate-200 pl-6">
          {entries.map(note => (
            <article key={note.id} className="relative pb-5 last:pb-0">
              <span className={`absolute -left-[31px] top-1 grid h-4 w-4 place-items-center rounded-full border-4 border-white ${note.system ? 'bg-blue-500' : 'bg-[#aa3000]'}`}/>
              <div className={`rounded-lg border p-4 ${note.system ? 'border-blue-100 bg-blue-50/40' : 'border-slate-200 bg-white shadow-sm'}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b className={note.system ? 'text-sm text-blue-800' : 'text-sm text-[#001e40]'}>{note.actor}</b>
                  <span className="text-xs font-medium text-slate-500">· {note.time}</span>
                  {note.system && <span className="ml-auto text-xs text-blue-600">Tự động từ hệ thống</span>}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{note.content}</p>
              </div>
            </article>
          ))}
          {!entries.length && <div className="py-5 text-sm text-slate-500">Chưa có lognote.</div>}
        </div>
      </div>
    </section>
  );
}