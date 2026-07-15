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
  
  // Interactive channel filter states for comparison chart
  const [selectedChannelsForCompare, setSelectedChannelsForCompare] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (data && data.channelStats) {
      setSelectedChannelsForCompare(new Set(data.channelStats.map(s => s.channelName)));
    }
  }, [data]);

  const toggleChannelCompare = (name: string) => {
    const next = new Set(selectedChannelsForCompare);
    if (next.has(name)) {
      if (next.size > 1) {
        next.delete(name);
      }
    } else {
      next.add(name);
    }
    setSelectedChannelsForCompare(next);
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
          <input 
            type="date" 
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-xs text-slate-400">đến</span>
          <input 
            type="date" 
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
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

          {/* Charts section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Trends chart */}
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Xu hướng tương tác theo ngày đăng</h3>
                <p className="text-[11px] text-slate-400">Biểu đồ thể hiện tổng tương tác & tiếp cận tích lũy theo ngày xuất bản thực tế của các bài đăng.</p>
              </div>
              <div className="h-64">
                {data.trends.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-xs text-slate-400">
                    Không có xu hướng biến động cho khoảng thời gian này.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.trends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      
                      {/* Đường tham chiếu tổng cộng */}
                      <Line type="monotone" dataKey="engagement" name="Tổng cộng" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" />
                      
                      {/* Đường xu hướng riêng cho mỗi kênh active */}
                      {data.channelStats.map((stat, idx) => (
                        <Line
                          key={stat.channelName}
                          type="monotone"
                          dataKey={stat.channelName}
                          name={stat.channelName}
                          stroke={COLORS[idx % COLORS.length]}
                          strokeWidth={2.2}
                          activeDot={{ r: 5 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Channels chart */}
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4 flex flex-col justify-between">
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-slate-800">So sánh hiệu quả giữa các kênh</h3>
                <p className="text-[11px] text-slate-400">Tổng số lượng bài đăng và tổng tương tác tích lũy của các bài đăng phát sóng trong khoảng thời gian đã chọn.</p>
                <p className="text-[10px] text-slate-400 italic">Trục Y bên trái: Tương tác (Cột xanh), Trục Y bên phải: Số bài viết (Đường xanh biển).</p>
                
                {/* Chọn kênh hiển thị trên biểu đồ so sánh */}
                {data.channelStats.length > 0 && (
                  <div className="flex flex-wrap gap-1 p-2 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider self-center mr-1">Hiển thị:</span>
                    {data.channelStats.map((stat, idx) => {
                      const isSelected = selectedChannelsForCompare.has(stat.channelName);
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => toggleChannelCompare(stat.channelName)}
                          className={`px-2 py-0.5 rounded-md text-[9px] font-bold transition-all border cursor-pointer ${
                            isSelected 
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
                              : 'bg-white text-slate-500 hover:bg-slate-100 border-slate-200'
                          }`}
                        >
                          {stat.channelName}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="h-72">
                {data.channelStats.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-xs text-slate-400">
                    Chưa cấu hình kênh để so sánh.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart 
                      data={data.channelStats.filter(s => selectedChannelsForCompare.has(s.channelName))} 
                      margin={{ top: 10, right: -5, left: -20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis 
                        dataKey="channelName" 
                        tickStyle={{ fontSize: 8 }}
                        angle={-25}
                        textAnchor="end"
                        height={55}
                        interval={0}
                        tickFormatter={(value) => value.length > 20 ? value.substring(0, 18) + '...' : value}
                      />
                      <YAxis yAxisId="left" orientation="left" stroke="#10b981" tickStyle={{ fontSize: 9 }} />
                      <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" tickStyle={{ fontSize: 9 }} />
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
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar yAxisId="left" dataKey="engagement" name="Lượt tương tác" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={30} />
                      <Line yAxisId="right" type="monotone" dataKey="postsCount" name="Số bài viết" stroke="#3b82f6" strokeWidth={2.5} activeDot={{ r: 5 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Bảng so sánh chi tiết số liệu */}
              {data.channelStats.length > 0 && (
                <div className="mt-4 overflow-x-auto border border-slate-100 rounded-xl">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                        <th className="p-2.5">Kênh</th>
                        <th className="p-2.5 text-center">Nền tảng</th>
                        <th className="p-2.5 text-center">Bài viết</th>
                        <th className="p-2.5 text-center">Tương tác</th>
                        <th className="p-2.5 text-center">Trung bình / bài</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {data.channelStats
                        .filter(s => selectedChannelsForCompare.has(s.channelName))
                        .map((stat, idx) => {
                          const avgEngagement = stat.postsCount > 0 
                            ? Math.round(stat.engagement / stat.postsCount) 
                            : 0;
                          return (
                            <tr key={idx} className="hover:bg-slate-50/40">
                              <td className="p-2.5 font-semibold text-slate-800 truncate max-w-[120px]" title={stat.channelName}>{stat.channelName}</td>
                              <td className="p-2.5 text-center">
                                <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full font-semibold text-[8px] uppercase ${
                                  stat.platform === 'facebook' 
                                    ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                                    : stat.platform === 'zalo'
                                    ? 'bg-teal-50 text-teal-750 border border-teal-100'
                                    : 'bg-purple-50 text-purple-700 border border-purple-100'
                                }`}>
                                  {stat.platform}
                                </span>
                              </td>
                              <td className="p-2.5 text-center font-mono font-medium text-slate-600">{stat.postsCount}</td>
                              <td className="p-2.5 text-center font-mono font-medium text-slate-600">{stat.engagement.toLocaleString()}</td>
                              <td className="p-2.5 text-center font-semibold text-blue-600 font-mono bg-blue-50/20">{avgEngagement.toLocaleString()}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
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
