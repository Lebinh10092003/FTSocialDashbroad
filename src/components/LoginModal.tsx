import React from 'react';
import { LogIn, X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
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
  email,
  password,
  setEmail,
  setPassword,
  loading,
  error,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-md animate-fade-in-fast">
      <div className="relative w-full max-w-md rounded-3xl border border-white/60 bg-white/95 p-8 shadow-2xl animate-scale-in">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 rounded-xl p-2 text-slate-450 hover:bg-slate-100/70 hover:text-slate-700 transition-all cursor-pointer"
          aria-label="Đóng"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-8 text-center space-y-2">
          <img src="/logo.png" alt="FermatTech" className="mx-auto h-11 object-contain" />
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            Đăng nhập FT Workspace
          </h1>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 tracking-wider uppercase pl-1">Email / Tài khoản</label>
            <input
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="Nhập email hoặc tên tài khoản"
              autoComplete="username"
              className="ft-input"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 tracking-wider uppercase pl-1">Mật khẩu</label>
            <input
              value={password}
              onChange={event => setPassword(event.target.value)}
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              className="ft-input"
              required
            />
          </div>

          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-xs font-semibold text-rose-600 animate-fade-in">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full ft-btn ft-btn-primary py-3 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
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
        </form>
      </div>
    </div>
  );
}
