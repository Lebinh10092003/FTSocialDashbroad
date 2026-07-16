import { Platform } from '../src/types';
import { adminDb } from './firebase';

export interface SocialPostRaw {
  id: string;
  message?: string;
  created_time?: string;
  published_at?: string;
  permalink_url?: string;
  post_type?: string;
  image_url?: string;
  rawMetrics?: any;
}

export interface SocialProvider {
  validateCredentials(channelId: string, externalId: string): Promise<boolean>;
  getFollowers(channelId: string, externalId: string): Promise<number>;
  listPosts(channelId: string, externalId: string, since?: Date, until?: Date): Promise<SocialPostRaw[]>;
  getPostMetrics(channelId: string, externalId: string, posts: SocialPostRaw[]): Promise<any[]>;
  normalizePost(raw: SocialPostRaw, channelId: string): any;
  normalizeMetrics(rawMetric: any, channelId: string, postKey: string, snapshotDate: string): any;
}

/**
 * Helper to execute fetch with timeout & retry on 429
 */
async function fetchWithRetry(url: string, options: any = {}, retries = 3, delay = 1000): Promise<any> {
  const timeout = options.timeout || 10000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);

    if (res.status === 429 && retries > 0) {
      console.warn(`Gặp lỗi 429 (Rate Limit). Thử lại sau ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return await res.json();
  } catch (error: any) {
    clearTimeout(id);
    if (retries > 0 && error.name !== 'AbortError') {
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    throw error;
  }
}

/**
 * Facebook Graph API Social Provider
 */
export class FacebookProvider implements SocialProvider {
  private apiVersion: string;

  constructor() {
    this.apiVersion = process.env.META_GRAPH_API_VERSION || 'v20.0';
  }

  private async getToken(externalId: string): Promise<string> {
    try {
      const configSnap = await adminDb.collection('systemConfig').doc('main').get();
      if (configSnap.exists) {
        const configData = configSnap.data();
        const tokensJson = configData?.metaPageTokensJson;
        if (tokensJson) {
          const tokens = JSON.parse(tokensJson);
          const token = tokens[externalId];
          if (token) return token;
        }
      }
    } catch (e: any) {
      console.warn('Lỗi đọc token Facebook từ Firestore, chuyển sang biến môi trường:', e.message);
    }

    const tokensJson = process.env.META_PAGE_TOKENS_JSON;
    if (!tokensJson) {
      throw new Error('Chưa cấu hình META_PAGE_TOKENS_JSON trong hệ thống. Vui lòng vào Cấu hình hệ thống để cài đặt.');
    }
    try {
      const tokens = JSON.parse(tokensJson);
      const token = tokens[externalId];
      if (!token) {
        throw new Error(`Không tìm thấy Facebook Page Access Token cho Page ID: ${externalId}`);
      }
      return token;
    } catch (e: any) {
      throw new Error(`Lỗi parse hoặc truy xuất token Facebook: ${e.message}`);
    }
  }

  async validateCredentials(channelId: string, externalId: string): Promise<boolean> {
    const token = await this.getToken(externalId);
    const url = `https://graph.facebook.com/${this.apiVersion}/${externalId}?fields=name&access_token=${token}`;
    try {
      const data = await fetchWithRetry(url, { timeout: 5000 });
      return !!data.name;
    } catch (error) {
      console.error(`Validate Facebook Page ${externalId} thất bại:`, error);
      return false;
    }
  }

  async getFollowers(channelId: string, externalId: string): Promise<number> {
    const token = await this.getToken(externalId);
    const url = `https://graph.facebook.com/${this.apiVersion}/${externalId}?fields=followers_count,fan_count&access_token=${token}`;
    const data = await fetchWithRetry(url, { timeout: 5000 });
    return Number(data.followers_count ?? data.fan_count ?? 0);
  }

  async listPosts(channelId: string, externalId: string, since?: Date, until?: Date): Promise<SocialPostRaw[]> {
    const token = await this.getToken(externalId);
    let url = `https://graph.facebook.com/${this.apiVersion}/${externalId}/posts?fields=id,message,created_time,permalink_url,attachments{media_type,media,subattachments{media}}&access_token=${token}&limit=100`;

    if (since) {
      url += `&since=${Math.floor(since.getTime() / 1000)}`;
    }
    if (until) {
      url += `&until=${Math.floor(until.getTime() / 1000)}`;
    }

    try {
      const data = await fetchWithRetry(url);
      const rawPosts = data.data || [];
      return rawPosts.map((p: any) => {
        const attachment = p.attachments?.data?.[0];
        let postType = 'status';
        if (attachment?.media_type) {
          postType = attachment.media_type.toLowerCase();
        }
        return {
          id: p.id,
          message: p.message || '',
          created_time: p.created_time,
          permalink_url: p.permalink_url,
          post_type: postType,
          image_url: attachment?.media?.image?.src || attachment?.subattachments?.data?.[0]?.media?.image?.src,
        };
      });
    } catch (error: any) {
      console.error(`Lỗi listPosts Facebook cho ${externalId}:`, error);
      throw error;
    }
  }

  async getPostMetrics(channelId: string, externalId: string, posts: SocialPostRaw[]): Promise<any[]> {
    if (posts.length === 0) return [];
    const token = await this.getToken(externalId);
    const results: any[] = [];

    // Meta Graph API cho phép batching hoặc truy vấn gộp. Để đơn giản, ta truy vấn từng post gộp hoặc riêng lẻ.
    // Vì giới hạn API, ta gọi song song có kiểm soát lỗi metric từng phần (unavailable)
    for (const post of posts) {
      const postMetrics: any = {
        id: post.id,
        reactions: 0,
        comments: 0,
        shares: 0,
        views: 0,
        reach: 0,
        impressions: 0,
        clicks: 0,
        metadata: {}
      };

      try {
        // Lấy reactions, comments, shares
        const fieldsUrl = `https://graph.facebook.com/${this.apiVersion}/${post.id}?fields=reactions.summary(total_count),comments.summary(total_count),shares&access_token=${token}`;
        const basicData = await fetchWithRetry(fieldsUrl, { timeout: 4000 }).catch(err => {
          postMetrics.metadata.basic_unavailable = true;
          return null;
        });

        if (basicData) {
          postMetrics.reactions = basicData.reactions?.summary?.total_count ?? 0;
          postMetrics.likes = postMetrics.reactions; // Facebook reactions map vào likes hoặc reactions riêng
          postMetrics.comments = basicData.comments?.summary?.total_count ?? 0;
          postMetrics.shares = basicData.shares?.count ?? 0;
        }

        // Lấy insights nếu có quyền (reach, impressions, clicks, video views)
        const insightsUrl = `https://graph.facebook.com/${this.apiVersion}/${post.id}/insights?metric=post_media_view,post_total_media_view_unique&access_token=${token}`;
        const insightsData = await fetchWithRetry(insightsUrl, { timeout: 4000 }).catch(err => {
          postMetrics.metadata.insights_unavailable = true;
          return null;
        });

        if (insightsData?.data) {
          for (const item of insightsData.data) {
            const val = item.values?.[0]?.value ?? 0;
            if (item.name === 'post_media_view') {
              postMetrics.views = val;
              postMetrics.impressions = val;
            }
            if (item.name === 'post_total_media_view_unique') postMetrics.reach = val;
          }
        } else {
          postMetrics.metadata.insights_unavailable = true;
        }

        // Thêm views nếu là video
        if (postMetrics.views === 0) {
          postMetrics.views = postMetrics.impressions || postMetrics.reach || 0;
          if (postMetrics.views > 0) postMetrics.metadata.views_source = postMetrics.impressions ? 'impressions' : 'reach';
        }

      } catch (e: any) {
        console.warn(`Lỗi khi lấy metric cho bài viết Facebook ${post.id}:`, e.message);
      }
      results.push(postMetrics);
    }

    return results;
  }

  normalizePost(raw: SocialPostRaw, channelId: string) {
    const postKey = `facebook:${channelId}:${raw.id}`;
    return {
      postKey,
      platform: 'facebook',
      channelId,
      externalPostId: raw.id,
      postUrl: raw.permalink_url || `https://facebook.com/${raw.id}`,
      ...(raw.image_url ? { imageUrl: raw.image_url } : {}),
      postType: raw.post_type || 'status',
      message: raw.message || '',
      publishedAt: raw.created_time || new Date().toISOString(),
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false,
    };
  }

  normalizeMetrics(rawMetric: any, channelId: string, postKey: string, snapshotDate: string) {
    const reactions = Number(rawMetric.reactions || 0);
    const likes = Number(rawMetric.reactions || 0);
    const comments = Number(rawMetric.comments || 0);
    const shares = Number(rawMetric.shares || 0);
    const views = Number(rawMetric.views || 0);
    const reach = Number(rawMetric.reach || 0);
    const impressions = Number(rawMetric.impressions || 0);
    const clicks = Number(rawMetric.clicks || 0);

    const totalEngagement = reactions + comments + shares + clicks;
    let engagementRate: number | null = null;
    if (reach > 0) {
      engagementRate = (totalEngagement / reach) * 100;
    } else if (impressions > 0) {
      engagementRate = (totalEngagement / impressions) * 100;
    }

    return {
      snapshotKey: `${snapshotDate}:${postKey}`,
      snapshotDate,
      platform: 'facebook',
      channelId,
      postKey,
      reactions,
      likes,
      comments,
      shares,
      views,
      reach,
      impressions,
      clicks,
      totalEngagement,
      engagementRate: engagementRate !== null ? Number(engagementRate.toFixed(2)) : null,
      fetchedAt: new Date().toISOString()
    };
  }
}

/**
 * Zalo Official Account Social Provider
 */
export class ZaloOAProvider implements SocialProvider {
  private async getToken(externalId: string): Promise<string> {
    try {
      const configSnap = await adminDb.collection('systemConfig').doc('main').get();
      if (configSnap.exists) {
        const configData = configSnap.data();
        const tokensJson = configData?.zaloOaTokensJson;
        if (tokensJson) {
          const tokens = JSON.parse(tokensJson);
          const token = tokens[externalId];
          if (token) return token;
        }
      }
    } catch (e: any) {
      console.warn('Lỗi đọc token Zalo từ Firestore, chuyển sang biến môi trường:', e.message);
    }

    const tokensJson = process.env.ZALO_OA_TOKENS_JSON;
    if (!tokensJson) {
      throw new Error('Chưa cấu hình ZALO_OA_TOKENS_JSON trong hệ thống. Vui lòng vào Cấu hình hệ thống để cài đặt.');
    }
    try {
      const tokens = JSON.parse(tokensJson);
      const token = tokens[externalId];
      if (!token) {
        throw new Error(`Không tìm thấy Zalo OA Access Token cho OA ID: ${externalId}`);
      }
      return token;
    } catch (e: any) {
      throw new Error(`Lỗi parse hoặc truy xuất token Zalo: ${e.message}`);
    }
  }

  async validateCredentials(channelId: string, externalId: string): Promise<boolean> {
    const token = await this.getToken(externalId);
    // Zalo OA API: get profile of OA
    const url = `https://openapi.zalo.me/v2.0/oa/getprofile`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'access_token': token,
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      return data.error === 0;
    } catch (error) {
      console.error(`Validate Zalo OA ${externalId} thất bại:`, error);
      return false;
    }
  }

  async getFollowers(channelId: string, externalId: string): Promise<number> {
    const token = await this.getToken(externalId);
    const res = await fetch('https://openapi.zalo.me/v2.0/oa/getprofile', {
      headers: { access_token: token, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.error !== 0) throw new Error(`Zalo API error ${data.error}: ${data.message}`);
    return Number(data.data?.followers ?? data.data?.follower ?? data.data?.followers_count ?? 0);
  }

  async listPosts(channelId: string, externalId: string, since?: Date, until?: Date): Promise<SocialPostRaw[]> {
    const token = await this.getToken(externalId);
    // OA API to list broadcast/article posts
    const url = `https://openapi.zalo.me/v2.0/article/getslice?offset=0&limit=50`;
    try {
      const res = await fetch(url, {
        headers: { access_token: token }
      });
      const data = await res.json();

      if (data.error !== 0) {
        throw new Error(`Zalo API error ${data.error}: ${data.message}`);
      }

      const articles = data.data?.articles || [];
      // Lọc theo thời gian nếu cần
      return articles
        .map((a: any) => ({
          id: a.id,
          message: a.title + (a.description ? ` - ${a.description}` : ''),
          created_time: new Date(Number(a.create_date || Date.now())).toISOString(),
        permalink_url: `https://oa.zalo.me/details/${a.id}`,
        post_type: 'article',
        image_url: a.thumb || a.thumbnail || a.cover || undefined,
        }))
        .filter((p: any) => {
          const pubDate = new Date(p.created_time);
          if (since && pubDate < since) return false;
          if (until && pubDate > until) return false;
          return true;
        });
    } catch (error: any) {
      console.error(`Lỗi listPosts Zalo cho OA ${externalId}:`, error);
      throw error;
    }
  }

  async getPostMetrics(channelId: string, externalId: string, posts: SocialPostRaw[]): Promise<any[]> {
    const token = await this.getToken(externalId);
    const results: any[] = [];

    for (const post of posts) {
      const postMetrics: any = {
        id: post.id,
        reactions: 0,
        comments: 0,
        shares: 0,
        views: 0,
        reach: 0,
        impressions: 0,
        clicks: 0,
        metadata: {}
      };

      try {
        // Zalo OA API lấy thông tin chi tiết bài viết (bao gồm view, share...)
        const url = `https://openapi.zalo.me/v2.0/article/getdetail?id=${post.id}`;
        const res = await fetch(url, { headers: { access_token: token } });
        const data = await res.json();

        if (data.error === 0 && data.data) {
          // Zalo OA trả về số lượt xem, chia sẻ
          postMetrics.views = data.data.views ?? 0;
          postMetrics.shares = data.data.shares ?? 0;
          postMetrics.clicks = data.data.clicks ?? 0;
          postMetrics.reactions = data.data.likes ?? 0; // Thích
          // Zalo không có bình luận công khai hoặc reach chuẩn, map click làm reach/impression
          postMetrics.reach = postMetrics.views;
          postMetrics.impressions = postMetrics.views;
        } else {
          postMetrics.metadata.unavailable = true;
        }
      } catch (e: any) {
        console.warn(`Lỗi lấy metric Zalo bài viết ${post.id}:`, e.message);
        postMetrics.metadata.unavailable = true;
      }
      results.push(postMetrics);
    }

    return results;
  }

  normalizePost(raw: SocialPostRaw, channelId: string) {
    const postKey = `zalo:${channelId}:${raw.id}`;
    return {
      postKey,
      platform: 'zalo',
      channelId,
      externalPostId: raw.id,
      postUrl: raw.permalink_url || `https://oa.zalo.me/details/${raw.id}`,
      ...(raw.image_url ? { imageUrl: raw.image_url } : {}),
      postType: 'article',
      message: raw.message || '',
      publishedAt: raw.created_time || new Date().toISOString(),
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false,
    };
  }

  normalizeMetrics(rawMetric: any, channelId: string, postKey: string, snapshotDate: string) {
    const reactions = Number(rawMetric.reactions || 0);
    const likes = Number(rawMetric.reactions || 0);
    const comments = Number(rawMetric.comments || 0);
    const shares = Number(rawMetric.shares || 0);
    const views = Number(rawMetric.views || 0);
    const reach = Number(rawMetric.reach || 0);
    const impressions = Number(rawMetric.impressions || 0);
    const clicks = Number(rawMetric.clicks || 0);

    const totalEngagement = reactions + comments + shares + clicks;
    let engagementRate: number | null = null;
    if (reach > 0) {
      engagementRate = (totalEngagement / reach) * 100;
    }

    return {
      snapshotKey: `${snapshotDate}:${postKey}`,
      snapshotDate,
      platform: 'zalo',
      channelId,
      postKey,
      reactions,
      likes,
      comments,
      shares,
      views,
      reach,
      impressions,
      clicks,
      totalEngagement,
      engagementRate: engagementRate !== null ? Number(engagementRate.toFixed(2)) : null,
      fetchedAt: new Date().toISOString()
    };
  }
}

/**
 * Mock Provider (for automatic testing only)
 * DO NOT enable in production UI.
 */
export class MockProvider implements SocialProvider {
  async validateCredentials(channelId: string, externalId: string): Promise<boolean> {
    return true;
  }

  async getFollowers(channelId: string, externalId: string): Promise<number> {
    return 0;
  }

  async listPosts(channelId: string, externalId: string, since?: Date, until?: Date): Promise<SocialPostRaw[]> {
    return [
      {
        id: 'mock_post_1',
        message: 'Đây là bài viết Mock số 1 - Chúc mừng năm mới!',
        created_time: new Date().toISOString(),
        permalink_url: 'https://example.com/mock1',
        post_type: 'photo'
      },
      {
        id: 'mock_post_2',
        message: 'Bài viết Mock số 2 - Ra mắt tính năng phân tích tương tác mạng xã hội',
        created_time: new Date(Date.now() - 86400000).toISOString(),
        permalink_url: 'https://example.com/mock2',
        post_type: 'video'
      }
    ];
  }

  async getPostMetrics(channelId: string, externalId: string, posts: SocialPostRaw[]): Promise<any[]> {
    return posts.map((post, index) => ({
      id: post.id,
      reactions: 10 + index * 5,
      comments: 5 + index * 2,
      shares: 2 + index,
      views: post.post_type === 'video' ? 120 : 150 + index * 80,
      reach: 100 + index * 50,
      impressions: 150 + index * 80,
      clicks: 8 + index * 3,
      metadata: {}
    }));
  }

  normalizePost(raw: SocialPostRaw, channelId: string) {
    const postKey = `facebook:${channelId}:${raw.id}`;
    return {
      postKey,
      platform: 'facebook',
      channelId,
      externalPostId: raw.id,
      postUrl: raw.permalink_url || `https://example.com/${raw.id}`,
      postType: raw.post_type || 'status',
      message: raw.message || '',
      publishedAt: raw.created_time || new Date().toISOString(),
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false,
    };
  }

  normalizeMetrics(rawMetric: any, channelId: string, postKey: string, snapshotDate: string) {
    const reactions = Number(rawMetric.reactions || 0);
    const comments = Number(rawMetric.comments || 0);
    const shares = Number(rawMetric.shares || 0);
    const clicks = Number(rawMetric.clicks || 0);
    const reach = Number(rawMetric.reach || 0);

    const totalEngagement = reactions + comments + shares + clicks;
    const engagementRate = reach > 0 ? (totalEngagement / reach) * 100 : null;

    return {
      snapshotKey: `${snapshotDate}:${postKey}`,
      snapshotDate,
      platform: 'facebook',
      channelId,
      postKey,
      reactions,
      likes: reactions,
      comments,
      shares,
      views: Number(rawMetric.views || 0),
      reach,
      impressions: Number(rawMetric.impressions || 0),
      clicks,
      totalEngagement,
      engagementRate: engagementRate !== null ? Number(engagementRate.toFixed(2)) : null,
      fetchedAt: new Date().toISOString()
    };
  }
}
