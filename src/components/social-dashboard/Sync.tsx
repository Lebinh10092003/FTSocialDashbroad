import React, { useState, useEffect } from 'react';
import { 
  RefreshCw, Play, Calendar, CheckCircle2, XCircle, AlertCircle, ShieldAlert, History, ArrowRight
} from 'lucide-react';
import { Channel, ApiLog, UserRole } from '../../types';
import ConfirmModal from '../ConfirmModal';

interface SyncProps {
  idToken: string;
  googleAccessToken: string | null;
  channels: Channel[];
  userRole: UserRole;
  onRefreshChannels: () => Promise<void>;
  onConnectGoogle?: () => Promise<boolean>;
}

function getDefaultSinceDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return date.toISOString().slice(0, 10);
}

export default function Sync({ idToken, googleAccessToken, channels, userRole, onRefreshChannels, onConnectGoogle }: SyncProps) {
  const [since, setSince] = useState(getDefaultSinceDate);
  const [until, setUntil] = useState('');
  const [syncHistory, setSyncHistory] = useState<ApiLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [channelSyncStates, setChannelSyncStates] = useState<Record<string, ApiLog['status']>>({});

  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
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

  const canManage = userRole === 'ADMIN' || userRole === 'MANAGER';
  const activeChannels = channels.filter(channel => channel.status === 'active');
  const activeChannelIds = new Set(activeChannels.map(channel => channel.id));
  const hasActiveChannelSync = Object.entries(channelSyncStates).some(
    ([channelId, status]) => activeChannelIds.has(channelId) && (status === 'queued' || status === 'running'),
  );

  const applySyncStatesFromHistory = (logs: ApiLog[]) => {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    const latestByChannel: Record<string, ApiLog['status']> = {};

    for (const log of logs) {
      if (!log.channelId || latestByChannel[log.channelId]) continue;
      if (new Date(log.startedAt).getTime() < cutoff) continue;
      latestByChannel[log.channelId] = log.status;
    }

    setChannelSyncStates(latestByChannel);
  };

  const fetchSyncHistory = async (silent = false) => {
    if (!silent) setLoadingHistory(true);
    try {
      const res = await fetch('/api/sync/history', {
        headers: {
          'Authorization': 'Bearer ' + idToken,
        },
      });
      if (res.ok) {
        const data: ApiLog[] = await res.json();
        setSyncHistory(data || []);
        applySyncStatesFromHistory(data || []);
      }
    } catch (error) {
      console.error('Không thể tải lịch sử đồng bộ:', error);
    } finally {
      if (!silent) setLoadingHistory(false);
    }
  };

  useEffect(() => {
    void fetchSyncHistory();
  }, [idToken]);

  useEffect(() => {
    if (!hasActiveChannelSync && syncingId === null) return;
    const intervalId = window.setInterval(() => {
      void fetchSyncHistory(true);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [hasActiveChannelSync, syncingId, idToken]);

  const handleSyncAll = () => {
    if (!canManage) return;
    setConfirmState({
      isOpen: true,
      title: 'Đồng bộ toàn bộ các kênh',
      message: 'Bạn có muốn kích hoạt đồng bộ dữ liệu cho TOÀN BỘ các kênh đang hoạt động?',
      confirmText: 'Đồng bộ tất cả',
      type: 'info',
      onConfirm: async () => {
        setConfirmState(current => ({ ...current, isOpen: false }));
        setSyncingId('all');
        setSyncResult(null);
        setChannelSyncStates(current => ({
          ...current,
          ...Object.fromEntries(activeChannels.map(channel => [channel.id, 'queued' as const])),
        }));

        try {
          const res = await fetch('/api/sync/all', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + idToken,
              'X-Google-OAuth-Token': googleAccessToken || '',
            },
            body: JSON.stringify({ background: true, recentDays: 7 }),
          });

          const data = await res.json();
          if (data.success) {
            await onRefreshChannels();
            setSyncResult({
              status: 'success',
              message: data.message || 'Đã xếp hàng đồng bộ nền cho các kênh. Xem tiến độ trong bảng lịch sử.',
            });
          } else {
            setSyncResult({ status: 'failed', message: data.error || data.message || 'Lỗi xảy ra trong quá trình đồng bộ.' });
          }
        } catch (error: any) {
          setSyncResult({ status: 'failed', message: error.message || 'Lỗi đồng bộ.' });
          setChannelSyncStates(current => Object.fromEntries(
            Object.entries(current).map(([channelId, status]) => [
              channelId,
              status === 'queued' || status === 'running' ? 'failed' : status,
            ]),
          ));
        } finally {
          await fetchSyncHistory(true);
          setSyncingId(null);
        }
      },
    });
  };

  const handleCancelAll = () => {
    if (!canManage || !hasActiveChannelSync) return;
    setConfirmState({
      isOpen: true,
      title: 'Hủy đồng bộ dữ liệu',
      message: 'Bạn có muốn dừng lượt đồng bộ đang chạy? Kênh đang gọi API sẽ dừng sau tác vụ hiện tại, các kênh chờ sẽ không tiếp tục.',
      confirmText: 'Hủy đồng bộ',
      type: 'danger',
      onConfirm: async () => {
        setConfirmState(current => ({ ...current, isOpen: false }));
        setCancelling(true);
        try {
          const response = await fetch('/api/sync/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
            body: JSON.stringify({}),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || 'Không thể hủy đồng bộ.');
          setSyncResult({ status: 'success', message: data.message || 'Đã gửi yêu cầu hủy đồng bộ.' });
          await fetchSyncHistory(true);
        } catch (error: any) {
          setSyncResult({ status: 'failed', message: error.message || 'Không thể hủy đồng bộ.' });
        } finally {
          setCancelling(false);
        }
      },
    });
  };
  const handleSyncChannel = async (channelId: string) => {
    if (!canManage) return;
    setSyncingId(channelId);
    setSyncResult(null);
    setChannelSyncStates(current => ({ ...current, [channelId]: 'running' }));

    try {
      const res = await fetch('/api/channels/' + channelId + '/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + idToken,
          'X-Google-OAuth-Token': googleAccessToken || '',
        },
        body: JSON.stringify({
          since: since || undefined,
          until: until || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setChannelSyncStates(current => ({ ...current, [channelId]: 'success' }));
        await onRefreshChannels();
        setSyncResult({
          status: 'success',
          message: data.message || 'Đồng bộ kênh hoàn tất.',
        });
      } else {
        setChannelSyncStates(current => ({ ...current, [channelId]: 'failed' }));
        setSyncResult({ status: 'failed', message: data.error || 'Đồng bộ thất bại.' });
      }
    } catch (error: any) {
      setChannelSyncStates(current => ({ ...current, [channelId]: 'failed' }));
      setSyncResult({ status: 'failed', message: error.message || 'Đồng bộ thất bại.' });
    } finally {
      await fetchSyncHistory(true);
      setSyncingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-150 pb-5">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Đồng Bộ Dữ Liệu</h2>
          <p className="text-sm text-slate-500">Yêu cầu kéo dữ liệu tức thời từ API Facebook/Zalo để đồng bộ và lưu trữ vào cơ sở dữ liệu hệ thống.</p>
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasActiveChannelSync && (
              <button
                onClick={handleCancelAll}
                disabled={cancelling}
                className="flex items-center gap-2 border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 font-semibold text-xs px-4 py-2.5 rounded-xl disabled:opacity-50 transition-colors"
              >
                <XCircle className={'w-4 h-4 ' + (cancelling ? 'animate-spin' : '')} />
                {cancelling ? 'Đang hủy...' : 'Hủy đồng bộ'}
              </button>
            )}
            <button
              onClick={handleSyncAll}
              disabled={syncingId !== null || hasActiveChannelSync || activeChannels.length === 0}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
            >
              <RefreshCw className={'w-4 h-4 ' + (syncingId === 'all' || hasActiveChannelSync ? 'animate-spin' : '')} />
              {syncingId === 'all' || hasActiveChannelSync ? 'Đang đồng bộ...' : 'Đồng bộ toàn bộ các kênh'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-500 rounded-lg text-xs font-semibold">
            <ShieldAlert className="w-4 h-4 text-slate-400" />
            Viewer Mode - Không thể đồng bộ
          </div>
        )}
      </div>

      {/* Google Sheets warning removed, as database sync does not require Google login */}

      {/* Date filters and controls for manual syncing */}
      {canManage && (
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-800">Cấu hình tham số đồng bộ thủ công</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Đồng bộ riêng lẻ từ ngày (mặc định 7 ngày gần nhất)</label>
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
                  const syncState = channelSyncStates[chan.id];
                  const isQueued = syncState === 'queued';
                  const isRunning = syncState === 'running' || syncingId === chan.id;
                  const isThisSyncing = isQueued || isRunning;
                  return (
                    <div key={chan.id} className={'flex items-center justify-between p-3 rounded-xl border transition-colors ' + (isRunning ? 'border-blue-200 bg-blue-50/60' : isQueued ? 'border-amber-200 bg-amber-50/60' : 'border-slate-100 bg-slate-50/50')}>
                      <div>
                        <span className="text-xs font-bold text-slate-800 block truncate max-w-[150px]">{chan.name}</span>
                        <span className="text-[10px] text-slate-400 uppercase font-semibold">{chan.platform}</span>
                      </div>
                      <button
                        onClick={() => handleSyncChannel(chan.id)}
                        disabled={syncingId !== null || hasActiveChannelSync}
                        title={isRunning ? 'Đang đồng bộ' : isQueued ? 'Đang chờ đến lượt đồng bộ' : 'Đồng bộ kênh này'}
                        className={'flex items-center gap-1.5 bg-white border font-semibold text-[10px] px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-80 ' + (isRunning ? 'border-blue-200 text-blue-700' : isQueued ? 'border-amber-200 text-amber-700' : 'border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-100')}
                      >
                        {isThisSyncing ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        {isRunning ? 'Đang Sync' : isQueued ? 'Chờ Sync' : 'Sync'}
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
            onClick={() => fetchSyncHistory()}
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
                        <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-sans font-semibold text-[10px] ' + (
                          log.status === 'success'
                            ? 'bg-emerald-50 text-emerald-700'
                            : log.status === 'running'
                              ? 'bg-blue-50 text-blue-700'
                              : log.status === 'queued'
                                ? 'bg-amber-50 text-amber-700'
                                : log.status === 'cancelled'
                                  ? 'bg-slate-100 text-slate-600'
                                  : 'bg-red-50 text-red-700'
                        )}>
                          {(log.status === 'queued' || log.status === 'running') && <RefreshCw className="w-3 h-3 animate-spin" />}
                          {log.status === 'success' ? 'Thành công' : log.status === 'running' ? 'Đang chạy' : log.status === 'queued' ? 'Đang chờ' : log.status === 'cancelled' ? 'Đã hủy' : 'Thất bại'}
                        </span>
                      </td>
                      <td className="p-4 text-center text-slate-600 font-medium">{log.recordsReceived}</td>
                      <td className="p-4 text-center text-slate-600 font-medium">{log.recordsInserted}</td>
                      <td className="p-4 text-center text-slate-600 font-medium">{log.recordsUpdated}</td>
                      <td className="p-4 font-sans text-slate-500 truncate" title={log.errorMessage || ''}>
                        {log.status === 'success' ? (
                          <span className="text-slate-400 italic">Đồng bộ hoàn hảo</span>
                        ) : log.status === 'running' ? (
                          <span className="text-blue-600 font-medium">Đang lấy dữ liệu...</span>
                        ) : log.status === 'queued' ? (
                          <span className="text-amber-600 font-medium">Đang chờ đến lượt...</span>
                        ) : log.status === 'cancelled' ? (
                          <span className="text-slate-500 font-medium">Đã hủy theo yêu cầu quản trị.</span>
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
