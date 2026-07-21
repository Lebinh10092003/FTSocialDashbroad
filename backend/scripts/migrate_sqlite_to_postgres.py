import os
import sys
import json
import sqlite3
from datetime import datetime
import django

# Add backend directory to python path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ft_backend.settings')
django.setup()

from authentication.models import UserProfile, UserLogin, SystemConfig
from examination.models import Competition, ExamSession, Candidate, LogNote, ExaminationSheet
from django.utils.dateparse import parse_datetime
from django.utils import timezone

def clean_datetime(dt_str):
    if not dt_str:
        return None
    try:
        dt = parse_datetime(dt_str)
        if dt:
            if timezone.is_naive(dt):
                return timezone.make_aware(dt)
            return dt
    except Exception:
        pass
    
    # Try parsing other common formats
    for fmt in ('%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%d %H:%M:%S'):
        try:
            dt = datetime.strptime(dt_str, fmt)
            return timezone.make_aware(dt)
        except Exception:
            continue
    return None

def migrate():
    # Path to SQLite
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    db_path = os.path.join(project_root, 'server', 'data', 'app.db')
    
    if not os.path.exists(db_path):
        print(f"SQLite file not found at: {db_path}")
        return
        
    print(f"Connecting to SQLite database: {db_path}")
    sqlite_conn = sqlite3.connect(db_path)
    cursor = sqlite_conn.cursor()
    
    try:
        cursor.execute("SELECT collection_name, doc_id, data FROM collections")
        rows = cursor.fetchall()
        print(f"Found {len(rows)} rows to migrate.")
    except Exception as e:
        print("Error reading from SQLite:", e)
        return
        
    stats = {}
    
    for collection_name, doc_id, data_str in rows:
        try:
            data = json.loads(data_str)
        except Exception as e:
            print(f"Error parsing JSON for {collection_name}/{doc_id}: {e}")
            continue
            
        stats[collection_name] = stats.get(collection_name, 0) + 1
        
        if collection_name == 'users':
            email = data.get('email') or doc_id
            name = data.get('name') or data.get('displayName') or email.split('@')[0]
            role = data.get('role', 'EMPLOYEE')
            photo_url = data.get('photoURL') or data.get('picture') or ''
            last_login = clean_datetime(data.get('lastLogin') or data.get('updatedAt'))
            
            UserProfile.objects.update_or_create(
                email=email,
                defaults={
                    'name': name,
                    'role': role,
                    'photo_url': photo_url,
                    'last_login': last_login
                }
            )
            
        elif collection_name == 'userLogins':
            login_at = clean_datetime(data.get('loginAt') or data.get('timestamp') or datetime.now().isoformat())
            UserLogin.objects.update_or_create(
                id=doc_id,
                defaults={
                    'email': data.get('email') or 'unknown',
                    'name': data.get('name') or '',
                    'role': data.get('role', 'EMPLOYEE'),
                    'login_at': login_at,
                    'user_agent': data.get('userAgent') or '',
                    'ip': data.get('ip') or ''
                }
            )
            
        elif collection_name == 'systemConfig':
            admin_emails = data.get('adminEmails') or ''
            last_token = data.get('lastGoogleAccessToken') or ''
            last_token_time = clean_datetime(data.get('lastGoogleAccessTokenTime'))
            
            SystemConfig.objects.update_or_create(
                key=doc_id,
                defaults={
                    'admin_emails': admin_emails,
                    'last_google_access_token': last_token,
                    'last_google_access_token_time': last_token_time,
                    'data': data
                }
            )
            
        elif collection_name == 'examinationCandidates':
            session_ids = data.get('sessionIds') or []
            if isinstance(session_ids, str):
                try:
                    session_ids = json.loads(session_ids)
                except Exception:
                    session_ids = [s.strip() for s in session_ids.split(',') if s.strip()]
            
            Candidate.objects.update_or_create(
                id=doc_id,
                defaults={
                    'code': data.get('code') or doc_id,
                    'name': data.get('name') or '',
                    'school': data.get('school') or '',
                    'class_name': data.get('className') or '',
                    'city': data.get('city') or '',
                    'contests': data.get('contests') or '',
                    'achievement': data.get('achievement') or '',
                    'email': data.get('email') or '',
                    'parent': data.get('parent') or '',
                    'phone': data.get('phone') or '',
                    'identity': data.get('identity') or '',
                    'address': data.get('address') or '',
                    'birth_date': data.get('birthDate') or '',
                    'session_ids': session_ids,
                    'sort_key': data.get('sortKey') or doc_id,
                    'updated': data.get('updated') or ''
                }
            )
            
        elif collection_name == 'examinationCompetitions':
            Competition.objects.update_or_create(
                id=doc_id,
                defaults={
                    'code': data.get('code') or '',
                    'name': data.get('name') or '',
                    'parent': data.get('parent') or '',
                    'organizer': data.get('organizer') or '',
                    'sort_key': data.get('sortKey') or '',
                    'created_by': data.get('createdBy') or ''
                }
            )
            
        elif collection_name == 'examinationSessions':
            rounds = data.get('rounds') or []
            if isinstance(rounds, str):
                try:
                    rounds = json.loads(rounds)
                except Exception:
                    rounds = []
                    
            ExamSession.objects.update_or_create(
                id=doc_id,
                defaults={
                    'competition_id': data.get('competitionId') or '',
                    'code': data.get('code') or '',
                    'name': data.get('name') or '',
                    'parent': data.get('parent') or '',
                    'organizer': data.get('organizer') or '',
                    'time': data.get('time') or '',
                    'candidates_count': int(data.get('candidates') or 0),
                    'national': data.get('national') or '',
                    'national_date': data.get('nationalDate') or '',
                    'international': data.get('international') or '',
                    'international_date': data.get('internationalDate') or '',
                    'phase': data.get('phase', 'Chuẩn bị'),
                    'note': data.get('note') or '',
                    'rounds': rounds,
                    'sort_key': data.get('sortKey') or '',
                    'created_by': data.get('createdBy') or ''
                }
            )
            
        elif collection_name == 'examinationSheets':
            created_at = clean_datetime(data.get('createdAt') or datetime.now().isoformat())
            updated_at = clean_datetime(data.get('updatedAt') or datetime.now().isoformat())
            
            ExaminationSheet.objects.update_or_create(
                id=doc_id,
                defaults={
                    'name': data.get('name') or '',
                    'url': data.get('url') or '',
                    'status': data.get('status', 'idle'),
                    'created_at': created_at,
                    'updated_at': updated_at,
                    'created_by': data.get('createdBy') or ''
                }
            )
            
    sqlite_conn.close()
    print("Migration finished. Summary:")
    for col, count in stats.items():
        print(f" - {col}: {count} items imported.")

if __name__ == '__main__':
    migrate()
