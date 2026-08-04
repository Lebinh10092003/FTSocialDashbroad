from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from authentication.models import UserProfile
from .models import EmailTemplate


class EmailTemplateSharingTests(TestCase):
    def setUp(self):
        self.owner = UserProfile.objects.create(
            email='owner@fermat.vn', name='Người tạo', access_modules=['email-builder']
        )
        self.editor = UserProfile.objects.create(
            email='editor@fermat.vn', name='Người sửa', access_modules=['email-builder']
        )
        self.owner_client = APIClient()
        self.owner_client.force_authenticate(self.owner)
        self.editor_client = APIClient()
        self.editor_client.force_authenticate(self.editor)
        self.payload = {
            'id': 'shared-template',
            'name': 'Mẫu chia sẻ',
            'subject': 'Tiêu đề',
            'settings': {},
            'blocks': [],
            'lastUpdated': 1,
        }

    def test_publish_allows_other_employee_to_view_and_edit_without_transferring_owner(self):
        created = self.owner_client.post('/api/email-templates', self.payload, format='json')
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertFalse(created.data['template']['isPublished'])

        hidden = self.editor_client.get('/api/email-templates')
        self.assertEqual(hidden.status_code, status.HTTP_200_OK)
        self.assertEqual(hidden.data, [])

        published = self.owner_client.post('/api/email-templates/shared-template/publish', format='json')
        self.assertEqual(published.status_code, status.HTTP_200_OK)
        self.assertTrue(published.data['template']['isPublished'])

        visible = self.editor_client.get('/api/email-templates')
        self.assertEqual([item['id'] for item in visible.data], ['shared-template'])
        edited = self.editor_client.put(
            '/api/email-templates/shared-template',
            {**self.payload, 'subject': 'Tiêu đề đã được đồng nghiệp sửa', 'lastUpdated': 2},
            format='json',
        )
        self.assertEqual(edited.status_code, status.HTTP_200_OK)
        self.assertEqual(edited.data['template']['createdBy'], self.owner.email)
        self.assertEqual(edited.data['template']['updatedBy'], self.editor.email)

    def test_only_owner_can_delete_or_publish(self):
        self.owner_client.post('/api/email-templates', self.payload, format='json')
        self.assertEqual(
            self.editor_client.post('/api/email-templates/shared-template/publish', format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.owner_client.post('/api/email-templates/shared-template/publish', format='json')
        self.assertEqual(
            self.editor_client.delete('/api/email-templates/shared-template').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertTrue(EmailTemplate.objects.filter(id='shared-template').exists())
        self.assertEqual(
            self.owner_client.delete('/api/email-templates/shared-template').status_code,
            status.HTTP_200_OK,
        )
        self.assertFalse(EmailTemplate.objects.filter(id='shared-template').exists())

    def test_template_list_requires_authenticated_workspace_member(self):
        response = APIClient().get('/api/email-templates')
        self.assertIn(response.status_code, {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN})