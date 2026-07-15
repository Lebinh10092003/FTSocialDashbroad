import React, { useState, useEffect } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts';
import { 
  Calendar, Layers, TrendingUp, Users, Award, RefreshCw, AlertCircle, 
  Image, Video, Link as LinkIcon, FileText, CheckCircle2, ChevronRight, Filter
} from 'lucide-react';
import { Channel, DashboardData } from '../types';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
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

  const typeLabels = [
    { type: 'Ảnh / Album', icon: Image },
    { type: 'Video / Reel', icon: Video },
    { type: 'Liên kết', icon: LinkIcon },
    { type: 'Khác', icon: FileText }
  ];

  return (
    <div className="space-y-7 pb-10">
      {/* Upper bar: Post type pills and quick date selectors */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-200/60 pb-5">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Thống kê tương tác</h2>
          <p className="text-xs text-slate-500 mt-0.5">Theo dõi và phân tích chỉ số hiệu quả đa kênh theo thời gian thực.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Post Type Pills */}
          <div className="flex p-1 bg-slate-100 rounded-2xl border border-slate-200/50">
            <button
              onClick={() => setPostTypeFilter('all')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                postTypeFilter === 'all' 
                  ? 'bg-white text-blue-650 shadow-[0_2px_8px_rgba(59,130,246,0.08)] border border-slate-200/40' 
                  : 'text-slate-550 hover:text-slate-900'
              }`}
            >
              Tất cả
            </button>
            <button
              onClick={() => setPostTypeFilter('photo')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                postTypeFilter === 'photo' 
                  ? 'bg-white text-blue-650 shadow-[0_2px_8px_rgba(59,130,246,0.08)] border border-slate-200/40' 
                  : 'text-slate-550 hover:text-slate-900'
              }`}
            >
              Ảnh
            </button>
            <button
              onClick={() => setPostTypeFilter('video')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                postTypeFilter === 'video' 
                  ? 'bg-white text-blue-650 shadow-[0_2px_8px_rgba(59,130,246,0.08)] border border-slate-200/40' 
                  : 'text-slate-550 hover:text-slate-900'
              }`}
            >
              Video / Reel
            </button>
            <button
              onClick={() => setPostTypeFilter('link')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                postTypeFilter === 'link' 
                  ? 'bg-white text-blue-650 shadow-[0_2px_8px_rgba(59,130,246,0.08)] border border-slate-200/40' 
                  : 'text-slate-550 hover:text-slate-900'
              }`}
            >
              Liên kết
            </button>
          </div>
          
          {/* Quick Preset + Calendar Inputs */}
          <div className="flex flex-wrap items-center gap-2 bg-white p-1.5 rounded-2xl border border-slate-200/80 shadow-[0_4px_12px_rgba(15,23,42,0.015)]">
            <div className="flex items-center gap-1 pl-1.5 text-slate-400">
              <Calendar className="w-3.5 h-3.5" />
            </div>
            <select
              value={datePreset}
              onChange={(e) => handleDatePresetChange(e.target.value)}
              className="text-[11px] border-0 focus:ring-0 focus:outline-none bg-transparent font-bold text-slate-700 cursor-pointer pr-5"
            >
              <option value="custom">Tùy chọn ngày</option>
              <option value="7days">7 ngày qua</option>
              <option value="30days">30 ngày qua</option>
              <option value="thisMonth">Tháng này</option>
              <option value="lastMonth">Tháng trước</option>
            </select>
            <div className="w-[1px] h-3.5 bg-slate-200"></div>
            <input 
              type="date" 
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setDatePreset('custom'); }}
              className="text-[11px] border-0 focus:ring-0 bg-transparent text-slate-650 focus:outline-none p-0 w-24"
            />
            <span className="text-[10px] text-slate-400 font-bold uppercase">Đến</span>
            <input 
              type="date" 
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setDatePreset('custom'); }}
              className="text-[11px] border-0 focus:ring-0 bg-transparent text-slate-650 focus:outline-none p-0 w-24"
            />
          </div>
        </div>
      </div>

      {/* Row 2: Secondary Platform/Channel filters */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200/60 p-3 rounded-2xl">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-bold text-slate-500">Lọc nhanh:</span>
        </div>
        
        <select
          value={platformFilter}
          onChange={(e) => handlePlatformChange(e.target.value)}
          className="bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
        >
          <option value="all">Tất cả nền tảng</option>
          <option value="facebook">Facebook Pages</option>
          <option value="zalo">Zalo OA</option>
        </select>

        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer max-w-xs truncate"
        >
          <option value="all">Tất cả các kênh</option>
          {filteredChannels.map(chan => (
            <option key={chan.id} value={chan.id}>{chan.name}</option>
          ))}
        </select>

        <div className="ml-auto">
          <button 
            onClick={fetchDashboardData}
            className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 font-extrabold text-xs px-3.5 py-1.5 rounded-xl border border-slate-200 shadow-sm active:scale-[0.98] transition-all cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Đồng bộ lại
          </button>
        </div>
      </div>

      {/* Synchronized status & Errors */}
      {data && (
        <div className="space-y-2">
          {data.lastSync && (
            <div className="text-xs text-slate-450 flex items-center gap-2 bg-emerald-50/50 border border-emerald-100/50 px-3.5 py-2 rounded-xl w-fit">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Dữ liệu khớp thực tế tính đến: <strong className="text-slate-700 font-bold">{new Date(data.lastSync).toLocaleString('vi-VN')}</strong></span>
            </div>
          )}
          {data.errors && data.errors.map((err, idx) => (
            <div key={idx} className="flex items-start gap-2.5 text-xs text-amber-800 bg-amber-50/80 border border-amber-200/50 p-3.5 rounded-2xl shadow-sm">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white border border-slate-200/60 rounded-3xl shadow-sm space-y-4">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-bold text-slate-555 animate-pulse">Đang truy xuất chỉ số tương tác...</p>
        </div>
      ) : error ? (
        <div className="p-10 bg-rose-50 border border-rose-200/50 rounded-3xl text-center space-y-4 shadow-sm max-w-lg mx-auto">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <h3 className="text-base font-extrabold text-rose-950">Lỗi nạp dữ liệu thống kê</h3>
          <p className="text-xs text-rose-700 leading-relaxed">{error}</p>
          <button onClick={fetchDashboardData} className="text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 px-5 py-2.5 rounded-xl cursor-pointer">Thử lại ngay</button>
        </div>
      ) : !data || data.kpis.postsCount === 0 ? (
        <div className="p-16 text-center bg-white border border-slate-200/60 rounded-3xl shadow-sm space-y-4 max-w-xl mx-auto">
          <Layers className="w-12 h-12 text-slate-350 mx-auto" />
          <div>
            <h3 className="text-sm font-extrabold text-slate-800">Không tìm thấy bài đăng nào</h3>
            <p className="text-xs text-slate-450 leading-relaxed max-w-sm mx-auto mt-1.5">Không có dữ liệu bài đăng được ghi nhận cho bộ lọc đã chọn trong khoảng thời gian này.</p>
          </div>
        </div>
      ) : (
        <>
          {/* KPI Interactive Grid Cards (Mockup Meta style) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Card 1: Engagement */}
            <div 
              onClick={() => setActiveMetric('engagement')}
              className={`p-5 rounded-2xl border transition-all cursor-pointer premium-card relative ${
                activeMetric === 'engagement'
                  ? 'border-blue-600 bg-gradient-to-br from-blue-50/20 to-indigo-50/20 ring-2 ring-blue-600'
                  : 'bg-white border-slate-200/60 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Lượt tương tác</span>
                <div className={`p-2 rounded-xl ${activeMetric === 'engagement' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600'}`}>
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2 mt-3">
                <h4 className="text-2xl font-extrabold text-slate-900 leading-none">{data.kpis.totalEngagement.toLocaleString('vi-VN')}</h4>
                <span className="text-[9px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-100/50 px-1.5 py-0.5 rounded-lg">↑ 12%</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-2 font-medium">Tổng tương tác tích lũy của trang</p>
            </div>

            {/* Card 2: Reach */}
            <div 
              onClick={() => setActiveMetric('reach')}
              className={`p-5 rounded-2xl border transition-all cursor-pointer premium-card relative ${
                activeMetric === 'reach'
                  ? 'border-indigo-600 bg-gradient-to-br from-indigo-50/20 to-purple-50/20 ring-2 ring-indigo-600'
                  : 'bg-white border-slate-200/60 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Lượt tiếp cận (Reach)</span>
                <div className={`p-2 rounded-xl ${activeMetric === 'reach' ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600'}`}>
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2 mt-3">
                <h4 className="text-2xl font-extrabold text-slate-900 leading-none">
                  {data.kpis.reach > 0 ? data.kpis.reach.toLocaleString('vi-VN') : 'Không hỗ trợ'}
                </h4>
                {data.kpis.reach > 0 && <span className="text-[9px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-100/50 px-1.5 py-0.5 rounded-lg">↑ 8%</span>}
              </div>
              <p className="text-[10px] text-slate-400 mt-2 font-medium">Số tài khoản tiếp cận thực tế</p>
            </div>

            {/* Card 3: Posts Count */}
            <div 
              onClick={() => setActiveMetric('postsCount')}
              className={`p-5 rounded-2xl border transition-all cursor-pointer premium-card relative ${
                activeMetric === 'postsCount'
                  ? 'border-teal-600 bg-gradient-to-br from-teal-50/20 to-emerald-50/20 ring-2 ring-teal-600'
                  : 'bg-white border-slate-200/60 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Số bài đăng</span>
                <div className={`p-2 rounded-xl ${activeMetric === 'postsCount' ? 'bg-teal-600 text-white' : 'bg-teal-50 text-teal-600'}`}>
                  <Layers className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2 mt-3">
                <h4 className="text-2xl font-extrabold text-slate-900 leading-none">{data.kpis.postsCount}</h4>
                <span className="text-[9px] font-extrabold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-lg">0%</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-2 font-medium">Tổng số bài phát sóng được ghi nhận</p>
            </div>

            {/* Card 4: Engagement Rate */}
            <div 
              onClick={() => setActiveMetric('engagementRate')}
              className={`p-5 rounded-2xl border transition-all cursor-pointer premium-card relative ${
                activeMetric === 'engagementRate'
                  ? 'border-purple-600 bg-gradient-to-br from-purple-50/20 to-pink-50/20 ring-2 ring-purple-600'
                  : 'bg-white border-slate-200/60 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Tỷ lệ tương tác</span>
                <div className={`p-2 rounded-xl ${activeMetric === 'engagementRate' ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-600'}`}>
                  <Award className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2 mt-3">
                <h4 className="text-2xl font-extrabold text-slate-900 leading-none">
                  {data.kpis.engagementRate !== null ? `${data.kpis.engagementRate}%` : 'Chưa đủ dữ liệu'}
                </h4>
                {data.kpis.engagementRate !== null && <span className="text-[9px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-100/50 px-1.5 py-0.5 rounded-lg">↑ 1.2%</span>}
              </div>
              <p className="text-[10px] text-slate-400 mt-2 font-medium">Tính trên Reach hoặc Impressions</p>
            </div>
          </div>

          {/* Premium Area Chart block */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.015)] space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-800">
                  Xu hướng {activeMetric === 'engagement' ? 'Tương tác' 
                            : activeMetric === 'reach' ? 'Tiếp cận'
                            : activeMetric === 'postsCount' ? 'Số bài đăng'
                            : 'Tỷ lệ tương tác'} theo ngày đăng
                </h3>
                <p className="text-[11px] text-slate-400">Biểu đồ thể hiện biến động chỉ số theo ngày xuất bản thực tế của các bài đăng.</p>
              </div>
              
              <div>
                {/* Channel dropdown filter */}
                {data.channelStats.length > 0 && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 flex items-center gap-2 cursor-pointer shadow-sm active:scale-[0.98] transition-all"
                    >
                      <span>Chọn kênh hiển thị ({selectedChannelsForTrend.size})</span>
                      <span className="text-[9px] text-slate-400">▼</span>
                    </button>

                    {isDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)}></div>
                        <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl z-25 p-3 space-y-2 premium-dropdown text-left">
                          <div className="flex justify-between border-b border-slate-100 pb-2 mb-1.5">
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
                              className="text-[10px] font-bold text-red-600 hover:underline cursor-pointer"
                            >
                              Xóa tất cả
                            </button>
                          </div>
                          <div className="max-h-48 overflow-y-auto space-y-1.5">
                            {data.channelStats.map((stat, idx) => {
                              const isSelected = selectedChannelsForTrend.has(stat.channelName);
                              return (
                                <label key={idx} className="flex items-center gap-2 text-xs font-semibold text-slate-750 hover:bg-slate-50 px-2 py-1.5 rounded-lg cursor-pointer transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleChannelTrend(stat.channelName)}
                                    className="rounded border-slate-350 text-blue-600 focus:ring-blue-500 cursor-pointer"
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
                  <AreaChart data={data.trends} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                    <defs>
                      <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.0}/>
                      </linearGradient>
                      {data.channelStats.map((stat, idx) => (
                        <linearGradient key={stat.channelName} id={`color-${idx}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLORS[idx % COLORS.length]} stopOpacity={0.12}/>
                          <stop offset="95%" stopColor={COLORS[idx % COLORS.length]} stopOpacity={0.0}/>
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" tickStyle={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <YAxis tickStyle={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#0f172a', 
                        border: 'none', 
                        borderRadius: '12px', 
                        color: '#fff', 
                        fontSize: '11px',
                        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'
                      }} 
                      itemStyle={{ color: '#e2e8f0', padding: '1px 0' }}
                      labelStyle={{ fontWeight: 'bold', color: '#94a3b8', marginBottom: '4px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, pt: 10 }} iconType="circle" />
                    
                    {/* Area for Total Reference */}
                    {showTotalLine && (
                      <Area 
                        type="monotone" 
                        dataKey={activeMetric} 
                        name="Tổng cộng" 
                        stroke="#94a3b8" 
                        strokeWidth={1.5} 
                        strokeDasharray="4 4" 
                        fill="url(#colorTotal)"
                      />
                    )}
                    
                    {/* Areas for selected channels */}
                    {data.channelStats
                      .filter(stat => selectedChannelsForTrend.has(stat.channelName))
                      .map((stat, idx) => (
                        <Area
                          key={stat.channelName}
                          type="monotone"
                          dataKey={`${stat.channelName}_${activeMetric}`}
                          name={stat.channelName}
                          stroke={COLORS[idx % COLORS.length]}
                          strokeWidth={2.5}
                          fill={`url(#color-${idx})`}
                          activeDot={{ r: 5, strokeWidth: 0 }}
                        />
                      ))}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Toggle switch for showing total line & breakdown cards */}
            <div className="flex flex-col space-y-4 pt-3 border-t border-slate-100">
              <div className="flex justify-end">
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-500">
                  <input 
                    type="checkbox" 
                    checked={showTotalLine}
                    onChange={(e) => setShowTotalLine(e.target.checked)}
                    className="sr-only peer"
                  />
                  <span className="relative w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></span>
                  <span>Hiển thị đường Tổng cộng</span>
                </label>
              </div>

              {/* KPI Breakdown Cards (Mockup Meta style) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200/50 text-left space-y-1">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">👍 Cảm xúc (Reactions)</span>
                  <p className="text-xl font-extrabold text-slate-800">{data.kpis.reactions.toLocaleString('vi-VN')}</p>
                  <p className="text-[9px] text-slate-400">Tổng số lượt thích và cảm xúc</p>
                </div>
                <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200/50 text-left space-y-1">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">💬 Bình luận (Comments)</span>
                  <p className="text-xl font-extrabold text-slate-800">{data.kpis.comments.toLocaleString('vi-VN')}</p>
                  <p className="text-[9px] text-slate-400">Tổng số phản hồi trên bài viết</p>
                </div>
                <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200/50 text-left space-y-1">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">🔗 Lượt chia sẻ (Shares)</span>
                  <p className="text-xl font-extrabold text-slate-800">{data.kpis.shares.toLocaleString('vi-VN')}</p>
                  <p className="text-[9px] text-slate-400">Tổng số lượt chia sẻ bài viết</p>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Progress Bars Content Type (Left) & Interaction Donut (Middle) & Platform Donut (Right) */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Card 1: Content Type */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200/60 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.015)] space-y-5">
              <div>
                <h3 className="text-sm font-extrabold text-slate-800">Theo loại nội dung</h3>
                <p className="text-[11px] text-slate-400">Tỷ lệ tương tác của từng định dạng đăng tải.</p>
              </div>
              
              <div className="space-y-4 pt-1">
                {typeLabels.map(({ type, icon: Icon }) => {
                  const item = data.typeStats?.find(t => t.type === type) || { type, count: 0, engagement: 0 };
                  const totalEng = data.kpis.totalEngagement || 1;
                  const percent = Math.min(100, Math.round((item.engagement / totalEng) * 1000) / 10);
                  return (
                    <div key={type} className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 font-bold text-slate-700">
                          <div className="p-1.5 bg-slate-100 rounded-lg text-slate-505">
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <span>{type}</span>
                        </div>
                        <span className="font-extrabold text-slate-900">{percent}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div 
                          className="bg-gradient-to-r from-blue-500 to-indigo-500 h-1.5 rounded-full transition-all duration-500" 
                          style={{ width: `${percent}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Card 2: Theo loại tương tác (Donut Chart) */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200/60 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.015)] flex flex-col justify-between space-y-4">
              <div>
                <h3 className="text-sm font-extrabold text-slate-800">Theo loại tương tác</h3>
                <p className="text-[11px] text-slate-400">Tỷ lệ tương tác chia theo cảm xúc, bình luận, chia sẻ.</p>
              </div>
              
              <div className="flex items-center justify-center h-36 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Cảm xúc', value: data.kpis.reactions },
                        { name: 'Bình luận', value: data.kpis.comments },
                        { name: 'Chia sẻ', value: data.kpis.shares }
                      ].filter(item => item.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={62}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      <Cell key="cell-0" fill="#3b82f6" />
                      <Cell key="cell-1" fill="#10b981" />
                      <Cell key="cell-2" fill="#8b5cf6" />
                    </Pie>
                    <Tooltip 
                      formatter={(value: any) => [`${value.toLocaleString()} lượt`, 'Số lượng']}
                      contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '10px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                
                <div className="absolute flex flex-col items-center justify-center">
                  <span className="text-base font-extrabold text-slate-900 leading-none">
                    {(data.kpis.reactions + data.kpis.comments + data.kpis.shares).toLocaleString('vi-VN')}
                  </span>
                  <span className="text-[8px] font-extrabold text-slate-400 uppercase tracking-widest mt-1">Tổng cộng</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 text-[11px] font-bold text-slate-655 px-2">
                {(() => {
                  const total = (data.kpis.reactions + data.kpis.comments + data.kpis.shares) || 1;
                  const pctReact = Math.round((data.kpis.reactions / total) * 1000) / 10;
                  const pctComm = Math.round((data.kpis.comments / total) * 1000) / 10;
                  const pctShare = Math.round((data.kpis.shares / total) * 1000) / 10;
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                          <span>Cảm xúc</span>
                        </div>
                        <span className="text-slate-900">{pctReact}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          <span>Bình luận</span>
                        </div>
                        <span className="text-slate-900">{pctComm}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                          <span>Lượt chia sẻ</span>
                        </div>
                        <span className="text-slate-900">{pctShare}%</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Card 3: Phân bổ tương tác theo nền tảng */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200/60 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.015)] flex flex-col justify-between space-y-4">
              <div>
                <h3 className="text-sm font-extrabold text-slate-800">Theo nền tảng</h3>
                <p className="text-[11px] text-slate-400">Tỷ lệ tương tác chia theo Facebook và Zalo OA.</p>
              </div>
              
              <div className="flex items-center justify-center h-36 relative">
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
                          innerRadius={48}
                          outerRadius={62}
                          paddingAngle={3}
                          dataKey="engagement"
                        >
                          {data.platformStats.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: any) => [`${value.toLocaleString()} tương tác`, 'Tương tác']}
                          contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '10px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    
                    <div className="absolute flex flex-col items-center justify-center">
                      <span className="text-base font-extrabold text-slate-900 leading-none">
                        {data.kpis.totalEngagement.toLocaleString('vi-VN')}
                      </span>
                      <span className="text-[8px] font-extrabold text-slate-400 uppercase tracking-widest mt-1">Tương tác</span>
                    </div>
                  </>
                )}
              </div>

              {/* Legends with customized percentages */}
              <div className="flex justify-center gap-6 text-xs pt-1">
                {data.platformStats?.map((entry, index) => {
                  const total = data.kpis.totalEngagement || 1;
                  const pct = Math.round((entry.engagement / total) * 100);
                  return (
                    <div key={entry.platform} className="flex items-center gap-1.5 font-bold text-slate-700">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}></span>
                      <span>{entry.platform}: {pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Row 4: Horizontal Carousel of Recent Posts */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.015)] space-y-5">
            <div>
              <h3 className="text-sm font-extrabold text-slate-800">Bài viết mới đây</h3>
              <p className="text-[11px] text-slate-400">Danh sách bài đăng mới đồng bộ sắp xếp theo thời gian đăng thực tế.</p>
            </div>
            
            <div className="flex overflow-x-auto gap-4.5 pb-4 scrollbar-thin scrollbar-thumb-slate-200">
              {data.topPosts.map((post) => {
                const chan = channels.find(c => c.id === post.channelId);
                return (
                  <a
                    key={post.postKey}
                    href={post.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 w-64 border border-slate-200/70 hover:border-blue-500 rounded-2xl p-4 transition-all space-y-3 bg-slate-50/30 hover:bg-white hover:shadow-lg hover:shadow-blue-500/5 relative group"
                  >
                    {/* Cover photo placeholder (vibrant modern gradient with overlay logo) */}
                    <div className="w-full h-32 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-650 to-violet-650 flex items-center justify-center text-white relative overflow-hidden">
                      <span className="text-[8px] font-extrabold tracking-widest uppercase opacity-20 absolute -right-3 -bottom-3 rotate-12 scale-150 select-none">FT Social</span>
                      <CheckCircle2 className="w-10 h-10 opacity-70 group-hover:scale-110 transition-transform duration-300" />
                      <span className="absolute top-2.5 right-2.5 inline-flex items-center px-2 py-0.5 rounded-lg text-[8px] font-extrabold bg-white/20 backdrop-blur-md uppercase tracking-wider">
                        {post.platform === 'facebook' ? 'FB' : 'Zalo'}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                        {new Date(post.publishedAt).toLocaleString('vi-VN', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <p className="text-xs font-bold text-slate-800 truncate" title={chan?.name}>{chan?.name || 'Kênh ẩn'}</p>
                      <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed h-8">
                        {post.message || <em className="text-slate-400">Không có nội dung văn bản</em>}
                      </p>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-[10px]">
                      <span className="text-slate-450 font-bold uppercase tracking-widest">{post.postType || 'Photo'}</span>
                      <span className="font-extrabold text-blue-650 bg-blue-50/80 border border-blue-100/50 px-2.5 py-0.5 rounded-full">
                        {post.engagement.toLocaleString()} tương tác
                      </span>
                    </div>
                    
                    <span className="absolute bottom-4 right-4 text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
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
