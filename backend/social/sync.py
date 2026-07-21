import uuid
from django.utils import timezone
from .models import Channel, Post, DailySnapshot, FollowerSnapshot, ApiLog
from .providers import FacebookProvider, ZaloOAProvider, MockProvider

class SyncEngine:
    @staticmethod
    def get_provider(platform):
        platform = platform.lower()
        if platform == 'facebook':
            return FacebookProvider()
        elif platform == 'zalo':
            return ZaloOAProvider()
        else:
            return MockProvider()

    @classmethod
    def sync_channel(cls, channel_id, request_id=None):
        if not request_id:
            request_id = f"req_{uuid.uuid4().hex[:10]}"
            
        started_at = timezone.now()
        log_id = f"sync_{int(started_at.timestamp() * 1000)}_{uuid.uuid4().hex[:5]}"
        
        try:
            channel = Channel.objects.get(id=channel_id)
        except Channel.DoesNotExist:
            ApiLog.objects.create(
                log_id=log_id,
                started_at=started_at,
                ended_at=timezone.now(),
                platform='unknown',
                action='sync_channel',
                channel_id=channel_id,
                status='failed',
                error_code='CHANNEL_NOT_FOUND',
                error_message='Channel not found',
                request_id=request_id
            )
            return False, "Không tìm thấy kênh"

        api_log = ApiLog.objects.create(
            log_id=log_id,
            started_at=started_at,
            platform=channel.platform,
            action='sync_channel',
            channel_id=channel_id,
            status='running',
            request_id=request_id
        )

        try:
            provider = cls.get_provider(channel.platform)
            
            # 1. Fetch followers
            followers = provider.get_followers(channel.id, channel.external_id)
            snapshot_date = timezone.now().strftime('%Y-%m-%d')
            
            # Save FollowerSnapshot
            FollowerSnapshot.objects.update_or_create(
                snapshot_key=f"{snapshot_date}:{channel.id}",
                defaults={
                    'snapshot_date': snapshot_date,
                    'channel_id': channel.id,
                    'channel_name': channel.name,
                    'followers_count': followers,
                    'fetched_at': timezone.now()
                }
            )

            # 2. Fetch posts
            raw_posts = provider.list_posts(channel.id, channel.external_id)
            api_log.records_received = len(raw_posts)
            
            inserted = 0
            updated = 0
            
            if raw_posts:
                # Get metrics
                metrics = provider.get_post_metrics(channel.id, channel.external_id, raw_posts)
                metrics_map = {m['id']: m for m in metrics}
                
                for rp in raw_posts:
                    post_data = provider.normalize_post(rp, channel.id)
                    post_key = post_data['post_key']
                    
                    # Save post
                    post_obj, created = Post.objects.update_or_create(
                        post_key=post_key,
                        defaults={
                            'platform': post_data['platform'],
                            'channel_id': post_data['channel_id'],
                            'external_post_id': post_data['external_post_id'],
                            'post_url': post_data['post_url'],
                            'image_url': post_data.get('image_url'),
                            'post_type': post_data['post_type'],
                            'message': post_data.get('message'),
                            'published_at': post_data['published_at'],
                            'imported_at': post_data['imported_at'],
                            'updated_at': post_data['updated_at'],
                            'is_deleted': post_data['is_deleted'],
                        }
                    )
                    
                    if created:
                        inserted += 1
                    else:
                        updated += 1
                        
                    # Save metrics
                    raw_metric = metrics_map.get(rp['id'], {})
                    metric_data = provider.normalize_metrics(raw_metric, channel.id, post_key, snapshot_date)
                    
                    DailySnapshot.objects.update_or_create(
                        snapshot_key=metric_data['snapshot_key'],
                        defaults={
                            'snapshot_date': metric_data['snapshot_date'],
                            'platform': metric_data['platform'],
                            'channel_id': metric_data['channel_id'],
                            'post_key': metric_data['post_key'],
                            'reactions': metric_data['reactions'],
                            'likes': metric_data['likes'],
                            'comments': metric_data['comments'],
                            'shares': metric_data['shares'],
                            'views': metric_data['views'],
                            'reach': metric_data['reach'],
                            'impressions': metric_data['impressions'],
                            'clicks': metric_data['clicks'],
                            'total_engagement': metric_data['total_engagement'],
                            'engagement_rate': metric_data['engagement_rate'],
                            'fetched_at': metric_data['fetched_at'],
                        }
                    )

            # Update channel
            channel.followers_count = followers
            channel.last_sync_at = timezone.now()
            channel.last_sync_status = 'success'
            channel.save()
            
            # Update log
            api_log.status = 'success'
            api_log.records_inserted = inserted
            api_log.records_updated = updated
            api_log.ended_at = timezone.now()
            api_log.save()
            
            return True, f"Thành công: thêm mới {inserted}, cập nhật {updated}"
            
        except Exception as e:
            # Update channel status
            channel.last_sync_status = 'failed'
            channel.save()
            
            # Log failure
            api_log.status = 'failed'
            api_log.error_code = 'SYNC_ERROR'
            api_log.error_message = str(e)
            api_log.ended_at = timezone.now()
            api_log.save()
            return False, f"Lỗi đồng bộ: {str(e)}"
