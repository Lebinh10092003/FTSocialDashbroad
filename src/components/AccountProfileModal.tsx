import React, { useRef, useState } from 'react';
import { Camera, Eye, EyeOff, KeyRound, LoaderCircle, UserRound, X } from 'lucide-react';

type AccountUser = { email: string; displayName: string; photoURL?: string | null };
type Props = {
  open: boolean;
  user: AccountUser;
  idToken: string | null;
  onClose: () => void;
  onSaved: (user: AccountUser) => void;
  onTokenChanged: (token: string, user: AccountUser) => void;
};

export default function AccountProfileModal({ open, user, idToken, onClose, onSaved, onTokenChanged }: Props) {
  const [name, setName] = useState(user.displayName || '');
  const [photoURL, setPhotoURL] = useState(user.photoURL || '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!open) return null;

  const upload = async (file?: File) => {
    if (!file || !idToken) return;
    if (!file.type.startsWith('image/')) { setNotice('Vui lòng chọn tệp ảnh.'); return; }
    if (file.size > 5 * 1024 * 1024) { setNotice('Ảnh tối đa 5 MB.'); return; }
    setBusy(true); setNotice('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = reject; reader.readAsDataURL(file); });
      const response = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ filename: file.name, base64 }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Không thể tải ảnh lên.');
      setPhotoURL(data.url || '');
    } catch (error: any) { setNotice(error.message || 'Không thể tải ảnh lên.'); }
    finally { setBusy(false); }
  };

  const toUser = (data: any): AccountUser => ({
    email: data.email || user.email,
    displayName: data.displayName || data.name || name.trim() || user.displayName,
    photoURL: data.photoURL || data.picture || photoURL,
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!idToken || !name.trim()) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/auth/profile', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ displayName: name.trim(), photoURL }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Không thể lưu hồ sơ.');
      onSaved(toUser(data));
      setNotice('Đã lưu thông tin tài khoản.');
    } catch (error: any) { setNotice(error.message || 'Không thể lưu hồ sơ.'); }
    finally { setBusy(false); }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!idToken) return;
    if (newPassword !== confirmPassword) { setPasswordNotice('Xác nhận mật khẩu mới chưa khớp.'); return; }
    setBusy(true); setPasswordNotice('');
    try {
      const response = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ currentPassword, newPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Không thể đổi mật khẩu.');
      const nextToken = String(data.token || '');
      if (!nextToken) throw new Error('Máy chủ không trả về phiên đăng nhập mới.');
      const nextUser = toUser(data.user || {});
      onTokenChanged(nextToken, nextUser);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setPasswordNotice('Đổi mật khẩu thành công. Các phiên đăng nhập cũ đã được đăng xuất.');
    } catch (error: any) { setPasswordNotice(error.message || 'Không thể đổi mật khẩu.'); }
    finally { setBusy(false); }
  };

  const passwordType = showPasswords ? 'text' : 'password';
  return <div className="ft-dialog-backdrop fixed inset-0 z-[100] overflow-y-auto p-4 sm:p-8"><div className="mx-auto my-4 w-full max-w-3xl ft-dialog-panel bg-white p-6 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-sky-700">Tài khoản Workspace</p><h2 className="mt-1 text-2xl font-extrabold text-slate-900">Thông tin tài khoản</h2><p className="mt-2 text-sm text-slate-500">Cập nhật hồ sơ và bảo mật đăng nhập của bạn.</p></div><button type="button" aria-label="Đóng trang tài khoản" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5"/></button></div><div className="mt-7 grid gap-8 lg:grid-cols-2"><form onSubmit={save} className="rounded-2xl border border-slate-200 p-5"><h3 className="font-extrabold text-slate-900">Hồ sơ cơ bản</h3><div className="mt-5 flex items-center gap-4"><button type="button" aria-label="Đổi ảnh đại diện" onClick={() => fileRef.current?.click()} className="group relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 text-sky-700"><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={event => upload(event.target.files?.[0])}/>{photoURL ? <img src={photoURL} alt={name} className="h-full w-full object-cover"/> : <UserRound className="h-8 w-8"/>}<span className="absolute inset-x-0 bottom-0 flex h-7 items-center justify-center bg-slate-950/60 text-white opacity-0 transition group-hover:opacity-100"><Camera className="h-4 w-4"/></span></button><p className="text-xs leading-5 text-slate-500">Nhấn ảnh để thay đổi. Dùng JPG, PNG, GIF hoặc WebP, tối đa 5 MB.</p></div><label className="mt-5 block"><span className="mb-1.5 block text-sm font-bold text-slate-700">Tên hiển thị</span><input value={name} onChange={event => setName(event.target.value)} required maxLength={255} className="ft-input w-full" placeholder="Nhập tên hiển thị"/></label><label className="mt-4 block"><span className="mb-1.5 block text-sm font-bold text-slate-700">Email đăng nhập</span><input value={user.email} disabled className="ft-input w-full bg-slate-50 text-slate-500"/><span className="mt-1 block text-xs text-slate-400">Email đăng nhập do quản trị viên quản lý.</span></label>{notice && <p className={`mt-4 rounded-lg border px-3 py-2 text-sm font-semibold ${notice.startsWith('Đã') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{notice}</p>}<button disabled={busy || !name.trim()} className="ft-primary mt-5 inline-flex items-center gap-2 disabled:opacity-60">{busy && <LoaderCircle className="h-4 w-4 animate-spin"/>}Lưu thông tin</button></form><form onSubmit={changePassword} className="rounded-2xl border border-slate-200 p-5"><div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-sky-700"/><h3 className="font-extrabold text-slate-900">Đổi mật khẩu</h3></div><p className="mt-2 text-xs leading-5 text-slate-500">Sau khi đổi, các phiên đã lưu trên thiết bị khác sẽ bị đăng xuất.</p><label className="mt-5 block"><span className="mb-1.5 block text-sm font-bold text-slate-700">Mật khẩu hiện tại</span><input value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} type={passwordType} autoComplete="current-password" required className="ft-input w-full"/></label><label className="mt-4 block"><span className="mb-1.5 block text-sm font-bold text-slate-700">Mật khẩu mới</span><input value={newPassword} onChange={event => setNewPassword(event.target.value)} type={passwordType} autoComplete="new-password" required className="ft-input w-full"/><span className="mt-1 block text-xs text-slate-400">Tối thiểu 8 ký tự; không dùng mật khẩu phổ biến hoặc quá dễ đoán.</span></label><label className="mt-4 block"><span className="mb-1.5 block text-sm font-bold text-slate-700">Xác nhận mật khẩu mới</span><input value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} type={passwordType} autoComplete="new-password" required className="ft-input w-full"/></label><button type="button" onClick={() => setShowPasswords(value => !value)} className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-sky-700 hover:text-sky-900">{showPasswords ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}{showPasswords ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}</button>{passwordNotice && <p className={`mt-4 rounded-lg border px-3 py-2 text-sm font-semibold ${passwordNotice.startsWith('Đổi') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{passwordNotice}</p>}<button disabled={busy || !currentPassword || !newPassword || !confirmPassword} className="ft-primary mt-5 inline-flex items-center gap-2 disabled:opacity-60">{busy && <LoaderCircle className="h-4 w-4 animate-spin"/>}Đổi mật khẩu</button></form></div></div></div>;
}