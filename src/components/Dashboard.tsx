import React, { useState, useEffect } from 'react';
import { 
  ComposedChart, LineChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { 
  Calendar, Radio, Layers, MessageSquare, Heart, Share2, Eye, EyeOff, Users, Award, RefreshCw, AlertCircle, TrendingUp
} from 'lucide-react';
import { Channel, DashboardData, Platform } from '../types';

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

interface DashboardProps {
  idToken: string;
  googleAccessToken: string | null;
  channels: Channel[];
}

export default function Dashboard({ idToken, googleAccessToken, channels }: DashboardProps) {
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  
  // Default date range: Last 30 days
  const getPastDateStr = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  };
  const getTodayStr = () => new Date().toISOString().split('T')[0];

  const [startDate, setStartDate] = useState<string>(getPastDateStr(30));
  const [endDate, setEndDate] = useState<string>(getTodayStr());

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // Interactive channel filter states for daily trend chart
  const [selectedChannelsForTrend, setSelectedChannelsForTrend] = useState<Set<string>>(new Set());
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [selectedMetric, setSelectedMetric] = useState<string>('engagement');
  const [datePreset, setDatePreset] = useState<string>('30days');

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
  }, [idToken, googleAccessToken, platformFilter, channelFilter, startDate, endDate, channels]);

  const handlePlatformChange = (p: string) => {
    setPlatformFilter(p);
    setChannelFilter('all'); // Reset channel filter when platform changes
  };

  const filteredChannels = platformFilter === 'all' 
    ? channels.filter(c => c.status === 'active') 
    : channels.filter(c => c.platform === platformFilter && c.status === 'active');

  return (
    <div className="space-y-6">
      {/* Page header & summary */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-150 pb-5">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Bảng Điều Khiển Tổng Quan</h2>
          <p className="text-sm text-slate-500">Phân tích hiệu quả tương tác mạng xã hội Facebook & Zalo OA thực tế.</p>
        </div>
        
        {/* Date Filters */}
        <div className="flex flex-wrap items-center gap-3 bg-white p-2.5 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-500">Khoảng thời gian:</span>
          </div>
          <select
            value={datePreset}
            onChange={(e) => handleDatePresetChange(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white font-medium text-slate-700 cursor-pointer"
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
            className="text-xs border border-gray-200 rounded px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-xs text-slate-400">đến</span>
          <input 
            type="date" 
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setDatePreset('custom'); }}
            className="text-xs border border-gray-200 rounded px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Primary filters */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
        <div>
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Nền tảng</label>
          <select
            value={platformFilter}
            onChange={(e) => handlePlatformChange(e.target.value)}
            className="bg-white border border-slate-200 text-xs font-medium text-slate-700 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">Tất cả nền tảng</option>
            <option value="facebook">Facebook Pages</option>
            <option value="zalo">Zalo OA</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Kênh mạng xã hội</label>
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="bg-white border border-slate-200 text-xs font-medium text-slate-700 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">Tất cả các kênh</option>
            {filteredChannels.map(chan => (
              <option key={chan.id} value={chan.id}>{chan.name} ({chan.platform.toUpperCase()})</option>
            ))}
          </select>
        </div>

        <div className="ml-auto">
          <button 
            onClick={fetchDashboardData}
            className="flex items-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-xs px-3.5 py-1.5 rounded-lg border border-blue-200 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Làm mới
          </button>
        </div>
      </div>

      {/* Sync timestamp and platform warnings */}
      {data && (
        <div className="space-y-2">
          {data.lastSync && (
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Đồng bộ dữ liệu lần cuối vào lúc: <strong className="text-slate-600 font-semibold">{new Date(data.lastSync).toLocaleString('vi-VN')}</strong>
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
            <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">Hệ thống chưa tìm thấy dữ liệu đồng bộ thật nào từ Facebook hoặc Zalo OA cho khoảng thời gian này.</p>
          </div>
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 px-3 py-1.5 rounded-lg inline-block">Vui lòng kiểm tra API Tokens trong mục <strong>Cấu hình</strong> và thực hiện đồng bộ trong mục <strong>Đồng bộ dữ liệu</strong>.</p>
        </div>
      ) : (
        <>
          {/* KPI Bento Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Số bài đăng</span>
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <Layers className="w-4 h-4" />
                </div>
              </div>
              <h4 className="text-2xl font-bold text-slate-900">{data.kpis.postsCount}</h4>
              <p className="text-[11px] text-slate-400">Tổng số bài phát sóng được tìm thấy</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tổng tương tác</span>
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <h4 className="text-2xl font-bold text-slate-900">{data.kpis.totalEngagement.toLocaleString('vi-VN')}</h4>
              <p className="text-[11px] text-slate-400">Likes + Comments + Shares + Clicks</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Lượt tiếp cận (Reach)</span>
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <Users className="w-4 h-4" />
                </div>
              </div>
              <h4 className="text-2xl font-bold text-slate-900">
                {data.kpis.reach > 0 ? data.kpis.reach.toLocaleString('vi-VN') : 'Không hỗ trợ'}
              </h4>
              <p className="text-[11px] text-slate-400">Số tài khoản thực tế tiếp cận</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tỷ lệ tương tác</span>
                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                  <Award className="w-4 h-4" />
                </div>
              </div>
              <h4 className="text-2xl font-bold text-slate-900">
                {data.kpis.engagementRate !== null ? `${data.kpis.engagementRate}%` : 'Chưa đủ dữ liệu'}
              </h4>
              <p className="text-[11px] text-slate-400">Tính trên Reach hoặc Impressions</p>
            </div>
          </div>

          {/* Engagement breakdown list */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-center">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Reactions / Thích</p>
              <p className="text-lg font-bold text-slate-800 mt-0.5">{data.kpis.reactions.toLocaleString('vi-VN')}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Bình luận</p>
              <p className="text-lg font-bold text-slate-800 mt-0.5">{data.kpis.comments.toLocaleString('vi-VN')}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Chia sẻ</p>
              <p className="text-lg font-bold text-slate-800 mt-0.5">{data.kpis.shares.toLocaleString('vi-VN')}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Lượt xem video</p>
              <p className="text-lg font-bold text-slate-800 mt-0.5">{data.kpis.views.toLocaleString('vi-VN')}</p>
            </div>
          </div>

          {/* Charts section - Full Width Trend Chart with Integrated Filters */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-800">Xu hướng tương tác theo ngày đăng</h3>
                <p className="text-xs text-slate-400">Biểu đồ thể hiện biến động chỉ số tương tác theo ngày xuất bản thực tế của các bài đăng.</p>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                {/* Chọn chỉ số hiển thị */}
                <select
                  value={selectedMetric}
                  onChange={(e) => setSelectedMetric(e.target.value)}
                  className="bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="engagement">Tổng tương tác</option>
                  <option value="likes">Reactions (Like/Tim)</option>
                  <option value="comments">Bình luận</option>
                  <option value="shares">Chia sẻ</option>
                  <option value="views">Lượt xem video</option>
                  <option value="reach">Lượt tiếp cận (Reach)</option>
                </select>

                {/* Chọn kênh hiển thị: select choice dropdown */}
                {data.channelStats.length > 0 && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                    >
                      <span>Lọc kênh ({selectedChannelsForTrend.size})</span>
                      <span className="text-[9px] text-slate-400">▼</span>
                    </button>

                    {isDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)}></div>
                        <div className="absolute right-0 mt-2 w-60 bg-white border border-slate-200 rounded-xl shadow-xl z-20 p-2.5 space-y-2">
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
                              className="text-[10px] font-bold text-red-600 hover:underline cursor-pointer"
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
                    
                    {/* Đường tham chiếu tổng cộng */}
                    <Line type="monotone" dataKey={selectedMetric} name="Tổng cộng" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" />
                    
                    {/* Đường xu hướng riêng cho mỗi kênh active được chọn */}
                    {data.channelStats
                      .filter(stat => selectedChannelsForTrend.has(stat.channelName))
                      .map((stat, idx) => (
                        <Line
                          key={stat.channelName}
                          type="monotone"
                          dataKey={`${stat.channelName}_${selectedMetric}`}
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
          </div>

          {/* Top Posts Table */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Top 10 bài đăng tương tác hiệu quả nhất</h3>
                <p className="text-[11px] text-slate-400">Sắp xếp theo tổng lượng tương tác tích lũy.</p>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-100 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="p-4">Nền tảng</th>
                    <th className="p-4">Ngày đăng</th>
                    <th className="p-4">Nội dung bài viết</th>
                    <th className="p-4 text-center">Likes</th>
                    <th className="p-4 text-center">Comments</th>
                    <th className="p-4 text-center">Shares</th>
                    <th className="p-4 text-center">Tương tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {data.topPosts.map(post => (
                    <tr key={post.postKey} className="hover:bg-slate-50/50">
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full font-semibold text-[10px] ${
                          post.platform === 'facebook' 
                            ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                            : 'bg-teal-50 text-teal-700 border border-teal-100'
                        }`}>
                          {post.platform === 'facebook' ? 'Facebook' : 'Zalo OA'}
                        </span>
                      </td>
                      <td className="p-4 text-slate-500 whitespace-nowrap">
                        {new Date(post.publishedAt).toLocaleDateString('vi-VN')}
                      </td>
                      <td className="p-4 max-w-sm truncate text-slate-800 font-medium">
                        {post.message || <em className="text-slate-400">Không có văn bản</em>}
                      </td>
                      <td className="p-4 text-center font-mono font-medium text-slate-600">{post.likes.toLocaleString()}</td>
                      <td className="p-4 text-center font-mono font-medium text-slate-600">{post.comments.toLocaleString()}</td>
                      <td className="p-4 text-center font-mono font-medium text-slate-600">{post.shares.toLocaleString()}</td>
                      <td className="p-4 text-center">
                        <span className="font-semibold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-1 rounded font-mono">
                          {post.engagement.toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
