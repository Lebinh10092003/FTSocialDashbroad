import { EmailTemplate, EmailVariable, EmailBlock } from '../types/emailBuilder';
import { sanitizeHtml } from './emailSanitizer';
import { getVariablesInText, detectVariableWarnings, replaceVariables } from './emailVariables';

interface GeneratedEmail {
  subject: string;
  html: string;
  copyHtml: string;
  plainText: string;
  variables: string[];
  warnings: string[];
}

export function generateEmailHtml(
  template: EmailTemplate,
  variables: EmailVariable[],
  useMock: boolean = false
): GeneratedEmail {
  const warnings: string[] = [];
  const allVars: string[] = [];
  
  const settings = template.settings;
  const fontFamily = settings.fontFamily || 'Arial, Helvetica, sans-serif';
  const textColor = settings.textColor || '#1e293b';
  const linkColor = settings.linkColor || '#1473d1';
  
  // 1. Process template subject
  let processedSubject = template.subject || '';
  // Check variables in subject
  getVariablesInText(processedSubject).forEach(v => {
    if (!allVars.includes(v)) allVars.push(v);
  });
  detectVariableWarnings(processedSubject).forEach(w => {
    warnings.push(`[Tiêu đề] ${w}`);
  });
  processedSubject = replaceVariables(processedSubject, variables, useMock);

  // Helper to check HTTPS image URLs
  // Helper to check HTTPS image URLs
  const checkImageUrl = (url: string, blockName: string) => {
    if (!url) return;
    if (url.startsWith('data:image/')) return;
    
    const lowerUrl = url.toLowerCase();
    
    if (url.startsWith('blob:')) {
      warnings.push(`[${blockName}] Ảnh blob ("${url}") chỉ có hiệu lực trên trình duyệt hiện tại và người nhận thư sẽ không thể tải được. Tuy nhiên, ảnh blob sẽ được tự động biên dịch nhúng (Base64) khi thực hiện copy để tạo email hoàn chỉnh.`);
    } else if (
      lowerUrl.includes('localhost') || 
      lowerUrl.includes('127.0.0.1') || 
      lowerUrl.startsWith('/') || 
      (!lowerUrl.startsWith('http://') && !lowerUrl.startsWith('https://') && !lowerUrl.startsWith('data:'))
    ) {
      warnings.push(`[${blockName}] URL ảnh chỉ khả dụng cục bộ ("${url}") và người nhận thư sẽ không thể tải được. Tuy nhiên, ảnh nội bộ sẽ được tự động biên dịch nhúng (Base64) khi thực hiện copy để tạo email hoàn chỉnh.`);
    } else if (lowerUrl.startsWith('http://')) {
      warnings.push(`[${blockName}] URL ảnh "${url}" không sử dụng HTTPS bảo mật. Hãy chuyển sang link HTTPS để đảm bảo hình ảnh không bị chặn.`);
    }
  };

  // Helper to check normal link URLs
  const checkLinkUrl = (url: string, blockName: string) => {
    if (!url) return;
    // Skip if link is a personalization token e.g., {{Link đăng ký}}
    if (url.startsWith('{{') && url.endsWith('}}')) return;
    if (!url.toLowerCase().startsWith('https://') && !url.toLowerCase().startsWith('http://')) {
      warnings.push(`[${blockName}] URL liên kết "${url}" không hợp lệ (nên bắt đầu bằng https://).`);
    }
  };

  // Compile blocks to HTML
  const blockHtmls = template.blocks.map((block: EmailBlock) => {
    if (!block.visible) return '';

    const content = block.content;
    const styles = block.styles;
    const marginTop = styles.marginTop ?? 10;
    const marginBottom = styles.marginBottom ?? 10;

    // Scan for variables & syntax warnings in all text fields
    Object.keys(content).forEach(key => {
      const value = content[key];
      if (typeof value === 'string') {
        getVariablesInText(value).forEach(v => {
          if (!allVars.includes(v)) allVars.push(v);
        });
        detectVariableWarnings(value).forEach(w => {
          warnings.push(`[Khối ${block.type.toUpperCase()}] ${w}`);
        });
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (typeof item === 'string') {
            getVariablesInText(item).forEach(v => {
              if (!allVars.includes(v)) allVars.push(v);
            });
            detectVariableWarnings(item).forEach(w => {
              warnings.push(`[Khối ${block.type.toUpperCase()} - Dòng ${index + 1}] ${w}`);
            });
          }
        });
      } else if (typeof value === 'object' && value !== null) {
        // nested object, e.g. buttons
        Object.keys(value).forEach(subKey => {
          const subValue = value[subKey];
          if (typeof subValue === 'string') {
            getVariablesInText(subValue).forEach(v => {
              if (!allVars.includes(v)) allVars.push(v);
            });
            detectVariableWarnings(subValue).forEach(w => {
              warnings.push(`[Khối ${block.type.toUpperCase()} - Nút] ${w}`);
            });
          }
        });
      }
    });

    // Helper to replace variables inside block values
    const rep = (val: string) => replaceVariables(val, variables, useMock);

    switch (block.type) {
      case 'logo': {
        const url = content.url || '';
        const alt = content.alt || '';
        const width = content.width || 120;
        const align = content.align || 'center';
        const link = content.link || '';

        checkImageUrl(url, 'Logo');
        checkLinkUrl(link, 'Logo');

        return `
<!-- Logo Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td align="${align}" style="padding: 0;">
      ${link ? `<a href="${rep(link)}" target="_blank" style="text-decoration: none; border: none; outline: none;">` : ''}
        <img src="${rep(url)}" alt="${rep(alt)}" width="${width}" style="display: block; border: 0; outline: none; text-decoration: none; width: ${width}px; max-width: 100%; height: auto; margin: ${align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0'};" />
      ${link ? `</a>` : ''}
    </td>
  </tr>
</table>
`;
      }

      case 'heading': {
        const text = content.text || '';
        const level = content.level || 'h2';
        const fontSize = content.fontSize || 18;
        const color = content.color || '#0f3a72';
        const bold = content.bold !== false;
        const align = content.align || 'left';

        return `
<!-- Heading Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td align="${align}" style="padding: 0; text-align: ${align};">
      <${level} style="margin: 0; padding: 0; font-family: ${fontFamily}; color: ${color}; font-size: ${fontSize}px; line-height: 1.3; font-weight: ${bold ? 'bold' : 'normal'}; text-align: ${align};">
        ${rep(text)}
      </${level}>
    </td>
  </tr>
</table>
`;
      }

      case 'paragraph': {
        const rawHtml = content.html || '';
        const align = content.align || 'left';
        const sanitized = sanitizeHtml(rawHtml);
        const replaced = rep(sanitized);

        return `
<!-- Paragraph Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td align="${align}" style="padding: 0; font-family: ${fontFamily}; color: ${textColor}; font-size: 15px; line-height: 1.6; text-align: ${align}; word-break: break-word;">
      ${replaced}
    </td>
  </tr>
</table>
`;
      }

      case 'image': {
        const url = content.url || '';
        const alt = content.alt || '';
        const width = content.width || 600;
        const align = content.align || 'center';
        const borderRadius = content.borderRadius || 0;
        const link = content.link || '';

        checkImageUrl(url, 'Hình ảnh');
        checkLinkUrl(link, 'Hình ảnh');

        return `
<!-- Image Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td align="${align}" style="padding: 0;">
      ${link ? `<a href="${rep(link)}" target="_blank" style="text-decoration: none; border: none; outline: none;">` : ''}
        <img src="${rep(url)}" alt="${rep(alt)}" width="${width}" style="display: block; border: 0; outline: none; text-decoration: none; width: ${width}px; max-width: 100%; height: auto; border-radius: ${borderRadius}px; margin: ${align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0'};" />
      ${link ? `</a>` : ''}
    </td>
  </tr>
</table>
`;
      }

      case 'bullet-list':
      case 'number-list': {
        const items = content.items || [];
        const isNumbered = block.type === 'number-list';
        const listTag = isNumbered ? 'ol' : 'ul';

        return `
<!-- List Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td style="padding: 0; font-family: ${fontFamily}; color: ${textColor}; font-size: 15px; line-height: 1.6;">
      <${listTag} style="margin: 0; padding-left: 20px; font-family: ${fontFamily}; color: ${textColor}; font-size: 15px;">
        ${items.map((item: string) => `
          <li style="margin-bottom: 6px; font-family: ${fontFamily}; color: ${textColor}; font-size: 15px;">
            ${rep(sanitizeHtml(item))}
          </li>
        `).join('')}
      </${listTag}>
    </td>
  </tr>
</table>
`;
      }

      case 'button': {
        const text = content.text || '';
        const link = content.link || '';
        const bg = content.bg || settings.btnDefaultBg || '#1473d1';
        const color = content.color || settings.btnDefaultTextColor || '#ffffff';
        const radius = content.radius ?? 8;
        const align = content.align || 'center';
        const width = content.width || 'auto';

        checkLinkUrl(link, 'Nút bấm');

        return `
<!-- Button Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td align="${align}" style="padding: 0;">
      <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="width: ${width === 'full' ? '100%' : 'auto'}; border-collapse: collapse;">
        <tr>
          <td align="center" bgcolor="${bg}" style="border-radius: ${radius}px; padding: 12px 24px; text-align: center; background-color: ${bg};" valign="middle">
            <a href="${rep(link)}" target="_blank" style="display: ${width === 'full' ? 'block' : 'inline-block'}; font-family: ${fontFamily}; color: ${color}; font-size: 15px; font-weight: bold; text-decoration: none; border-radius: ${radius}px; background-color: ${bg}; width: 100%; box-sizing: border-box;">
              ${rep(text)}
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;
      }

      case 'button-group': {
        const align = content.align || 'center';
        const gap = content.gap ?? 15;
        const btn1 = content.btn1 || {};
        const btn2 = content.btn2 || {};

        checkLinkUrl(btn1.link, 'Nút nhóm 1');
        checkLinkUrl(btn2.link, 'Nút nhóm 2');

        return `
<!-- Button Group Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td align="${align}" style="padding: 0;">
      <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; display: inline-block; margin: 0 auto;">
        <tr>
          <td align="center" bgcolor="${btn1.bg || '#1473d1'}" style="border-radius: ${btn1.radius ?? 8}px; padding: 11px 22px; background-color: ${btn1.bg || '#1473d1'};" valign="middle">
            <a href="${rep(btn1.link || '')}" target="_blank" style="display: inline-block; font-family: ${fontFamily}; color: ${btn1.color || '#ffffff'}; font-size: 14px; font-weight: bold; text-decoration: none;">
              ${rep(btn1.text || '')}
            </a>
          </td>
          <td width="${gap}" style="width: ${gap}px; font-size: 1px; line-height: 1px;">&nbsp;</td>
          <td align="center" bgcolor="${btn2.bg || '#f1f5f9'}" style="border-radius: ${btn2.radius ?? 8}px; padding: 11px 22px; background-color: ${btn2.bg || '#f1f5f9'};" valign="middle">
            <a href="${rep(btn2.link || '')}" target="_blank" style="display: inline-block; font-family: ${fontFamily}; color: ${btn2.color || '#0f3a72'}; font-size: 14px; font-weight: bold; text-decoration: none;">
              ${rep(btn2.text || '')}
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;
      }

      case 'highlight-box': {
        const rawHtml = content.html || '';
        const bg = content.bg || '#eef6ff';
        const borderColor = content.borderColor || '#1473d1';
        const padding = content.padding ?? 16;
        const sanitized = sanitizeHtml(rawHtml);
        const replaced = rep(sanitized);

        return `
<!-- Highlight Box Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td style="background-color: ${bg}; border-left: 4px solid ${borderColor}; padding: ${padding}px; border-radius: 4px; font-family: ${fontFamily}; color: ${textColor}; font-size: 14px; line-height: 1.5; text-align: left; background-color: ${bg};">
      ${replaced}
    </td>
  </tr>
</table>
`;
      }

      case 'divider': {
        const thickness = styles.thickness ?? 1;
        const color = styles.color || '#e2e8f0';
        const borderStyle = styles.borderStyle || 'solid';

        return `
<!-- Divider Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td style="padding: 0; border-top: ${thickness}px ${borderStyle} ${color}; font-size: 1px; line-height: 1px; height: ${thickness}px;">&nbsp;</td>
  </tr>
</table>
`;
      }

      case 'spacer': {
        const height = styles.height ?? 20;

        return `
<!-- Spacer Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse;">
  <tr>
    <td height="${height}" style="height: ${height}px; font-size: 1px; line-height: 1px; padding: 0;">&nbsp;</td>
  </tr>
</table>
`;
      }

      case 'signature': {
        const rawHtml = content.html || '';
        const sanitized = sanitizeHtml(rawHtml);
        const replaced = rep(sanitized);

        return `
<!-- Signature Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td style="padding: 0; font-family: ${fontFamily}; color: ${textColor}; font-size: 14px; line-height: 1.5; text-align: left; word-break: break-word;">
      ${replaced}
    </td>
  </tr>
</table>
`;
      }

      case 'social-links': {
        const align = content.align || 'center';
        const links = content.links || [];

        return `
<!-- Social Links Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td align="${align}" style="padding: 0;">
      <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; display: inline-block; margin: 0 auto;">
        <tr>
          ${links.filter((l: any) => l.visible !== false).map((link: any) => {
            checkLinkUrl(link.url, 'Mạng xã hội');
            return `
            <td style="padding: 0 8px; font-family: ${fontFamily}; font-size: 13px;">
              <a href="${rep(link.url)}" target="_blank" style="color: ${linkColor}; text-decoration: none; font-weight: bold;">
                ${rep(link.label)}
              </a>
            </td>
            `;
          }).join('')}
        </tr>
      </table>
    </td>
  </tr>
</table>
`;
      }

      default:
        return '';
    }
  }).join('\n');

  // Wrapper template
  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${processedSubject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 0;">
        <table role="presentation" width="${settings.maxWidth}" border="0" cellspacing="0" cellpadding="0" style="width: 100%; max-width: ${settings.maxWidth}px; background-color: ${settings.contentBg}; border-collapse: collapse; font-family: ${fontFamily}; color: ${textColor}; text-align: left;">
          <tr>
            <td style="padding: ${settings.contentPadding}px;">
              ${blockHtmls}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Clean wrapper snippet for safe Gmail copying
  const copyHtml = `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; background-color: #ffffff;">
  <tr>
    <td align="center" style="padding: 0;">
      <table role="presentation" width="${settings.maxWidth}" border="0" cellspacing="0" cellpadding="0" style="width: 100%; max-width: ${settings.maxWidth}px; background-color: ${settings.contentBg}; border-collapse: collapse; font-family: ${fontFamily}; color: ${textColor}; text-align: left;">
        <tr>
          <td style="padding: ${settings.contentPadding}px;">
            ${blockHtmls}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

  // Build plain text fallback
  const plainTextLines: string[] = [];
  plainTextLines.push(`TIÊU ĐỀ: ${processedSubject}`);
  plainTextLines.push(`===================================`);

  template.blocks.forEach((block: EmailBlock) => {
    if (!block.visible) return;
    const content = block.content;
    const rep = (val: string) => replaceVariables(val, variables, useMock);

    switch (block.type) {
      case 'heading':
        plainTextLines.push(`\n[${content.text ? rep(content.text).toUpperCase() : ''}]`);
        break;
      case 'paragraph': {
        const text = (content.html || '').replace(/<[^>]+>/g, ' ').trim();
        if (text) plainTextLines.push(rep(text));
        break;
      }
      case 'bullet-list':
      case 'number-list':
        (content.items || []).forEach((item: string, idx: number) => {
          const cleanItem = item.replace(/<[^>]+>/g, '').trim();
          plainTextLines.push(block.type === 'number-list' ? `${idx + 1}. ${rep(cleanItem)}` : `• ${rep(cleanItem)}`);
        });
        break;
      case 'button':
        plainTextLines.push(`\n>>> ${rep(content.text)}: ${rep(content.link)} <<<`);
        break;
      case 'button-group':
        plainTextLines.push(`\n>>> ${rep(content.btn1?.text || '')}: ${rep(content.btn1?.link || '')} <<<`);
        plainTextLines.push(`>>> ${rep(content.btn2?.text || '')}: ${rep(content.btn2?.link || '')} <<<`);
        break;
      case 'highlight-box': {
        const text = (content.html || '').replace(/<[^>]+>/g, '\n').trim();
        plainTextLines.push(`\n--- LƯU Ý ---\n${rep(text)}\n-------------`);
        break;
      }
      case 'signature': {
        const text = (content.html || '').replace(/<[^>]+>/g, '\n').trim();
        plainTextLines.push(`\nCHỮ KÝ:\n${rep(text)}`);
        break;
      }
      case 'social-links': {
        const links = (content.links || []).filter((l: any) => l.visible !== false).map((l: any) => `${l.label}: ${rep(l.url)}`).join(' | ');
        if (links) plainTextLines.push(`\nKết nối: ${links}`);
        break;
      }
      default:
        break;
    }
  });

  const plainText = plainTextLines.join('\n');

  return {
    subject: processedSubject,
    html,
    copyHtml,
    plainText,
    variables: allVars,
    warnings
  };
}
