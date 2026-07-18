import { EmailTemplate, EmailVariable, EmailBlock } from '../types/emailBuilder';
import { inlineCustomCss, sanitizeCustomHtml, sanitizeHtml } from './emailSanitizer';
import { getVariablesInText, detectVariableWarnings, replaceVariables } from './emailVariables';
import { getLayoutSlotIndex, normalizeEmailLayout } from './emailLayout';
import { renderEmailIconDataUri } from './emailIcon';

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
  const renderBlock = (block: EmailBlock, inheritedTextColor?: string): string => {
    if (!block.visible) return '';

    const content = block.content;
    const blockTextColor = content.color || inheritedTextColor || textColor;
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
        const width = Number(content.width) || 120;
        const height = Number(content.height) || 0;
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
        <img src="${rep(url)}" alt="${rep(alt)}" width="${width}"${height ? ` height="${height}"` : ''} style="display: block; border: 0; outline: none; text-decoration: none; width: ${width}px; max-width: 100%; height: ${height ? `${height}px` : 'auto'}; object-fit: contain; margin: ${align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0'};" />
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
        const fontSize = content.fontSize || 15;
        const lineHeight = content.lineHeight || 1.6;
        const sanitized = sanitizeHtml(rawHtml);
        const replaced = rep(sanitized);

        return `
<!-- Paragraph Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td align="${align}" style="padding: 0; font-family: ${fontFamily}; color: ${blockTextColor}; font-size: ${fontSize}px; line-height: ${lineHeight}; text-align: ${align}; word-break: break-word;">
      ${replaced}
    </td>
  </tr>
</table>
`;
      }

      case 'icon-text': {
        const iconSize = Math.max(8, Math.min(160, Number(content.iconSize) || 24));
        const fontSize = Math.max(10, Math.min(72, Number(content.fontSize) || 15));
        const gap = Math.max(0, Math.min(80, Number(content.gap) || 10));
        const align = content.align || 'left';
        const verticalAlign = content.verticalAlign || 'middle';
        const iconUrl = content.iconSource === 'upload'
          ? content.iconUrl || ''
          : renderEmailIconDataUri(content.iconName || 'CircleCheck', content.iconColor || '#1473D1', iconSize);
        const text = rep(content.text || '');
        checkImageUrl(iconUrl, 'Icon minh họa');
        const iconCell = iconUrl
          ? `<td width="${iconSize}" valign="${verticalAlign}" style="width:${iconSize}px;padding:0;vertical-align:${verticalAlign};"><img src="${rep(iconUrl)}" alt="" width="${iconSize}" height="${iconSize}" style="display:block;width:${iconSize}px;height:${iconSize}px;max-width:none;border:0;outline:none;object-fit:contain;" /></td><td width="${gap}" style="width:${gap}px;padding:0;font-size:1px;line-height:1px;">&nbsp;</td>`
          : '';
        return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:${marginTop}px;margin-bottom:${marginBottom}px;"><tr><td align="${align}" style="padding:0;text-align:${align};"><table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;display:inline-table;"><tr>${iconCell}<td valign="${verticalAlign}" style="padding:0;vertical-align:${verticalAlign};font-family:${fontFamily};font-size:${fontSize}px;line-height:1.45;color:${blockTextColor};">${text}</td></tr></table></td></tr></table>`;
      }
      case 'image': {
        const url = content.url || '';
        const alt = content.alt || '';
        const width = Number(content.width) || 600;
        const height = Number(content.height) || 0;
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
        <img src="${rep(url)}" alt="${rep(alt)}" width="${width}"${height ? ` height="${height}"` : ''} style="display: block; border: 0; outline: none; text-decoration: none; width: ${width}px; max-width: 100%; height: ${height ? `${height}px` : 'auto'}; object-fit: ${height ? 'cover' : 'contain'}; border-radius: ${borderRadius}px; margin: ${align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0'};" />
      ${link ? `</a>` : ''}
    </td>
  </tr>
</table>
`;
      }

      case 'bullet-list':
      case 'number-list': {
        const items = content.items || [];
        const fontSize = content.fontSize || 15;
        const lineHeight = content.lineHeight || 1.6;
        const isNumbered = block.type === 'number-list';
        const listTag = isNumbered ? 'ol' : 'ul';

        return `
<!-- List Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td style="padding: 0; font-family: ${fontFamily}; color: ${blockTextColor}; font-size: ${fontSize}px; line-height: ${lineHeight};">
      <${listTag} style="margin: 0; padding-left: 20px; font-family: ${fontFamily}; color: ${blockTextColor}; font-size: ${fontSize}px; line-height: ${lineHeight};">
        ${items.map((item: string) => `
          <li style="margin-bottom: 6px; font-family: ${fontFamily}; color: ${blockTextColor}; font-size: ${fontSize}px; line-height: ${lineHeight};">
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
        const fontSize = content.fontSize || 15;
        const paddingX = Number(content.paddingX) || 24;
        const paddingY = Number(content.paddingY) || 12;
        const minWidth = Math.max(0, Number(content.minWidth) || 0);

        checkLinkUrl(link, 'Nút bấm');

        return `
<!-- Button Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td align="${align}" style="padding: 0;">
      <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="width: ${width === 'full' ? '100%' : 'auto'};${minWidth ? `min-width:${minWidth}px;` : ''} border-collapse: collapse;">
        <tr>
          <td align="center" bgcolor="${bg}" style="border-radius: ${radius}px; padding: ${paddingY}px ${paddingX}px;${minWidth ? `min-width:${minWidth}px;` : ''} text-align: center; background-color: ${bg};" valign="middle">
            <a href="${rep(link)}" target="_blank" style="display: ${width === 'full' ? 'block' : 'inline-block'}; font-family: ${fontFamily}; color: ${color}; font-size: ${fontSize}px; font-weight: bold; text-decoration: none; border-radius: ${radius}px; background-color: ${bg}; width: 100%; box-sizing: border-box;">
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

      case 'button-group':
      case 'button-group-3': {
        const align = content.align || 'center'; const gap = content.gap ?? 12;
        const buttons = content.buttons || [content.btn1, content.btn2].filter(Boolean);
        buttons.forEach((button: any, index: number) => checkLinkUrl(button.link, `Nút hành động ${index + 1}`));
        const cells = buttons.map((button: any, index: number) => {
          const paddingX = Number(button.paddingX) || 18;
          const paddingY = Number(button.paddingY) || 11;
          const minWidth = Math.max(0, Number(button.minWidth) || 0);
          const fontSize = Number(button.fontSize) || 14;
          return `<td align="center" bgcolor="${button.bg || '#0F3A72'}"${minWidth ? ` width="${minWidth}"` : ''} style="border-radius:${button.radius ?? 8}px;padding:${paddingY}px ${paddingX}px;background-color:${button.bg || '#0F3A72'};${minWidth ? `min-width:${minWidth}px;` : ''}"><a href="${rep(button.link || '')}" target="_blank" style="display:inline-block;font-family:${fontFamily};color:${button.color || '#ffffff'};font-size:${fontSize}px;line-height:1.2;font-weight:bold;text-decoration:none;white-space:nowrap;">${rep(button.text || '')}</a></td>${index < buttons.length - 1 ? `<td width="${gap}" style="width:${gap}px;font-size:1px;line-height:1px;">&nbsp;</td>` : ''}`;
        }).join('');
        return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:${marginTop}px;margin-bottom:${marginBottom}px;"><tr><td align="${align}" style="padding:0;"><table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;display:inline-table;"><tr>${cells}</tr></table></td></tr></table>`;
      }

      case 'highlight-box': {
        const rawHtml = content.html || '';
        const bg = content.bg || '#eef6ff';
        const borderColor = content.borderColor || '#1473d1';
        const padding = content.padding ?? 16;
        const fontSize = content.fontSize || 14;
        const lineHeight = content.lineHeight || 1.5;
        const sanitized = sanitizeHtml(rawHtml);
        const replaced = rep(sanitized);

        return `
<!-- Highlight Box Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td style="background-color: ${bg}; border-left: 4px solid ${borderColor}; padding: ${padding}px; border-radius: 4px; font-family: ${fontFamily}; color: ${blockTextColor}; font-size: ${fontSize}px; line-height: ${lineHeight}; text-align: left; background-color: ${bg};">
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
        const fontSize = content.fontSize || 14;
        const lineHeight = content.lineHeight || 1.5;
        const sanitized = sanitizeHtml(rawHtml);
        const replaced = rep(sanitized);

        return `
<!-- Signature Block -->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td style="padding: 0; font-family: ${fontFamily}; color: ${blockTextColor}; font-size: ${fontSize}px; line-height: ${lineHeight}; text-align: left; word-break: break-word;">
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

      case 'custom-html': {
        const custom = rep(inlineCustomCss(sanitizeCustomHtml(content.html || '')));
        return '<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:' + marginTop + 'px;margin-bottom:' + marginBottom + 'px"><tr><td style="padding:0">' + custom + '</td></tr></table>';
      }
      case 'columns': {
        const { layout, slots } = normalizeEmailLayout(block);
        const horizontalGap = Math.max(0, Number(content.horizontalGap) || 0);
        const verticalGap = Math.max(0, Number(content.verticalGap) || 0);
        const totalWeight = layout.reduce((total, column) => total + Math.max(1, Number(column.width) || 1), 0);
        const targetHeight = Math.max(...layout.map(column => column.cells.reduce((total, cell) => total + cell.minHeight, 0) + Math.max(0, column.cells.length - 1) * verticalGap));
        const columnCells = layout.map((column, columnIndex) => {
          const baseHeight = column.cells.reduce((total, cell) => total + cell.minHeight, 0) + Math.max(0, column.cells.length - 1) * verticalGap;
          const extraPerCell = Math.max(0, targetHeight - baseHeight) / column.cells.length;
          const rows = column.cells.map((cell, cellIndex) => {
            const slotIndex = getLayoutSlotIndex(layout, columnIndex, cellIndex);
            const inner = (slots[slotIndex] || []).map(child => renderBlock(child, cell.color || blockTextColor)).join('') || '&nbsp;';
            const height = Math.round(cell.minHeight + extraPerCell);
            const cellHtml = `<tr><td height="${height}" valign="${cell.verticalAlign}" bgcolor="${cell.background}" style="height:${height}px;padding:${cell.padding}px;background-color:${cell.background};color:${cell.color || blockTextColor};border:${cell.borderWidth}px solid ${cell.borderColor};border-radius:${cell.borderRadius}px;vertical-align:${cell.verticalAlign};font-family:${fontFamily};">${inner}</td></tr>`;
            return cellHtml + (cellIndex < column.cells.length - 1 ? `<tr><td height="${verticalGap}" style="height:${verticalGap}px;font-size:1px;line-height:1px;padding:0;">&nbsp;</td></tr>` : '');
          }).join('');
          const columnWeight = Math.max(1, Number(column.width) || 1);
          const width = columnWeight / totalWeight * 100;
          const gapShare = horizontalGap * Math.max(0, layout.length - 1) * columnWeight / totalWeight;
          const widthStyle = horizontalGap ? `calc(${width.toFixed(2)}% - ${gapShare.toFixed(2)}px)` : `${width.toFixed(2)}%`;
          const spacer = columnIndex < layout.length - 1 ? `<td width="${horizontalGap}" style="width:${horizontalGap}px;min-width:${horizontalGap}px;font-size:1px;line-height:1px;padding:0;">&nbsp;</td>` : '';
          return `<td width="${width.toFixed(2)}%" height="100%" valign="top" style="width:${widthStyle};height:100%;padding:0;vertical-align:top;"><table role="presentation" width="100%" height="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;height:100%;min-height:${targetHeight}px;border-collapse:separate;">${rows}</table></td>${spacer}`;
        }).join('');
        return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;border-collapse:collapse;margin-top:${marginTop}px;margin-bottom:${marginBottom}px;"><tr style="height:100%;">${columnCells}</tr></table>`;
      }      case 'data-table': {
        const rows: string[][] = Array.isArray(content.rows) ? content.rows : [];
        const heading = content.heading ? `<div style="margin:0 0 10px;font-family:${fontFamily};font-size:18px;line-height:1.3;font-weight:bold;color:#0F3A72;">${rep(content.heading)}</div>` : '';
        const tableRows = rows.map((row, rowIndex) => `<tr>${row.map(cell => rowIndex === 0
          ? `<th align="left" style="padding:10px;border:1px solid #cbd5e1;background:#f1f5f9;font-family:${fontFamily};font-size:13px;line-height:1.4;font-weight:bold;color:${blockTextColor};">${rep(cell)}</th>`
          : `<td align="left" style="padding:10px;border:1px solid #cbd5e1;font-family:${fontFamily};font-size:13px;line-height:1.4;color:${blockTextColor};">${rep(cell)}</td>`).join('')}</tr>`).join('');
        return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:${marginTop}px;margin-bottom:${marginBottom}px;"><tr><td style="padding:0;">${heading}<table role="table" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;table-layout:fixed;">${tableRows}</table></td></tr></table>`;
      }
      case 'section': {
        const title = rep(content.heading || '');
        const body = rep(content.body || '');
        const children = (block.children || []).map(child => renderBlock(child, blockTextColor)).join('');
        return '<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:' + marginTop + 'px;margin-bottom:' + marginBottom + 'px"><tr><td style="padding:' + (content.padding ?? 24) + 'px;background:' + (content.bg || '#f8fafc') + ';border:1px solid #e2e8f0;font-family:' + fontFamily + ';color:' + blockTextColor + '"><strong style="color:#0F3A72">' + title + '</strong><div style="margin-top:6px;line-height:1.5">' + body + '</div>' + children + '</td></tr></table>';
      }
      case 'image-text': case 'testimonial': case 'callout': case 'gallery': case 'video': case 'feature-list': case 'product-card': case 'product-grid': case 'pricing-table': case 'header': case 'footer': case 'merge-tag': {
        const title = rep(content.heading || content.title || content.name || content.company || content.author || '');
        const body = rep(content.body || content.description || content.text || content.quote || content.price || content.navigation || content.address || '');
        return '<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:' + marginTop + 'px;margin-bottom:' + marginBottom + 'px"><tr><td style="padding:16px;border:1px solid #e2e8f0;font-family:' + fontFamily + ';color:' + blockTextColor + '"><strong style="color:#0F3A72">' + title + '</strong><div style="margin-top:6px;line-height:1.5">' + body + '</div></td></tr></table>';
      }
      default:
        return '';
    }
  };

  const blockHtmls = template.blocks.map(block => renderBlock(block)).join('\n');

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
      case 'icon-text':
        if (content.text) plainTextLines.push(rep(content.text));
        break;
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
      case 'button-group-3':
        (content.buttons || [content.btn1, content.btn2].filter(Boolean)).forEach((button: any) => plainTextLines.push(`>>> ${rep(button.text || '')}: ${rep(button.link || '')} <<<`));
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
