import React from 'react';
import { 
  LayoutDashboard, 
  Radio, 
  FileText, 
  RefreshCw, 
  BarChart3, 
  Settings, 
  LogOut,
  UserCheck
} from 'lucide-react';
import { UserRole } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  user: any;
  userRole: UserRole;
  onLogout: () => void;
}

export default function Sidebar({ activeTab, setActiveTab, user, userRole, onLogout }: SidebarProps) {
  const menuItems = [
    { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'channels', label: 'Kênh mạng xã hội', icon: Radio },
    { id: 'posts', label: 'Bài đăng', icon: FileText },
    { id: 'sync', label: 'Đồng bộ dữ liệu', icon: RefreshCw },
    { id: 'reports', label: 'Báo cáo', icon: BarChart3 },
    { id: 'config', label: 'Cấu hình', icon: Settings },
  ];

  return (
    <div className="w-64 bg-white text-slate-800 flex flex-col h-screen sticky top-0 border-r border-slate-200">
      {/* Brand logo & title */}
      <div className="p-6 border-b border-slate-100 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-lg">
          <div className="w-4 h-4 bg-white rounded-sm"></div>
        </div>
        <div>
          <h1 className="font-extrabold text-slate-900 text-base leading-tight tracking-tight">FT Social</h1>
          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Analytics Suite</p>
        </div>
      </div>

      {/* Navigation menu items */}
      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const IconComponent = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive 
                  ? 'bg-blue-50 text-blue-700' 
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              <IconComponent className="w-5 h-5 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* User profile section */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3 mb-3">
          {user?.photoURL ? (
            <img src={user.photoURL} alt={user.displayName} className="w-9 h-9 rounded-full referrerPolicy='no-referrer'" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
              {user?.email?.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800 truncate">{user?.displayName || 'Người dùng'}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <UserCheck className="w-3 h-3 text-blue-500" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{userRole}</span>
            </div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
