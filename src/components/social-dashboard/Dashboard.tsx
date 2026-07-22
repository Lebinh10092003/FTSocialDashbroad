import React, { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  Calendar,
  ChevronRight,
  Eye,
  Filter,
  Image as ImageIcon,
  Layers,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Channel, DashboardData } from '../../types';
import SearchableSelect from '../SearchableSelect';

const COLORS = ['#2563eb', '#0f766e', '#f59e0b', '#ef4444', '#7c3aed', '#ec4899', '#0891b2', '#ea580c'];
const DEFAULT_AUTO_SCALE_STEPS = 8;

interface DashboardProps {
  idToken: string;
  googleAccessToken: string | null;
  channels: Channel[];
}

type TrendMetric = 'views' | 'engagement' | 'postsCount' | 'engagementRate' | 'followers';
type DatePreset = 'custom' | '7days' | '30days' | '3months' | '6months' | '1year';

interface FollowerTrendPoint {
  date: string;
  followersCount: number;
  dailyFollowsUnique: number | null;
  dailyUnfollowsUnique: number | null;
}

const formatFollowerInsight = (value: number | null | undefined) => (
  value == null ? 'Chưa có dữ liệu' : Number(value).toLocaleString('vi-VN')
);

const FollowerTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ payload?: FollowerTrendPoint }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white shadow-xl">
      <p className="mb-2 font-extrabold text-slate-100">{label}</p>
      <p>Người theo dõi: <strong>{formatFollowerInsight(point.followersCount)}</strong></p>
      <p className="mt-1">Người theo dõi mới: <strong>{formatFollowerInsight(point.dailyFollowsUnique)}</strong></p>
      <p className="mt-1">Người bỏ theo dõi: <strong>{formatFollowerInsight(point.dailyUnfollowsUnique)}</strong></p>
    </div>
  );
};

interface YAxisScale {
  domain: [number, number];
  ticks: number[];
}

const getCalendarDates = (startDate: string, endDate: string): string[] => {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};
const getDateAxisTicks = (startDate: string, endDate: string): string[] => {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const intervalDays = totalDays <= 10
    ? 1
    : totalDays <= 20
      ? 2
      : totalDays <= 70
        ? Math.max(1, Math.round(totalDays / 10))
        : 7;
  const ticks: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    ticks.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + intervalDays);
  }
  if (ticks[ticks.length - 1] !== endDate) ticks.push(endDate);
  return ticks;
};

const roundUpScaleStep = (value: number) => {
  const increment = value >= 10_000 ? 1_000 : value >= 1_000 ? 100 : value >= 100 ? 10 : 1;
  return Math.max(increment, Math.ceil(value / increment) * increment);
};

const getYAxisScale = (values: number[], divisions: number, includeZero = true): YAxisScale => {
  const validValues = values.filter(value => Number.isFinite(value));
  const minValue = validValues.length ? Math.min(...validValues) : 0;
  const maxValue = validValues.length ? Math.max(...validValues) : 0;

  if (!includeZero) {
    const range = Math.max(maxValue - minValue, Math.max(maxValue * 0.02, 1));
    const step = roundUpScaleStep(range / divisions);
    const domainMin = Math.max(0, Math.floor((minValue - range * 0.15) / step) * step);
    const domainMax = Math.ceil((maxValue + range * 0.15) / step) * step;
    const ticks = Array.from({ length: Math.min(12, Math.round((domainMax - domainMin) / step) + 1) }, (_, index) => domainMin + index * step);
    return { domain: [domainMin, domainMax || step], ticks };
  }

  const requiredDomain = Math.max(maxValue, 1);
  const step = roundUpScaleStep(requiredDomain / divisions);
  const domainMax = step * divisions;
  const ticks = Array.from({ length: divisions + 1 }, (_, index) => index * step);
  return { domain: [0, domainMax], ticks };
};

const getPastDateStr = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

const getTodayStr = () => new Date().toISOString().slice(0, 10);

export default function Dashboard({ idToken, googleAccessToken, channels }: DashboardProps) {
  const [platformFilter, setPlatformFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [startDate, setStartDate] = useState(getPastDateStr(6));
  const [endDate, setEndDate] = useState(getTodayStr());
  const [datePreset, setDatePreset] = useState<DatePreset>('7days');
  const [syncingSelectedPeriod, setSyncingSelectedPeriod] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [followerTrend, setFollowerTrend] = useState<FollowerTrendPoint[]>([]);
  const [followerTrendLoading, setFollowerTrendLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMetric, setActiveMetric] = useState<TrendMetric>('views');
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [isChannelPickerOpen, setIsChannelPickerOpen] = useState(false);
  const [onlyShowTotal, setOnlyShowTotal] = useState(false);
  const [manualScaleSteps, setManualScaleSteps] = useState<number | null>(null);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (platformFilter !== 'all') params.set('platform', platformFilter);
      if (channelFilter !== 'all') params.set('channelId', channelFilter);

      const response = await fetch(`/api/dashboard?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${idToken}`,
          'X-Google-OAuth-Token': googleAccessToken || '',
        },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Không thể tải thống kê (${response.status}).`);
      }
      setData(await response.json());
    } catch (fetchError: any) {
      setError(fetchError.message || 'Không thể kết nối tới hệ thống.');
    } finally {
      setLoading(false);
    }
  };

  const fetchFollowerTrend = async () => {
    setFollowerTrendLoading(true);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (channelFilter !== 'all') params.set('channelId', channelFilter);
      if (platformFilter !== 'all') params.set('platform', platformFilter);
      const response = await fetch(`/api/followers/trend?${params.toString()}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!response.ok) throw new Error('Không thể tải lịch sử người theo dõi.');
      setFollowerTrend(await response.json());
    } catch (trendError) {
      console.error('Không thể tải xu hướng followers:', trendError);
      setFollowerTrend([]);
    } finally {
      setFollowerTrendLoading(false);
    }
  };
  useEffect(() => {
    fetchDashboardData();
  }, [idToken, googleAccessToken, platformFilter, channelFilter, startDate, endDate, channels]);
  useEffect(() => {
    fetchFollowerTrend();
  }, [idToken, channelFilter, platformFilter, startDate, endDate]);

  useEffect(() => {
    if (data) setSelectedChannels(new Set(data.channelStats.map(stat => stat.channelName)));
  }, [data]);

  const updatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === 'custom') return;

    const end = new Date();
    const start = new Date();
    if (preset === '7days') start.setDate(end.getDate() - 6);
    if (preset === '30days') start.setDate(end.getDate() - 29);
    if (preset === '3months') start.setMonth(end.getMonth() - 3);
    if (preset === '6months') start.setMonth(end.getMonth() - 6);
    if (preset === '1year') start.setFullYear(end.getFullYear() - 1);

    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  };

  const syncSelectedPeriod = async () => {
    setSyncingSelectedPeriod(true); setSyncMessage(null); setError(null);
    try {
      const response = await fetch('/api/sync/all', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}`, 'X-Google-OAuth-Token': googleAccessToken || '' }, body: JSON.stringify({ background: true, recentDays: 1 }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) throw new Error(body.error || body.message || 'Không thể bắt đầu đồng bộ dữ liệu gần đây.');
      setSyncMessage(body.message || 'Đã bắt đầu đồng bộ nền dữ liệu gần đây.');
      await Promise.all([fetchDashboardData(), fetchFollowerTrend()]);
    } catch (syncError: any) { setError(syncError.message || 'Không thể bắt đầu đồng bộ dữ liệu.'); }
    finally { setSyncingSelectedPeriod(false); }
  };
  const filteredChannels = channels.filter(channel =>
    channel.status === 'active'
    && channel.externalId !== 'current-facebook-token'
    && (platformFilter === 'all' || channel.platform === platformFilter),
  );
  const typeStats = data?.typeStats || [];
  const isSingleChannelScope = channelFilter !== 'all';
  const selectedMetricLabel: Record<TrendMetric, string> = {
    views: 'lượt xem',
    engagement: 'tương tác',
    postsCount: 'số bài đăng',
    engagementRate: 'tỷ lệ tương tác',
    followers: 'lượt follow',
  };

  const toggleChannel = (channelName: string) => {
    setSelectedChannels(current => {
      const next = new Set(current);
      if (next.has(channelName)) next.delete(channelName);
      else next.add(channelName);
      return next;
    });
  };

  const selectedBreakdown = () => {
    if (!data) return { reactions: 0, comments: 0, shares: 0 };
    return data.trends.reduce(
      (totals, point) => {
        selectedChannels.forEach(channelName => {
          totals.reactions += Number(point[`${channelName}_likes`] || 0);
          totals.comments += Number(point[`${channelName}_comments`] || 0);
          totals.shares += Number(point[`${channelName}_shares`] || 0);
        });
        return totals;
      },
      { reactions: 0, comments: 0, shares: 0 },
    );
  };

  const breakdown = selectedBreakdown();
  const interactionDistribution = [
    { label: 'Cảm xúc', value: breakdown.reactions, color: '#2563eb' },
    { label: 'Bình luận', value: breakdown.comments, color: '#0f766e' },
    { label: 'Lượt chia sẻ', value: breakdown.shares, color: '#7c3aed' },
  ];
  const interactionTotal = interactionDistribution.reduce((total, item) => total + item.value, 0);

  const cards: Array<{
    metric?: TrendMetric;
    title: string;
    value: string;
    description: string;
    icon: React.ElementType;
    accent: string;
    idle: string;
  }> = data ? [
    {
      metric: 'views',
      title: 'Lượt xem',
      value: data.kpis.views.toLocaleString('vi-VN'),
      description: 'Tổng lượt xem từ nội dung hỗ trợ chỉ số này',
      icon: Eye,
      accent: 'border-cyan-600 ring-cyan-600 bg-cyan-50/40',
      idle: 'bg-cyan-50 text-cyan-700',
    },
    {
      metric: 'engagement',
      title: 'Lượt tương tác',
      value: data.kpis.totalEngagement.toLocaleString('vi-VN'),
      description: 'Cảm xúc, bình luận và chia sẻ',
      icon: TrendingUp,
      accent: 'border-blue-600 ring-blue-600 bg-blue-50/40',
      idle: 'bg-blue-50 text-blue-700',
    },
    {
      metric: 'postsCount',
      title: 'Số bài đăng',
      value: data.kpis.postsCount.toLocaleString('vi-VN'),
      description: 'Bài đăng duy nhất trong khoảng thời gian đã chọn',
      icon: Layers,
      accent: 'border-emerald-600 ring-emerald-600 bg-emerald-50/40',
      idle: 'bg-emerald-50 text-emerald-700',
    },
    {
      metric: 'followers',
      title: 'Lượt follow',
      value: data.kpis.followersAvailable ? data.kpis.followers.toLocaleString('vi-VN') : 'Chưa có dữ liệu',
      description: channelFilter === 'all' ? 'Tổng follower tại cuối kỳ của các trang đã chọn' : 'Follower tại cuối kỳ của trang đã chọn',
      icon: Users,
      accent: 'border-violet-600 ring-violet-600 bg-violet-50/40',
      idle: 'bg-violet-50 text-violet-700',
    },
  ] : [];

  const visibleTrends = (data?.trends || []).filter(point => point.date >= startDate && point.date <= endDate);
  const isFollowerMetric = activeMetric === 'followers';
  const contentTrendValues = !data || activeMetric === 'followers'
    ? []
    : visibleTrends.flatMap(point => [
      Number(point[activeMetric] || 0),
      ...data.channelStats
        .filter(stat => selectedChannels.has(stat.channelName))
        .map(stat => Number(point[`${stat.channelName}_${activeMetric}`] || 0)),
    ]);
  const yAxisScale = getYAxisScale(
    isFollowerMetric ? followerTrend.map(point => point.followersCount) : contentTrendValues,
    manualScaleSteps || DEFAULT_AUTO_SCALE_STEPS,
    !isFollowerMetric,
  );
  const xAxisTicks = getDateAxisTicks(startDate, endDate);
  const followerValuesByDate = new Map(followerTrend.map(point => [point.date, point]));
  const followerChartData = getCalendarDates(startDate, endDate).map(date => {
    const point = followerValuesByDate.get(date);
    return {
      date,
      followersCount: point?.followersCount ?? null,
      dailyFollowsUnique: point?.dailyFollowsUnique ?? null,
      dailyUnfollowsUnique: point?.dailyUnfollowsUnique ?? null,
    };
  });

  return (
    <div className="space-y-5 pb-6">
      <section className="border-b border-slate-200/70 pb-4">
        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Thống kê tương tác</h2>
        <p className="text-sm text-slate-500 mt-1">Theo dõi hiệu quả nội dung đa kênh theo thời gian thực.</p>
      </section>

      <section className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200/70 p-3 rounded-xl">
        <Filter className="w-5 h-5 text-slate-400" />
        <span className="text-sm font-bold text-slate-600">Lọc nhanh:</span>
        <SearchableSelect
          value={platformFilter}
          onChange={value => { setPlatformFilter(value); setChannelFilter('all'); }}
          options={[{ value: 'all', label: 'Tất cả nền tảng' }, { value: 'facebook', label: 'Facebook Pages' }, { value: 'zalo', label: 'Zalo OA' }]}
          className="min-w-[190px]"
        />
        <SearchableSelect
          value={channelFilter}
          onChange={setChannelFilter}
          options={[{ value: 'all', label: 'Tổng tất cả trang' }, ...filteredChannels.map(channel => ({ value: channel.id, label: channel.name }))]}
          className="min-w-[220px]"
        />
        <div className="flex flex-wrap items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm">
          <Calendar className="w-4 h-4 text-slate-400" />
          <select value={datePreset} onChange={event => updatePreset(event.target.value as DatePreset)} className="text-sm font-bold text-slate-700 bg-transparent outline-none">
            <option value="custom">Tùy chọn</option>
            <option value="7days">7 ngày qua</option>
            <option value="30days">1 tháng qua</option>
            <option value="3months">3 tháng qua</option>
            <option value="6months">6 tháng qua</option>
            <option value="1year">1 năm qua</option>
          </select>
          <input type="date" value={startDate} min={getPastDateStr(365)} max={endDate} onChange={event => { setStartDate(event.target.value); setDatePreset('custom'); }} className="text-sm text-slate-600 outline-none" />
          <span className="text-sm text-slate-400">đến</span>
          <input type="date" value={endDate} min={startDate} max={getTodayStr()} onChange={event => { setEndDate(event.target.value); setDatePreset('custom'); }} className="text-sm text-slate-600 outline-none" />
        </div>
        <button
          onClick={syncSelectedPeriod}
          disabled={syncingSelectedPeriod}
          title="Đồng bộ nền dữ liệu 7 ngày gần đây vào SQLite"
          className="inline-flex items-center gap-2 bg-white border border-slate-200 px-3 py-2 rounded-lg text-sm font-extrabold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          <RefreshCw className={'w-4 h-4 ' + (syncingSelectedPeriod ? 'animate-spin' : '')} />
          {syncingSelectedPeriod ? 'Đang khởi chạy...' : 'Đồng bộ lại'}
        </button>
        {data?.lastSync && (
          <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-lg text-xs text-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Cập nhật lúc <strong>{new Date(data.lastSync).toLocaleString('vi-VN')}</strong>
          </div>
        )}
      </section>

      {syncMessage && <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-lg text-xs text-emerald-800"><span className="w-2 h-2 rounded-full bg-emerald-500" />{syncMessage}</div>}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-28 bg-white border border-slate-200 rounded-3xl space-y-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-bold text-slate-500">Đang tải thống kê truyền thông...</p>
        </div>
      ) : error ? (
        <div className="p-10 bg-rose-50 border border-rose-200 rounded-3xl text-center space-y-4 max-w-xl mx-auto">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <p className="text-base text-rose-800">{error}</p>
          <button onClick={fetchDashboardData} className="bg-rose-600 text-white px-5 py-2.5 rounded-xl font-bold">Thử lại</button>
        </div>
      ) : !data || data.kpis.postsCount === 0 ? (
        <div className="p-16 text-center bg-white border border-slate-200 rounded-3xl">
          <Layers className="w-14 h-14 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-extrabold text-slate-800">Chưa có bài đăng trong khoảng thời gian này</h3>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {cards.map(card => {
              const Icon = card.icon;
              const isActive = activeMetric === card.metric;
              return (
                <button
                  key={card.title}
                  onClick={() => card.metric && setActiveMetric(card.metric)}
                  className={`text-left p-4 rounded-xl border transition-all premium-card ${card.metric ? 'cursor-pointer' : 'cursor-default'} ${isActive ? `${card.accent} ring-2` : 'bg-white border-slate-200/70 hover:border-slate-300'}`}
                >
                  <span className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-slate-500 uppercase tracking-wide">{card.title}</span>
                    <span className={`p-2 rounded-lg ${isActive ? 'bg-slate-900 text-white' : card.idle}`}><Icon className="w-4 h-4" /></span>
                  </span>
                  <strong className="block text-2xl font-extrabold text-slate-900 mt-3 leading-none">{card.value}</strong>
                  <span className="block text-xs text-slate-500 mt-2 leading-snug">{card.description}</span>
                </button>
              );
            })}
          </section>

          <section className="bg-white p-4 md:p-5 rounded-2xl border border-slate-200/70 shadow-sm space-y-4">
            <div className="flex flex-col lg:flex-row justify-between gap-4">
              <div>
                <h3 className="text-lg font-extrabold text-slate-800">Xu hướng {isFollowerMetric ? 'lượt follow' : selectedMetricLabel[activeMetric]} {isFollowerMetric ? 'theo thời gian' : 'theo ngày đăng'}</h3>
                <p className="text-sm text-slate-500 mt-1">{isFollowerMetric ? 'Chọn trang để xem biến động người theo dõi trong khoảng thời gian đang lọc.' : 'Chọn KPI phía trên để đổi chỉ số hiển thị trên biểu đồ.'}</p>
              </div>
              <div className="flex items-start gap-2">
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
                  <span className="text-xs font-bold text-slate-600 whitespace-nowrap">Thay đổi thang đo</span>
                  <input
                    type="range"
                    min="5"
                    max="10"
                    step="1"
                    value={manualScaleSteps || DEFAULT_AUTO_SCALE_STEPS}
                    onChange={event => setManualScaleSteps(Number(event.target.value))}
                    className="w-20 accent-blue-600"
                    aria-label="Thay đổi thang đo biểu đồ"
                  />
                  <span className="min-w-14 text-right text-xs font-extrabold text-slate-700">{manualScaleSteps ? `${manualScaleSteps} nấc` : 'Tự động'}</span>
                  {manualScaleSteps && <button type="button" onClick={() => setManualScaleSteps(null)} className="text-[11px] font-bold text-blue-700 hover:text-blue-900">Tự động</button>}
                </div>
                {isFollowerMetric ? (
                  <SearchableSelect value={channelFilter} onChange={setChannelFilter} options={[{value:'all',label:'Tổng tất cả trang'},...filteredChannels.map(channel => ({value:channel.id,label:channel.name}))]} className="min-w-[220px]"/>
                ) : (
                  <>
                    <div className="relative">
                      <button onClick={() => setIsChannelPickerOpen(open => !open)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-sm">
                        Chọn kênh hiển thị ({selectedChannels.size}) ▾
                      </button>
                      {isChannelPickerOpen && (
                        <>
                          <button aria-label="Đóng bộ chọn kênh" className="fixed inset-0 z-10 cursor-default" onClick={() => setIsChannelPickerOpen(false)} />
                          <div className="absolute right-0 mt-2 z-20 w-72 bg-white border border-slate-200 rounded-2xl shadow-xl p-3">
                            <div className="flex justify-between border-b border-slate-100 pb-2 mb-2">
                              <button onClick={() => setSelectedChannels(new Set(data.channelStats.map(stat => stat.channelName)))} className="text-sm font-bold text-blue-700">Chọn tất cả</button>
                              <button onClick={() => setSelectedChannels(new Set())} className="text-sm font-bold text-rose-600">Bỏ chọn</button>
                            </div>
                            <div className="max-h-64 overflow-y-auto space-y-1">
                              {data.channelStats.map(stat => (
                                <label key={stat.channelName} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-700 cursor-pointer">
                                  <input type="checkbox" checked={selectedChannels.has(stat.channelName)} onChange={() => toggleChannel(stat.channelName)} className="rounded text-blue-600" />
                                  <span className="truncate">{stat.channelName}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="h-[440px] md:h-[480px]">
              {isFollowerMetric ? (
                followerTrendLoading ? (
                  <div className="h-full grid place-items-center text-sm text-slate-400">Đang tải lịch sử followers...</div>
                ) : followerTrend.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={followerChartData} margin={{ top: 16, right: 18, left: 0, bottom: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="date" ticks={xAxisTicks} interval={0} minTickGap={12} tickFormatter={(value: string) => value.slice(5).split('-').reverse().join('/')} tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
                      <YAxis domain={yAxisScale.domain} ticks={yAxisScale.ticks} tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
                      <Tooltip content={<FollowerTooltip />} cursor={{ stroke: '#c4b5fd', strokeDasharray: '3 3' }} />
                      <Line type="monotone" dataKey="followersCount" name="Người theo dõi" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full grid place-items-center text-sm text-slate-400">Chưa có lịch sử followers. Dữ liệu sẽ xuất hiện sau lần đồng bộ tiếp theo.</div>
                )
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={visibleTrends} margin={{ top: 16, right: 18, left: 0, bottom: 12 }}>
                    <defs>
                      <linearGradient id="totalLine" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#94a3b8" stopOpacity={0.2} /><stop offset="95%" stopColor="#94a3b8" stopOpacity={0} /></linearGradient>
                      {data.channelStats.map((stat, index) => <linearGradient key={stat.channelName} id={`channel-${index}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.18} /><stop offset="95%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0} /></linearGradient>)}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="date" ticks={xAxisTicks} interval={0} minTickGap={12} tickFormatter={(value: string) => value.slice(5).split('-').reverse().join('/')} tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <YAxis domain={yAxisScale.domain} ticks={yAxisScale.ticks} tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 10, color: '#fff', fontSize: 12 }} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff', fontWeight: 700 }} wrapperStyle={{ zIndex: 30, outline: 'none', pointerEvents: 'none' }} formatter={(value: number, name: string) => [Number(value).toLocaleString('vi-VN'), name]} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
                    {!isSingleChannelScope && <Area type="monotone" dataKey={activeMetric} name="Tổng cộng" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" fill="url(#totalLine)" />}
                    {!onlyShowTotal && data.channelStats.filter(stat => selectedChannels.has(stat.channelName)).map((stat, index) => <Area key={stat.channelName} type="monotone" dataKey={`${stat.channelName}_${activeMetric}`} name={stat.channelName} stroke={COLORS[index % COLORS.length]} strokeWidth={2.5} fill={`url(#channel-${index})`} />)}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {!isFollowerMetric && (
              <div className="border-t border-slate-100 pt-3 space-y-3">
                {!isSingleChannelScope && <label className="flex items-center justify-end gap-2 text-xs font-bold text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={onlyShowTotal} onChange={event => setOnlyShowTotal(event.target.checked)} className="w-4 h-4 accent-blue-600" /> Chỉ hiển đường tổng
                </label>}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    ['Cảm xúc', breakdown.reactions, 'Tổng lượt thích và cảm xúc'],
                    ['Bình luận', breakdown.comments, 'Tổng phản hồi trên bài viết'],
                    ['Lượt chia sẻ', breakdown.shares, 'Tổng lượt chia sẻ bài viết'],
                  ].map(([title, value, description]) => (
                    <div key={String(title)} className="bg-slate-50 p-3 rounded-xl border border-slate-200/70">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">{title}</p>
                      <p className="text-2xl font-extrabold text-slate-900 mt-1">{Number(value).toLocaleString('vi-VN')}</p>
                      <p className="text-xs text-slate-500 mt-1">{description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <ContentBarChart title="Lượt xem theo loại nội dung" subtitle="Tổng lượt xem trong khoảng thời gian đang lọc." data={typeStats} dataKey="views" color="#0891b2" formatter="lượt xem" />
            <ContentBarChart title="Lượt tương tác theo loại nội dung" subtitle="Tổng tương tác trong khoảng thời gian đang lọc." data={typeStats} dataKey="engagement" color="#2563eb" formatter="tương tác" />
            <div className="bg-white p-5 rounded-2xl border border-slate-200/70 shadow-sm">
              <h3 className="text-lg font-extrabold text-slate-800">Tỷ lệ tương tác</h3>
              <p className="text-sm text-slate-500 mt-1">Tỷ trọng cảm xúc, bình luận và lượt chia sẻ.</p>
              <div className="h-56 relative mt-2">
                {interactionTotal > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={interactionDistribution} dataKey="value" nameKey="label" innerRadius={54} outerRadius={82} paddingAngle={3}>
                        {interactionDistribution.map(entry => <Cell key={entry.label} fill={entry.color} />)}
                      </Pie>
                      <Tooltip formatter={(value: number) => [`${value.toLocaleString('vi-VN')} tương tác`, '']} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div className="h-full grid place-items-center text-sm text-slate-400">Chưa có dữ liệu tương tác</div>}
                <div className="absolute inset-0 grid place-items-center pointer-events-none text-center">
                  <div><strong className="block text-2xl text-slate-900">{interactionTotal.toLocaleString('vi-VN')}</strong><span className="text-xs text-slate-400">Tổng tương tác</span></div>
                </div>
              </div>
              <div className="space-y-2 mt-2">
                {interactionDistribution.map(item => <div key={item.label} className="flex justify-between gap-3 text-sm"><span className="flex items-center gap-2 text-slate-600"><i className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />{item.label}</span><strong className="text-slate-800">{item.value.toLocaleString('vi-VN')} ({interactionTotal ? Math.round((item.value / interactionTotal) * 100) : 0}%)</strong></div>)}
              </div>
            </div>
          </section>

          <section className="bg-white p-5 rounded-2xl border border-slate-200/70 shadow-sm">
            <h3 className="text-lg font-extrabold text-slate-800">Bài viết mới đây</h3>
            <p className="text-sm text-slate-500 mt-1">Các bài mới nhất đã đồng bộ, có thumbnail khi nền tảng cung cấp.</p>
            <div className="flex overflow-x-auto gap-4 pt-4 pb-2">
              {data.topPosts.map(post => {
                const channel = channels.find(item => item.id === post.channelId);
                return (
                  <a key={post.postKey} href={post.postUrl} target="_blank" rel="noreferrer" className="flex-none w-64 border border-slate-200 rounded-xl p-3 bg-white hover:border-blue-400 hover:shadow-lg transition-all group">
                    <div className="w-full h-32 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 grid place-items-center text-white relative overflow-hidden">
                      <ImageIcon className="w-11 h-11 opacity-60" />
                      {post.imageUrl && <img src={post.imageUrl} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} className="absolute inset-0 w-full h-full object-cover" />}
                      <span className="absolute top-2 right-2 px-2 py-1 rounded-lg text-xs font-extrabold bg-slate-950/50">{post.platform === 'facebook' ? 'FB' : 'Zalo'}</span>
                    </div>
                    <div className="mt-4 space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{new Date(post.publishedAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                      <p className="text-sm font-extrabold text-slate-800 truncate" title={channel?.name}>{channel?.name || 'Kênh ẩn'}</p>
                      <p className="text-sm text-slate-600 leading-relaxed line-clamp-2 h-11">{post.message || <em>Không có nội dung văn bản</em>}</p>
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-100 mt-4 pt-3 text-xs"><span className="font-bold uppercase text-slate-500">{post.postType || 'Khác'}</span><div className="text-right"><span className="block font-extrabold text-blue-700">{post.engagement.toLocaleString('vi-VN')} tương tác</span><span className="block text-[11px] font-bold text-blue-700 mt-0.5">{(post.views || 0).toLocaleString('vi-VN')} lượt xem</span></div></div>
                    <ChevronRight className="w-5 h-5 text-blue-600 ml-auto mt-3 opacity-0 group-hover:opacity-100" />
                  </a>
                );
              })}
            </div>
          </section>
          <section className="bg-white p-5 rounded-2xl border border-slate-200/70 shadow-sm">
            <h3 className="text-lg font-extrabold text-slate-800">Các bài viết có lượt xem cao nhất</h3>
            <p className="text-sm text-slate-500 mt-1">05 bài có lượt xem cao nhất trong 12 tháng gần nhất, theo bộ lọc trang hiện tại.</p>
            <div className="flex overflow-x-auto gap-4 pt-4 pb-2">
              {(data.topViewedPosts || []).map(post => {
                const channel = channels.find(item => item.id === post.channelId);
                return <a key={post.postKey} href={post.postUrl} target="_blank" rel="noreferrer" className="flex-none w-64 border border-slate-200 rounded-xl p-3 bg-white hover:border-cyan-400 hover:shadow-lg transition-all group"><div className="w-full h-32 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 grid place-items-center text-white relative overflow-hidden"><ImageIcon className="w-11 h-11 opacity-60" />{post.imageUrl && <img src={post.imageUrl} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} className="absolute inset-0 w-full h-full object-cover" />}<span className="absolute top-2 right-2 px-2 py-1 rounded-lg text-xs font-extrabold bg-slate-950/50">{post.platform === 'facebook' ? 'FB' : 'Zalo'}</span></div><div className="mt-4 space-y-2"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{new Date(post.publishedAt).toLocaleDateString('vi-VN')}</p><p className="text-sm font-extrabold text-slate-800 truncate" title={channel?.name}>{channel?.name || 'Kênh ẩn'}</p><p className="text-sm text-slate-600 leading-relaxed line-clamp-2 h-11">{post.message || <em>Không có nội dung văn bản</em>}</p></div><div className="flex items-center justify-between border-t border-slate-100 mt-4 pt-3 text-xs"><span className="font-bold uppercase text-slate-500">{post.postType || 'Khác'}</span><div className="text-right"><span className="block font-extrabold text-blue-700">{post.views.toLocaleString('vi-VN')} lượt xem</span><span className="block text-[11px] font-bold text-blue-700 mt-0.5">{(post.engagement || 0).toLocaleString('vi-VN')} tương tác</span></div></div><ChevronRight className="w-5 h-5 text-cyan-600 ml-auto mt-3 opacity-0 group-hover:opacity-100" /></a>;
              })}
              {!(data.topViewedPosts || []).length && <p className="py-8 text-sm text-slate-400">Chưa có dữ liệu lượt xem trong 12 tháng gần nhất.</p>}
            </div>
          </section>        </>
      )}
    </div>
  );
}

function ContentBarChart({ title, subtitle, data, dataKey, color, formatter }: { title: string; subtitle: string; data: NonNullable<DashboardData['typeStats']>; dataKey: 'views' | 'engagement'; color: string; formatter: string; }) {
  return <div className="bg-white p-5 rounded-2xl border border-slate-200/70 shadow-sm"><h3 className="text-lg font-extrabold text-slate-800">{title}</h3><p className="text-sm text-slate-500 mt-1">{subtitle}</p><div className="h-60 mt-3">{data.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 0, right: 18, left: 6, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" /><XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="type" width={92} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value: number) => [`${value.toLocaleString('vi-VN')} ${formatter}`, '']} contentStyle={{ borderRadius: 12, fontSize: 12 }} /><Bar dataKey={dataKey} fill={color} radius={[0, 7, 7, 0]} barSize={18} /></BarChart></ResponsiveContainer> : <div className="h-full grid place-items-center text-sm text-slate-400">Chưa có dữ liệu</div>}</div></div>;
}
