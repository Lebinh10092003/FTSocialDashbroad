import { useEffect, useState } from 'react';
import { AlertCircle, BarChart3, Calendar, Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { Platform } from '../types';

interface MediaSummaryRow {
  id: string;
  platform: Platform;
  name: string;
  externalId: string;
  lastSyncAt: string | null;
  lastSyncStatus: 'success' | 'failed' | null;
  followersCount: number;
  postsCount: number;
  views: number;
  totalEngagement: number;
}

interface MediaSummaryProps {
  idToken: string;
}

type DatePreset = 'custom' | '7days' | '30days' | '3months';

function getPastDateStr(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
export default function MediaSummary({ idToken }: MediaSummaryProps) {
  const [rows, setRows] = useState<MediaSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(getPastDateStr(29));
  const [endDate, setEndDate] = useState(getTodayStr());
  const [datePreset, setDatePreset] = useState<DatePreset>('30days');

  const loadSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      const response = await fetch(`/api/media-summary?${params.toString()}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Không thể tải tổng hợp truyền thông.');
      }
      setRows(await response.json());
    } catch (loadError: any) {
      setError(loadError.message || 'Không thể kết nối tới hệ thống.');
    } finally {
      setLoading(false);
    }
  };

  const updatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === 'custom') return;

    const end = new Date();
    const start = new Date();
    if (preset === '7days') start.setDate(end.getDate() - 6);
    if (preset === '30days') start.setDate(end.getDate() - 29);
    if (preset === '3months') start.setMonth(end.getMonth() - 3);

    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  };
  useEffect(() => {
    if (idToken) loadSummary();
  }, [idToken, startDate, endDate]);

  const downloadXlsx = async () => {
    try {
      const params = new URLSearchParams({ startDate, endDate });
      const response = await fetch(`/api/reports/media-summary.xlsx?${params.toString()}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!response.ok) throw new Error('Không thể tạo file Excel.');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tong_hop_truyen_thong_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError: any) {
      alert(downloadError.message || 'Không thể tải file Excel.');
    }
  };

  return (
    <div className="space-y-7 pb-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200/70 pb-6">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Tổng hợp truyền thông</h2>
          <p className="text-sm text-slate-500 mt-1">Theo dõi số bài đăng, người theo dõi và hiệu quả tương tác của từng trang trong 30 ngày gần nhất.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex flex-wrap items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm">
            <Calendar className="w-4 h-4 text-slate-400" />
            <select value={datePreset} onChange={event => updatePreset(event.target.value as DatePreset)} className="text-sm font-bold text-slate-700 bg-transparent outline-none">
              <option value="custom">Tùy chọn</option>
              <option value="7days">7 ngày qua</option>
              <option value="30days">30 ngày qua</option>
              <option value="3months">3 tháng qua</option>
            </select>
            <input type="date" value={startDate} min={getPastDateStr(365)} max={endDate} onChange={event => { setStartDate(event.target.value); setDatePreset('custom'); }} className="text-sm text-slate-600 outline-none" />
            <span className="text-sm text-slate-400">đến</span>
            <input type="date" value={endDate} min={startDate} max={getTodayStr()} onChange={event => { setEndDate(event.target.value); setDatePreset('custom'); }} className="text-sm text-slate-600 outline-none" />
          </div>
          <button onClick={loadSummary} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-extrabold text-slate-700 hover:bg-slate-50">
            <RefreshCw className="w-4 h-4" /> Làm mới
          </button>
          <button onClick={downloadXlsx} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-extrabold hover:bg-emerald-700 shadow-sm">
            <Download className="w-4 h-4" /> Xuất Excel
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200/70 rounded-3xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-start gap-3">
          <div className="p-3 rounded-xl bg-blue-50 text-blue-700"><BarChart3 className="w-6 h-6" /></div>
          <div>
            <h3 className="text-lg font-extrabold text-slate-800">Hiệu quả hoạt động theo kênh</h3>
            <p className="text-sm text-slate-500 mt-1">Mặc định chỉ lấy dữ liệu trong 30 ngày gần nhất; số bài đăng được đếm theo bài viết duy nhất.</p>
          </div>
        </div>

        {loading ? (
          <div className="py-24 text-center"><RefreshCw className="w-9 h-9 text-blue-500 animate-spin mx-auto" /><p className="text-sm text-slate-500 mt-3">Đang tải dữ liệu...</p></div>
        ) : error ? (
          <div className="m-6 p-6 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-3"><AlertCircle className="w-6 h-6" />{error}</div>
        ) : rows.length === 0 ? (
          <div className="py-24 text-center text-slate-500"><FileSpreadsheet className="w-10 h-10 mx-auto text-slate-300 mb-3" />Chưa có kênh đang hoạt động.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1160px] text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  <th className="px-6 py-4 text-center w-20">STT</th>
                  <th className="px-6 py-4">Nền tảng</th>
                  <th className="px-6 py-4">Tên trang</th>
                  <th className="px-6 py-4 font-mono">ID</th>
                  <th className="px-6 py-4">Đồng bộ lần cuối</th>
                  <th className="px-6 py-4 text-right">Người theo dõi</th>
                  <th className="px-6 py-4 text-center">Số bài đăng</th>
                  <th className="px-6 py-4 text-right">Lượt xem</th>
                  <th className="px-6 py-4 text-right">Tổng tương tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {rows.map((row, index) => (
                  <tr key={row.id} className="hover:bg-slate-50/70">
                    <td className="px-6 py-5 text-center font-semibold text-slate-500">{index + 1}</td>
                    <td className="px-6 py-5"><span className={`inline-flex px-3 py-1 rounded-full border text-xs font-extrabold ${row.platform === 'facebook' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-teal-50 text-teal-700 border-teal-100'}`}>{row.platform === 'facebook' ? 'Facebook' : 'Zalo OA'}</span></td>
                    <td className="px-6 py-5 font-bold text-slate-800">{row.name}</td>
                    <td className="px-6 py-5 font-mono text-slate-500">{row.externalId}</td>
                    <td className="px-6 py-5">
                      {row.lastSyncAt ? <div><p className="font-semibold text-slate-700">{new Date(row.lastSyncAt).toLocaleString('vi-VN')}</p><p className={`text-xs font-bold mt-1 ${row.lastSyncStatus === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>{row.lastSyncStatus === 'success' ? 'Thành công' : 'Thất bại'}</p></div> : <span className="text-slate-400">Chưa đồng bộ</span>}
                    </td>
                    <td className="px-6 py-5 text-right font-extrabold text-slate-700">{row.followersCount.toLocaleString('vi-VN')}</td>
                    <td className="px-6 py-5 text-center font-extrabold text-slate-700">{row.postsCount.toLocaleString('vi-VN')}</td>
                    <td className="px-6 py-5 text-right font-extrabold text-slate-700">{row.views.toLocaleString('vi-VN')}</td>
                    <td className="px-6 py-5 text-right font-extrabold text-slate-900">{row.totalEngagement.toLocaleString('vi-VN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4">Bảng và tệp Excel mặc định chỉ gồm dữ liệu trong 30 ngày gần nhất; Excel có thêm Người theo dõi và Lượt xem. ID và thời điểm đồng bộ được giữ trên giao diện để tra cứu.</p>
    </div>
  );
}
