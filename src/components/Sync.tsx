import React, { useState, useEffect } from 'react';
import { 
  RefreshCw, Play, Calendar, CheckCircle2, XCircle, AlertCircle, ShieldAlert, History, ArrowRight
} from 'lucide-react';
import { Channel, ApiLog, UserRole } from '../types';
import ConfirmModal from './ConfirmModal';

interface SyncProps {
  idToken: string;
  googleAccessToken: string | null;
  channels: Channel[];
  userRole: UserRole;
  onRefreshChannels: () => Promise<void>;
  onConnectGoogle?: () => Promise<boolean>;
}

export default function Sync({ idToken, googleAccessToken, channels, userRole, onRefreshChannels, onConnectGoogle }: SyncProps) {
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [syncHistory, setSyncHistory] = useState<ApiLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ status: 'success' | 'failed'; message: string } | null>(null);

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

  const fetchSyncHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/sync/history', {
        headers: {
          'Authorization': `Bearer ${idToken}`,
        }
      });
      if (res.ok) {
        const data = await res.json();
        setSyncHistory(data || []);
      }
    } catch (e) {
      console.error('Không thể tải lịch sử đồng bộ:', e);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchSyncHistory();
  }, [idToken]);

  const handleSyncAll = () => {
    if (!isAdmin) return;
    setConfirmState({
      isOpen: true,
      title: 'Đồng bộ toàn bộ các kênh',
      message: 'Bạn có muốn kích hoạt đồng bộ dữ liệu cho TOÀN BỘ các kênh đang hoạt động?',
      confirmText: 'Đồng bộ tất cả',
      type: 'info',
      onConfirm: async () => {
        // Close before starting the long-running request. The result is shown
        // in the sync page, so the confirmation dialog must not remain open.
        setConfirmState(current => ({ ...current, isOpen: false }));
        setSyncingId('all');
        setSyncResult(null);

        try {
          const res = await fetch('/api/sync/all', {
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
            await fetchSyncHistory();
            setSyncResult({
              status: 'success',
              message: 'Kích hoạt đồng bộ tất cả các kênh hoàn tất. Xem chi tiết kết quả trong bảng lịch sử.'
            });
          } else {
            setSyncResult({ status: 'failed', message: data.error || 'Lỗi xảy ra trong quá trình đồng bộ.' });
          }
        } catch (error: any) {
          setSyncResult({ status: 'failed', message: error.message || 'Lỗi đồng bộ.' });
        } finally {
          setSyncingId(null);
        }
      }
    });
  };

  const handleSyncChannel = async (channelId: string) => {
    if (!isAdmin) return;
    setSyncingId(channelId);
    setSyncResult(null);

    try {
      const res = await fetch(`/api/channels/${channelId}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
          'X-Google-OAuth-Token': googleAccessToken || '',
        },
        body: JSON.stringify({
          since: since || undefined,
          until: until || undefined,
        })
      });

      const data = await res.json();
      if (data.success) {
        await onRefreshChannels();
        await fetchSyncHistory();
        setSyncResult({
          status: 'success',
          message: `Đồng bộ kênh hoàn tất! Nhận được ${data.recordsReceived} bài đăng. Ghi mới: ${data.recordsInserted} dòng. Cập nhật: ${data.recordsUpdated} dòng.`
        });
      } else {
        setSyncResult({ status: 'failed', message: data.error || 'Đồng bộ thất bại.' });
      }
    } catch (error: any) {
      setSyncResult({ status: 'failed', message: error.message || 'Đồng bộ thất bại.' });
    } finally {
      setSyncingId(null);
    }
  };

  const activeChannels = channels.filter(c => c.status === 'active');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-150 pb-5">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Đồng Bộ Dữ Liệu</h2>
          <p className="text-sm text-slate-500">Yêu cầu kéo dữ liệu tức thời từ API Facebook/Zalo và đồng bộ hóa sang Google Sheets.</p>
        </div>

        {isAdmin ? (
          <button
            onClick={handleSyncAll}
            disabled={syncingId !== null || activeChannels.length === 0 || !googleAccessToken}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl disabled:opacity-50 transition-colors shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${syncingId === 'all' ? 'animate-spin' : ''}`} />
            Đồng bộ toàn bộ các kênh
          </button>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-500 rounded-lg text-xs font-semibold">
            <ShieldAlert className="w-4 h-4 text-slate-400" />
            Viewer Mode - Không thể đồng bộ
          </div>
        )}
      </div>

      {!googleAccessToken && isAdmin && (
        <div className="bg-amber-50 border border-amber-200/50 p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-amber-900">Thiếu Token Xác Thực Google</h4>
              <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                Google Sheets API <strong>bắt buộc phải có token xác thực tài khoản Google</strong> để thực hiện ghi và đồng bộ dữ liệu báo cáo.
                Ngay cả khi bạn cấu hình Google Sheet ở chế độ công khai (Ai cũng có thể chỉnh sửa), API của Google vẫn chặn mọi thao tác ghi ẩn danh không qua xác thực để bảo vệ dịch vụ.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onConnectGoogle}
            className="shrink-0 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#ffffff"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#ffffff"
                fillOpacity="0.8"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#ffffff"
                fillOpacity="0.7"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z"
              />
              <path
                fill="#ffffff"
                fillOpacity="0.9"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Kết nối Google Account ngay
          </button>
        </div>
      )}

      {/* Date filters and controls for manual syncing */}
      {isAdmin && (
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-800">Cấu hình tham số đồng bộ thủ công</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Đồng bộ từ ngày (Tùy chọn)</label>
              <input 
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Đến ngày (Tùy chọn)</label>
              <input 
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="border-t border-slate-50 pt-4 space-y-2">
            <h4 className="text-xs font-bold text-slate-500 mb-1">Đồng bộ riêng lẻ từng kênh hoạt động</h4>
            
            {activeChannels.length === 0 ? (
              <p className="text-xs text-amber-600 italic">Không có kênh nào đang ở trạng thái hoạt động để đồng bộ.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeChannels.map(chan => {
                  const isThisSyncing = syncingId === chan.id;
                  return (
                    <div key={chan.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50">
                      <div>
                        <span className="text-xs font-bold text-slate-800 block truncate max-w-[150px]">{chan.name}</span>
                        <span className="text-[10px] text-slate-400 uppercase font-semibold">{chan.platform}</span>
                      </div>
                      <button
                        onClick={() => handleSyncChannel(chan.id)}
                        disabled={syncingId !== null}
                        className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-100 font-semibold text-[10px] px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isThisSyncing ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        Sync
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sync feedback result */}
      {syncResult && (
        <div className={`p-4 rounded-xl border flex items-start gap-3 text-xs ${
          syncResult.status === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {syncResult.status === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
          )}
          <div>
            <strong className="font-semibold block">
              {syncResult.status === 'success' ? 'Đồng bộ hoàn tất' : 'Lỗi đồng bộ hóa'}
            </strong>
            <p className="mt-0.5">{syncResult.message}</p>
          </div>
          <button onClick={() => setSyncResult(null)} className="ml-auto font-bold text-slate-400 hover:text-slate-600">×</button>
        </div>
      )}

      {/* Sync History Logs */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-50 pb-3">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <History className="w-4 h-4 text-slate-500" />
            Nhật ký cuộc gọi API & Lịch sử đồng bộ hệ thống
          </h3>
          <button 
            onClick={fetchSyncHistory}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" />
            Tải lại
          </button>
        </div>

        {loadingHistory ? (
          <div className="py-12 text-center text-slate-400 text-xs">Đang tải lịch sử...</div>
        ) : syncHistory.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs italic">Chưa ghi nhận nhật ký đồng bộ nào.</div>
        ) : (
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-left border-collapse table-fixed">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="p-4 w-36">Thời điểm khởi động</th>
                  <th className="p-4 w-28">Nền tảng</th>
                  <th className="p-4 w-24">Trạng thái</th>
                  <th className="p-4 w-20 text-center">Nhận</th>
                  <th className="p-4 w-20 text-center">Ghi mới</th>
                  <th className="p-4 w-20 text-center">Cập nhật</th>
                  <th className="p-4 w-52">Nội dung lỗi / Thông điệp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-mono">
                {syncHistory.map((log) => {
                  const chan = channels.find(c => c.id === log.channelId);
                  return (
                    <tr key={log.logId} className="hover:bg-slate-50/50">
                      <td className="p-4 text-slate-500 font-sans whitespace-nowrap">
                        {new Date(log.startedAt).toLocaleString('vi-VN')}
                      </td>
                      <td className="p-4 font-sans text-slate-800 font-medium">
                        {chan?.name || log.platform.toUpperCase()}
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-sans font-semibold text-[10px] ${
                          log.status === 'success' 
                            ? 'bg-emerald-50 text-emerald-700' 
                            : 'bg-red-50 text-red-700'
                        }`}>
                          {log.status === 'success' ? 'Thành công' : 'Thất bại'}
                        </span>
                      </td>
                      <td className="p-4 text-center text-slate-600 font-medium">{log.recordsReceived}</td>
                      <td className="p-4 text-center text-slate-600 font-medium">{log.recordsInserted}</td>
                      <td className="p-4 text-center text-slate-600 font-medium">{log.recordsUpdated}</td>
                      <td className="p-4 font-sans text-slate-500 truncate" title={log.errorMessage || ''}>
                        {log.status === 'success' ? (
                          <span className="text-slate-400 italic">Đồng bộ hoàn hảo</span>
                        ) : (
                          <span className="text-red-500 font-medium">{log.errorMessage}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
