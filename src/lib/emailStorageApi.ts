/**
 * Persistent storage for email templates.
 * The browser cache keeps drafts responsive, while the API is the authority for
 * ownership, publication, editing and deletion permissions.
 */
import { EmailTemplate } from '../types/emailBuilder';

const LOCAL_CACHE_KEY = 'ft_email_templates';
const LOCAL_PREFS_KEY = 'ft_email_user_prefs';
type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const raw = localStorage.getItem('ft_auth_session');
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.token ? { Authorization: `Bearer ${parsed.token}` } : {};
  } catch {
    return {};
  }
}

function getCurrentUserEmail(): string {
  try {
    const raw = localStorage.getItem('ft_auth_session');
    return String(raw ? JSON.parse(raw)?.user?.email || '' : '').trim().toLowerCase();
  } catch {
    return '';
  }
}

async function apiCall<T>(method: ApiMethod, path: string, body?: unknown): Promise<T | null> {
  try {
    const headers = await getAuthHeader();
    if (!headers.Authorization) return null;
    const response = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      console.warn(`[emailStorageApi] ${method} ${path} failed:`, error.error);
      return null;
    }
    return response.json();
  } catch (error: any) {
    console.warn(`[emailStorageApi] Network error on ${method} ${path}:`, error.message);
    return null;
  }
}

async function apiCallOrThrow<T>(method: ApiMethod, path: string, body?: unknown): Promise<T> {
  const headers = await getAuthHeader();
  if (!headers.Authorization) throw new Error('Bạn cần đăng nhập để thực hiện thao tác này.');
  try {
    const response = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || response.statusText || 'Không thể hoàn tất thao tác.');
    return payload as T;
  } catch (error: any) {
    throw new Error(error?.message || 'Không thể kết nối tới hệ thống.');
  }
}

function readLocalCache(): EmailTemplate[] {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCache(templates: EmailTemplate[]): void {
  try {
    const cleaned = templates.map(template => ({
      ...template,
      blocks: (template.blocks || []).map(block => {
        const url = block.content?.url;
        return typeof url === 'string' && url.startsWith('data:image/')
          ? { ...block, content: { ...block.content, url: '' } }
          : block;
      }),
    }));
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cleaned));
  } catch (error: any) {
    console.warn('[emailStorageApi] Không thể ghi localStorage:', error.message);
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
    localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify({ ...readLocalPrefs(), ...prefs }));
  } catch {}
}

export async function loadTemplatesAsync(): Promise<EmailTemplate[]> {
  const serverTemplates = await apiCall<EmailTemplate[]>('GET', '/email-templates');
  const cached = readLocalCache();
  if (serverTemplates && Array.isArray(serverTemplates)) {
    const byId = new Map(serverTemplates.map(template => [template.id, template]));
    const currentEmail = getCurrentUserEmail();
    const localChanges = cached.filter(template => {
      const server = byId.get(template.id);
      if (server) return Number(template.lastUpdated || 0) > Number(server.lastUpdated || 0);
      // Only recover an offline draft created by this browser user. Never copy a
      // hidden private draft from a different employee into their account.
      return !template.createdBy || template.createdBy.toLowerCase() === currentEmail;
    });
    localChanges.forEach(template => byId.set(template.id, template));
    if (localChanges.length) void syncTemplatesToServer(localChanges);
    const merged = Array.from(byId.values());
    writeLocalCache(merged);
    return merged;
  }
  if (cached.length) {
    migrateLocalTemplatesInBackground(cached);
    return cached;
  }
  return [];
}

/** Writes the local list only. Individual mutations call their matching API. */
export function saveTemplatesAsync(templates: EmailTemplate[]): void {
  writeLocalCache(templates);
}

async function syncTemplatesToServer(templates: EmailTemplate[]): Promise<void> {
  for (const template of templates) {
    await apiCall('PUT', `/email-templates/${template.id}`, template);
  }
}

function replaceCachedTemplate(template: EmailTemplate): void {
  const cached = readLocalCache();
  const index = cached.findIndex(item => item.id === template.id);
  if (index >= 0) cached[index] = template;
  else cached.push(template);
  writeLocalCache(cached);
}

export async function createTemplateAsync(template: EmailTemplate): Promise<EmailTemplate | null> {
  replaceCachedTemplate(template);
  const result = await apiCall<{ template: EmailTemplate }>('POST', '/email-templates', template);
  if (result?.template) replaceCachedTemplate(result.template);
  return result?.template || null;
}

export async function saveTemplateAsync(template: EmailTemplate): Promise<EmailTemplate | null> {
  replaceCachedTemplate(template);
  const result = await apiCall<{ template: EmailTemplate }>('PUT', `/email-templates/${template.id}`, template);
  if (result?.template) replaceCachedTemplate(result.template);
  return result?.template || null;
}

export async function saveTemplateOrThrow(template: EmailTemplate): Promise<EmailTemplate> {
  replaceCachedTemplate(template);
  const result = await apiCallOrThrow<{ template: EmailTemplate }>('PUT', `/email-templates/${template.id}`, template);
  replaceCachedTemplate(result.template);
  return result.template;
}

export async function publishTemplateAsync(id: string): Promise<EmailTemplate> {
  const result = await apiCallOrThrow<{ template: EmailTemplate }>('POST', `/email-templates/${id}/publish`);
  replaceCachedTemplate(result.template);
  return result.template;
}

export async function deleteTemplateAsync(id: string): Promise<void> {
  await apiCallOrThrow('DELETE', `/email-templates/${id}`);
  writeLocalCache(readLocalCache().filter(template => template.id !== id));
}

export interface EmailUserPrefs {
  activeTemplateId?: string | null;
  leftPanelWidth?: number;
  rightPanelWidth?: number;
}

export async function loadUserPrefsAsync(): Promise<EmailUserPrefs> {
  const serverPrefs = await apiCall<EmailUserPrefs>('GET', '/email-user-prefs');
  if (serverPrefs && typeof serverPrefs === 'object') {
    writeLocalPrefs(serverPrefs as Record<string, unknown>);
    return serverPrefs;
  }
  const localPrefs = readLocalPrefs();
  return {
    activeTemplateId: localPrefs.activeTemplateId || localStorage.getItem('ft_active_email_template_id') || null,
    leftPanelWidth: localPrefs.leftPanelWidth || Number(localStorage.getItem('ft_email_left_panel_width')) || 152,
    rightPanelWidth: localPrefs.rightPanelWidth || Number(localStorage.getItem('ft_email_right_panel_width')) || 300,
  };
}

export function saveUserPrefsAsync(prefs: Partial<EmailUserPrefs>): void {
  writeLocalPrefs(prefs as Record<string, unknown>);
  void apiCall('PUT', '/email-user-prefs', prefs);
}

async function migrateLocalTemplatesInBackground(templates: EmailTemplate[]): Promise<void> {
  if (localStorage.getItem('ft_email_templates_migrated') === 'true') return;
  try {
    for (const template of templates) await apiCall('POST', '/email-templates', template);
    localStorage.setItem('ft_email_templates_migrated', 'true');
  } catch (error: any) {
    console.warn('[emailStorageApi] Migration thất bại:', error.message);
  }
}