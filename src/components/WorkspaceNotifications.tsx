import React, { useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCheck, ExternalLink, X } from 'lucide-react';

type Notification = {
  id: number; title: string; message: string; severity: 'info' | 'warning' | 'urgent' | 'success';
  category: string; actionUrl?: string; createdAt: string; read: boolean;
};

const sessionToken = () => {
  try { return JSON.parse(localStorage.getItem('ft_auth_session') || '{}')?.token || ''; }
  catch { return ''; }
};

export default function WorkspaceNotifications({ menuItem = false }: { menuItem?: boolean }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const unread = items.filter(item => !item.read).length;
  const load = async () => {
    const token = sessionToken(); if (!token) return;
    const response = await fetch('/api/notifications', { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) setItems((await response.json()).notifications || []);
  };
  useEffect(() => {
    void load(); const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const markAll = async () => {
    const token = sessionToken();
    await fetch('/api/notifications/read-all', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    setItems(current => current.map(item => ({ ...item, read: true })));
  };
  const openItem = async (item: Notification) => {
    const token = sessionToken();
    if (!item.read) await fetch(`/api/notifications/${item.id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (item.actionUrl) window.location.assign(item.actionUrl);
    else setItems(current => current.map(row => row.id === item.id ? { ...row, read: true } : row));
  };
  return <>
    <button type="button" onClick={() => setOpen(true)} className={menuItem ? 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-700' : 'relative grid h-9 w-9 place-items-center rounded-full border bg-white text-slate-600'}>
      <Bell className="h-4 w-4" />{menuItem && <span>Thông báo</span>}{unread > 0 && <span className={`${menuItem ? 'ml-auto' : 'absolute -right-1 -top-1'} grid min-w-4 h-4 place-items-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white`}>{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && <div className="fixed inset-0 z-[1300] flex justify-end bg-slate-950/35" onMouseDown={() => setOpen(false)}><aside className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}><header className="sticky top-0 flex items-center justify-between border-b bg-white p-4"><div><h2 className="font-extrabold text-slate-900">Thông báo FT Workspace</h2><p className="text-xs text-slate-500">{unread} thông báo chưa đọc</p></div><div className="flex gap-1"><button onClick={() => void markAll()} className="rounded-lg p-2 text-blue-700" title="Đánh dấu tất cả đã đọc"><CheckCheck className="h-5 w-5" /></button><button onClick={() => setOpen(false)} className="rounded-lg p-2"><X className="h-5 w-5" /></button></div></header><div className="space-y-2 p-4">{items.length ? items.map(item => <button key={item.id} onClick={() => void openItem(item)} className={`w-full rounded-xl border p-4 text-left ${item.read ? 'bg-white opacity-70' : item.severity === 'urgent' ? 'border-rose-300 bg-rose-50' : item.severity === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-blue-100 bg-blue-50'}`}><div className="flex items-start gap-2">{item.severity === 'urgent' || item.severity === 'warning' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Bell className="mt-0.5 h-4 w-4 shrink-0" />}<span className="min-w-0 flex-1"><b className="block text-sm text-slate-900">{item.title}</b><span className="mt-1 block text-xs leading-relaxed text-slate-600">{item.message}</span><small className="mt-2 block text-slate-400">{new Date(item.createdAt).toLocaleString('vi-VN')}</small></span>{item.actionUrl && <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />}</div></button>) : <p className="py-12 text-center text-sm text-slate-500">Chưa có thông báo.</p>}</div></aside></div>}
  </>;
}
