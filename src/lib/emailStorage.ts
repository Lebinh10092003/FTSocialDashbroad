import { EmailTemplate } from '../types/emailBuilder';
import { DEFAULT_EMAIL_TEMPLATES } from '../data/defaultEmailTemplates';

const TEMPLATES_KEY = 'ft_email_templates';
const ACTIVE_TEMPLATE_ID_KEY = 'ft_active_email_template_id';

/**
 * Ảnh Base64 có thể làm localStorage vượt dung lượng và khiến React phải xử lý
 * nhiều MB dữ liệu ở mỗi lần chỉnh sửa. Mẫu email chỉ được lưu URL ảnh đã tải lên.
 *
 * Hàm này cố ý làm sạch trực tiếp mảng nhận vào. updateTemplatesList gọi
 * setTemplates(newList) rồi saveTemplates(newList), vì vậy việc làm sạch đồng bộ
 * sẽ ngăn dữ liệu Base64 còn nằm trong state chờ render.
 */
function removeEmbeddedDataImagesInPlace(templates: EmailTemplate[]): number {
  let removedCount = 0;

  for (const template of templates) {
    if (!Array.isArray(template.blocks)) continue;

    for (const block of template.blocks) {
      const imageUrl = block.content?.url;
      if (typeof imageUrl === 'string' && imageUrl.startsWith('data:image/')) {
        block.content = {
          ...block.content,
          url: '',
        };
        removedCount += 1;
      }
    }
  }

  return removedCount;
}

function resetTemplatesToDefault(): EmailTemplate[] {
  const defaults = structuredClone(DEFAULT_EMAIL_TEMPLATES);
  saveTemplates(defaults);
  return defaults;
}

/**
 * Loads all templates from localStorage, seeding with default if empty.
 */
export function loadTemplates(): EmailTemplate[] {
  try {
    const stored = localStorage.getItem(TEMPLATES_KEY);
    if (!stored) return resetTemplatesToDefault();

    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.removeItem(TEMPLATES_KEY);
      return resetTemplatesToDefault();
    }

    const templates = parsed as EmailTemplate[];
    const removedCount = removeEmbeddedDataImagesInPlace(templates);

    if (removedCount > 0) {
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
      console.warn(`Đã loại bỏ ${removedCount} ảnh Base64 cũ khỏi mẫu email để tránh treo trình duyệt. Vui lòng tải lại ảnh.`);
    }

    return templates;
  } catch (error) {
    console.error('Lỗi khi load templates từ localStorage:', error);
    localStorage.removeItem(TEMPLATES_KEY);
    return resetTemplatesToDefault();
  }
}

/**
 * Saves templates list to localStorage.
 */
export function saveTemplates(templates: EmailTemplate[]): void {
  try {
    const removedCount = removeEmbeddedDataImagesInPlace(templates);
    if (removedCount > 0) {
      console.warn(`Đã chặn ${removedCount} ảnh Base64 để bảo vệ hiệu năng trình duyệt.`);
    }
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch (error) {
    console.error('Lỗi khi lưu templates vào localStorage:', error);
  }
}

/**
 * Gets the active template ID.
 */
export function getActiveTemplateId(): string | null {
  return localStorage.getItem(ACTIVE_TEMPLATE_ID_KEY);
}

/**
 * Sets the active template ID.
 */
export function setActiveTemplateId(id: string): void {
  localStorage.setItem(ACTIVE_TEMPLATE_ID_KEY, id);
}

/**
 * Restores templates to default.
 */
export function restoreDefaultTemplates(): EmailTemplate[] {
  return resetTemplatesToDefault();
}

/**
 * Exports a template as JSON file.
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

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Lỗi khi xuất JSON template:', error);
    alert('Không thể xuất file JSON template.');
  }
}
