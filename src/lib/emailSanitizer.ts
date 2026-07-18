export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return html;
  
  // Rich-text blocks can contain email-signature tables, so preserve them.
  const allowedTags = new Set([
    'p', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 'br', 'a', 'ul', 'ol', 'li', 'img',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col'
  ]);

  const tableAttributes = new Set(['role', 'width', 'height', 'border', 'cellpadding', 'cellspacing']);
  const cellAttributes = new Set(['width', 'height', 'colspan', 'rowspan']);
  const commonPresentationAttributes = new Set(['align', 'valign', 'bgcolor']);
  const safeLinkProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:']);

  const safeStyle = (style: string) => style
    .split(';')
    .map(declaration => declaration.trim())
    .filter(declaration => {
      const separator = declaration.indexOf(':');
      if (separator <= 0) return false;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim().toLowerCase();
      return !property.startsWith('--')
        && !/expression\s*\(|behavior\s*:|-moz-binding|@import|javascript:|vbscript:|url\s*\(/i.test(value);
    })
    .join('; ');

  const safeUrl = (value: string, protocols: Set<string>) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed;
    try {
      return protocols.has(new URL(trimmed, window.location.origin).protocol.toLowerCase()) ? trimmed : '';
    } catch {
      return '';
    }
  };

  const safeImageUrl = (value: string) => {
    const trimmed = value.trim();
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed) || /^cid:/i.test(trimmed)) return trimmed;
    return safeUrl(trimmed, new Set(['http:', 'https:', 'blob:']));
  };
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || '', 'text/html');
  
  const cleanNode = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.cloneNode(true);
    }
    
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();
      
      // Drop both harmful tags and their contents.
      if (['script', 'iframe', 'form', 'input', 'object', 'embed', 'video', 'audio', 'button'].includes(tagName)) {
        return null;
      }
      
      // If tag is not allowed but not explicitly harmful, we keep its children
      if (!allowedTags.has(tagName)) {
        const frag = doc.createDocumentFragment();
        el.childNodes.forEach(child => {
          const cleanChild = cleanNode(child);
          if (cleanChild) frag.appendChild(cleanChild);
        });
        return frag;
      }
      
      const newEl = doc.createElement(tagName);
      
      if (tagName === 'a') {
        const href = safeUrl(el.getAttribute('href') || '', safeLinkProtocols);
        if (href) {
          newEl.setAttribute('href', href);
          newEl.setAttribute('target', '_blank');
          newEl.setAttribute('rel', 'noopener noreferrer');
        }
      }
      
      if (tagName === 'img') {
        const src = safeImageUrl(el.getAttribute('src') || '');
        if (src) {
          newEl.setAttribute('src', src);
        }
        ['alt', 'width', 'height', 'border', 'align', 'hspace', 'vspace'].forEach(name => {
          const value = el.getAttribute(name);
          if (value) newEl.setAttribute(name, value);
        });
      }

      if (tagName === 'table') {
        tableAttributes.forEach(name => {
          const value = el.getAttribute(name);
          if (value) newEl.setAttribute(name, value);
        });
      }
      if (['td', 'th'].includes(tagName)) {
        cellAttributes.forEach(name => {
          const value = el.getAttribute(name);
          if (value) newEl.setAttribute(name, value);
        });
      }
      if (tagName === 'col') {
        ['span', 'width'].forEach(name => {
          const value = el.getAttribute(name);
          if (value) newEl.setAttribute(name, value);
        });
      }

      commonPresentationAttributes.forEach(name => {
        const value = el.getAttribute(name);
        if (value) newEl.setAttribute(name, value);
      });
      const style = el.getAttribute('style');
      if (style) {
        const cleanedStyle = safeStyle(style);
        if (cleanedStyle) newEl.setAttribute('style', cleanedStyle);
      }
      
      // Process children
      el.childNodes.forEach(child => {
        const cleanChild = cleanNode(child);
        if (cleanChild) newEl.appendChild(cleanChild);
      });
      
      return newEl;
    }
    
    return null;
  };
  
  const cleanFragment = doc.createDocumentFragment();
  doc.body.childNodes.forEach(child => {
    const cleanChild = cleanNode(child);
    if (cleanChild) cleanFragment.appendChild(cleanChild);
  });
  
  const container = doc.createElement('div');
  container.appendChild(cleanFragment);
  return container.innerHTML;
}

/** Sanitizes Custom HTML while preserving email-safe tables and inline/style CSS. */
export function sanitizeCustomHtml(html: string): string {
  if (typeof window === 'undefined') return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '');
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, link, form, input, video, audio').forEach(node => node.remove());
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase(); const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || (name === 'src' && value.startsWith('javascript:')) || (name === 'href' && value.startsWith('javascript:'))) el.removeAttribute(attr.name);
    });
  });
  return doc.body.innerHTML;
}

/** Small dependency-free CSS inliner for Custom HTML export (tag, .class and #id rules). */
export function inlineCustomCss(html: string): string {
  if (typeof window === 'undefined') return html.replace(/<style[\s\S]*?<\/style>/gi, '');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style').forEach(style => {
    style.textContent?.split('}').forEach(rule => {
      const [selectors, declarations] = rule.split('{');
      if (!selectors || !declarations) return;
      selectors.split(',').forEach(selector => {
        try { doc.querySelectorAll(selector.trim()).forEach(el => el.setAttribute('style', `${el.getAttribute('style') || ''};${declarations.trim()}`)); } catch { /* ignore unsupported selectors */ }
      });
    });
    style.remove();
  });
  return doc.body.innerHTML;
}
