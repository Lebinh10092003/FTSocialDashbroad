import React, { useRef, useState } from 'react';
import { Camera, LoaderCircle, UserRound, X } from 'lucide-react';

type AccountUser = { email: string; displayName: string; photoURL?: string | null };
type Props = { open: boolean; user: AccountUser; idToken: string | null; onClose: () => void; onSaved: (user: AccountUser) => void };

export default function AccountProfileModal({ open, user, idToken, onClose, onSaved }: Props) {
  const [name, setName] = useState(user.displayName || '');
  const [photoURL, setPhotoURL] = useState(user.photoURL || '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không thể tải ảnh lên.');
      setPhotoURL(data.url || '');
    } catch (error: any) { setNotice(error.message || 'Không thể tải ảnh lên.'); }
    finally { setBusy(false); }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!idToken || !name.trim()) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/auth/profile', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ displayName: name.trim(), photoURL }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không thể lưu hồ sơ.');
      onSaved({ email: data.email || user.email, displayName: data.displayName || data.name || name.trim(), photoURL: data.photoURL || data.picture || photoURL });
      onClose();
    } catch (error: any) { setNotice(error.message || 'Không thể lưu hồ sơ.'); }
    finally { setBusy(false); }
  };

  return <div className="ft-dialog-backdrop fixed inset-0 z-[100] grid place-items-center p-4"><form onSubmit={save} className="ft-dialog-panel w-full max-w-md bg-white p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-sky-700">Tài khoản Workspace</p><h2 className="mt-1 text-2xl font-extrabold text-slate-900">Chỉnh sửa hồ sơ</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5"/></button></div><div className="mt-6 flex items-center gap-4"><button type="button" onClick={() => fileRef.current?.click()} className="group relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 text-sky-700"><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={event => upload(event.target.files?.[0])}/>{photoURL ? <img src={photoURL} alt={name} className="h-full w-full object-cover"/> : <UserRound className="h-8 w-8"/>}<span className="absolute inset-x-0 bottom-0 flex h-7 items-center justify-center bg-slate-950/60 text-white opacity-0 transition group-hover:opacity-100"><Camera className="h-4 w-4"/></span></button><div><p className="font-bold text-slate-800">Ảnh đại diện</p><p className="mt-1 text-xs leading-5 text-slate-500">JPG, PNG, GIF hoặc WebP, tối đa 5 MB. Ảnh này sẽ xuất hiện trên lognote mới.</p></div></div><label className="mt-6 block"><span className="mb-1.5 block text-sm font-bold text-slate-700">Tên hiển thị</span><input value={name} onChange={event => setName(event.target.value)} required maxLength={255} className="ft-input w-full" placeholder="Nhập tên hiển thị"/></label><label className="mt-4 block"><span className="mb-1.5 block text-sm font-bold text-slate-700">Email</span><input value={user.email} disabled className="ft-input w-full bg-slate-50 text-slate-500"/></label>{notice && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{notice}</p>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">Hủy</button><button disabled={busy || !name.trim()} className="ft-primary inline-flex items-center gap-2 disabled:opacity-60">{busy && <LoaderCircle className="h-4 w-4 animate-spin"/>}Lưu thay đổi</button></div></form></div>;
}