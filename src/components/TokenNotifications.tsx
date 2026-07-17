import React, { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { UserRole } from '../types';

interface TokenNotification {
  platform: string;
  affectedPages: string[];
  issuedAt: string;
  expiresAt: string;
  daysRemaining: number;
}

interface TokenNotificationsProps {
  idToken: string;
  userRole: UserRole;
}

export default function TokenNotifications({ idToken, userRole }: TokenNotificationsProps) {
  const [notifications, setNotifications] = useState<TokenNotification[]>([]);
  const [open, setOpen] = useState(false);
  const canManage = userRole === 'ADMIN' || userRole === 'MANAGER';

  useEffect(() => {
    if (!canManage || !idToken) return;
    fetch('/api/admin/token-notifications', { headers: { Authorization: `Bearer ${idToken}` } })
      .then(response => response.ok ? response.json() : { notifications: [] })
      .then(data => setNotifications(data.notifications || []))
      .catch(() => setNotifications([]));
  }, [canManage, idToken]);

  if (!canManage || notifications.length === 0) return null;

  return <div className="relative">
    <button onClick={() => setOpen(value => !value)} className="relative p-2 rounded-xl text-amber-600 hover:bg-amber-50" title="Thông báo token">
      <Bell className="w-4 h-4" />
      <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold grid place-items-center">{notifications.length}</span>
    </button>
    {open && <div className="absolute bottom-11 left-0 z-30 w-80 bg-white border border-amber-200 rounded-2xl shadow-xl p-3">
      <div className="flex items-center justify-between mb-2"><strong className="text-sm text-slate-800">Token sắp hết hạn</strong><button onClick={() => setOpen(false)} className="p-1 text-slate-400"><X className="w-4 h-4" /></button></div>
      <div className="space-y-2 max-h-72 overflow-y-auto">{notifications.map((notification, index) => <div key={`${notification.platform}-${index}`} className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-900"><p className="font-bold">Còn {Math.max(0, notification.daysRemaining)} ngày để thay token {notification.platform === 'facebook' ? 'Facebook' : 'Zalo'}.</p><p className="mt-1 text-amber-800">Ảnh hưởng: {notification.affectedPages.join(', ')}.</p><p className="mt-1 text-amber-700">Hết hạn: {new Date(notification.expiresAt).toLocaleDateString('vi-VN')}.</p></div>)}</div>
    </div>}
  </div>;
}