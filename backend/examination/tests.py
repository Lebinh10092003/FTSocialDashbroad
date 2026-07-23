from authentication.models import UserProfile
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import Candidate, CandidateParticipation, ExamSession, LogNote, RoundResult


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
        self.assertIn('Trường học: “Trường cũ” → “Trường mới”', candidate_note.content)
        self.assertIn('Điện thoại: “0900000000” → “0911222333”', candidate_note.content)
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
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1][0], 'FT26-9001')
        self.assertIn('A-001', rows[1])
        self.assertIn('B-001', rows[1])
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
