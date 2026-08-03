import { EmailSettings, EmailTemplate } from '../types/emailBuilder';
import { inlineCustomCss, sanitizeCustomHtml } from './emailSanitizer';

export const FERMATTECH_EMAIL_LOGO_URL = 'https://workspace.fermat.vn/logo.png';

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  maxWidth: 650,
  externalBg: '#f8fafc',
  contentBg: '#ffffff',
  fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
  textColor: '#1e293b',
  contentPadding: 24,
  borderRadius: 16,
  linkColor: '#1473d1',
  btnDefaultBg: '#1473d1',
  btnDefaultTextColor: '#ffffff',
};

const safeTemplateName = (value: string) => value.trim() || 'Mẫu email chưa đặt tên';
const fileNameWithoutExtension = (fileName: string) => fileName.replace(/\.(?:html?|json)$/i, '').trim();

export function createBlankEmailTemplate(name: string, timestamp = Date.now()): EmailTemplate {
  return {
    id: `template-${timestamp}`,
    name: safeTemplateName(name),
    // Template name is internal metadata. The recipient-facing subject is always authored separately.
    subject: '',
    settings: { ...DEFAULT_EMAIL_SETTINGS },
    blocks: [
      {
        id: `logo-${timestamp}`,
        type: 'logo',
        content: {
          url: FERMATTECH_EMAIL_LOGO_URL,
          alt: 'FermatTech',
          width: 120,
          align: 'center',
          link: 'https://www.fermat.vn',
        },
        styles: { marginTop: 10, marginBottom: 10 },
        visible: true,
      },
      {
        id: `heading-${timestamp + 1}`,
        type: 'heading',
        content: {
          text: '',
          html: '',
          level: 'h2',
          fontSize: 20,
          color: '#0f3a72',
          bold: true,
          align: 'left',
        },
        styles: { marginTop: 15, marginBottom: 10 },
        visible: true,
      },
      {
        id: `para-${timestamp + 2}`,
        type: 'paragraph',
        content: {
          html: '<p>Kính gửi Quý phụ huynh...</p>',
          align: 'left',
        },
        styles: { marginTop: 10, marginBottom: 10 },
        visible: true,
      },
    ],
    lastUpdated: timestamp,
  };
}

export function createEmailTemplateFromHtml(source: string, fileName: string, timestamp = Date.now()): EmailTemplate {
  if (typeof DOMParser === 'undefined') throw new Error('Trình duyệt không hỗ trợ đọc tệp HTML.');
  const documentNode = new DOMParser().parseFromString(source || '', 'text/html');
  const parserError = documentNode.querySelector('parsererror');
  if (parserError) throw new Error('Tệp HTML không hợp lệ.');

  const subject = documentNode.querySelector('title')?.textContent?.trim() || '';
  // Inline head CSS before sanitizing because email clients routinely discard
  // <style> blocks and the canvas preview only renders the imported body.
  const importedBody = sanitizeCustomHtml(inlineCustomCss(source));
  const hasVisibleContent = importedBody.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '').trim()
    || /<(?:img|table|hr)\b/i.test(importedBody);
  if (!hasVisibleContent) throw new Error('Tệp HTML không có nội dung email để nhập.');

  return {
    id: `imported-html-${timestamp}`,
    name: safeTemplateName(fileNameWithoutExtension(fileName)),
    subject,
    settings: { ...DEFAULT_EMAIL_SETTINGS },
    blocks: [{
      id: `custom-html-${timestamp}`,
      type: 'custom-html',
      content: { variant: 'style-1', html: importedBody },
      styles: { marginTop: 0, marginBottom: 0 },
      visible: true,
    }],
    lastUpdated: timestamp,
  };
}

export function isHtmlEmailFile(file: File, contents: string): boolean {
  return /\.html?$/i.test(file.name) || file.type === 'text/html' || /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(contents);
}
