import React from 'react';
import { LogIn, X } from 'lucide-react';

type Props = { 
  open: boolean; 
  onClose: () => void; 
  onSubmit: (event: React.FormEvent) => void; 
  onGoogle: () => void; 
  email: string; 
  password: string; 
  setEmail: (value: string) => void; 
  setPassword: (value: string) => void; 
  loading: boolean; 
  error: string; 
};

export default function LoginModal({ 
  open, 
  onClose, 
  onSubmit, 
  onGoogle, 
  email, 
  password, 
  setEmail, 
  setPassword, 
  loading, 
  error 
}: Props) { 
  if (!open) return null; 
  
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-md animate-fade-in-fast">
      <div className="relative w-full max-w-md rounded-3xl border border-white/60 bg-white/95 p-8 shadow-2xl animate-scale-in">
        
        {/* Close Button */}
        <button 
          onClick={onClose} 
          className="absolute right-5 top-5 rounded-xl p-2 text-slate-450 hover:bg-slate-100/70 hover:text-slate-700 transition-all cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Title */}
        <div className="mb-8 text-center space-y-2">
          <img src="/logo.png" alt="FermatTech" className="mx-auto h-11 object-contain" />
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            Đăng nhập FT Workspace
          </h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            Sử dụng tài khoản FermatTech của bạn để truy cập toàn bộ tài nguyên.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 tracking-wider uppercase pl-1">Email / Tài khoản</label>
            <input 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              placeholder="Nhập email hoặc tên tài khoản" 
              className="ft-input" 
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 tracking-wider uppercase pl-1">Mật khẩu</label>
            <input 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              type="password" 
              placeholder="••••••••" 
              className="ft-input" 
              required
            />
          </div>

          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-xs font-semibold text-rose-600 animate-fade-in">
              {error}
            </div>
          )}

          <div className="pt-2 space-y-2">
            <button 
              type="submit"
              disabled={loading} 
              className="w-full ft-btn ft-btn-primary py-3 cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Đang đăng nhập...</span>
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  <span>Đăng nhập</span>
                </>
              )}
            </button>

            <div className="relative flex items-center justify-center my-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200/80" /></div>
              <span className="relative bg-white/95 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Hoặc</span>
            </div>

            <button 
              type="button" 
              onClick={onGoogle} 
              disabled={loading} 
              className="w-full ft-btn ft-btn-secondary py-3 flex items-center justify-center gap-2.5 cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
              </svg>
              <span>Đăng nhập bằng Google</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  ); 
}