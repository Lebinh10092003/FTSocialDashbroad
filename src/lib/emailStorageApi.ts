/**
 * emailStorageApi.ts
 * -------------------
 * Lớp lưu trữ bất đồng bộ cho email templates.
 * Chiến lược: Write-through cache
 *   - Đọc: ưu tiên server, fallback về localStorage
 *   - Ghi: ghi localStorage ngay (không delay UI), đồng thời gọi server API
 *   - Khi offline: chỉ lưu localStorage, sync lên server khi có mạng trở lại
 */

import { EmailTemplate } from '../types/emailBuilder';

const LOCAL_CACHE_KEY = 'ft_email_templates';
const LOCAL_PREFS_KEY = 'ft_email_user_prefs';

// Lấy ID Token hiện tại từ Django Session để gọi API
async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const raw = localStorage.getItem('ft_auth_session');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed?.token) return {};
    return { Authorization: `Bearer ${parsed.token}` };
  } catch {
    return {};
  }
}


// Helper gọi API
async function apiCall<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T | null> {
  try {
    const headers = await getAuthHeader();
    if (!headers.Authorization) return null; // Chưa đăng nhập, skip API

    const res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      console.warn(`[emailStorageApi] ${method} ${path} failed:`, err.error);
      return null;
    }
    return res.json();
  } catch (e: any) {
    console.warn(`[emailStorageApi] Network error on ${method} ${path}:`, e.message);
    return null;
  }
}

// ── Cache helpers ────────────────────────────────────────────────────────────

function readLocalCache(): EmailTemplate[] {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCache(templates: EmailTemplate[]): void {
  try {
    // Strip embedded base64 images trước khi lưu để tránh tốn dung lượng
    const cleaned = templates.map(t => ({
      ...t,
      blocks: (t.blocks || []).map(b => {
        const url = b.content?.url;
        if (typeof url === 'string' && url.startsWith('data:image/')) {
          return { ...b, content: { ...b.content, url: '' } };
        }
        return b;
      }),
    }));
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cleaned));
  } catch (e: any) {
    console.warn('[emailStorageApi] Không thể ghi localStorage:', e.message);
  }
}

function readLocalPrefs(): { activeTemplateId?: string; leftPanelWidth?: number; rightPanelWidth?: number } {
  try {
    const raw = localStorage.getItem(LOCAL_PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLocalPrefs(prefs: Record<string, unknown>): void {
  try {
    const existing = readLocalPrefs();
    localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify({ ...existing, ...prefs }));
  } catch {}
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load tất cả email templates.
 * Thử lấy từ server trước; nếu thất bại thì dùng localStorage cache.
 * Nếu server trả về dữ liệu, cập nhật cache luôn.
 */
export async function loadTemplatesAsync(): Promise<EmailTemplate[]> {
  const serverTemplates = await apiCall<EmailTemplate[]>('GET', '/email-templates');
  if (serverTemplates && Array.isArray(serverTemplates) && serverTemplates.length > 0) {
    writeLocalCache(serverTemplates);
    return serverTemplates;
  }

  // Fallback: localStorage
  const cached = readLocalCache();
  if (cached.length > 0) {
    // Cố gắng migrate lên server (background, không await)
    migrateLocalTemplatesInBackground(cached);
    return cached;
  }

  return [];
}

/**
 * Lưu toàn bộ danh sách templates (batch save).
 * Ghi localStorage ngay, rồi sync lên server trong background.
 */
export function saveTemplatesAsync(templates: EmailTemplate[]): void {
  writeLocalCache(templates);
  // Sync lên server trong background - không block UI
  syncTemplatesToServer(templates);
}

/**
 * Sync từng template lên server (upsert).
 */
async function syncTemplatesToServer(templates: EmailTemplate[]): Promise<void> {
  for (const t of templates) {
    await apiCall('PUT', `/email-templates/${t.id}`, t);
  }
}

/**
 * Xóa một template khỏi cache và server.
 */
export async function deleteTemplateAsync(id: string): Promise<void> {
  const cached = readLocalCache();
  const updated = cached.filter(t => t.id !== id);
  writeLocalCache(updated);
  await apiCall('DELETE', `/email-templates/${id}`);
}

/**
 * Tạo một template mới trên server.
 */
export async function createTemplateAsync(template: EmailTemplate): Promise<void> {
  const cached = readLocalCache();
  const existing = cached.find(t => t.id === template.id);
  if (!existing) {
    writeLocalCache([...cached, template]);
  }
  await apiCall('POST', '/email-templates', template);
}

/**
 * Lưu một template (update).
 */
export async function saveTemplateAsync(template: EmailTemplate): Promise<void> {
  const cached = readLocalCache();
  const idx = cached.findIndex(t => t.id === template.id);
  if (idx >= 0) {
    cached[idx] = template;
  } else {
    cached.push(template);
  }
  writeLocalCache(cached);
  await apiCall('PUT', `/email-templates/${template.id}`, template);
}

// ── User Preferences ─────────────────────────────────────────────────────────

export interface EmailUserPrefs {
  activeTemplateId?: string | null;
  leftPanelWidth?: number;
  rightPanelWidth?: number;
}

/**
 * Load user preferences: thử server trước, fallback về localStorage.
 */
export async function loadUserPrefsAsync(): Promise<EmailUserPrefs> {
  const serverPrefs = await apiCall<EmailUserPrefs>('GET', '/email-user-prefs');
  if (serverPrefs && typeof serverPrefs === 'object') {
    writeLocalPrefs(serverPrefs as Record<string, unknown>);
    return serverPrefs;
  }

  // Fallback: localStorage
  const localPrefs = readLocalPrefs();
  // Tương thích với key cũ
  const activeTemplateId = localPrefs.activeTemplateId
    || localStorage.getItem('ft_active_email_template_id')
    || null;
  const leftPanelWidth = localPrefs.leftPanelWidth
    || Number(localStorage.getItem('ft_email_left_panel_width'))
    || 152;
  const rightPanelWidth = localPrefs.rightPanelWidth
    || Number(localStorage.getItem('ft_email_right_panel_width'))
    || 300;

  return { activeTemplateId, leftPanelWidth, rightPanelWidth };
}

/**
 * Lưu user preferences: ghi localStorage ngay, sync server background.
 */
export function saveUserPrefsAsync(prefs: Partial<EmailUserPrefs>): void {
  writeLocalPrefs(prefs as Record<string, unknown>);
  // Đồng bộ lên server (background)
  apiCall('PUT', '/email-user-prefs', prefs).catch(() => {});
}

// ── Migration ────────────────────────────────────────────────────────────────

/**
 * Migrate templates từ localStorage lên server (chỉ chạy một lần khi login lần đầu sau update).
 */
async function migrateLocalTemplatesInBackground(templates: EmailTemplate[]): Promise<void> {
  const migrated = localStorage.getItem('ft_email_templates_migrated');
  if (migrated === 'true') return;
  try {
    console.log('[emailStorageApi] Đang migrate', templates.length, 'templates từ localStorage lên server...');
    for (const t of templates) {
      await apiCall('POST', '/email-templates', t);
    }
    localStorage.setItem('ft_email_templates_migrated', 'true');
    console.log('[emailStorageApi] Migration hoàn tất!');
  } catch (e: any) {
    console.warn('[emailStorageApi] Migration thất bại:', e.message);
  }
}
