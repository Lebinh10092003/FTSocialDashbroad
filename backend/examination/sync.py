import io
import csv
import re
import requests
import datetime
import uuid
from django.utils import timezone
from .models import Candidate, ExamSession, Competition, ExaminationSheet
from authentication.models import SystemConfig

DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1kqztN_iCeZ9uR1mO7gz9j1TcUt8ZmCdpEv0TagTf4VA/edit?usp=sharing'

def clean_txt(value):
    if value is None:
        return ''
    return str(value).strip()

def normalise_str(value):
    val = clean_txt(value).lower()
    # Remove accents using a basic mapping or regex for Vietnamese
    char_map = {
        'à':'a','á':'a','ả':'a','ã':'a','ạ':'a','ă':'a','ằ':'a','ắ':'a','ẳ':'a','ẵ':'a','ặ':'a','â':'a','ầ':'a','ấ':'a','ẩ':'a','ẫ':'a','ậ':'a',
        'è':'e','é':'e','ẻ':'e','ẽ':'e','ẹ':'e','ê':'e','ề':'e','ế':'e','ể':'e','ễ':'e','ệ':'e',
        'ì':'i','í':'i','ỉ':'i','ĩ':'i','ị':'i',
        'ò':'o','ó':'o','ỏ':'o','õ':'o','ọ':'o','ô':'o','ồ':'o','ố':'o','ổ':'o','ỗ':'o','ộ':'o','ơ':'o','ờ':'o','ớ':'o','ở':'o','ỡ':'o','ợ':'o',
        'ù':'u','ú':'u','ủ':'u','ũ':'u','ụ':'u','ư':'u','ừ':'u','ứ':'u','ử':'u','ữ':'u','ự':'u',
        'ỳ':'y','ý':'y','ỷ':'y','ỹ':'y','ỵ':'y',
        'đ':'d',
    }
    for k, v in char_map.items():
        val = val.replace(k, v)
    # Remove non-alphanumeric
    val = re.sub(r'[^a-z0-9]', '', val)
    return val

def get_contest_codes(value):
    val = clean_txt(value)
    if not val:
        return []
    parts = re.split(r'[,;]', val)
    return [p.strip().upper() for p in parts if p.strip()]

def merge_contest_codes(*values):
    codes = []
    for v in values:
        codes.extend(get_contest_codes(v))
    # Remove duplicates preserving order
    seen = set()
    result = []
    for c in codes:
        if c not in seen:
            seen.add(c)
            result.append(c)
    return ', '.join(result)

def same_candidate(a, b):
    # Match by CCCD if both present
    id_a = normalise_str(a.get('identity'))
    id_b = normalise_str(b.get('identity'))
    if id_a and id_b:
        return id_a == id_b
    
    # Fallback: match by name, dob, identity, email
    for field in ['name', 'birth_date', 'identity', 'email']:
        val_a = normalise_str(a.get(field))
        val_b = normalise_str(b.get(field))
        if not val_a or val_a != val_b:
            return False
    return True

def next_code(existing_codes_set, offset):
    yr = datetime.datetime.now().strftime('%y')
    seq = offset + 1
    candidate = f"FT{yr}-{seq:04d}"
    while candidate in existing_codes_set:
        seq += 1
        candidate = f"FT{yr}-{seq:04d}"
    return candidate

def parse_dob(raw):
    cleaned = clean_txt(raw).replace(' ', '')
    cleaned = re.sub(r'[^0-9/\-.]', '', cleaned)
    parts = re.split(r'[/\-.]', cleaned)
    if len(parts) != 3:
        return ''
        
    day = ''
    month = ''
    year = ''
    
    if len(parts[2]) == 4:
        day = parts[0].zfill(2)
        month = parts[1].zfill(2)
        year = parts[2]
    elif len(parts[0]) == 4:
        year = parts[0]
        month = parts[1].zfill(2)
        day = parts[2].zfill(2)
    else:
        return ''
        
    try:
        d, m, y = int(day), int(month), int(year)
        if d < 1 or d > 31 or m < 1 or m > 12 or y < 1990 or y > 2025:
            return ''
        return f"{year}-{month}-{day}"
    except ValueError:
        return ''

def resolve_column_indices(header):
    n = lambda h: normalise_str(h)
    idx = {}
    
    for i, h in enumerate(header):
        nh = n(h)
        if 'timestamp' not in idx and ('thoigian' in nh or 'timestamp' in nh):
            idx['timestamp'] = i
        elif 'stt' not in idx and (nh == 'stt' or nh.startswith('sott') or nh.startswith('sôtt')):
            idx['stt'] = i
        elif 'name' not in idx and ('hovantenthisinh' in nh or 'hovaten' in nh or 'thisinh' in nh or 'ten' in nh):
            idx['name'] = i
        elif 'amount' not in idx and ('tien' in nh or 'sotiendanop' in nh or 'lephi' in nh):
            idx['amount'] = i
        elif 'invoice' not in idx and ('hoadon' in nh or 'hoadien' in nh):
            idx['invoice'] = i
        elif 'contests' not in idx and ('kythidangky' in nh or 'dangkythi' in nh or 'monthi' in nh or 'dangthi' in nh or 'contest' in nh or 'kythi' in nh):
            idx['contests'] = i
        elif 'className' not in idx and ('hocsinhlop' in nh or ('lop' in nh and 'khoi' not in nh)):
            idx['className'] = i
        elif 'dob' not in idx and ('ngaythangnamsinh' in nh or 'namsinh' in nh or 'ngaysinh' in nh or 'dob' in nh or 'birthday' in nh):
            idx['dob'] = i
        elif 'grade' not in idx and ('khoithi' in nh or 'khoi' in nh):
            idx['grade'] = i
        elif 'school' not in idx and ('truong' in nh and 'email' not in nh):
            idx['school'] = i
        elif 'cccd' not in idx and ('cccd' in nh or 'canchuan' in nh or 'dinhdanh' in nh or 'identity' in nh or 'cmnd' in nh):
            idx['cccd'] = i
        elif 'streetAddress' not in idx and ('diachinh' in nh or 'diachinharieng' in nh or ('diachi' in nh and len(nh) < 15)):
            idx['streetAddress'] = i
        elif 'ward' not in idx and ('xa' in nh or 'phuong' in nh):
            idx['ward'] = i
        elif 'city' not in idx and ('tinhthanhpho' in nh or 'tinh' in nh or 'thanhpho' in nh or 'city' in nh):
            idx['city'] = i
        elif 'fullAddress' not in idx and (nh == 'diachi' or 'diachidaydu' in nh or 'address' in nh):
            idx['fullAddress'] = i
        elif 'email' not in idx and 'email' in nh:
            idx['email'] = i
        elif 'emailStatus' not in idx and ('tinhtranggui' in nh or 'guiemail' in nh):
            idx['emailStatus'] = i
        elif 'phone' not in idx and ('dienthoai' in nh or 'sdt' in nh or 'phone' in nh or 'giamho' in nh):
            idx['phone'] = i
        elif 'paymentStatus' not in idx and ('chuyenkhoan' in nh or 'noplephi' in nh or 'tinhtrangnop' in nh or 'thanhtoan' in nh):
            idx['paymentStatus'] = i
        elif 'note' not in idx and ('ghichu' in nh or 'suco' in nh or 'note' in nh):
            idx['note'] = i

    is_am_format = len(header) <= 15 or idx.get('contests') == 12
    
    if is_am_format:
        if 'timestamp' not in idx: idx['timestamp'] = 0
        if 'name' not in idx: idx['name'] = 1
        if 'dob' not in idx: idx['dob'] = 2
        if 'className' not in idx: idx['className'] = 3
        if 'school' not in idx: idx['school'] = 4
        if 'city' not in idx: idx['city'] = 5
        if 'phone' not in idx: idx['phone'] = 6
        if 'email' not in idx: idx['email'] = 7
        if 'cccd' not in idx: idx['cccd'] = 8
        if 'fullAddress' not in idx: idx['fullAddress'] = 9
        if 'paymentStatus' not in idx: idx['paymentStatus'] = 10
        if 'note' not in idx: idx['note'] = 11
        if 'contests' not in idx: idx['contests'] = 12
    else:
        if 'timestamp' not in idx: idx['timestamp'] = 0
        if 'stt' not in idx: idx['stt'] = 1
        if 'name' not in idx: idx['name'] = 2
        if 'amount' not in idx: idx['amount'] = 3
        if 'invoice' not in idx: idx['invoice'] = 4
        if 'contests' not in idx: idx['contests'] = 5
        if 'className' not in idx: idx['className'] = 6
        if 'dob' not in idx: idx['dob'] = 7
        if 'grade' not in idx: idx['grade'] = 8
        if 'school' not in idx: idx['school'] = 9
        if 'cccd' not in idx: idx['cccd'] = 10
        if 'streetAddress' not in idx: idx['streetAddress'] = 11
        if 'ward' not in idx: idx['ward'] = 12
        if 'city' not in idx: idx['city'] = 13
        if 'fullAddress' not in idx: idx['fullAddress'] = 14
        if 'email' not in idx: idx['email'] = 15
        if 'emailStatus' not in idx: idx['emailStatus'] = 16
        if 'phone' not in idx: idx['phone'] = 17
        if 'paymentStatus' not in idx: idx['paymentStatus'] = 18
        if 'note' not in idx: idx['note'] = 19
        
    return idx

def sync_session_candidate_totals():
    sessions = ExamSession.objects.all()
    candidates = Candidate.objects.all()
    
    totals = {}
    sessions_by_code = {}
    
    for s in sessions:
        code = clean_txt(s.code).upper()
        if code:
            if code not in sessions_by_code:
                sessions_by_code[code] = []
            sessions_by_code[code].append(s.id)
            
    for c in candidates:
        session_ids = c.session_ids or []
        linked = []
        if session_ids:
            linked = session_ids
        else:
            for code in get_contest_codes(c.contests):
                linked.extend(sessions_by_code.get(code, []))
                
        for s_id in set(linked):
            totals[s_id] = totals.get(s_id, 0) + 1
            
    for s in sessions:
        s.candidates_count = totals.get(s.id, 0)
        s.save()

def get_google_sheet_csv_urls(spreadsheet_url):
    urls = []
    if '/d/e/' in spreadsheet_url:
        pub_url = spreadsheet_url
        if pub_url.endswith('/pubhtml') or pub_url.endswith('/pub'):
            pub_url = re.sub(r'/pub(html)?$', '/pub?output=csv', pub_url)
        elif 'output=csv' not in pub_url:
            pub_url = pub_url.split('?')[0] + '/pub?output=csv'
        urls.append(pub_url)
        
    sheet_id = ''
    id_match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', spreadsheet_url)
    if not id_match:
        id_match = re.search(r'[?&]id=([a-zA-Z0-9-_]+)', spreadsheet_url)
    if id_match:
        sheet_id = id_match.group(1)
        
    if sheet_id and sheet_id != 'e':
        gid_match = re.search(r'[?&#]gid=([0-9]+)', spreadsheet_url)
        gid_param = f"&gid={gid_match.group(1)}" if gid_match else ''
        
        urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv{gid_param}")
        urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv{gid_param}")
        urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/pub?output=csv{gid_param}")
        
    if not urls and (spreadsheet_url.startswith('http://') or spreadsheet_url.startswith('https://')):
        urls.append(spreadsheet_url)
        
    return urls

def sync_single_sheet(spreadsheet_url, ts_vn, sheet_doc_id=None):
    def update_state(data):
        if sheet_doc_id:
            try:
                sheet = ExaminationSheet.objects.get(id=sheet_doc_id)
                sheet.status = data.get('status', sheet.status)
                if 'error' in data:
                    pass  # ExaminationSheet has no note field
                sheet.updated_at = timezone.now()
                sheet.save()
            except Exception:
                pass

    try:
        candidate_urls = get_google_sheet_csv_urls(spreadsheet_url)
        if not candidate_urls:
            raise Exception('Đường dẫn Google Sheets không hợp lệ.')
            
        raw = ''
        last_error = None
        
        for csv_url in candidate_urls:
            print(f"[ExamSync] Downloading CSV: {csv_url}")
            try:
                res = requests.get(csv_url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                }, timeout=15)
                
                if res.status_code in [401, 403]:
                    raise Exception('Sheet chưa mở quyền truy cập công khai. Vui lòng chia sẻ công khai.')
                res.raise_for_status()
                
                trimmed = res.text.strip()
                if 'accounts.google.com' in res.url or 'ServiceLogin' in res.url or trimmed.startswith('<!DOCTYPE html') or trimmed.startswith('<html'):
                    raise Exception('Sheet yêu cầu đăng nhập Google (Chưa mở quyền công khai).')
                if not trimmed:
                    raise Exception('Google Sheets trả về nội dung trống.')
                    
                raw = res.text
                last_error = None
                break
            except Exception as err:
                last_error = err
                if 'quyền truy cập' in str(err) or 'đăng nhập' in str(err):
                    break
                    
        if not raw and last_error:
            raise last_error
            
        # Parse CSV
        f = io.StringIO(raw)
        reader = csv.reader(f)
        grid = list(reader)
        
        if len(grid) < 2:
            raise Exception('Không tìm thấy dữ liệu trong tệp (cần ít nhất 1 dòng tiêu đề + 1 dòng dữ liệu).')
            
        header_row = grid[0]
        col = resolve_column_indices(header_row)
        
        incoming = []
        for ri in range(1, len(grid)):
            row = grid[ri]
            if not row or len(row) <= max(col.values()):
                continue
                
            name = clean_txt(row[col['name']])
            if not name:
                continue
                
            raw_dob = clean_txt(row[col['dob']])
            birth_date = parse_dob(raw_dob)
            
            raw_contests = clean_txt(row[col['contests']])
            contests = ', '.join(get_contest_codes(raw_contests))
            
            identity = re.sub(r'\D', '', clean_txt(row[col['cccd']]))
            
            street = clean_txt(row[col.get('streetAddress', -1)]) if col.get('streetAddress', -1) >= 0 else ''
            ward = clean_txt(row[col.get('ward', -1)]) if col.get('ward', -1) >= 0 else ''
            city = clean_txt(row[col.get('city', -1)]) if col.get('city', -1) >= 0 else ''
            full = clean_txt(row[col.get('fullAddress', -1)]) if col.get('fullAddress', -1) >= 0 else ''
            address = full or ', '.join(filter(None, [street, ward, city]))
            
            amount = clean_txt(row[col.get('amount', -1)]) if col.get('amount', -1) >= 0 else ''
            invoice = clean_txt(row[col.get('invoice', -1)]) if col.get('invoice', -1) >= 0 else ''
            payment_status = clean_txt(row[col.get('paymentStatus', -1)]) if col.get('paymentStatus', -1) >= 0 else ''
            note = clean_txt(row[col.get('note', -1)]) if col.get('note', -1) >= 0 else ''
            
            achievement_parts = []
            if amount:
                achievement_parts.append(f"Lệ phí: {amount}")
            if payment_status and payment_status != '—':
                achievement_parts.append(payment_status)
            if invoice and invoice != 'x':
                achievement_parts.append(f"HĐ: {invoice}")
            achievement = ' | '.join(achievement_parts) or 'Đã nộp phí'
            
            email = clean_txt(row[col['email']])
            phone = re.sub(r'[^\d+]', '', clean_txt(row[col['phone']]))
            
            cand = {
                'name': name,
                'birth_date': birth_date,
                'identity': identity,
                'email': email,
                'phone': phone,
                'school': clean_txt(row[col['school']]),
                'class_name': clean_txt(row[col['className']]),
                'city': city,
                'address': address,
                'contests': contests,
                'achievement': achievement,
                'note': note,
                'parent': f"SĐT: {clean_txt(row[col['phone']])}" if phone else '',
                'updated': ts_vn
            }
            incoming.append(cand)
            
        if not incoming:
            update_state({'status': 'success', 'error': None})
            return {
                'success': True,
                'message': 'Không có hồ sơ hợp lệ nào trong tệp.',
                'created': 0,
                'updated': 0,
                'total': 0,
                'timestamp': ts_vn
            }
            
        # Perform Sync
        existing = list(Candidate.objects.all())
        existing_codes_set = {c.code for c in existing}
        
        created = 0
        updated = 0
        
        for i, cand in enumerate(incoming):
            # Match
            matched = None
            for e in existing:
                e_dict = {
                    'name': e.name,
                    'birth_date': e.birth_date,
                    'identity': e.identity,
                    'email': e.email
                }
                if same_candidate(e_dict, cand):
                    matched = e
                    break
                    
            if matched:
                matched.name = cand['name']
                if cand['birth_date']:
                    matched.birth_date = cand['birth_date']
                if cand['identity']:
                    matched.identity = cand['identity']
                if cand['email']:
                    matched.email = cand['email']
                if cand['phone']:
                    matched.phone = cand['phone']
                    matched.parent = cand['parent']
                if cand['school']:
                    matched.school = cand['school']
                if cand['class_name']:
                    matched.class_name = cand['class_name']
                if cand['city']:
                    matched.city = cand['city']
                if cand['address']:
                    matched.address = cand['address']
                # note is parsed but not stored on Candidate model
                    
                matched.contests = merge_contest_codes(matched.contests, cand['contests'])
                matched.updated = ts_vn
                matched.sort_key = f"{matched.name.lower()}_{matched.identity or matched.id}"
                matched.save()
                updated += 1
            else:
                code = next_code(existing_codes_set, len(existing) + i)
                c_id = code
                new_cand = Candidate.objects.create(
                    id=c_id,
                    code=code,
                    name=cand['name'],
                    birth_date=cand['birth_date'],
                    identity=cand['identity'],
                    email=cand['email'],
                    phone=cand['phone'],
                    school=cand['school'],
                    class_name=cand['class_name'],
                    city=cand['city'],
                    address=cand['address'],
                    contests=cand['contests'],
                    achievement=cand['achievement'],
                    # note is not a Candidate model field
                    parent=cand['parent'],
                    updated=ts_vn,
                    sort_key=f"{cand['name'].lower()}_{cand['identity'] or c_id}"
                )
                existing.append(new_cand)
                existing_codes_set.add(code)
                created += 1
                
        sync_session_candidate_totals()
        update_state({'status': 'success', 'error': None})
        
        return {
            'success': True,
            'message': f"Đồng bộ thành công – Thêm mới: {created}, Cập nhật: {updated}, Tổng: {len(incoming)}",
            'created': created,
            'updated': updated,
            'total': len(incoming),
            'timestamp': ts_vn
        }
    except Exception as e:
        msg = str(e)
        print(f"[ExamSync] Sync Error: {msg}")
        update_state({'status': 'failed', 'error': msg})
        return {
            'success': False,
            'message': f"Lỗi: {msg}",
            'created': 0,
            'updated': 0,
            'total': 0,
            'timestamp': ts_vn
        }

def sync_examination_from_google_sheet(spreadsheet_url=None):
    ts_vn = datetime.datetime.now().strftime('%d/%m/%Y %H:%M:%S')
    
    # helper to update system config state
    def update_global_state(data):
        try:
            config, _ = SystemConfig.objects.get_or_create(key='examination_sync_state')
            current = config.data or {}
            current.update(data)
            config.data = current
            config.save()
        except Exception:
            pass

    if spreadsheet_url:
        result = sync_single_sheet(spreadsheet_url, ts_vn)
        update_global_state({
            'status': 'success' if result['success'] else 'failed',
            'lastSyncDate': ts_vn.split(' ')[0],
            'lastSyncTime': ts_vn,
            'lastSheetUrl': spreadsheet_url,
            'created': result['created'],
            'updated': result['updated'],
            'total': result['total'],
            'message': result['message'],
            'error': None if result['success'] else result['message']
        })
        return result
        
    # Else sync all configured sheets
    try:
        sheets = list(ExaminationSheet.objects.all())
        if not sheets:
            # Seed default sheet
            default_sheet = ExaminationSheet.objects.create(
                id=f"sheet-{uuid.uuid4().hex[:10]}",
                name='Google Sheets Khảo thí FT (Mặc định)',
                url=DEFAULT_SHEET_URL,
                status='idle'
            )
            sheets = [default_sheet]
            
        total_created = 0
        total_updated = 0
        total_candidates = 0
        success_count = 0
        error_messages = []
        
        for sheet in sheets:
            sheet.status = 'running'
            sheet.save()
            
            res = sync_single_sheet(sheet.url, ts_vn, sheet.id)
            if res['success']:
                total_created += res['created']
                total_updated += res['updated']
                total_candidates += res['total']
                success_count += 1
            else:
                error_messages.append(f"{sheet.name}: {res['message']}")
                
        status_text = f"Đã đồng bộ {success_count}/{len(sheets)} nguồn dữ liệu. (Tổng thêm mới: {total_created}, Cập nhật: {total_updated})"
        status = 'failed' if len(error_messages) == len(sheets) else 'success'
        
        update_global_state({
            'status': status,
            'lastSyncDate': ts_vn.split(' ')[0],
            'lastSyncTime': ts_vn,
            'created': total_created,
            'updated': total_updated,
            'total': total_candidates,
            'message': status_text,
            'error': '; '.join(error_messages) if error_messages else None
        })
        
        return {
            'success': status == 'success',
            'message': status_text,
            'created': total_created,
            'updated': total_updated,
            'total': total_candidates,
            'timestamp': ts_vn
        }
    except Exception as e:
        msg = str(e)
        update_global_state({
            'status': 'failed',
            'error': msg,
            'lastSyncTime': ts_vn
        })
        return {
            'success': False,
            'message': f"Lỗi: {msg}",
            'created': 0,
            'updated': 0,
            'total': 0,
            'timestamp': ts_vn
        }
