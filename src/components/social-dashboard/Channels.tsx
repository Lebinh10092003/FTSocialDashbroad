import React, { useState } from 'react';
import { 
  Radio, Plus, RefreshCw, CheckCircle2, XCircle, Settings, Trash2, ShieldAlert, Wifi, Globe, AlertTriangle
} from 'lucide-react';
import { Channel, UserRole } from '../../types';
import ConfirmModal from '../ConfirmModal';

interface ChannelsProps {
  idToken: string;
  googleAccessToken: string | null;
  channels: Channel[];
  userRole: UserRole;
  onRefreshChannels: () => Promise<void>;
}

export default function Channels({ idToken, googleAccessToken, channels, userRole, onRefreshChannels }: ChannelsProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newChanPlatform, setNewChanPlatform] = useState<'facebook' | 'zalo' | 'mock'>('facebook');
  const [newChanName, setNewChanName] = useState('');
  const [newChanExternalId, setNewChanExternalId] = useState('');
  const [newChanTimezone, setNewChanTimezone] = useState('Asia/Bangkok');

  const [loading, setLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState<{ id: string; type: 'test' | 'sync' | 'add' | 'delete'; status: 'success' | 'failed' | 'loading'; message: string } | null>(null);

  // Custom confirmation modal state to bypass iframe window.confirm limits
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    type?: 'danger' | 'warning' | 'info';
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const isAdmin = userRole === 'ADMIN';

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!newChanName || !newChanExternalId) {
      alert('Vui lòng điền đầy đủ tên kênh và ID nền tảng!');
      return;
    }

    setLoading(true);
    setActionStatus({ id: 'new', type: 'add', status: 'loading', message: 'Đang khởi tạo kênh...' });

    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          platform: newChanPlatform,
          name: newChanName,
          externalId: newChanExternalId,
          timezone: newChanTimezone,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Lỗi hệ thống khi tạo kênh.');
      }

      await onRefreshChannels();
      setShowAddForm(false);
      setNewChanName('');
      setNewChanExternalId('');
      setActionStatus({ id: 'new', type: 'add', status: 'success', message: 'Tạo kênh thành công!' });
    } catch (error: any) {
      setActionStatus({ id: 'new', type: 'add', status: 'failed', message: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async (chanId: string) => {
    if (!isAdmin) return;
    setActionStatus({ id: chanId, type: 'test', status: 'loading', message: 'Đang kiểm tra kết nối...' });

    try {
      const res = await fetch(`/api/channels/${chanId}/test-connection`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
        }
      });
      const data = await res.json();
      if (data.success) {
        setActionStatus({ id: chanId, type: 'test', status: 'success', message: 'Kết nối API thành công!' });
      } else {
        setActionStatus({ id: chanId, type: 'test', status: 'failed', message: data.message });
      }
    } catch (error: any) {
      setActionStatus({ id: chanId, type: 'test', status: 'failed', message: 'Lỗi kết nối: ' + error.message });
    }
  };

  const handleSyncChannel = (chanId: string) => {
    if (!isAdmin) return;
    if (!googleAccessToken) {
      setActionStatus({ 
        id: chanId, 
        type: 'sync', 
        status: 'failed', 
        message: 'Yêu cầu kết nối tài khoản Google trong mục Cấu hình trước khi đồng bộ!' 
      });
      return;
    }
    setConfirmState({
      isOpen: true,
      title: 'Đồng bộ dữ liệu thủ công',
      message: 'Bạn có chắc chắn muốn chạy đồng bộ thủ công ngay lập tức? Thao tác này sẽ ghi đè lên Google Sheets.',
      confirmText: 'Đồng bộ ngay',
      type: 'info',
      onConfirm: async () => {
        setActionStatus({ id: chanId, type: 'sync', status: 'loading', message: 'Đang đồng bộ dữ liệu mạng xã hội...' });

        try {
          const res = await fetch(`/api/channels/${chanId}/sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`,
              'X-Google-OAuth-Token': googleAccessToken || '',
            }
          });
          const data = await res.json();
          if (data.success) {
            await onRefreshChannels();
            setActionStatus({
              id: chanId, 
              type: 'sync', 
              status: 'success', 
              message: `Đồng bộ thành công! Nhận được ${data.recordsReceived} bài đăng.` 
            });
          } else {
            setActionStatus({ id: chanId, type: 'sync', status: 'failed', message: data.error || 'Lỗi đồng bộ.' });
          }
        } catch (error: any) {
          setActionStatus({ id: chanId, type: 'sync', status: 'failed', message: 'Lỗi đồng bộ: ' + error.message });
        }
      }
    });
  };

  const toggleChannelStatus = async (chan: Channel) => {
    if (!isAdmin) return;
    const newStatus = chan.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await fetch(`/api/channels/${chan.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        await onRefreshChannels();
      }
    } catch (error) {
      console.error('Lỗi chuyển trạng thái kênh:', error);
    }
  };

  const handleDeleteChannel = (chanId: string, chanName: string) => {
    if (!isAdmin) return;
    setConfirmState({
      isOpen: true,
      title: 'Xóa kênh kết nối',
      message: `Bạn có chắc chắn muốn xóa kênh "${chanName}" và toàn bộ dữ liệu lịch sử liên quan? Hành động này không thể hoàn tác!`,
      confirmText: 'Xóa kênh',
      type: 'danger',
      onConfirm: async () => {
        setActionStatus({ id: chanId, type: 'delete', status: 'loading', message: 'Đang xóa kênh...' });

        try {
          const res = await fetch(`/api/channels/${chanId}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${idToken}`,
            }
          });
          const data = await res.json();
          if (res.ok && data.success) {
            await onRefreshChannels();
            setActionStatus({ id: chanId, type: 'delete', status: 'success', message: 'Đã xóa kênh thành công!' });
          } else {
            setActionStatus({ id: chanId, type: 'delete', status: 'failed', message: data.error || 'Lỗi khi xóa kênh.' });
          }
        } catch (error: any) {
          setActionStatus({ id: chanId, type: 'delete', status: 'failed', message: 'Lỗi khi xóa kênh: ' + error.message });
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-150 pb-5">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Kênh Mạng Xã Hội</h2>
          <p className="text-sm text-slate-500">Quản lý và thiết lập kết nối API Facebook Pages và Zalo OA thực tế.</p>
        </div>
        
        {isAdmin ? (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-4 py-2 rounded-xl transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Thêm kênh kết nối
          </button>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-500 rounded-lg text-xs font-semibold">
            <ShieldAlert className="w-4 h-4 text-slate-400" />
            Chế độ xem (Viewer)
          </div>
        )}
      </div>

      {/* Add form */}
      {showAddForm && isAdmin && (
        <form onSubmit={handleCreateChannel} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4 max-w-xl">
          <h3 className="text-sm font-bold text-slate-800">Cấu hình kết nối kênh mới</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Nền tảng</label>
              <select
                value={newChanPlatform}
                onChange={(e) => setNewChanPlatform(e.target.value as any)}
                className="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
              >
                <option value="facebook">Facebook Page</option>
                <option value="zalo">Zalo Official Account (OA)</option>
                <option value="mock">Mock Platform (Thử nghiệm)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Múi giờ</label>
              <select
                value={newChanTimezone}
                onChange={(e) => setNewChanTimezone(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
              >
                <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Tên kênh hiển thị</label>
            <input
              type="text"
              placeholder="VD: Fanpage FT Social, Cửa hàng Zalo..."
              value={newChanName}
              onChange={(e) => setNewChanName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">External ID (ID thực tế)</label>
            <input
              type="text"
              placeholder="VD: Page ID của Facebook hoặc OA ID của Zalo"
              value={newChanExternalId}
              onChange={(e) => setNewChanExternalId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 bg-slate-100 px-4 py-2 rounded-lg"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={loading}
              className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg disabled:opacity-50"
            >
              Khởi tạo kênh
            </button>
          </div>
        </form>
      )}

      {/* Action logs banner feedback */}
      {actionStatus && (
        <div className={`p-4 rounded-xl border flex items-start gap-3 text-xs ${
          actionStatus.status === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
            : actionStatus.status === 'failed' 
            ? 'bg-red-50 border-red-200 text-red-800' 
            : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          {actionStatus.status === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
          ) : actionStatus.status === 'failed' ? (
            <XCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
          ) : (
            <RefreshCw className="w-4 h-4 shrink-0 text-blue-600 animate-spin mt-0.5" />
          )}
          <div>
            <strong className="font-semibold block">
              {actionStatus.type === 'add' ? 'Thêm kênh mới: ' : actionStatus.type === 'test' ? 'Kiểm tra kết nối API: ' : actionStatus.type === 'delete' ? 'Xóa kênh: ' : 'Đồng bộ dữ liệu: '}
              {actionStatus.status === 'loading' ? 'Đang thực hiện...' : actionStatus.status === 'success' ? 'Hoàn tất' : 'Lỗi xảy ra'}
            </strong>
            <p className="mt-0.5">{actionStatus.message}</p>
          </div>
          <button onClick={() => setActionStatus(null)} className="ml-auto font-bold text-slate-400 hover:text-slate-600">×</button>
        </div>
      )}

      {/* Channels List Table */}
      {channels.length === 0 ? (
        <div className="p-12 text-center bg-white border border-slate-150 rounded-2xl shadow-sm space-y-4">
          <Radio className="w-12 h-12 text-slate-300 mx-auto" />
          <div>
            <h3 className="text-base font-bold text-slate-800">Chưa cấu hình kênh mạng xã hội nào</h3>
            <p className="text-xs text-slate-400 mt-1">Cần cấu hình kết nối ít nhất 1 Facebook Page hoặc Zalo OA để thu thập dữ liệu báo cáo.</p>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="p-4">Nền tảng</th>
                  <th className="p-4">Tên kênh</th>
                  <th className="p-4 font-mono">External ID</th>
                  <th className="p-4">Trạng thái</th>
                  <th className="p-4">Đồng bộ cuối</th>
                  <th className="p-4 text-center">Số bài</th>
                  <th className="p-4 text-right">Tác vụ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {channels.map((chan) => (
                  <tr key={chan.id} className="hover:bg-slate-50/50">
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full font-semibold text-[10px] ${
                        chan.platform === 'facebook' 
                          ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                          : 'bg-teal-50 text-teal-700 border border-teal-100'
                      }`}>
                        {chan.platform === 'facebook' ? 'Facebook' : 'Zalo OA'}
                      </span>
                    </td>
                    <td className="p-4 font-medium text-slate-800">{chan.name}</td>
                    <td className="p-4 font-mono text-slate-500">{chan.externalId}</td>
                    <td className="p-4">
                      <button
                        onClick={() => toggleChannelStatus(chan)}
                        disabled={!isAdmin}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                          chan.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${chan.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                        {chan.status === 'active' ? 'Hoạt động' : 'Tạm dừng'}
                      </button>
                    </td>
                    <td className="p-4 text-slate-500">
                      {chan.lastSyncAt ? (
                        <div className="space-y-0.5">
                          <span className="block font-medium">{new Date(chan.lastSyncAt).toLocaleDateString('vi-VN')}</span>
                          <span className={`text-[10px] font-semibold ${chan.lastSyncStatus === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
                            {chan.lastSyncStatus === 'success' ? 'Thành công' : 'Thất bại'}
                          </span>
                        </div>
                      ) : (
                        <em className="text-slate-400">Chưa đồng bộ</em>
                      )}
                    </td>
                    <td className="p-4 text-center font-mono font-semibold text-slate-600">{chan.totalPosts || 0}</td>
                    <td className="p-4 text-right">
                      {isAdmin ? (
                        <div className="inline-flex gap-2">
                          <button
                            onClick={() => handleTestConnection(chan.id)}
                            title="Kiểm tra kết nối API"
                            className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-800 rounded-lg border border-slate-200 transition-colors"
                          >
                            <Wifi className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleSyncChannel(chan.id)}
                            title="Đồng bộ ngay"
                            className="p-1.5 hover:bg-slate-100 text-blue-600 hover:text-blue-800 rounded-lg border border-slate-200 transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteChannel(chan.id, chan.name)}
                            title="Xóa kênh"
                            className="p-1.5 hover:bg-red-50 text-red-500 hover:text-red-700 rounded-lg border border-slate-200 hover:border-red-200 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[10px] italic">Không khả dụng</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Guide Card on managing secrets safely */}
      <div className="bg-slate-50 p-5 rounded-2xl border border-slate-150 space-y-3">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
          <Settings className="w-4 h-4 text-slate-500" />
          Hướng dẫn quản lý mã xác thực an toàn (Server-Side Secrets)
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          Theo nguyên tắc bảo mật, toàn bộ Access Token của Facebook Pages và Zalo OA được mã hóa và lưu trữ an toàn phía backend (server-side). Chúng tôi không bao giờ hiển thị trực tiếp token trên giao diện hoặc lưu trong trình duyệt của người dùng.
        </p>
        <div className="text-[11px] text-slate-500 bg-white p-3 rounded-xl border border-slate-200 space-y-1">
          <p>• Để thay đổi cấu hình, vui lòng truy cập <strong>Cấu hình Secrets</strong> của server (Google Cloud Run / AI Studio Secrets panel).</p>
          <p>• Định dạng Secrets JSON: <code className="font-mono bg-slate-50 px-1 py-0.5 rounded text-blue-700">{"{\"PAGE_ID_1\": \"TOKEN_VAL_1\", \"PAGE_ID_2\": \"TOKEN_VAL_2\"}"}</code></p>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        type={confirmState.type}
      />
    </div>
  );
}
