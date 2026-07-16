export type Platform = 'facebook' | 'zalo' | 'mock';
export type UserRole = 'ADMIN' | 'MANAGER' | 'EMPLOYEE';

export interface Channel {
  id: string;
  platform: Platform;
  name: string;
  externalId: string;
  status: 'active' | 'inactive';
  timezone: string;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'failed';
  totalPosts?: number;
  followersCount?: number;
}

export interface Post {
  postKey: string;
  platform: Platform;
  channelId: string;
  externalPostId: string;
  postUrl: string;
  imageUrl?: string;
  postType: string;
  message: string;
  publishedAt: string;
  importedAt: string;
  updatedAt: string;
  isDeleted: boolean;
}

export interface DailySnapshot {
  snapshotKey: string;
  snapshotDate: string; // dd/MM/yyyy or yyyy-MM-dd
  platform: Platform;
  channelId: string;
  postKey: string;
  reactions: number;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  reach: number;
  impressions: number;
  clicks: number;
  totalEngagement: number;
  engagementRate: number | null;
  fetchedAt: string;
}

export interface FollowerSnapshot {
  snapshotKey: string;
  snapshotDate: string;
  channelId: string;
  channelName: string;
  followersCount: number;
  fetchedAt: string;
}
export interface ApiLog {
  logId: string;
  startedAt: string;
  endedAt?: string;
  platform: string;
  action: string;
  channelId?: string;
  status: 'running' | 'success' | 'failed';
  recordsReceived: number;
  recordsInserted: number;
  recordsUpdated: number;
  errorCode?: string;
  errorMessage?: string;
  requestId: string;
}

export interface SystemConfig {
  spreadsheetId: string;
  timezone: string;
  startDate: string;
  syncTime: string;
}

export interface UserProfile {
  email: string;
  name?: string;
  role: UserRole;
  updatedAt: string;
}

export interface DashboardData {
  kpis: {
    postsCount: number;
    reactions: number;
    comments: number;
    shares: number;
    views: number;
    reach: number;
    totalEngagement: number;
    engagementRate: number | null;
    followers: number;
    followersAvailable: boolean;
  };
  previousKpis?: {
    postsCount: number;
    reactions: number;
    comments: number;
    shares: number;
    views: number;
    reach: number;
    totalEngagement: number;
    engagementRate: number | null;
  };
  trends: Array<{
    date: string;
    engagement: number;
    postsCount: number;
    views: number;
    reach: number;
    likes: number;
    comments: number;
    shares: number;
    [key: string]: string | number;
  }>;
  channelStats: {
    channelName: string;
    platform: Platform;
    postsCount: number;
    engagement: number;
  }[];
  topPosts: (Post & {
    engagement: number;
    likes: number;
    comments: number;
    shares: number;
  })[];
  typeStats?: {
    type: string;
    count: number;
    views: number;
    engagement: number;
    engagementRate: number | null;
  }[];
  platformStats?: {
    platform: string;
    count: number;
    engagement: number;
  }[];
  lastSync?: string;
  errors?: string[];
}
