import React from 'react';
import { 
  LayoutDashboard, 
  Radio, 
  FileText, 
  RefreshCw, 
  Settings, 
  LogOut,
  UserCheck,
  ArrowLeft
} from 'lucide-react';
import { UserRole } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  user: any;
  userRole: UserRole;
  onLogout: () => void;
  onBackToWorkspace: () => void;
}

export default function Sidebar({ activeTab, setActiveTab, user, userRole, onLogout, onBackToWorkspace }: SidebarProps) {
  const menuItems = [
    { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'media', label: 'Tổng hợp truyền thông', icon: Radio },
    { id: 'posts', label: 'Bài đăng', icon: FileText },
    { id: 'sync', label: 'Đồng bộ dữ liệu', icon: RefreshCw },
    { id: 'config', label: 'Cấu hình hệ thống', icon: Settings },
  ];

  return (
    <div className="w-64 bg-white text-slate-800 flex flex-col h-screen sticky top-0 border-r border-slate-200/80 shadow-[1px_0_10px_rgba(0,0,0,0.015)]">
      {/* Brand logo & title */}
      <div className="p-6 border-b border-slate-100 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center font-bold text-white text-lg shadow-md shadow-blue-500/20">
          FT
        </div>
        <div>
          <h1 className="font-extrabold text-slate-900 text-sm leading-tight tracking-tight">FT Social</h1>
          <p className="text-[9px] uppercase font-extrabold text-blue-600 tracking-widest mt-0.5">Analytics Suite</p>
        </div>
      </div>

      {/* Back to Workspace button */}
      <div className="px-4.5 pt-4">
        <button
          onClick={onBackToWorkspace}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200/50 transition-all cursor-pointer shadow-sm active:scale-[0.99]"
        >
          <ArrowLeft className="w-4 h-4 text-slate-500" />
          <span>Quay lại Workspace</span>
        </button>
      </div>

      {/* Navigation menu items */}
      <nav className="flex-1 px-4.5 py-6 space-y-1.5 overflow-y-auto">
        {menuItems.map((item) => {
          const IconComponent = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                isActive 
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-650 text-white sidebar-glow-active' 
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              <IconComponent className={`w-4.5 h-4.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* User profile section */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-3 mb-3 bg-white p-2.5 rounded-xl border border-slate-200/40">
          {user?.photoURL ? (
            <img src={user.photoURL} alt={user.displayName} className="w-8.5 h-8.5 rounded-xl border border-slate-100 object-cover" />
          ) : (
            <div className="w-8.5 h-8.5 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-50 flex items-center justify-center text-xs font-bold text-blue-650 border border-blue-200/30">
              {user?.email?.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-slate-800 truncate leading-tight">{user?.displayName || 'Người dùng'}</p>
            <div className="flex items-center gap-1 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span className="text-[9px] font-extrabold text-slate-400 tracking-wider uppercase">{userRole}</span>
            </div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-slate-500 hover:text-rose-600 bg-slate-150 hover:bg-rose-50 border border-slate-200/30 hover:border-rose-100 rounded-xl transition-all cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
