from authentication.models import UserProfile
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import Candidate, CandidateParticipation, Competition, ExamSession, LogNote, RoundResult


class ExistingSessionRoundBackfillTests(TestCase):
    def test_blank_legacy_session_receives_common_editable_rounds(self):
        session = ExamSession.objects.create(
            id='fieo-legacy', competition_id='fieo', code='FIEO', name='FIEO legacy',
            parent='FIEO', organizer='FermatTech', time='', sort_key='fieo-legacy',
        )

        from .views import ensure_examination_seed
        ensure_examination_seed()

        session.refresh_from_db()
        self.assertEqual(
            [round_config['name'] for round_config in session.rounds],
            ['Vòng loại Quốc gia', 'Vòng Chung kết Quốc gia', 'Vòng Quốc tế'],
        )
        self.assertTrue(all('slots' in round_config for round_config in session.rounds))

    def test_backfill_preserves_legacy_final_and_international_dates(self):
        session = ExamSession.objects.create(
            id='fimo-legacy', competition_id='fimo', code='FIMO', name='FIMO legacy',
            parent='FIMO', organizer='FermatTech', time='', sort_key='fimo-legacy',
            national='26/7/2026', national_date='2026-07-26',
            international='Tháng 9/2026', international_date='',
        )

        from .views import ensure_examination_seed, sync_legacy_round_milestones
        ensure_examination_seed()
        session.refresh_from_db()
        sync_legacy_round_milestones(session, session.rounds)

        self.assertEqual(session.rounds[1]['date'], '2026-07-26')
        self.assertEqual(session.rounds[1]['label'], '26/7/2026')
        self.assertEqual(session.rounds[2]['label'], 'Tháng 9/2026')
        self.assertEqual(session.national_date, '2026-07-26')
        self.assertEqual(session.national, '26/7/2026')

    def test_legacy_summary_prefers_national_final_and_clears_removed_international_round(self):
        session = ExamSession.objects.create(
            id='round-summary', competition_id='aysbc', code='AYSBC', name='Round summary',
            parent='AYSBC', organizer='SCS', time='', sort_key='round-summary',
            international='Stale date', international_date='2026-09-01',
        )
        from .views import sync_legacy_round_milestones

        sync_legacy_round_milestones(session, [
            {'id': 'qualifier', 'name': 'V\u00f2ng lo\u1ea1i Qu\u1ed1c gia', 'label': '17/5/2026', 'date': '2026-05-17'},
            {'id': 'final', 'name': 'V\u00f2ng Chung k\u1ebft Qu\u1ed1c gia', 'label': '7/6/2026', 'date': '2026-06-07'},
            {'id': 'regional', 'name': 'V\u00f2ng Khu v\u1ef1c', 'label': 'Th\u00e1ng 10/2026', 'date': ''},
        ])

        self.assertEqual(session.national, '7/6/2026')
        self.assertEqual(session.national_date, '2026-06-07')
        self.assertEqual(session.international, '')
        self.assertEqual(session.international_date, '')

class LogNoteApiTests(TestCase):
    def setUp(self):
        self.user = UserProfile.objects.create(email='lognote-admin@example.com', name='LogNote Admin', role='ADMIN')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = '/api/examination/lognotes/session-demo'

    def test_each_note_keeps_its_own_saved_timestamp(self):
        first = self.client.post(self.url, {'content': 'Tạo kỳ tổ chức.', 'actor': 'Quản trị viên'}, format='json')
        self.assertEqual(first.status_code, 201)
        first_id = first.data['note']['id']
        first_time = first.data['note']['time']

        second = self.client.post(self.url, {'content': 'Bổ sung ghi chú.', 'actor': 'Quản trị viên'}, format='json')
        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(first_id, second.data['note']['id'])

        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 2)
        persisted_first = next(item for item in response.data if item['id'] == first_id)
        self.assertEqual(persisted_first['time'], first_time)
        self.assertEqual(LogNote.objects.filter(entity_key='session-demo').count(), 2)

    def test_partners_are_persisted_and_returned_in_bootstrap(self):
        payload = {'partners': [{
            'id': 'partner-persisted', 'province': 'Hà Nội', 'ward': 'Yên Hòa', 'school': 'Trường A', 'level': 'THCS',
            'representative': 'Nguyễn A', 'phone': '0900000000', 'email': 'a@example.com', 'contests': ['AYSBC'],
            'studentCounts': [{'session': 'AYSBC', 'count': 8}],
        }]}
        saved = self.client.put('/api/examination/partners', payload, format='json')
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.data['partners'][0]['school'], 'Trường A')
        bootstrap = self.client.get('/api/examination/bootstrap')
        self.assertEqual(bootstrap.status_code, 200)
        self.assertEqual(bootstrap.data['partners'][0]['studentCounts'][0]['count'], 8)
    def test_get_does_not_create_or_retime_a_log_note(self):
        self.assertEqual(self.client.get(self.url).data, [])
        self.assertFalse(LogNote.objects.exists())


class CandidateRoundHistoryTests(TestCase):
    def setUp(self):
        self.session = ExamSession.objects.create(
            id='simo-2026', competition_id='simo', code='SIMO', name='SIMO 2026',
            parent='SCO - IMO', organizer='SCO', time='2026', sort_key='simo-2026',
        )
        self.candidate = Candidate.objects.create(
            id='FT26-9001', code='FT26-9001', name='Candidate One', sort_key='candidate-one',
        )
        email = 'round-admin@example.com'
        self.user = UserProfile.objects.create(email=email, name='Round Admin', role='ADMIN')
        django_user = get_user_model().objects.create_user(username=email, email=email, password='RoundAdmin9921')
        token = Token.objects.create(user=django_user).key
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    def test_candidate_update_writes_full_before_after_audit_to_candidate_and_session(self):
        self.candidate.session_ids = [self.session.id]
        self.candidate.school = 'Trường cũ'
        self.candidate.phone = '0900000000'
        self.candidate.save()

        response = self.client.put(
            f'/api/examination/candidates/{self.candidate.code}',
            {'school': 'Trường mới', 'phone': '0911222333'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        candidate_note = LogNote.objects.filter(entity_key=f'candidate-{self.candidate.code}').latest('created_at')
        self.assertIn('Đã đổi Trường học từ "Trường cũ" thành "Trường mới".', candidate_note.content)
        self.assertIn('Đã đổi Điện thoại từ "0900000000" thành "0911222333".', candidate_note.content)
        self.assertEqual(candidate_note.updated_by, 'round-admin@example.com')
        self.assertFalse(candidate_note.system)
        self.assertTrue(LogNote.objects.filter(entity_key=f'session-{self.session.id}', content__contains='Cập nhật hồ sơ thí sinh').exists())

    def test_one_session_tab_keeps_multiple_rounds_without_duplicates(self):
        from .views import serialize_candidate, upsert_participation_history

        upsert_participation_history(
            self.candidate,
            self.session.id,
            [
                {'round': 'Round 1', 'sbd': 'A-001', 'password': 'secret-round-1', 'score': '82'},
                {'round': 'Round 2', 'sbd': 'B-001', 'score': '91'},
            ],
            'https://docs.google.com/spreadsheets/d/example#gid=1',
        )
        upsert_participation_history(
            self.candidate,
            self.session.id,
            [{'round': 'Round 1', 'sbd': 'A-001', 'score': '86'}],
            'https://docs.google.com/spreadsheets/d/example#gid=1',
        )

        self.assertEqual(CandidateParticipation.objects.count(), 1)
        self.assertEqual(RoundResult.objects.count(), 2)
        self.assertEqual(RoundResult.objects.get(round_name='Round 1').score, '86')
        history = serialize_candidate(self.candidate)['examHistory']
        self.assertEqual(len(history), 2)
        self.assertEqual({item['sessionId'] for item in history}, {'simo-2026'})
        self.assertEqual(next(item for item in history if item['round'] == 'Round 1')['password'], 'secret-round-1')


    def test_export_rows_keep_all_rounds_in_one_session_row(self):
        from .views import upsert_participation_history
        from .sync import session_export_rows

        upsert_participation_history(
            self.candidate,
            self.session.id,
            [
                {'round': 'Round 1', 'sbd': 'A-001', 'password': 'secret-round-1', 'score': '82'},
                {'round': 'Round 2', 'sbd': 'B-001', 'score': '91'},
            ],
        )
        rows = session_export_rows(self.session.id)
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0][0], 'HỒ SƠ THÍ SINH')
        self.assertEqual(rows[1][1], 'Mã hồ sơ')
        self.assertEqual(rows[2][1], 'FT26-9001')
        self.assertIn('A-001', rows[2])
        self.assertIn('B-001', rows[2])

    def test_official_template_headers_keep_registration_and_all_rounds(self):
        from .sync import EXPORT_GROUP_HEADERS, EXPORT_HEADERS, history_from_sheet_row, merged_headers, resolve_column_indices

        headers = merged_headers([EXPORT_GROUP_HEADERS, EXPORT_HEADERS], 1)
        columns = resolve_column_indices(headers)
        self.assertEqual(columns['code'], 1)
        self.assertEqual(columns['subject'], 15)
        self.assertEqual(columns['highestRound'], 66)
        self.assertEqual(columns['achievement'], 67)
        self.assertEqual(columns['certificateLink'], 68)
        self.assertEqual(columns['generalNote'], 20)

        row = [''] * len(headers)
        row[21] = 'Đủ điều kiện'
        row[22] = 'SBD-001'
        row[31] = '91'
        row[37] = 'SBD-002'
        history = history_from_sheet_row(headers, row)
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]['eligibility'], 'Đủ điều kiện')
        self.assertEqual(history[0]['sbd'], 'SBD-001')
        self.assertEqual(history[0]['score'], '91')
        self.assertEqual(history[1]['sbd'], 'SBD-002')
    def test_round_score_does_not_match_exam_location(self):
        from .sync import history_from_sheet_row
        headers = [
            'V\u00f2ng 1: \u0110\u1ecba \u0111i\u1ec3m/Ph\u00f2ng thi', 'V\u00f2ng 1: \u0110i\u1ec3m',
            'V\u00f2ng 1: Tr\u1ea1ng th\u00e1i d\u1ef1 thi', 'V\u00f2ng 1: Link thi',
        ]
        history = history_from_sheet_row(headers, ['Room 1', '91/105', '\u0110\u00e3 c\u00f3 k\u1ebft qu\u1ea3', 'https://exam.example.test'])
        self.assertEqual(history[0]['location'], 'Room 1')
        self.assertEqual(history[0]['score'], '91/105')
        self.assertEqual(history[0]['attendance'], '\u0110\u00e3 c\u00f3 k\u1ebft qu\u1ea3')
        self.assertEqual(history[0]['link'], 'https://exam.example.test')

    def test_sbd_column_is_never_used_as_profile_code(self):
        from .sync import resolve_column_indices
        columns = resolve_column_indices(['Hồ sơ thí sinh: Họ và tên thí sinh', 'Vòng 1: Số báo danh (SBD)'])
        self.assertNotIn('code', columns)

    def test_manual_template_import_links_the_selected_competition(self):
        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.session.id,
            'source': 'Template XLSX',
            'records': [{
                'code': 'HS-0001', 'name': 'Candidate Template', 'school': 'School A', 'birthDate': '2014',
                'subject': 'Toán', 'category': 'Bảng A', 'teamName': 'Nhóm 1', 'highestRound': 'Vòng 2',
            }],
        }, format='json')
        self.assertEqual(response.status_code, 200)
        candidate = Candidate.objects.get(code='HS-0001')
        self.assertEqual(candidate.contests, 'SIMO')
        participation = CandidateParticipation.objects.get(candidate=candidate, session=self.session)
        self.assertEqual(participation.subject, 'Toán')
        self.assertEqual(participation.category, 'Bảng A')
        self.assertEqual(participation.team_name, 'Nhóm 1')
    def test_import_assigns_ft_code_and_preserves_all_template_fields(self):
        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.session.id,
            'source': 'Template XLSX',
            'records': [{
                'code': '', 'name': 'Candidate Imported', 'birthDate': '20/03/2014',
                'city': 'Hà Nội', 'ward': 'Phường Giảng Võ', 'school': 'School A',
                'examHistory': [{
                    'round': 'Vòng 1', 'date': '6/21/26', 'time': '09:00 - 10:00',
                    'mode': 'Trực tuyến', 'link': 'https://example.test/room',
                    'account': 'candidate.account', 'password': 'candidate.password',
                }],
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        candidate = Candidate.objects.get(name='Candidate Imported')
        self.assertRegex(candidate.code, r'^FT-\d{5}$')
        self.assertEqual(candidate.birth_date, '2014-03-20')
        self.assertEqual(candidate.city, 'Hà Nội')
        result = RoundResult.objects.get(participation__candidate=candidate, round_name='Vòng 1')
        self.assertEqual(result.exam_date, '2026-06-21')
        self.assertEqual(result.time_slot, '09:00 - 10:00')
        self.assertEqual(result.account, 'candidate.account')
        self.assertEqual(result.password, 'candidate.password')
    def test_round_slots_persist_and_removal_updates_candidate_participation(self):
        from .views import upsert_participation_history

        update = self.client.put(
            f'/api/examination/sessions/{self.session.id}',
            {'rounds': [{'id': 'r1', 'name': 'V\u00f2ng Chung k\u1ebft Qu\u1ed1c gia', 'label': '26/7/2026', 'date': '2026-07-26', 'slots': [
                {'id': 'slot-1', 'date': '2026-07-26', 'time': '09:00 - 10:00', 'mode': 'Trực tuyến', 'link': 'https://example.test/room', 'location': ''},
                {'id': 'slot-2', 'date': '2026-07-27', 'time': '13:00 - 14:00', 'mode': 'Trực tiếp', 'link': '', 'location': 'Hà Nội'},
            ]}]},
            format='json',
        )
        self.assertEqual(update.status_code, 200)
        self.assertEqual(len(update.data['rounds'][0]['slots']), 2)
        session_note = LogNote.objects.filter(entity_key=f'session-{self.session.id}').latest('created_at')
        self.assertIn('Đã bổ sung Thông tin các vòng thi: Vòng Chung kết Quốc gia (26/7/2026).', session_note.content)
        self.assertNotIn('"id"', session_note.content)
        self.assertEqual(update.data['nationalDate'], '2026-07-26')
        self.assertEqual(update.data['national'], '26/7/2026')

        self.candidate.session_ids = [self.session.id]
        self.candidate.contests = 'SIMO'
        self.candidate.save()
        upsert_participation_history(self.candidate, self.session.id, [
            {'round': 'Round 1', 'sbd': 'A-001'},
            {'round': 'Round 2', 'sbd': 'B-001'},
        ])
        second = RoundResult.objects.get(round_name='Round 2')
        response = self.client.delete(f'/api/examination/round-results/{second.id}?removeFromSession=0')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(CandidateParticipation.objects.filter(candidate=self.candidate, session=self.session).exists())

        first = RoundResult.objects.get(round_name='Round 1')
        response = self.client.delete(f'/api/examination/round-results/{first.id}?removeFromSession=1')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(CandidateParticipation.objects.filter(candidate=self.candidate, session=self.session).exists())
        self.assertEqual(response.data['candidate']['sessionIds'], [])

class CandidateImportReuseTests(TestCase):
    def setUp(self):
        self.user = UserProfile.objects.create(email='reuse-admin@example.com', name='Reuse Admin', role='ADMIN')
        self.client = APIClient()
        django_user = get_user_model().objects.create_user(username='reuse-admin@example.com', email='reuse-admin@example.com', password='ReuseAdmin9921')
        token = Token.objects.create(user=django_user).key
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        self.competition = Competition.objects.create(
            id='aysbc-reuse', code='AYSBC', name='Huy hiệu các Nhà khoa học trẻ Châu Á',
            parent='AYSBC', organizer='SCS và META Knowledge', sort_key='aysbc-reuse',
        )
        self.previous = ExamSession.objects.create(
            id='aysbc-2026', competition_id=self.competition.id, code='AYSBC', name='T6/2026',
            parent='AYSBC', organizer='SCS', time='', sort_key='aysbc-2026',
        )
        self.target = ExamSession.objects.create(
            id='aysbc-2027', competition_id=self.competition.id, code='AYSBC', name='T6/2027',
            parent='AYSBC', organizer='SCS', time='', sort_key='aysbc-2027',
        )
        self.candidate = Candidate.objects.create(
            id='FT-00001', code='FT-00001', name='Nguyễn Minh Anh', identity='001214066182',
            school='Trường A', birth_date='2014-03-20', session_ids=[self.previous.id],
            contests='AYSBC', sort_key='nguyen-minh-anh',
        )
        CandidateParticipation.objects.create(candidate=self.candidate, session=self.previous)

    def test_import_reuses_existing_profile_and_adds_new_session_history(self):
        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.target.id,
            'source': 'Danh sách AYSBC 2027.xlsx',
            'records': [{
                'code': '', 'name': 'Nguyễn Minh Anh', 'identity': '001214066182',
                'school': 'Trường A', 'birthDate': '20/03/2014', 'city': 'Hà Nội',
                'examHistory': [{'round': 'Vòng 1', 'account': 'minh.anh.2027'}],
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created'], 0)
        self.assertEqual(response.data['linkedExisting'], 1)
        self.assertEqual(Candidate.objects.count(), 1)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.code, 'FT-00001')
        self.assertIn(self.target.id, self.candidate.session_ids)
        self.assertTrue(CandidateParticipation.objects.filter(candidate=self.candidate, session=self.target).exists())
        note = LogNote.objects.filter(entity_key='candidate-FT-00001').latest('created_at')
        self.assertIn('Hệ thống tự nhận diện hồ sơ trùng', note.content)
        self.assertIn('T6/2026', note.content)

    def test_confirmed_possible_match_reuses_selected_profile_and_records_audit(self):
        self.candidate.email = 'parent@example.com'
        self.candidate.save(update_fields=['email'])
        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.target.id,
            'source': 'Danh sách xác nhận.xlsx',
            'confirmedMatches': {'1': 'FT-00001'},
            'records': [{
                'name': 'Nguyen Ngoc An', 'email': 'parent@example.com',
                'school': 'Trường B', 'birthDate': '20/03/2014',
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created'], 0)
        self.assertEqual(Candidate.objects.count(), 1)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.name, 'Nguyen Ngoc An')
        self.assertEqual(self.candidate.school, 'Trường B')
        note = LogNote.objects.filter(entity_key='candidate-FT-00001').latest('created_at')
        self.assertIn('Người dùng đã xác nhận', note.content)

    def test_year_only_import_does_not_overwrite_a_full_birth_date(self):
        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.target.id,
            'source': 'Danh sách bổ sung.xlsx',
            'records': [{
                'name': 'Nguyễn Minh Anh', 'identity': '001214066182', 'birthDate': '2014',
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.birth_date, '2014-03-20')

class SessionCompetitionConsistencyTests(TestCase):
    def test_legacy_session_is_relinked_and_serialized_with_the_competition_name(self):
        competition = Competition.objects.create(
            id='aysbc-consistent', code='AYSBC', name='Huy hiệu các Nhà khoa học trẻ Châu Á',
            parent='AYSBC', organizer='SCS và META Knowledge', sort_key='aysbc-consistent',
        )
        session = ExamSession.objects.create(
            id='aysbc-legacy-name', competition_id='', code='AYSBC', name='T10/2026',
            parent='AYSBC', organizer='', time='', sort_key='legacy',
        )

        from .views import ensure_examination_seed, serialize_session
        ensure_examination_seed()
        session.refresh_from_db()
        payload = serialize_session(session)

        self.assertEqual(session.competition_id, competition.id)
        self.assertEqual(session.parent, competition.name)
        self.assertEqual(session.organizer, competition.organizer)
        self.assertEqual(payload['competitionName'], competition.name)
class ImportDuplicatePreviewTests(TestCase):
    def setUp(self):
        email = 'duplicate-preview@example.com'
        UserProfile.objects.create(email=email, name='Duplicate Preview', role='ADMIN')
        django_user = get_user_model().objects.create_user(username=email, email=email, password='DuplicatePreview9921')
        token = Token.objects.create(user=django_user).key
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        Candidate.objects.create(
            id='FT-00042', code='FT-00042', name='Nguyễn Minh Anh', identity='001214066182',
            school='Trường A', birth_date='2014-03-20', city='Hà Nội', sort_key='nguyen-minh-anh',
        )

    def test_duplicate_preview_returns_existing_profile_without_exposing_exam_credentials(self):
        response = self.client.post('/api/examination/import/candidates/duplicates', {
            'records': [{
                'name': 'nguyễn MINH anh', 'identity': '001214066182',
                'birthDate': '20/03/2014', 'school': 'Trường A',
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['duplicates']), 1)
        duplicate = response.data['duplicates'][0]
        self.assertEqual(duplicate['importedName'], 'Nguyễn Minh Anh')
        self.assertEqual(duplicate['existing']['code'], 'FT-00042')
        self.assertEqual(duplicate['matchBy'], 'Họ tên và CCCD/Hộ chiếu trùng')
        self.assertNotIn('password', duplicate['existing'])
        self.assertEqual(duplicate['status'], 'confirmed')

    def test_duplicate_preview_does_not_match_same_name_with_a_different_birth_date(self):
        response = self.client.post('/api/examination/import/candidates/duplicates', {
            'records': [{
                'name': 'Nguyen Minh Anh', 'birthDate': '21/03/2014',
                'school': 'Truong A', 'city': 'Ha Noi',
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['duplicates'], [])

    def test_manual_candidate_update_normalizes_person_name(self):
        response = self.client.put('/api/examination/candidates/FT-00042', {
            'name': 'nguyễn  MINH-ANH', 'parent': 'trần THỊ bình',
        }, format='json')

        self.assertEqual(response.status_code, 200)
        candidate = Candidate.objects.get(code='FT-00042')
        self.assertEqual(candidate.name, 'Nguyễn Minh-Anh')
        self.assertEqual(candidate.parent, 'Trần Thị Bình')
class CandidateIdentityMatchingTests(TestCase):
    def test_same_name_and_shared_identifier_are_confirmed_even_when_other_fields_changed(self):
        from .sync import candidate_match_assessment, same_candidate

        previous = {
            'name': 'Nguyen Thi Phuc An', 'birth_date': '2014-03-21',
            'identity': '001214056485', 'email': 'old@example.com', 'phone': '0981111111',
        }
        incoming = {
            'name': 'Nguyen Thi Phuc An', 'birth_date': '2014-09-21',
            'identity': '001214056485', 'email': 'new@example.com', 'phone': '0982222222',
        }

        assessment = candidate_match_assessment(previous, incoming)
        self.assertEqual(assessment['status'], 'confirmed')
        self.assertIn('CCCD', assessment['reason'])
        self.assertTrue(same_candidate(previous, incoming))

    def test_shared_identifier_but_different_name_requires_confirmation(self):
        from .sync import candidate_match_assessment, same_candidate

        previous = {'name': 'Nguyen Thi Phuc An', 'email': 'parent@example.com'}
        incoming = {'name': 'Nguyen Ngoc An', 'email': 'parent@example.com'}

        assessment = candidate_match_assessment(previous, incoming)
        self.assertEqual(assessment['status'], 'possible')
        self.assertFalse(same_candidate(previous, incoming))

    def test_missing_identifiers_use_strict_name_birth_school_and_class_fallback(self):
        from .sync import candidate_match_assessment, same_candidate

        previous = {
            'name': 'Nguyen Thi Phuc An', 'birth_date': '2014-03-21',
            'school': 'THCS Trung Vuong', 'class_name': '7A1',
        }
        incoming = {
            'name': 'Nguyen Thi Phuc An', 'birth_date': '2014-03-21',
            'school': 'THCS Trung Vuong', 'class_name': '7A1',
        }

        assessment = candidate_match_assessment(previous, incoming)
        self.assertEqual(assessment['status'], 'confirmed')
        self.assertTrue(same_candidate(previous, incoming))

    def test_same_name_school_but_different_full_birth_dates_do_not_match(self):
        from .sync import candidate_match_assessment, same_candidate

        previous = {
            'name': 'Nguyen Thi Phuc An', 'birth_date': '2014-03-21',
            'school': 'THCS Trung Vuong', 'class_name': '7A1',
        }
        incoming = {
            'name': 'Nguyen Thi Phuc An', 'birth_date': '2014-09-21',
            'school': 'THCS Trung Vuong', 'class_name': '7A1',
        }

        self.assertIsNone(candidate_match_assessment(previous, incoming))
        self.assertFalse(same_candidate(previous, incoming))