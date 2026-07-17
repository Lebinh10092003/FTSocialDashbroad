export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return html;
  
  // Safe HTML tags list (including img tags for inline images)
  const allowedTags = new Set([
    'p', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 'br', 'a', 'ul', 'ol', 'li', 'img'
  ]);
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || '', 'text/html');
  
  const cleanNode = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.cloneNode(true);
    }
    
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();
      
      // Block harmful tags
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
      
      // Copy only allowed attributes
      if (tagName === 'a') {
        const href = el.getAttribute('href') || '';
        // Block javascript: URLs
        if (href && !href.trim().toLowerCase().startsWith('javascript:')) {
          newEl.setAttribute('href', href);
          newEl.setAttribute('target', '_blank');
        }
      }
      
      if (tagName === 'img') {
        const src = el.getAttribute('src') || '';
        // Block javascript: URLs in image sources
        if (src && !src.trim().toLowerCase().startsWith('javascript:')) {
          newEl.setAttribute('src', src);
        }
        const alt = el.getAttribute('alt');
        if (alt) newEl.setAttribute('alt', alt);
        const width = el.getAttribute('width');
        if (width) newEl.setAttribute('width', width);
        const height = el.getAttribute('height');
        if (height) newEl.setAttribute('height', height);
      }
      
      // Safe attributes
      const style = el.getAttribute('style');
      if (style) {
        // Strip event handler expressions or expressions within styles if any (simplistic)
        if (!style.toLowerCase().includes('expression') && !style.toLowerCase().includes('behavior')) {
          newEl.setAttribute('style', style);
        }
      }
      
      const align = el.getAttribute('align');
      if (align) newEl.setAttribute('align', align);
      
      const color = el.getAttribute('color');
      if (color) newEl.setAttribute('color', color);

      // Clean event attributes completely
      Array.from(el.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          // Do not copy events
        }
      });
      
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
