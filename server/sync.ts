import { adminDb } from './firebase';
import { SheetsService, getGoogleSheetsAuth } from './sheets';
import { FacebookProvider, ZaloOAProvider, MockProvider, SocialProvider } from './providers';
import { Channel, Post, DailySnapshot, ApiLog } from '../src/types';
import { v4 as uuidv4 } from 'uuid';

// In-memory sync locks with timestamps
const syncLocks = new Map<string, number>();

export class SyncEngine {
  private static getProvider(platform: string): SocialProvider {
    switch (platform) {
      case 'facebook':
        return new FacebookProvider();
      case 'zalo':
        return new ZaloOAProvider();
      case 'mock':
        return new MockProvider();
      default:
        throw new Error(`Nền tảng "${platform}" chưa được hỗ trợ.`);
    }
  }

  /**
   * Đồng bộ hóa dữ liệu của một Kênh cụ thể
   */
  static async syncChannel(
    channelId: string,
    googleAccessToken: string | null,
    sinceDate?: Date,
    untilDate?: Date,
    requestId: string = uuidv4()
  ): Promise<any> {
    const now = Date.now();
    const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes timeout

    if (syncLocks.has(channelId)) {
      const lockedAt = syncLocks.get(channelId) || 0;
      if (now - lockedAt < LOCK_TIMEOUT_MS) {
        throw new Error('Kênh này đang được đồng bộ hóa. Vui lòng thử lại sau.');
      } else {
        console.warn(`Lock đồng bộ của kênh ${channelId} đã bị treo quá 5 phút. Tự động giải phóng lock.`);
        syncLocks.delete(channelId);
      }
    }

    syncLocks.set(channelId, now);
    const startedAt = new Date().toISOString();

    // 1. Đọc kênh từ Firestore
    const channelRef = adminDb.collection('channels').doc(channelId);
    const channelSnap = await channelRef.get();
    if (!channelSnap.exists) {
      syncLocks.delete(channelId);
      throw new Error(`Không tìm thấy kênh ID ${channelId}`);
    }

    const channel = channelSnap.data() as Channel;
    if (channel.status === 'inactive') {
      syncLocks.delete(channelId);
      throw new Error('Kênh đã bị vô hiệu hóa.');
    }

    const provider = this.getProvider(channel.platform);
    let logId = uuidv4();
    let recordsReceived = 0;
    let recordsInserted = 0;
    let recordsUpdated = 0;
    let status: 'success' | 'failed' = 'success';
    let errorCode = '';
    let errorMessage = '';

    try {
      // 2. Gọi API nhà mạng lấy danh sách bài đăng
      const rawPosts = await provider.listPosts(channelId, channel.externalId, sinceDate, untilDate);
      recordsReceived = rawPosts.length;

      const postsToUpsert: Post[] = [];
      const snapshotsToUpsert: DailySnapshot[] = [];

      if (rawPosts.length > 0) {
        // 3. Lấy metrics cho các bài đăng nhận được
        const rawMetrics = await provider.getPostMetrics(channelId, channel.externalId, rawPosts);

        // Múi giờ Asia/Bangkok cho ngày snapshot_date
        const tzOffset = 7 * 60 * 60 * 1000; // +7 hours
        const bkkTime = new Date(Date.now() + tzOffset);
        const snapshotDate = bkkTime.toISOString().split('T')[0]; // yyyy-MM-dd

        for (let i = 0; i < rawPosts.length; i++) {
          const rawPost = rawPosts[i];
          const rawMetric = rawMetrics.find(m => m.id === rawPost.id) || { id: rawPost.id };

          const normalizedPost = provider.normalizePost(rawPost, channelId);
          const normalizedSnapshot = provider.normalizeMetrics(rawMetric, channelId, normalizedPost.postKey, snapshotDate);

          postsToUpsert.push(normalizedPost);
          snapshotsToUpsert.push(normalizedSnapshot);
        }

        // 4. Upsert vào Firestore DB
        // Firestore batch upsert bài viết
        const batch = adminDb.batch();
        for (const post of postsToUpsert) {
          const postRef = adminDb.collection('posts').doc(post.postKey);
          batch.set(postRef, post, { merge: true });
        }
        await batch.commit();

        // Firestore batch upsert snapshot ngày
        const snapBatch = adminDb.batch();
        for (const snapshot of snapshotsToUpsert) {
          const snapRef = adminDb.collection('dailySnapshots').doc(snapshot.snapshotKey);
          snapBatch.set(snapRef, snapshot, { merge: true });
        }
        await snapBatch.commit();

        // Đếm số dòng thay đổi thực tế hoặc giả lập ghi nhận
        recordsInserted = postsToUpsert.length;
        recordsUpdated = snapshotsToUpsert.length;
      }

      // 5. Cập nhật thông tin kênh
      const updatedChannelFields = {
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: 'success',
        totalPosts: (channel.totalPosts || 0) + recordsInserted
      };
      await channelRef.update(updatedChannelFields);

      // 6. Ghi dữ liệu vào Google Sheets (Nếu có token và spreadsheetId)
      let spreadsheetId = '';
      const configSnap = await adminDb.collection('systemConfig').doc('main').get();
      if (configSnap.exists) {
        spreadsheetId = configSnap.data()?.spreadsheetId || '';
      }

      const googleAuth = await getGoogleSheetsAuth(googleAccessToken);
      if (googleAuth && spreadsheetId) {
        try {
          const sheetsService = new SheetsService(googleAuth, spreadsheetId);
          
          // Tính tổng tương tác tích lũy của kênh này từ Firestore
          let totalReactions = 0;
          let totalComments = 0;
          let totalShares = 0;
          try {
            const allSnapsSnap = await adminDb.collection('dailySnapshots').where('channelId', '==', channel.id).get();
            const latestPostSnaps = new Map<string, DailySnapshot>();
            allSnapsSnap.docs.forEach(doc => {
              const s = doc.data() as DailySnapshot;
              const curr = latestPostSnaps.get(s.postKey);
              if (!curr || s.snapshotDate > curr.snapshotDate) {
                latestPostSnaps.set(s.postKey, s);
              }
            });
            // Hợp nhất với các snapshot vừa lấy được trong lần sync này
            snapshotsToUpsert.forEach(s => {
              const curr = latestPostSnaps.get(s.postKey);
              if (!curr || s.snapshotDate > curr.snapshotDate) {
                latestPostSnaps.set(s.postKey, s);
              }
            });
            latestPostSnaps.forEach(s => {
              totalReactions += s.reactions || 0;
              totalComments += s.comments || 0;
              totalShares += s.shares || 0;
            });
          } catch (err: any) {
            console.error('Lỗi tính tổng lượng tương tác của kênh cho Sheets:', err.message);
          }
          const totalEngagement = totalReactions + totalComments + totalShares;

          // Upsert Kênh MXH dòng hiện tại
          const channelRow = {
            channel_id: channel.id,
            platform: channel.platform,
            channel_name: channel.name,
            external_id: channel.externalId,
            channel_url: channel.platform === 'facebook' ? `https://facebook.com/${channel.externalId}` : `https://oa.zalo.me/${channel.externalId}`,
            status: channel.status,
            timezone: channel.timezone || 'Asia/Bangkok',
            created_at: channel.createdAt,
            updated_at: new Date().toISOString(),
            last_sync_at: updatedChannelFields.lastSyncAt,
            last_sync_status: updatedChannelFields.lastSyncStatus,
            total_posts: updatedChannelFields.totalPosts,
            reactions: totalReactions,
            comments: totalComments,
            shares: totalShares,
            total_engagement: totalEngagement
          };
          await sheetsService.upsertRecords('KENH_MXH', 'channel_id', [channelRow]);

          // Upsert Bài viết
          if (postsToUpsert.length > 0) {
            const sheetPosts = postsToUpsert.map(p => {
              const snap = snapshotsToUpsert.find(s => s.postKey === p.postKey);
              return {
                post_key: p.postKey,
                platform: p.platform,
                channel_id: p.channelId,
                external_post_id: p.externalPostId,
                post_url: p.postUrl,
                post_type: p.postType,
                message: p.message,
                published_at: p.publishedAt,
                imported_at: p.importedAt,
                updated_at: p.updatedAt,
                is_deleted: p.isDeleted,
                reactions: snap?.reactions || 0,
                likes: snap?.likes || 0,
                comments: snap?.comments || 0,
                shares: snap?.shares || 0,
                views: snap?.views || 0,
                reach: snap?.reach || 0,
                total_engagement: snap?.totalEngagement || 0,
                engagement_rate: snap?.engagementRate || 0
              };
            });
            await sheetsService.upsertRecords('BAI_DANG', 'post_key', sheetPosts);
          }

          // Upsert snapshot dữ liệu ngày
          if (snapshotsToUpsert.length > 0) {
            const sheetSnapshots = snapshotsToUpsert.map(s => ({
              snapshot_key: s.snapshotKey,
              snapshot_date: s.snapshotDate,
              platform: s.platform,
              channel_id: s.channelId,
              post_key: s.postKey,
              reactions: s.reactions,
              likes: s.likes,
              comments: s.comments,
              shares: s.shares,
              views: s.views,
              reach: s.reach,
              impressions: s.impressions,
              clicks: s.clicks,
              total_engagement: s.totalEngagement,
              engagement_rate: s.engagementRate,
              fetched_at: s.fetchedAt
            }));
            await sheetsService.upsertRecords('DU_LIEU_NGAY', 'snapshot_key', sheetSnapshots);
          }
        } catch (sheetError: any) {
          console.error('Lỗi khi đồng bộ Google Sheets:', sheetError.message);
          // Không quăng lỗi ra ngoài làm hỏng toàn bộ luồng đồng bộ API chính
        }
      }

    } catch (error: any) {
      status = 'failed';
      errorCode = error.code || 'SYNC_ERROR';
      errorMessage = error.message || 'Lỗi đồng bộ hóa chưa xác định';
      console.error(`Lỗi đồng bộ hóa kênh ${channelId}:`, error);

      // Cập nhật trạng thái lỗi cho Kênh
      await channelRef.update({
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: 'failed'
      }).catch(console.error);

    } finally {
      const endedAt = new Date().toISOString();
      const apiLog: ApiLog = {
        logId,
        startedAt,
        endedAt,
        platform: channel.platform,
        action: 'sync',
        channelId,
        status: status === 'success' ? 'success' : 'failed',
        recordsReceived,
        recordsInserted,
        recordsUpdated,
        errorCode,
        errorMessage,
        requestId
      };

      // Lưu Log vào Firestore
      await adminDb.collection('apiLogs').doc(logId).set(apiLog).catch(console.error);

      // Ghi log vào Google Sheets nếu có thể
      const googleAuthLog = await getGoogleSheetsAuth(googleAccessToken);
      if (googleAuthLog) {
        try {
          const configSnap = await adminDb.collection('systemConfig').doc('main').get();
          const spreadsheetId = configSnap.data()?.spreadsheetId;
          if (spreadsheetId) {
            const sheetsService = new SheetsService(googleAuthLog, spreadsheetId);
            await sheetsService.upsertRecords('NHAT_KY_API', 'log_id', [{
              log_id: apiLog.logId,
              started_at: apiLog.startedAt,
              ended_at: apiLog.endedAt,
              platform: apiLog.platform,
              action: apiLog.action,
              channel_id: apiLog.channelId,
              status: apiLog.status,
              records_received: apiLog.recordsReceived,
              records_inserted: apiLog.recordsInserted,
              records_updated: apiLog.recordsUpdated,
              error_code: apiLog.errorCode || '',
              error_message: apiLog.errorMessage || '',
              request_id: apiLog.requestId
            }]);
          }
        } catch (e: any) {
          console.error('Không thể ghi nhật ký API vào Google Sheet:', e.message);
        }
      }

      syncLocks.delete(channelId);
    }

    if (status === 'failed') {
      throw new Error(errorMessage);
    }

    return {
      success: true,
      recordsReceived,
      recordsInserted,
      recordsUpdated,
    };
  }

  /**
   * Đồng bộ hóa tất cả các kênh đang hoạt động
   */
  static async syncAllChannels(googleAccessToken: string | null, requestId: string = uuidv4()): Promise<any> {
    const channelsSnap = await adminDb.collection('channels').where('status', '==', 'active').get();
    const results: any[] = [];
    
    for (const doc of channelsSnap.docs) {
      const channelId = doc.id;
      try {
        const res = await this.syncChannel(channelId, googleAccessToken, undefined, undefined, requestId);
        results.push({ channelId, success: true, ...res });
      } catch (e: any) {
        results.push({ channelId, success: false, error: e.message });
      }
    }
    return results;
  }
}
