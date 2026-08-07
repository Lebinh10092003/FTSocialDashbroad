import { EmailTemplate, EmailVariable, EmailBlock } from '../types/emailBuilder';
import { inlineCustomCss, sanitizeCustomHtml, sanitizeHtml } from './emailSanitizer';
import { getVariablesInText, detectVariableWarnings, replaceVariables } from './emailVariables';
import { getEmailLayoutColumnWidths, getLayoutSlotIndex, normalizeEmailLayout } from './emailLayout';
import { renderEmailIconDataUri } from './emailIcon';
import { emailIconRasterKey } from './emailIconDelivery';
import { getEmailBlockPresentation, getEmailLayoutCellPresentation, isDarkEmailColor } from './emailPresentation';

interface GeneratedEmail {
  subject: string;
  /** HTML dùng để gửi/copy email (tối ưu cho email clients, body trắng) */
  html: string;
  /** HTML dùng để copy vào Gmail/Outlook (không có <!DOCTYPE>) */
  copyHtml: string;
  /** HTML dùng cho iframe preview trong app (có externalBg, padding đúng) */
  previewHtml: string;
  plainText: string;
  variables: string[];
  warnings: string[];
}

/**
 * contentEditable can retain a real newline inside a text node. Browsers show
 * that newline while editing, but normal email HTML collapses it to a space.
 * Convert only meaningful newlines in text fragments; keep formatting
 * whitespace between HTML tags untouched.
 */
const preserveRichTextLineBreaks = (html: string) => html
  .split(/(<[^>]+>)/g)
  .map(fragment => {
    if (!fragment.includes('\n') || fragment.startsWith('<') || !fragment.trim()) return fragment;
    const withoutFormattingEdges = fragment
      .replace(/\r\n?/g, '\n')
      .replace(/^[\t ]*\n[\t ]*/, '')
      .replace(/[\t ]*\n[\t ]*$/, '');
    return withoutFormattingEdges.replace(/[\t ]*\n[\t ]*/g, '<br>');
  })
  .join('');
const escapePlainTextHtml = (text = '') => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// A button owns its URL through its outer anchor; nested anchors make browsers resolve {{Variable}} as a relative URL.
const stripButtonInnerLinks = (html: string) => html.replace(/<\/?a\b[^>]*>/gi, '');

/** Turn pasted bare web addresses into safe, clickable links without changing existing anchors. */
const autoLinkPlainUrls = (html: string, linkColor: string) => {
  if (typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('a')) continue;
    if (/https?:\/\/[^\s<>"']+/i.test(node.textContent || '')) textNodes.push(node as Text);
  }

  textNodes.forEach(textNode => {
    const source = textNode.textContent || '';
    const fragment = document.createDocumentFragment();
    const urlPattern = /https?:\/\/[^\s<>"']+/gi;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = urlPattern.exec(source))) {
      const rawUrl = match[0];
      const trailingPunctuation = rawUrl.match(/[.,;:!?]+$/)?.[0] || '';
      const url = rawUrl.slice(0, rawUrl.length - trailingPunctuation.length);
      fragment.append(source.slice(cursor, match.index));
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.color = linkColor;
      link.style.textDecoration = 'underline';
      link.textContent = url;
      fragment.append(link);
      if (trailingPunctuation) fragment.append(trailingPunctuation);
      cursor = match.index + rawUrl.length;
    }
    fragment.append(source.slice(cursor));
    textNode.parentNode?.replaceChild(fragment, textNode);
  });
  return document.body.innerHTML;
};
export function generateEmailHtml(
  template: EmailTemplate,
  variables: EmailVariable[],
  useMock: boolean = false
): GeneratedEmail {
  const warnings: string[] = [];
  const allVars: string[] = [];
  
  const settings = template.settings;
  // Inline email styles are quoted HTML attributes. Double quotes inside a
  // configured font stack would terminate the style attribute and discard all
  // following declarations (color, size, line-height, etc.).
  const fontFamily = String(settings.fontFamily || 'Roboto, "Helvetica Neue", Arial, sans-serif')
    .replace(/"/g, "'")
    .replace(/[<>]/g, '');
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
  const renderBlock = (block: EmailBlock, inheritedTextColor?: string, fillHeight = false): string => {
    if (!block.visible) return '';

    const content = block.content;
    const styles = block.styles;
    const presentation = getEmailBlockPresentation(block, settings, inheritedTextColor);
    const blockTextColor = presentation.textColor;
    const marginTop = presentation.marginTop;
    const marginBottom = presentation.marginBottom;
    const fillHeightAttribute = fillHeight ? ' height="100%"' : '';
    const fillHeightStyle = fillHeight ? ' height: 100%;' : '';

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
    const htmlOverride = typeof content.htmlOverride === 'string' ? content.htmlOverride.trim() : '';
    if (htmlOverride) {
      const safeHtml = inlineCustomCss(sanitizeCustomHtml(rep(htmlOverride)));
      return `<div class="ft-email-block ft-email-block-html-override" style="margin-top:${marginTop}px;margin-bottom:${marginBottom}px;color:${blockTextColor};${fillHeightStyle}">${safeHtml}</div>`;
    }

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
      ${link ? `<a href="${rep(link)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; border: none; outline: none;">` : ''}
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
        const renderedText = preserveRichTextLineBreaks(rep(sanitizeHtml(content.html || escapePlainTextHtml(text))));

        return `
<!-- Heading Block -->
<table role="presentation" class="ft-email-block ft-email-heading" data-ft-block-id="${block.id}" data-ft-block-type="heading" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td align="${presentation.align}" style="padding: 0; text-align: ${presentation.align};">
      <${level} style="margin: 0; padding: 0; font-family: ${fontFamily}; color: ${presentation.textColor}; font-size: ${presentation.fontSize}px; line-height: ${presentation.lineHeight}; font-weight: ${presentation.fontWeight}; text-align: ${presentation.align};">
        ${renderedText}
      </${level}>
    </td>
  </tr>
</table>
`;
      }

      case 'paragraph': {
        const rawHtml = content.html || '';
        const sanitized = sanitizeHtml(rawHtml);
        const replaced = autoLinkPlainUrls(preserveRichTextLineBreaks(rep(sanitized)), linkColor);

        return `
<!-- Paragraph Block -->
<table role="presentation" class="ft-email-block ft-email-paragraph" data-ft-block-id="${block.id}" data-ft-block-type="paragraph" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td align="${presentation.align}" style="padding: 0; font-family: ${fontFamily}; color: ${presentation.textColor}; font-size: ${presentation.fontSize}px; line-height: ${presentation.lineHeight}; font-weight: ${presentation.fontWeight}; font-style: ${presentation.fontStyle}; letter-spacing: ${presentation.letterSpacing}px; text-transform: ${presentation.textTransform}; text-align: ${presentation.align}; word-break: break-word;">
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
        const iconName = content.iconName || 'CircleCheck';
        const iconColor = content.iconColor || '#1473D1';
        const currentRasterKey = emailIconRasterKey(iconName, iconColor);
        const preparedPng = content.iconRasterKey === currentRasterKey ? content.iconPngUrl || '' : '';
        const iconUrl = content.iconSource === 'upload'
          ? content.iconUrl || ''
          : preparedPng || renderEmailIconDataUri(iconName, iconColor, iconSize);
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
      ${link ? `<a href="${rep(link)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; border: none; outline: none;">` : ''}
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
        const renderedText = preserveRichTextLineBreaks(rep(stripButtonInnerLinks(sanitizeHtml(content.html || escapePlainTextHtml(text)))));
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
      <table role="presentation" class="ft-email-button-table" border="0" cellspacing="0" cellpadding="0" style="width: ${width === 'full' ? '100%' : 'auto'};${minWidth ? `min-width:${minWidth}px;` : ''} border-collapse: collapse;">
        <tr>
          <td class="ft-email-button-cell" align="center" bgcolor="${bg}" style="border-radius: ${radius}px; padding: ${paddingY}px ${paddingX}px;${minWidth ? `min-width:${minWidth}px;` : ''} text-align: center; background-color: ${bg}; white-space: normal;" valign="middle">
            <a class="ft-email-button-text" href="${rep(link)}" target="_blank" rel="noopener noreferrer" style="display: ${width === 'full' ? 'block' : 'inline-block'}; font-family: ${fontFamily}; color: ${color}; font-size: ${fontSize}px; font-weight: bold; text-decoration: none; border-radius: ${radius}px; background-color: ${bg}; ${width === 'full' ? 'width: 100%;' : 'width: auto;'} box-sizing: border-box; white-space: normal; overflow-wrap: anywhere;">
              ${renderedText}
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
          const renderedButtonText = preserveRichTextLineBreaks(rep(stripButtonInnerLinks(sanitizeHtml(button.html || escapePlainTextHtml(button.text || '')))));
          return `<td class="ft-email-button-cell" align="center" bgcolor="${button.bg || '#0F3A72'}"${minWidth ? ` width="${minWidth}"` : ''} style="border-radius:${button.radius ?? 8}px;padding:${paddingY}px ${paddingX}px;background-color:${button.bg || '#0F3A72'};${minWidth ? `min-width:${minWidth}px;` : ''}"><a class="ft-email-button-text" href="${rep(button.link || '')}" target="_blank" rel="noopener noreferrer" style="display:inline-block;font-family:${fontFamily};color:${button.color || '#ffffff'};font-size:${fontSize}px;line-height:1.2;font-weight:bold;text-decoration:none;white-space:normal;overflow-wrap:anywhere;">${renderedButtonText}</a></td>${index < buttons.length - 1 ? `<td class="ft-email-button-gap" width="${gap}" style="width:${gap}px;font-size:1px;line-height:1px;padding:0;margin:0;">&nbsp;</td>` : ''}`;
        }).join('');
        return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:${marginTop}px;margin-bottom:${marginBottom}px;"><tr><td align="${align}" style="padding:0;"><table role="presentation" class="ft-email-button-group" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;display:inline-table;"><tr>${cells}</tr></table></td></tr></table>`;
      }

      case 'highlight-box': {
        const rawHtml = content.html || '';
        const bg = content.bg || '#eef6ff';
        const borderColor = content.borderColor || '#1473d1';
        const padding = content.padding ?? 16;
        const fontSize = content.fontSize || 14;
        const lineHeight = content.lineHeight || 1.5;
        const sanitized = sanitizeHtml(rawHtml);
        const replaced = preserveRichTextLineBreaks(rep(sanitized));

        return `
<!-- Highlight Box Block -->
<table role="presentation" class="ft-email-block${fillHeight ? ' ft-email-fill-height' : ''}" width="100%"${fillHeightAttribute} border="0" cellspacing="0" cellpadding="0" style="width: 100%;${fillHeightStyle} border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
  <tr>
    <td${fillHeightAttribute} valign="middle" style="${fillHeightStyle} background-color: ${bg}; border-left: 4px solid ${borderColor}; padding: ${padding}px; border-radius: 4px; font-family: ${fontFamily}; color: ${blockTextColor}; font-size: ${fontSize}px; line-height: ${lineHeight}; text-align: left; background-color: ${bg}; vertical-align: middle;">
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

      case 'signature-builder': {
        const width = Math.max(320, Math.min(900, Number(content.width) || 650));
        const logoWidth = Math.max(48, Math.min(320, Number(content.logoWidth) || 150));
        const padding = Math.max(0, Math.min(48, Number(content.padding) || 18));
        const accent = content.accentColor || '#1473D1';
        const text = content.textColor || '#28323D';
        const titleSize = Math.max(12, Math.min(48, Number(content.titleSize) || 22));
        const bodySize = Math.max(9, Math.min(24, Number(content.bodySize) || 12));
        const socialDefinitions = [
          ['Facebook', 'Facebook', 'facebookUrl', 'showFacebook'],
          ['LinkedIn', 'in', 'linkedInUrl', 'showLinkedIn'],
          ['YouTube', '▶', 'youtubeUrl', 'showYoutube'],
          ['Instagram', '◎', 'instagramUrl', 'showInstagram'],
          [content.otherLabel || 'Kênh khác', '•', 'otherUrl', 'showOther'],
        ];
        const socialLinks = socialDefinitions.filter(([, , urlKey, visibleKey]) => content[visibleKey] !== false && content[urlKey]);
        socialLinks.forEach(([, , urlKey]) => checkLinkUrl(content[urlKey], 'Liên kết chữ ký'));
        const details = [
          content.phone ? `Điện thoại: ${rep(content.phone)}` : '',
          content.email ? `Email: ${rep(content.email)}` : '',
          content.website ? `Website: ${rep(content.website)}` : '',
          content.address ? `Địa chỉ: ${rep(content.address)}` : '',
        ].filter(Boolean).join('<br>');
        const socials = socialLinks.length ? `<tr><td style="padding-top:10px;font-family:${fontFamily};font-size:${bodySize}px;line-height:1.4;">${socialLinks.map(([label, mark, urlKey]) => `<a href="${rep(content[urlKey])}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:0 8px 4px 0;color:${accent};text-decoration:none;font-weight:bold;"><span style="display:inline-block;min-width:18px;height:18px;line-height:18px;margin-right:4px;border-radius:9px;background:${accent};color:#ffffff;text-align:center;font-size:10px;">${mark}</span>${rep(label)}</a>`).join('')}</td></tr>` : '';
        const logo = content.logoUrl ? `<td width="${Math.min(220, logoWidth + 36)}" valign="middle" align="center" style="width:${Math.min(220, logoWidth + 36)}px;padding:${padding}px;border-right:1px solid #d9e2ef;"><img src="${rep(content.logoUrl)}" alt="${rep(content.logoAlt || 'Logo')}" width="${logoWidth}" style="display:block;width:${logoWidth}px;max-width:100%;height:auto;border:0;margin:0 auto;"></td>` : '';
        const divider = content.logoUrl ? '' : `border-left:0;`;
        return `<table role="presentation" class="ft-email-block ft-email-signature-builder" width="${width}" border="0" cellspacing="0" cellpadding="0" style="width:100%;max-width:${width}px;border-collapse:collapse;border-top:5px solid ${accent};border-bottom:6px solid ${accent};margin-top:${marginTop}px;margin-bottom:${marginBottom}px;"><tr>${logo}<td valign="top" style="${divider}padding:${padding}px;font-family:${fontFamily};color:${text};"><div style="font-size:${titleSize}px;line-height:1.2;font-weight:700;letter-spacing:.2px;color:${accent};text-transform:uppercase;">${rep(content.fullName || '')}</div><div style="padding-top:5px;font-size:${Math.max(10, bodySize + 1)}px;line-height:1.4;color:${text};">${rep(content.jobTitle || '')}</div><div style="padding-top:6px;font-size:${Math.max(10, bodySize + 1)}px;line-height:1.4;font-weight:700;color:${accent};text-transform:uppercase;">${rep(content.company || '')}</div><div style="margin:10px 0 9px;border-top:1px solid #d9e2ef;font-size:1px;line-height:1px;">&nbsp;</div><div style="font-size:${bodySize}px;line-height:1.65;color:${text};">${details}</div><table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${socials}</table></td></tr></table>`;
      }
      case 'signature': {
        const rawHtml = content.html || '';
        const fontSize = content.fontSize || 14;
        const lineHeight = content.lineHeight || 1.5;
        const sanitized = sanitizeHtml(rawHtml);
        const replaced = preserveRichTextLineBreaks(rep(sanitized));

        return `
<!-- Signature Block -->
<table role="presentation" class="ft-email-block ft-email-signature" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: ${marginTop}px; margin-bottom: ${marginBottom}px;">
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
              <a href="${rep(link.url)}" target="_blank" rel="noopener noreferrer" style="color: ${linkColor}; text-decoration: none; font-weight: bold;">
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
        return '<table role="presentation" class="ft-email-block" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;border-collapse:collapse;margin-top:' + marginTop + 'px;margin-bottom:' + marginBottom + 'px"><tr><td style="padding:0">' + custom + '</td></tr></table>';
      }
      case 'columns': {
        const { layout, slots } = normalizeEmailLayout(block);
        const horizontalGap = Math.max(0, Number(content.horizontalGap) || 0);
        const verticalGap = Math.max(0, Number(content.verticalGap) || 0);
        const availableWidth = Math.max(1, settings.maxWidth - settings.contentPadding * 2);
        const columnWidths = getEmailLayoutColumnWidths(layout, availableWidth, horizontalGap);
        const equalRowCount = layout.every(column => column.cells.length === layout[0].cells.length);
        const requestedHeight = (cell: typeof layout[number]['cells'][number]) => {
          const requested = cell.heightMode === 'fixed' ? cell.height : cell.minHeight;
          return cell.maxHeight > 0 ? Math.min(requested, cell.maxHeight) : requested;
        };
        const cellHtml = (columnIndex: number, cellIndex: number, rowHeight = 0, nested = false) => {
          const column = layout[columnIndex];
          const cell = column.cells[cellIndex];
          const slotIndex = getLayoutSlotIndex(layout, columnIndex, cellIndex);
          const slotBlocks = slots[slotIndex] || [];
          const shouldFill = slotBlocks.length === 1 && ['heading', 'paragraph', 'highlight-box', 'signature'].includes(slotBlocks[0].type);
          const cellPresentation = getEmailLayoutCellPresentation(cell, settings, blockTextColor);
          const inner = slotBlocks.map(child => renderBlock(child, cellPresentation.textColor, shouldFill)).join('') || '&nbsp;';
          const width = nested ? 100 : columnWidths[columnIndex] / availableWidth * 100;
          const height = Math.max(rowHeight, requestedHeight(cell));
          const heightAttribute = height > 0 ? ` height="${Math.round(height)}"` : '';
          const heightStyle = height > 0 ? `height:${Math.round(height)}px;min-height:${Math.round(height)}px;` : '';
          const spacer = !nested && columnIndex < layout.length - 1 ? `<td aria-hidden="true" width="${horizontalGap}" style="width:${horizontalGap}px;min-width:${horizontalGap}px;font-size:1px;line-height:1px;padding:0;">&nbsp;</td>` : '';
          return `<td class="ft-email-layout-cell" width="${width.toFixed(2)}%"${heightAttribute} valign="${cellPresentation.verticalAlign}" bgcolor="${cellPresentation.backgroundColor}" style="width:${width.toFixed(2)}%;${heightStyle}box-sizing:border-box;padding:${cellPresentation.padding}px;background-color:${cellPresentation.backgroundColor};color:${cellPresentation.textColor};border:${cellPresentation.borderWidth}px solid ${cellPresentation.borderColor};border-radius:${cellPresentation.borderRadius}px;vertical-align:${cellPresentation.verticalAlign};font-family:${fontFamily};overflow:visible;">${inner}</td>${spacer}`;
        };

        if (equalRowCount) {
          const rowCount = layout[0].cells.length;
          const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
            const rowHeight = Math.max(0, ...layout.map(column => requestedHeight(column.cells[rowIndex])));
            const cells = layout.map((_, columnIndex) => cellHtml(columnIndex, rowIndex, rowHeight)).join('');
            const row = `<tr${rowHeight > 0 ? ` height="${Math.round(rowHeight)}" style="height:${Math.round(rowHeight)}px;"` : ''}>${cells}</tr>`;
            const gap = rowIndex < rowCount - 1 ? `<tr height="${verticalGap}"><td colspan="${layout.length * 2 - 1}" height="${verticalGap}" style="height:${verticalGap}px;font-size:1px;line-height:1px;padding:0;">&nbsp;</td></tr>` : '';
            return row + gap;
          }).join('');
          return `<table role="presentation" class="ft-email-block ft-email-layout" data-ft-block-id="${block.id}" data-ft-block-type="columns" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;border-collapse:collapse;margin-top:${marginTop}px;margin-bottom:${marginBottom}px;">${rows}</table>`;
        }

        const targetHeight = Math.max(0, ...layout.map(column => column.cells.reduce((total, cell) => total + requestedHeight(cell), 0) + Math.max(0, column.cells.length - 1) * verticalGap));
        const columnCells = layout.map((column, columnIndex) => {
          const columnHeight = column.cells.reduce((total, cell) => total + requestedHeight(cell), 0) + Math.max(0, column.cells.length - 1) * verticalGap;
          const extraPerCell = Math.max(0, targetHeight - columnHeight) / column.cells.length;
          const rows = column.cells.map((cell, cellIndex) => {
            const height = requestedHeight(cell) + extraPerCell;
            const row = `<tr>${cellHtml(columnIndex, cellIndex, height, true)}</tr>`;
            return row + (cellIndex < column.cells.length - 1 ? `<tr height="${verticalGap}"><td height="${verticalGap}" style="height:${verticalGap}px;font-size:1px;line-height:1px;padding:0;">&nbsp;</td></tr>` : '');
          }).join('');
          const width = columnWidths[columnIndex] / availableWidth * 100;
          const spacer = columnIndex < layout.length - 1 ? `<td aria-hidden="true" width="${horizontalGap}" style="width:${horizontalGap}px;min-width:${horizontalGap}px;font-size:1px;line-height:1px;padding:0;">&nbsp;</td>` : '';
          return `<td width="${width.toFixed(2)}%" valign="top" style="width:${width.toFixed(2)}%;padding:0;vertical-align:top;"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;">${rows}</table></td>${spacer}`;
        }).join('');
        return `<table role="presentation" class="ft-email-block ft-email-layout" data-ft-block-id="${block.id}" data-ft-block-type="columns" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;border-collapse:collapse;margin-top:${marginTop}px;margin-bottom:${marginBottom}px;"><tr>${columnCells}</tr></table>`;
      }      case 'data-table': {
        const rows: string[][] = Array.isArray(content.rows) ? content.rows : [];
        const heading = content.heading ? `<div style="margin:0 0 10px;font-family:${fontFamily};font-size:18px;line-height:1.3;font-weight:bold;color:#0F3A72;">${rep(content.heading)}</div>` : '';
        const tableRows = rows.map((row, rowIndex) => `<tr>${row.map(cell => rowIndex === 0
          ? `<th align="left" style="padding:${presentation.tableCellPadding}px;border:1px solid ${presentation.borderColor};background:${presentation.tableHeaderBackground};font-family:${fontFamily};font-size:${presentation.tableFontSize}px;line-height:${presentation.tableLineHeight};font-weight:bold;color:${presentation.textColor};">${rep(cell)}</th>`
          : `<td align="left" style="padding:${presentation.tableCellPadding}px;border:1px solid ${presentation.borderColor};font-family:${fontFamily};font-size:${presentation.tableFontSize}px;line-height:${presentation.tableLineHeight};color:${presentation.textColor};">${rep(cell)}</td>`).join('')}</tr>`).join('');
        return `<table role="presentation" class="ft-email-block ft-email-data-table" data-ft-block-id="${block.id}" data-ft-block-type="data-table" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:${marginTop}px;margin-bottom:${marginBottom}px;"><tr><td style="padding:0;">${heading}<table role="table" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;table-layout:fixed;">${tableRows}</table></td></tr></table>`;
      }
      case 'section': {
        const title = rep(content.heading || '');
        const body = rep(content.body || '');
        const children = (block.children || []).map(child => renderBlock(child, presentation.textColor)).join('');
        const titleColor = content.color || (isDarkEmailColor(presentation.backgroundColor) ? '#ffffff' : '#0F3A72');
        const titleHtml = title ? '<strong style="display:block;color:' + titleColor + '">' + title + '</strong>' : '';
        const bodyHtml = body ? '<div style="margin-top:' + (title ? 6 : 0) + 'px;line-height:1.5">' + body + '</div>' : '';
        return '<table role="presentation" class="ft-email-block ft-email-section" data-ft-block-id="' + block.id + '" data-ft-block-type="section" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;margin-top:' + marginTop + 'px;margin-bottom:' + marginBottom + 'px"><tr><td bgcolor="' + presentation.backgroundColor + '" style="padding:' + presentation.padding + 'px;background-color:' + presentation.backgroundColor + ';border:' + presentation.borderWidth + 'px solid ' + presentation.borderColor + ';border-radius:' + presentation.borderRadius + 'px;box-shadow:' + presentation.boxShadow + ';overflow:' + presentation.overflow + ';font-family:' + fontFamily + ';color:' + presentation.textColor + '">' + titleHtml + bodyHtml + children + '</td></tr></table>';
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
  // One canonical email body for preview and clipboard. The complete export
  // wraps it in an outer page table, but that shell must never be pasted into
  // Gmail/Outlook because it carries the editor's external background color.
  const contentTableHtml = `<table role="presentation" class="ft-email-content" width="${settings.maxWidth}" border="0" cellspacing="0" cellpadding="0" style="width: 100%; max-width: ${settings.maxWidth}px; table-layout: fixed; background-color: ${settings.contentBg}; border-collapse: separate; border-spacing: 0; border-radius: ${settings.borderRadius || 0}px; overflow: hidden; box-shadow: 0 4px 18px rgba(19,50,92,0.09); font-family: ${fontFamily}; color: ${textColor}; text-align: left;">
    <tr>
      <td class="ft-email-content-cell" width="100%" style="width: 100%; max-width: 100%; box-sizing: border-box; padding: ${settings.contentPadding}px;">
        ${blockHtmls}
      </td>
    </tr>
  </table>`;
  const responsiveStyle = `<style type="text/css">
    html, body { width: 100% !important; min-width: 0 !important; }
    .ft-email-root, .ft-email-content { width: 100% !important; table-layout: fixed !important; }
    .ft-email-content-cell, .ft-email-block { width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; }
    .ft-email-block { table-layout: fixed !important; }
    .ft-email-root table { max-width: 100% !important; }
    .ft-email-root img, .ft-email-content img, img { max-width: 100% !important; height: auto !important; }
    .ft-email-layout { width: 100% !important; table-layout: fixed !important; }
    .ft-email-rich-table { width: 100% !important; max-width: 100% !important; table-layout: fixed !important; }
    .ft-email-fill-height { height: 100% !important; }
    @media only screen and (max-width: 480px) {
      .ft-email-content-cell { padding: 16px !important; }
      .ft-email-root td, .ft-email-root th { overflow-wrap: anywhere !important; word-break: break-word !important; }
      .ft-email-rich-table td, .ft-email-rich-table th { min-width: 0 !important; max-width: 100% !important; }
      .ft-email-button-table, .ft-email-button-group { max-width: 100% !important; }
      .ft-email-button-table { min-width: 0 !important; }
      .ft-email-button-group { width: 100% !important; display: table !important; }
      .ft-email-button-group tr { display: block !important; width: 100% !important; }
      .ft-email-button-cell { display: block !important; width: 100% !important; box-sizing: border-box !important; margin-bottom: 12px !important; min-width: 0 !important; padding-left: 12px !important; padding-right: 12px !important; }
      .ft-email-button-gap { display: none !important; }
      .ft-email-button-text { display: block !important; width: 100% !important; white-space: normal !important; overflow-wrap: anywhere !important; word-break: break-word !important; }
    }
  </style>`;

  // ── Export HTML (tối ưu cho email clients: body trắng, không có externalBg) ──
  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700;900&display=swap" rel="stylesheet">
  ${responsiveStyle}
  <title>${processedSubject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${settings.externalBg || '#f1f5f9'}; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  <table role="presentation" class="ft-email-root" width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; table-layout: fixed; border-collapse: collapse; background-color: ${settings.externalBg || '#f1f5f9'};">
    <tr>
      <td align="center" style="padding: 0;">
        ${contentTableHtml}
      </td>
    </tr>
  </table>
</body>
</html>`;

  // ── Preview HTML (WYSIWYG - hiển thị đúng như giao diện edit: externalBg, padding top/bottom) ──
  // Dùng cho iframe preview trong app, không dùng để gửi email
  const previewExternalBg = settings.externalBg || '#f1f5f9';
  const previewHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700;900&display=swap" rel="stylesheet">
  ${responsiveStyle}
  <style type="text/css">
    html { background-color: ${previewExternalBg}; }
    body {
      margin: 0;
      padding: 32px 0;
      background-color: ${previewExternalBg};
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
      min-height: 100vh;
    }
    .ft-email-preview-wrapper {
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 100vh;
      padding: 0 16px;
      box-sizing: border-box;
    }
    .ft-email-preview-card {
      width: 100%;
      max-width: ${settings.maxWidth}px;
      background-color: ${settings.contentBg};
      font-family: ${fontFamily};
      color: ${textColor};
      border-radius: ${settings.borderRadius || 0}px;
      overflow: hidden;
      box-shadow: 0 4px 18px rgba(19,50,92,0.09);
    }
    @media only screen and (max-width: 480px) {
      body { padding: 0; }
      .ft-email-preview-wrapper { padding: 0; }
    }
  </style>
  <title>${processedSubject}</title>
</head>
<body>
  <div class="ft-email-preview-wrapper">
    ${contentTableHtml}
  </div>
</body>
</html>`;

  // Clipboard must contain the email body only. Do not derive it by slicing
  // the complete document: the first table is the decorative outer shell.
  const copyHtml = `${responsiveStyle}${contentTableHtml}`;

  // Build plain text fallback
  const plainTextLines: string[] = [];
  plainTextLines.push(`TIÊU ĐỀ: ${processedSubject}`);
  plainTextLines.push(`===================================`);

  const appendPlainTextBlocks = (blocks: EmailBlock[]) => blocks.forEach((block: EmailBlock) => {
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
      case 'signature-builder': {
        const details = [content.fullName, content.jobTitle, content.company, content.phone, content.email, content.website, content.address].filter(Boolean).join('\n');
        if (details) plainTextLines.push(`\n${rep(details)}`);
        break;
      }      case 'signature': {
        const text = (content.html || '').replace(/<[^>]+>/g, '\n').trim();
        plainTextLines.push(`\nCHỮ KÝ:\n${rep(text)}`);
        break;
      }
      case 'social-links': {
        const links = (content.links || []).filter((l: any) => l.visible !== false).map((l: any) => `${l.label}: ${rep(l.url)}`).join(' | ');
        if (links) plainTextLines.push(`\nKết nối: ${links}`);
        break;
      }
      case 'data-table':
        (content.rows || []).forEach((row: string[]) => plainTextLines.push(row.map(cell => rep(cell)).join(' | ')));
        break;
      case 'section':
        if (content.heading) plainTextLines.push(rep(content.heading));
        if (content.body) plainTextLines.push(rep(content.body));
        break;
      case 'custom-html': {
        const text = (content.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text) plainTextLines.push(rep(text));
        break;
      }
      default:
        break;
    }
    appendPlainTextBlocks(block.children || []);
    (block.columns || []).forEach(slot => appendPlainTextBlocks(slot));
  });
  appendPlainTextBlocks(template.blocks);

  const plainText = plainTextLines.join('\n');

  return {
    subject: processedSubject,
    html,
    previewHtml,
    copyHtml,
    plainText,
    variables: allVars,
    warnings
  };
}
