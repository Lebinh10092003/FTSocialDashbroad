import React, { useEffect, useState } from 'react';
import { Edit3, Plus, Shield, Trash2, Users, UserCog } from 'lucide-react';
import { UserProfile, UserRole } from '../../types';
import ConfirmModal from '../ConfirmModal';

interface AccountManagementProps { idToken: string; userRole: UserRole; }

export default function AccountManagement({ idToken, userRole }: AccountManagementProps) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('EMPLOYEE');
  const [message, setMessage] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const canManage = userRole === 'ADMIN' || userRole === 'MANAGER';
  const isAdmin = userRole === 'ADMIN';

  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${idToken}` } });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error || 'Không thể tải danh sách tài khoản.');
      setUsers(Array.isArray(data) ? data : []);
    } catch (error: any) {
      setMessage(error.message || 'Không thể tải danh sách tài khoản.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadUsers(); }, [idToken]);

  const resetForm = () => {
    setEmail('');
    setName('');
    setPassword('');
    setRole('EMPLOYEE');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ email, name, password, role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Không thể lưu tài khoản.');
      setMessage(data.message || 'Đã lưu tài khoản.');
      resetForm();
      await loadUsers();
    } catch (error: any) {
      setMessage(error.message || 'Không thể lưu tài khoản.');
    } finally {
      setSaving(false);
    }
  };

  const edit = (user: UserProfile) => {
    setEmail(user.email);
    setName(user.name || '');
    setRole(user.role);
    setPassword('');
    setMessage('Đang chỉnh sửa tài khoản. Nhập mật khẩu mới để cập nhật.');
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !canManage || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ email: deleteTarget.email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Không thể xóa tài khoản.');
      setMessage(data.message || 'Đã xóa tài khoản.');
      setDeleteTarget(null);
      await loadUsers();
    } catch (error: any) {
      setMessage(error.message || 'Không thể xóa tài khoản.');
    } finally {
      setDeleting(false);
    }
  };

  return <div className="space-y-6">
    <div className="flex items-center justify-between border-b border-slate-200 pb-5"><div><h2 className="text-2xl font-bold text-slate-900">Quản lý tài khoản</h2><p className="text-sm text-slate-500 mt-1">Quản lý thành viên bằng email và cấp đúng phạm vi thao tác.</p></div><UserCog className="w-8 h-8 text-blue-600" /></div>
    {!canManage && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Nhân viên chỉ có quyền xem danh sách tài khoản.</div>}
    {canManage && <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 p-5 grid grid-cols-1 md:grid-cols-5 gap-3 items-end shadow-sm">
      <label className="text-xs font-bold text-slate-600">Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" /></label>
      <label className="text-xs font-bold text-slate-600">Tên hiển thị<input type="text" value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" /></label>
      <label className="text-xs font-bold text-slate-600">Mật khẩu<input required minLength={8} type="password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" /></label>
      <label className="text-xs font-bold text-slate-600">Vai trò<select value={role} onChange={event => setRole(event.target.value as UserRole)} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"><option value="EMPLOYEE">Nhân viên</option>{isAdmin && <><option value="MANAGER">Quản lý</option><option value="ADMIN">Admin</option></>}</select></label>
      <button type="submit" disabled={saving} className="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-blue-600 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"><Plus className="h-4 w-4 shrink-0" />{saving ? 'Đang lưu...' : 'Lưu tài khoản'}</button>
    </form>}
    {message && <p role="status" className="text-sm text-blue-700">{message}</p>}
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 font-bold text-slate-800"><Users className="w-5 h-5 text-blue-600" /> Thành viên hệ thống</div>{loading ? <p className="p-6 text-sm text-slate-400">Đang tải...</p> : <table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-4 text-left">Thành viên</th><th className="p-4 text-left">Vai trò</th>{canManage && <th className="p-4 text-right">Tác vụ</th>}</tr></thead><tbody className="divide-y divide-slate-100">{users.map(user => <tr key={user.email}><td className="p-4"><div className="font-semibold">{user.name || 'Thành viên'}</div><div className="text-xs text-slate-400">{user.email}</div></td><td className="p-4"><span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold"><Shield className="w-3 h-3" />{user.role}</span></td>{canManage && <td className="p-4 text-right"><button type="button" aria-label={`Chỉnh sửa ${user.email}`} onClick={() => edit(user)} className="p-2 text-slate-400 hover:text-blue-600"><Edit3 className="w-4 h-4" /></button><button type="button" aria-label={`Xóa ${user.email}`} onClick={() => setDeleteTarget(user)} className="p-2 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button></td>}</tr>)}</tbody></table>}</div>
    <ConfirmModal isOpen={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} onConfirm={confirmDelete} title="Xóa tài khoản" message={`Bạn có chắc chắn muốn xóa tài khoản ${deleteTarget?.email || ''}? Thao tác này không thể hoàn tác.`} confirmText={deleting ? 'Đang xóa...' : 'Xóa tài khoản'} type="danger" />
  </div>;
}
