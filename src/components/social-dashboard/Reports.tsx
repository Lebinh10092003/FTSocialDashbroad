import React, { useState, useEffect } from 'react';
import { 
  BarChart3, FileSpreadsheet, Download, ExternalLink, Calendar, Radio, TrendingUp, AlertCircle
} from 'lucide-react';
import { Channel, DashboardData, SystemConfig } from '../../types';

interface ReportsProps {
  idToken: string;
  channels: Channel[];
}

export default function Reports({ idToken, channels }: ReportsProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReportsData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Pull system config first
      const configRes = await fetch('/api/setup/sheets', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      // Fallback: system config is fetched on mount if admin or from local state, we can query our standard systemConfig via Firestore on client
      
      const dashboardRes = await fetch('/api/dashboard', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (dashboardRes.ok) {
        const dJson = await dashboardRes.json();
        setData(dJson);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportsData();
    
    // Fetch google sheets spreadsheet config
    const fetchConfig = async () => {
      try {
        // Query config from firestore if possible, or simple get
        const res = await fetch('/api/channels', {
          headers: { 'Authorization': `Bearer ${idToken}` }
        });
        // We can just rely on the API routes
      } catch (e) {}
    };
    fetchConfig();
  }, [idToken, channels]);

  const handleExportCSV = () => {
    const url = `/api/reports/export.csv`;
    const link = document.createElement('a');
    fetch(url, {
      headers: { 'Authorization': `Bearer ${idToken}` }
    })
    .then(res => res.blob())
    .then(blob => {
      const downloadUrl = window.URL.createObjectURL(blob);
      link.href = downloadUrl;
      link.setAttribute('download', `ft_social_detailed_report_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    })
    .catch(err => {
      alert('Không thể tải CSV: ' + err.message);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-150 pb-5">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Trung Tâm Báo Cáo</h2>
          <p className="text-sm text-slate-500">Tổng hợp báo cáo tương tác, xuất tài liệu và truy xuất liên kết Google Sheets.</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 bg-white border border-slate-100 rounded-2xl">
          <BarChart3 className="w-10 h-10 text-blue-500 animate-pulse mx-auto" />
          <p className="text-xs text-slate-500 mt-2">Đang tải báo cáo...</p>
        </div>
      ) : error ? (
        <div className="p-8 bg-red-50 border border-red-200 rounded-2xl text-center">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
          <p className="text-sm text-red-700 mt-2">{error}</p>
        </div>
      ) : !data ? (
        <div className="text-center py-12 bg-white border border-slate-100 rounded-2xl">
          <AlertCircle className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-xs text-slate-500 mt-2">Chưa có dữ liệu đồng bộ</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Quick downloads block */}
          <div className="md:col-span-1 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-800">Xuất tài liệu</h3>
            <p className="text-xs text-slate-500">Tải tệp báo cáo gốc dạng CSV hoặc truy cập trực tiếp Google Sheets lưu trữ.</p>

            <div className="space-y-2.5">
              <button
                onClick={handleExportCSV}
                className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 hover:border-blue-200 hover:bg-blue-50/20 text-slate-700 hover:text-blue-700 text-xs font-semibold transition-all text-left"
              >
                <span className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-slate-500" />
                  Báo cáo chi tiết (CSV)
                </span>
                <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">CSV</span>
              </button>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-150 text-xs space-y-2 text-slate-600">
              <span className="font-semibold text-slate-800 flex items-center gap-1">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Dữ liệu Google Sheets
              </span>
              <p className="leading-relaxed">Toàn bộ 5 bảng dữ liệu và Dashboard được cập nhật trực tiếp tại Google Sheets khi cấu hình.</p>
              <p className="text-[10px] text-slate-400">Xem tab DASHBOARD, KENH_MXH, BAI_DANG để tạo biểu đồ tùy biến.</p>
            </div>
          </div>

          {/* Performance breakdown table */}
          <div className="md:col-span-2 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-800">Hiệu quả hoạt động theo kênh</h3>
            <p className="text-xs text-slate-500">Tổng hợp tích lũy số lượng bài viết và tương tác của từng kênh.</p>

            <div className="overflow-x-auto border border-slate-100 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="p-4">Nền tảng</th>
                    <th className="p-4">Tên kênh</th>
                    <th className="p-4 text-center">Số bài viết</th>
                    <th className="p-4 text-center">Tổng tương tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {data.channelStats.map((stat, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-semibold text-[10px] ${
                          stat.platform === 'facebook' 
                            ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                            : 'bg-teal-50 text-teal-700 border border-teal-100'
                        }`}>
                          {stat.platform === 'facebook' ? 'Facebook' : 'Zalo OA'}
                        </span>
                      </td>
                      <td className="p-4 font-medium text-slate-800">{stat.channelName}</td>
                      <td className="p-4 text-center font-mono font-medium text-slate-600">{stat.postsCount}</td>
                      <td className="p-4 text-center font-mono font-semibold text-slate-800">{stat.engagement.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
