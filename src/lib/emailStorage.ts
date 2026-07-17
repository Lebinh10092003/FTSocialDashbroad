import { EmailTemplate } from '../types/emailBuilder';
import { DEFAULT_EMAIL_TEMPLATES } from '../data/defaultEmailTemplates';

const TEMPLATES_KEY = 'ft_email_templates';
const ACTIVE_TEMPLATE_ID_KEY = 'ft_active_email_template_id';

/**
 * Loads all templates from localStorage, seeding with default if empty
 */
export function loadTemplates(): EmailTemplate[] {
  try {
    const stored = localStorage.getItem(TEMPLATES_KEY);
    if (!stored) {
      saveTemplates(DEFAULT_EMAIL_TEMPLATES);
      return DEFAULT_EMAIL_TEMPLATES;
    }
    const parsed = JSON.parse(stored) as EmailTemplate[];
    if (parsed.length === 0) {
      saveTemplates(DEFAULT_EMAIL_TEMPLATES);
      return DEFAULT_EMAIL_TEMPLATES;
    }
    return parsed;
  } catch (error) {
    console.error('Lỗi khi load templates từ localStorage:', error);
    return DEFAULT_EMAIL_TEMPLATES;
  }
}

/**
 * Saves templates list to localStorage
 */
export function saveTemplates(templates: EmailTemplate[]): void {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch (error) {
    console.error('Lỗi khi lưu templates vào localStorage:', error);
  }
}

/**
 * Gets the active template ID
 */
export function getActiveTemplateId(): string | null {
  return localStorage.getItem(ACTIVE_TEMPLATE_ID_KEY);
}

/**
 * Sets the active template ID
 */
export function setActiveTemplateId(id: string): void {
  localStorage.setItem(ACTIVE_TEMPLATE_ID_KEY, id);
}

/**
 * Restores templates to default
 */
export function restoreDefaultTemplates(): EmailTemplate[] {
  saveTemplates(DEFAULT_EMAIL_TEMPLATES);
  return DEFAULT_EMAIL_TEMPLATES;
}

/**
 * Exports a template as JSON file
 */
export function exportTemplateToJson(template: EmailTemplate): void {
  try {
    const jsonString = JSON.stringify(template, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_template.json`;
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Lỗi khi xuất JSON template:', error);
    alert('Không thể xuất file JSON template.');
  }
}
