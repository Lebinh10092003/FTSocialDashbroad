/**
 * Copies rich HTML and plain text simultaneously to the clipboard.
 * Uses synchronous selection copying to preserve user gesture trust, which is highly compatible
 * with rich-text pasting into Gmail/Outlook and supports embedded Base64 images without security blocks.
 */
export async function copyEmailToClipboard(htmlContent: string, plainTextContent: string, emailWidth = 650): Promise<boolean> {
  try {
    // Prefer writing the exact MIME payload. Selecting an off-screen DOM node
    // lets Chrome serialise styles again against the dashboard document; Gmail
    // can then receive different table/background styles from the preview.
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        const clipboardItem = new ClipboardItem({
          'text/html': new Blob([htmlContent], { type: 'text/html' }),
          'text/plain': new Blob([plainTextContent], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([clipboardItem]);
        return true;
      } catch (clipErr) {
        console.warn('Exact HTML clipboard write failed, using legacy copy:', clipErr);
      }
    }

    // Legacy fallback for browsers that block ClipboardItem.
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'fixed';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '0';
    tempDiv.style.width = `${emailWidth}px`;
    tempDiv.style.overflow = 'hidden';
    tempDiv.innerHTML = htmlContent;
    document.body.appendChild(tempDiv);

    // Perform selection and copy using the Selection API.
    const range = document.createRange();
    range.selectNodeContents(tempDiv);
    
    const selection = window.getSelection();
    if (!selection) {
      document.body.removeChild(tempDiv);
      return false;
    }
    
    selection.removeAllRanges();
    selection.addRange(range);
    
    const successful = document.execCommand('copy');
    selection.removeAllRanges();
    document.body.removeChild(tempDiv);
    
    if (successful) {
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
