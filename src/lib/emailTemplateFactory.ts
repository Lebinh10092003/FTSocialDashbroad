import { EmailSettings, EmailTemplate } from '../types/emailBuilder';
import { inlineCustomCss, sanitizeCustomHtml } from './emailSanitizer';
import { importHtmlToEmailBlocks } from './emailHtmlBlockImporter';

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

const cssPx = (value: string | null | undefined, fallback = 0) => {
  const match = String(value || '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : fallback;
};

function inferImportedEmailSettings(documentNode: Document): Partial<EmailSettings> {
  const body = documentNode.body;
  const candidates = Array.from(body.querySelectorAll('table')).filter(table => {
    const width = table.getAttribute('width') || table.style.width || table.style.maxWidth;
    const numericWidth = cssPx(width, 0);
    return numericWidth >= 320 && numericWidth <= 1200 && !/%/.test(width || '');
  });
  const contentTable = candidates.find(table => table.textContent?.trim() || table.querySelector('img')) as HTMLElement | undefined;
  const maxWidth = contentTable
    ? cssPx(contentTable.style.maxWidth || contentTable.getAttribute('width') || contentTable.style.width, DEFAULT_EMAIL_SETTINGS.maxWidth)
    : DEFAULT_EMAIL_SETTINGS.maxWidth;
  const bodyBg = body.style.backgroundColor || body.getAttribute('bgcolor') || DEFAULT_EMAIL_SETTINGS.externalBg;
  const contentBg = contentTable?.style.backgroundColor || contentTable?.getAttribute('bgcolor') || DEFAULT_EMAIL_SETTINGS.contentBg;

  return {
    maxWidth: Math.max(320, Math.min(1200, maxWidth)),
    externalBg: bodyBg,
    contentBg,
    fontFamily: body.style.fontFamily || DEFAULT_EMAIL_SETTINGS.fontFamily,
    textColor: body.style.color || DEFAULT_EMAIL_SETTINGS.textColor,
    borderRadius: Math.max(0, Math.min(80, cssPx(contentTable?.style.borderRadius, DEFAULT_EMAIL_SETTINGS.borderRadius))),
    // Imported full-email tables already carry their own cell padding.
    contentPadding: contentTable ? 0 : DEFAULT_EMAIL_SETTINGS.contentPadding,
  };
}

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

export type HtmlImportMode = 'editable' | 'preserve';

export function createEmailTemplateFromHtml(source: string, fileName: string, timestamp = Date.now(), mode: HtmlImportMode = 'editable'): EmailTemplate {
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

  const converted = mode === 'editable' ? importHtmlToEmailBlocks(importedBody, timestamp) : null;
  const blocks = converted?.blocks.length ? converted.blocks : [{
    id: `custom-html-${timestamp}`,
    type: 'custom-html' as const,
    content: { variant: 'style-1', html: importedBody },
    styles: { marginTop: 0, marginBottom: 0 },
    visible: true,
  }];

  return {
    id: `imported-html-${timestamp}`,
    name: safeTemplateName(fileNameWithoutExtension(fileName)),
    subject,
    settings: { ...DEFAULT_EMAIL_SETTINGS, ...inferImportedEmailSettings(documentNode) },
    blocks,
    lastUpdated: timestamp,
  };
}

export function isHtmlEmailFile(file: File, contents: string): boolean {
  return /\.html?$/i.test(file.name) || file.type === 'text/html' || /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(contents);
}
