import React from 'react';
import { 
  LayoutDashboard, 
  Radio, 
  FileText, 
  RefreshCw, 
  Settings, 
  LogOut,
  UserCog,
  ArrowLeft,
  LogIn
} from 'lucide-react';
import { UserRole } from '../../types';
import TokenNotifications from './TokenNotifications';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  user: any;
  userRole: UserRole;
  idToken: string;
  onLogout: () => void;
  onBackToWorkspace: () => void;
}

export default function Sidebar({ activeTab, setActiveTab, user, userRole, idToken, onLogout, onBackToWorkspace }: SidebarProps) {
  const isGuest = user?.email === 'guest@ftsocial.com';
  const menuItems = [
    { id: 'dashboard', label: 'Biểu đồ tổng quan', icon: LayoutDashboard },
    { id: 'media', label: 'Báo cáo tổng hợp', icon: Radio },
    { id: 'posts', label: 'Bài đăng', icon: FileText },
    { id: 'sync', label: 'Đồng bộ dữ liệu', icon: RefreshCw },
    ...(isGuest ? [] : [{ id: 'config', label: 'Cấu hình hệ thống', icon: Settings }]),
    ...(userRole === 'ADMIN' || userRole === 'MANAGER' ? [{ id: 'accounts', label: 'Quản lý tài khoản', icon: UserCog }] : []),
  ];

  return (
    <div className="w-64 bg-white text-slate-800 flex flex-col h-screen sticky top-0 border-r border-slate-200/60 shadow-[2px_0_12px_rgba(15,23,42,0.02)]">
      {/* Brand logo & title */}
      <div className="p-5 border-b border-slate-100 flex items-center gap-3">
        <img src="/logo.png" alt="FermatTech Logo" className="h-8 object-contain" />
        <div className="border-l border-slate-200 pl-3">
          <h1 className="font-extrabold text-slate-900 text-sm leading-none tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Fermat</h1>
          <p className="text-[9px] uppercase font-bold text-indigo-650 tracking-wider mt-1">Phân tích MXH</p>
        </div>
      </div>

      {/* Back to Workspace button */}
      <div className="px-4 pt-4">
        <button
          onClick={onBackToWorkspace}
          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-650 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200/50 transition-all cursor-pointer shadow-sm active:scale-[0.98]"
        >
          <ArrowLeft className="w-4 h-4 text-slate-500" />
          <span>Quay lại Workspace</span>
        </button>
      </div>

      {/* Navigation menu items */}
      <nav className="flex-1 px-4 py-5 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const IconComponent = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                isActive 
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white sidebar-glow-active' 
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              <IconComponent className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* User profile section */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/40">
        <div className="mb-2 flex justify-end">
          <TokenNotifications idToken={idToken} userRole={userRole} />
        </div>
        <div className="flex items-center gap-3 mb-3 bg-white p-2.5 rounded-xl border border-slate-200/40 shadow-sm">
          {user?.photoURL ? (
            <img src={user.photoURL} alt={user.displayName} className="w-8.5 h-8.5 rounded-xl border border-slate-100 object-cover" />
          ) : (
            <div className="w-8.5 h-8.5 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-50 flex items-center justify-center text-xs font-bold text-blue-750 border border-blue-200/30">
              {user?.email?.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-slate-800 truncate leading-tight">{user?.displayName || 'Người dùng'}</p>
            <div className="flex items-center gap-1 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span className="text-[9px] font-bold text-slate-400 tracking-wider uppercase">{userRole}</span>
            </div>
          </div>
        </div>
        {user?.email === 'guest@ftsocial.com' ? (
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all cursor-pointer shadow-sm active:scale-[0.99]"
          >
            <LogIn className="w-3.5 h-3.5" />
            Đăng nhập
          </button>
        ) : (
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-slate-500 hover:text-rose-600 bg-white hover:bg-rose-50 border border-slate-200/50 hover:border-rose-100 rounded-xl transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Đăng xuất
          </button>
        )}
      </div>
    </div>
  );
}

