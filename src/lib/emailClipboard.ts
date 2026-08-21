const pageSurfaceProperties = ['background', 'background-color', 'background-image'] as const;

const readBackground = (element: HTMLElement) => element.getAttribute('bgcolor')
  || element.style.getPropertyValue('background-color')
  || element.style.getPropertyValue('background')
  || '';

const clearBackground = (element: HTMLElement) => {
  element.removeAttribute('bgcolor');
  pageSurfaceProperties.forEach(property => element.style.removeProperty(property));
};

const isPlainColour = (value: string) => /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i.test(value.trim());

/**
 * Remove page/chrome backgrounds before handing HTML to Gmail.
 *
 * Gmail promotes table `bgcolor` more aggressively than browser previews.
 * In particular, an imported Custom HTML wrapper can turn its original page
 * colour into a background around the entire pasted message. Tables are layout
 * containers in our output, so their own background is never needed; colours
 * intentionally used by CTAs, cards and sections live on `td`/`th` and stay.
 */
function removeClipboardPageSurfaces(documentNode: Document) {
  documentNode.querySelectorAll<HTMLElement>('table').forEach(clearBackground);

  // The generated email content table is only a width/padding shell. Its cell
  // must not carry a stale background from an older imported email either.
  documentNode.querySelectorAll<HTMLElement>('.ft-email-content > tbody > tr > td, .ft-email-root > tbody > tr > td').forEach(clearBackground);

  // A Custom HTML block is wrapped by a plain ft-email-block table. Clear the
  // source fragment's outer table/div and its immediate cell only. Nested
  // cells are actual components (buttons, cards, schedule rows) and retain
  // their authored colours.
  documentNode.querySelectorAll<HTMLElement>('table.ft-email-block:not([data-ft-block-type]), .ft-email-block-html-override').forEach(shell => {
    const roots = shell.matches('table')
      ? Array.from(shell.querySelectorAll<HTMLElement>(':scope > tbody > tr > td > :is(table, div)'))
      : Array.from(shell.children).filter((child): child is HTMLElement => child instanceof HTMLElement && /^(table|div)$/i.test(child.tagName));
    roots.forEach(root => {
      clearBackground(root);
      if (root.matches('table')) root.querySelectorAll<HTMLElement>(':scope > tbody > tr > td').forEach(clearBackground);
    });
  });
}

/** Make clipboard HTML self-contained before Gmail/Outlook can sanitise it. */
function prepareGmailClipboardHtml(htmlContent: string): string {
  const documentNode = document.implementation.createHTMLDocument('Email clipboard');
  documentNode.body.innerHTML = htmlContent;
  // Gmail inconsistently preserves a pasted style block. The email renderer
  // already writes essential presentation properties inline.
  documentNode.querySelectorAll('style, link, meta, title').forEach(element => element.remove());
  removeClipboardPageSurfaces(documentNode);
  documentNode.querySelectorAll<HTMLElement>('td, th').forEach(element => {
    const background = readBackground(element);
    if (!background || !isPlainColour(background)) return;
    // bgcolor remains the most reliable fallback in Gmail's composer, but do
    // not add it to a table wrapper: that was the source of the green frame.
    element.setAttribute('bgcolor', background.trim());
    element.style.setProperty('background-color', background.trim(), 'important');
  });
  return documentNode.body.innerHTML;
}

/**
 * The legacy fallback must not select a node inside the React application.
 * Chromium otherwise serialises ambient dashboard styles into the clipboard.
 */
async function copyFromIsolatedDocument(htmlContent: string): Promise<boolean> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"></head><body>${htmlContent}</body></html>`;
  try {
    await new Promise<void>(resolve => { frame.onload = () => resolve(); document.body.appendChild(frame); });
    const frameDocument = frame.contentDocument;
    const selection = frame.contentWindow?.getSelection();
    if (!frameDocument || !selection) return false;
    const range = frameDocument.createRange();
    range.selectNodeContents(frameDocument.body);
    selection.removeAllRanges();
    selection.addRange(range);
    return frameDocument.execCommand('copy');
  } finally {
    frame.remove();
  }
}

/** Copies rich HTML and plain text simultaneously to the clipboard. */
export async function copyEmailToClipboard(htmlContent: string, plainTextContent: string, _emailWidth = 650): Promise<boolean> {
  try {
    const clipboardHtml = prepareGmailClipboardHtml(htmlContent);
    // Prefer writing the exact MIME payload. Selecting an off-screen DOM node
    // lets Chrome serialise styles again against the dashboard document; Gmail
    // can then receive different table/background styles from the preview.
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        const clipboardItem = new ClipboardItem({
          'text/html': new Blob([clipboardHtml], { type: 'text/html' }),
          'text/plain': new Blob([plainTextContent], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([clipboardItem]);
        return true;
      } catch (clipErr) {
        console.warn('Exact HTML clipboard write failed, using legacy copy:', clipErr);
      }
    }

    // Isolated fallback for browsers that block ClipboardItem.
    if (await copyFromIsolatedDocument(clipboardHtml)) {
      return true;
    }

    // Plain-text fallback if execCommand is disabled.
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(plainTextContent);
        return true;
      }
    } catch (clipErr) {
      console.warn('Plain-text clipboard fallback failed:', clipErr);
    }
    
    return false;
  } catch (error) {
    console.error('Lỗi khi sao chép email:', error);
    return false;
  }
}

/**
 * Copies plain text (like Subject) to the clipboard.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    }
  } catch (error) {
    console.error('Lỗi khi sao chép text:', error);
    return false;
  }
}
