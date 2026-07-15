import React, { useState, useEffect } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts';
import { 
  Calendar, Layers, TrendingUp, Users, Award, RefreshCw, AlertCircle, ExternalLink, 
  Image, Video, Link as LinkIcon, FileText, CheckCircle2, ChevronRight
} from 'lucide-react';
import { Channel, DashboardData } from '../types';

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const PIE_COLORS = ['#3b82f6', '#14b8a6'];

interface DashboardProps {
  idToken: string;
  googleAccessToken: string | null;
  channels: Channel[];
}

export default function Dashboard({ idToken, googleAccessToken, channels }: DashboardProps) {
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [postTypeFilter, setPostTypeFilter] = useState<string>('all');
  
  // Default date range: Last 30 days
  const getPastDateStr = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  };
  const getTodayStr = () => new Date().toISOString().split('T')[0];

  const [startDate, setStartDate] = useState<string>(getPastDateStr(30));
  const [endDate, setEndDate] = useState<string>(getTodayStr());
  const [datePreset, setDatePreset] = useState<string>('30days');

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // Interactive channel filter states for daily trend chart
  const [selectedChannelsForTrend, setSelectedChannelsForTrend] = useState<Set<string>>(new Set());
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  
  // Active metric tab (KPI Card selector)
  const [activeMetric, setActiveMetric] = useState<'engagement' | 'postsCount' | 'reach' | 'engagementRate'>('engagement');
  
  // Toggle switch to show/hide total reference line
  const [showTotalLine, setShowTotalLine] = useState<boolean>(true);

  useEffect(() => {
    if (data && data.channelStats) {
      setSelectedChannelsForTrend(new Set(data.channelStats.map(s => s.channelName)));
    }
  }, [data]);

  const toggleChannelTrend = (name: string) => {
    const next = new Set(selectedChannelsForTrend);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    setSelectedChannelsForTrend(next);
  };

  const handleDatePresetChange = (preset: string) => {
    setDatePreset(preset);
    const today = new Date();
    if (preset === '7days') {
      const start = new Date();
      start.setDate(today.getDate() - 7);
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    } else if (preset === '30days') {
      const start = new Date();
      start.setDate(today.getDate() - 30);
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    } else if (preset === 'thisMonth') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    } else if (preset === 'lastMonth') {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(end.toISOString().split('T')[0]);
    }
  };

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/dashboard?startDate=${startDate}&endDate=${endDate}`;
      if (platformFilter !== 'all') url += `&platform=${platformFilter}`;
      if (channelFilter !== 'all') url += `&channelId=${channelFilter}`;
      if (postTypeFilter !== 'all') url += `&postType=${postTypeFilter}`;

      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'X-Google-OAuth-Token': googleAccessToken || '',
        }
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Lỗi tải thống kê (${res.status}): ${res.statusText}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Lỗi mạng hoặc hệ thống.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (idToken) {
      fetchDashboardData();
    }
  }, [idToken, googleAccessToken, platformFilter, channelFilter, postTypeFilter, startDate, endDate, channels]);

  const handlePlatformChange = (p: string) => {
    setPlatformFilter(p);
    setChannelFilter('all'); // Reset channel filter when platform changes
  };

  const filteredChannels = platformFilter === 'all' 
    ? channels.filter(c => c.status === 'active') 
    : channels.filter(c => c.platform === platformFilter && c.status === 'active');

  // Helper values for content type horizontal progress bars
  const typeLabels = [
    { type: 'Ảnh / Album', icon: Image },
    { type: 'Video / Reel', icon: Video },
    { type: 'Liên kết', icon: LinkIcon },
    { type: 'Khác', icon: FileText }
  ];

  const getMetricDisplayValue = (metric: string, item: any) => {
    if (metric === 'engagement') return item.engagement;
    if (metric === 'reach') return item.reach || 0;
    if (metric === 'likes') return item.likes || 0;
    if (metric === 'comments') return item.comments || 0;
    return 0;
  };

  return (
    <div className="space-y-6">
      {/* Filters Pill Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-150 pb-5">
        {/* Post Type Pills Filter */}
        <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200/60">
          <button
            onClick={() => setPostTypeFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              postTypeFilter === 'all' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            Tất cả bài đăng
          </button>
          <button
            onClick={() => setPostTypeFilter('photo')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              postTypeFilter === 'photo' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            Ảnh / Album
          </button>
          <button
            onClick={() => setPostTypeFilter('video')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              postTypeFilter === 'video' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            Thước phim / Video
          </button>
          <button
            onClick={() => setPostTypeFilter('link')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              postTypeFilter === 'link' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            }`}
          >
            Liên kết
          </button>
        </div>
        
        {/* Date Filter & Preset Dropdown */}
        <div className="flex flex-wrap items-center gap-2.5 bg-white p-2 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-bold text-slate-500">Ngày lọc:</span>
          </div>
          <select
            value={datePreset}
            onChange={(e) => handleDatePresetChange(e.target.value)}
            className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white font-bold text-slate-700 cursor-pointer"
          >
            <option value="custom">Tùy chọn ngày</option>
            <option value="7days">7 ngày qua</option>
            <option value="30days">30 ngày qua</option>
            <option value="thisMonth">Tháng này</option>
            <option value="lastMonth">Tháng trước</option>
          </select>
          <input 
            type="date" 
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setDatePreset('custom'); }}
            className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-xs text-slate-400">đến</span>
          <input 
            type="date" 
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setDatePreset('custom'); }}
            className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Primary Channel/Platform Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Nền tảng</label>
          <select
            value={platformFilter}
            onChange={(e) => handlePlatformChange(e.target.value)}
            className="bg-white border border-slate-200 text-xs font-semibold text-slate-700 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
          >
            <option value="all">Tất cả nền tảng</option>
            <option value="facebook">Facebook Pages</option>
            <option value="zalo">Zalo OA</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Kênh phát sóng</label>
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="bg-white border border-slate-200 text-xs font-semibold text-slate-700 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
          >
            <option value="all">Tất cả các kênh</option>
            {filteredChannels.map(chan => (
              <option key={chan.id} value={chan.id}>{chan.name}</option>
            ))}
          </select>
        </div>

        <div className="ml-auto">
          <button 
            onClick={fetchDashboardData}
            className="flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs px-3.5 py-1.5 rounded-lg border border-blue-200 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Làm mới
          </button>
        </div>
      </div>

      {/* Sync timestamp and warnings */}
      {data && (
        <div className="space-y-2">
          {data.lastSync && (
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              Đồng bộ lần cuối vào lúc: <strong className="text-slate-600 font-semibold">{new Date(data.lastSync).toLocaleString('vi-VN')}</strong>
            </div>
          )}
          {data.errors && data.errors.map((err, idx) => (
            <div key={idx} className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200/55 p-3 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-500" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white border border-slate-100 rounded-2xl shadow-sm space-y-3">
          <RefreshCw className="w-10 h-10 text-blue-500 animate-spin" />
          <p className="text-sm font-medium text-slate-500">Đang phân tích số liệu tương tác...</p>
        </div>
      ) : error ? (
        <div className="p-8 bg-red-50 border border-red-200/60 rounded-2xl text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
          <h3 className="text-base font-bold text-red-900">Không thể tải dữ liệu dashboard</h3>
          <p className="text-xs text-red-600 max-w-md mx-auto">{error}</p>
          <button onClick={fetchDashboardData} className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg">Thử lại</button>
        </div>
      ) : !data || data.kpis.postsCount === 0 ? (
        <div className="p-12 text-center bg-white border border-slate-150 rounded-2xl shadow-sm space-y-4">
          <Layers className="w-12 h-12 text-slate-300 mx-auto" />
          <div>
            <h3 className="text-base font-bold text-slate-800">Chưa có dữ liệu đồng bộ</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">Hệ thống chưa tìm thấy dữ liệu đồng bộ nào từ Facebook hoặc Zalo OA cho bộ lọc đã chọn.</p>
          </div>
        </div>
      ) : (
        <>
          {/* KPI Cards Row (Interactive) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Engagement */}
            <div 
              onClick={() => setActiveMetric('engagement')}
              className={`p-5 rounded-2xl border transition-all shadow-sm space-y-2 cursor-pointer ${
                activeMetric === 'engagement'
                  ? 'border-blue-600 bg-blue-50/20 ring-2 ring-blue-600'
                  : 'bg-white border-slate-100 hover:border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Lượt tương tác</span>
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <h4 className="text-2xl font-bold text-slate-900">{data.kpis.totalEngagement.toLocaleString('vi-VN')}</h4>
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1 rounded">↑ 12%</span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">Tổng tương tác tích lũy của trang</p>
            </div>

            {/* Card 2: Reach */}
            <div 
              onClick={() => setActiveMetric('reach')}
              className={`p-5 rounded-2xl border transition-all shadow-sm space-y-2 cursor-pointer ${
                activeMetric === 'reach'
                  ? 'border-blue-600 bg-blue-50/20 ring-2 ring-blue-600'
                  : 'bg-white border-slate-100 hover:border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Lượt tiếp cận (Reach)</span>
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <h4 className="text-2xl font-bold text-slate-900">
                  {data.kpis.reach > 0 ? data.kpis.reach.toLocaleString('vi-VN') : 'Không hỗ trợ'}
                </h4>
                {data.kpis.reach > 0 && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1 rounded">↑ 8%</span>}
              </div>
              <p className="text-[10px] text-slate-400 font-medium font-medium">Số tài khoản tiếp cận thực tế</p>
            </div>

            {/* Card 3: Posts Count */}
            <div 
              onClick={() => setActiveMetric('postsCount')}
              className={`p-5 rounded-2xl border transition-all shadow-sm space-y-2 cursor-pointer ${
                activeMetric === 'postsCount'
                  ? 'border-blue-600 bg-blue-50/20 ring-2 ring-blue-600'
                  : 'bg-white border-slate-100 hover:border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Số bài đăng</span>
                <div className="p-2 bg-teal-50 text-teal-600 rounded-lg">
                  <Layers className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <h4 className="text-2xl font-bold text-slate-900">{data.kpis.postsCount}</h4>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1 rounded">0%</span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">Tổng số bài viết phát sóng</p>
            </div>

            {/* Card 4: Engagement Rate */}
            <div 
              onClick={() => setActiveMetric('engagementRate')}
              className={`p-5 rounded-2xl border transition-all shadow-sm space-y-2 cursor-pointer ${
                activeMetric === 'engagementRate'
                  ? 'border-blue-600 bg-blue-50/20 ring-2 ring-blue-600'
                  : 'bg-white border-slate-100 hover:border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tỷ lệ tương tác</span>
                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                  <Award className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <h4 className="text-2xl font-bold text-slate-900">
                  {data.kpis.engagementRate !== null ? `${data.kpis.engagementRate}%` : 'Chưa đủ dữ liệu'}
                </h4>
                {data.kpis.engagementRate !== null && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1 rounded">↑ 1.2%</span>}
              </div>
              <p className="text-[10px] text-slate-400 font-medium font-medium">Tính trên Reach hoặc Impressions</p>
            </div>
          </div>

          {/* Main Trends Chart Card - Full Width */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  Xu hướng {activeMetric === 'engagement' ? 'Tương tác' 
                            : activeMetric === 'reach' ? 'Tiếp cận'
                            : activeMetric === 'postsCount' ? 'Số bài viết'
                            : 'Tỷ lệ tương tác'} theo ngày đăng
                </h3>
                <p className="text-xs text-slate-400">Biểu đồ thể hiện biến động chỉ số theo ngày xuất bản thực tế của các bài đăng.</p>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                {/* Chọn kênh hiển thị: select choice dropdown */}
                {data.channelStats.length > 0 && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 flex items-center gap-2 cursor-pointer shadow-sm"
                    >
                      <span>Lọc kênh ({selectedChannelsForTrend.size})</span>
                      <span className="text-[9px] text-slate-400">▼</span>
                    </button>

                    {isDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)}></div>
                        <div className="absolute right-0 mt-2 w-60 bg-white border border-slate-200 rounded-xl shadow-xl z-25 p-3 space-y-2 text-left">
                          <div className="flex justify-between border-b border-slate-100 pb-1.5 mb-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedChannelsForTrend(new Set(data.channelStats.map(s => s.channelName)))}
                              className="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer"
                            >
                              Chọn tất cả
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedChannelsForTrend(new Set())}
                              className="text-[10px] font-bold text-red-650 hover:underline cursor-pointer"
                            >
                              Xóa tất cả
                            </button>
                          </div>
                          <div className="max-h-48 overflow-y-auto space-y-1.5">
                            {data.channelStats.map((stat, idx) => {
                              const isSelected = selectedChannelsForTrend.has(stat.channelName);
                              return (
                                <label key={idx} className="flex items-center gap-2 text-xs font-medium text-slate-700 hover:bg-slate-50 px-1.5 py-1 rounded cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleChannelTrend(stat.channelName)}
                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                  />
                                  <span className="truncate">{stat.channelName}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="h-96">
              {data.trends.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-slate-400">
                  Không có xu hướng biến động cho khoảng thời gian này.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trends} margin={{ top: 10, right: 20, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tickStyle={{ fontSize: 10 }} />
                    <YAxis tickStyle={{ fontSize: 10 }} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#1e293b', 
                        border: 'none', 
                        borderRadius: '8px', 
                        color: '#fff', 
                        fontSize: '11px',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
                      }} 
                      itemStyle={{ color: '#e2e8f0', padding: '1px 0' }}
                      labelStyle={{ fontWeight: 'bold', color: '#94a3b8', marginBottom: '4px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    
                    {/* Reference total line (toggleable) */}
                    {showTotalLine && (
                      <Line 
                        type="monotone" 
                        dataKey={activeMetric} 
                        name="Tổng cộng" 
                        stroke="#94a3b8" 
                        strokeWidth={1.5} 
                        strokeDasharray="4 4" 
                      />
                    )}
                    
                    {/* Channel lines */}
                    {data.channelStats
                      .filter(stat => selectedChannelsForTrend.has(stat.channelName))
                      .map((stat, idx) => (
                        <Line
                          key={stat.channelName}
                          type="monotone"
                          dataKey={`${stat.channelName}_${activeMetric}`}
                          name={stat.channelName}
                          stroke={COLORS[idx % COLORS.length]}
                          strokeWidth={2.5}
                          activeDot={{ r: 6 }}
                        />
                      ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            
            {/* Toggle switch for showing total line, just like the mockup's publish toggle */}
            <div className="flex justify-end pt-2">
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-500">
                <input 
                  type="checkbox" 
                  checked={showTotalLine}
                  onChange={(e) => setShowTotalLine(e.target.checked)}
                  className="sr-only peer"
                />
                <span className="relative w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></span>
                <span>Hiển thị đường Tổng cộng</span>
              </label>
            </div>
          </div>

          {/* Row 2: Content Type Progress Bars (Left) & Platform Distribution Donut (Right) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Content Type Breakdown */}
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Tương tác theo loại nội dung</h3>
                <p className="text-[11px] text-slate-400">Phần trăm tương tác tích lũy của từng định dạng bài đăng.</p>
              </div>
              <div className="space-y-4 pt-2">
                {typeLabels.map(({ type, icon: Icon }) => {
                  const item = data.typeStats?.find(t => t.type === type) || { type, count: 0, engagement: 0 };
                  const totalEng = data.kpis.totalEngagement || 1;
                  const percent = Math.min(100, Math.round((item.engagement / totalEng) * 1000) / 10);
                  return (
                    <div key={type} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 font-semibold text-slate-700">
                          <Icon className="w-3.5 h-3.5 text-slate-400" />
                          <span>{type}</span>
                        </div>
                        <span className="font-bold text-slate-900">{percent}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-500" 
                          style={{ width: `${percent}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Platform Distribution Donut Chart */}
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Phân bổ tương tác theo nền tảng</h3>
                <p className="text-[11px] text-slate-400">Tỷ lệ tương tác chia theo Facebook và Zalo OA.</p>
              </div>
              
              <div className="flex items-center justify-center h-44 relative">
                {!data.platformStats || data.platformStats.length === 0 ? (
                  <span className="text-xs text-slate-400">Không có dữ liệu</span>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.platformStats}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={75}
                          paddingAngle={3}
                          dataKey="engagement"
                        >
                          {data.platformStats.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: any) => [`${value.toLocaleString()} tương tác`, 'Tương tác']}
                          contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '10px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    
                    {/* Centered overall label, matching mockup */}
                    <div className="absolute flex flex-col items-center justify-center">
                      <span className="text-lg font-bold text-slate-800">
                        {data.kpis.totalEngagement.toLocaleString('vi-VN')}
                      </span>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Tương tác</span>
                    </div>
                  </>
                )}
              </div>

              {/* Legends with customized percentages */}
              <div className="flex justify-center gap-6 text-xs pt-2">
                {data.platformStats?.map((entry, index) => {
                  const total = data.kpis.totalEngagement || 1;
                  const pct = Math.round((entry.engagement / total) * 100);
                  return (
                    <div key={entry.platform} className="flex items-center gap-1.5 font-semibold text-slate-700">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}></span>
                      <span>{entry.platform}: {pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Row 3: Horizontal Carousel of Recent Posts (Mockup-style) */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Bài viết mới đây</h3>
                <p className="text-[11px] text-slate-400">Danh sách bài đăng mới đồng bộ sắp xếp theo thời gian đăng thực tế.</p>
              </div>
            </div>
            
            <div className="flex overflow-x-auto gap-4 pb-4 scrollbar-thin scrollbar-thumb-slate-200">
              {data.topPosts.map((post) => {
                const chan = channels.find(c => c.id === post.channelId);
                return (
                  <a
                    key={post.postKey}
                    href={post.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 w-60 border border-slate-150 rounded-xl p-3.5 hover:border-blue-500 hover:shadow-md transition-all space-y-3 bg-slate-50/40 relative group"
                  >
                    {/* Thumbnail Cover Placeholder (Premium styled gradient matching mockup) */}
                    <div className="w-full h-32 rounded-lg bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white relative overflow-hidden">
                      <span className="text-[10px] font-bold tracking-widest uppercase opacity-20 absolute -right-2 -bottom-2 rotate-12 scale-150 select-none">FT Social</span>
                      <CheckCircle2 className="w-12 h-12 opacity-80" />
                      <span className="absolute top-2 right-2 inline-flex items-center px-1.5 py-0.5 rounded-md text-[8px] font-bold bg-white/20 backdrop-blur-sm uppercase">
                        {post.platform === 'facebook' ? 'FB' : 'Zalo'}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-400 font-bold">
                        {new Date(post.publishedAt).toLocaleString('vi-VN', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <p className="text-xs font-bold text-slate-800 truncate" title={chan?.name}>{chan?.name || 'Kênh ẩn'}</p>
                      <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed h-8">
                        {post.message || <em className="text-slate-400">Không có văn bản</em>}
                      </p>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-200/60 pt-2 text-[10px]">
                      <span className="text-slate-400 font-bold uppercase tracking-wider">{post.postType || 'Photo'}</span>
                      <span className="font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full font-mono">
                        {post.engagement.toLocaleString()} tương tác
                      </span>
                    </div>
                    
                    <span className="absolute bottom-3 right-3 text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ChevronRight className="w-4 h-4" />
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
